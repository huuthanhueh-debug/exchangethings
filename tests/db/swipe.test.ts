import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, SEED_MATCH, USERS, actAs, as, asOwner, asService, connect, dbTestsEnabled, expectError, rows } from './helpers';

// M2: quẹt và khớp (SPEC mục 5.3), giới hạn tần suất và chặn (mục 12), quyền đọc (mục 10).
const d = dbTestsEnabled ? describe : describe.skip;

type SwipeResult = { matched: boolean; match_id: string | null; is_new: boolean };

d('quẹt và khớp', () => {
  let c: pg.Client;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c?.end(); });

  const swipe = async (client: pg.Client, item: string, direction: 'like' | 'pass' = 'like') =>
    (await rows<SwipeResult>(client, 'select * from swipe_item($1, $2)', [item, direction]))[0];
  const setLimit = (key: string, n: number) => asService(c, () =>
    c.query(`update platform_settings set value = jsonb_set(value, $1, $2::jsonb) where key = 'rate_limits'`, [`{${key}}`, String(n)]));

  describe('luật khớp', () => {
    it('A thích một món của B, B thích một món bất kỳ của A thì khớp; match ghi đúng món của từng người', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await swipe(c, ITEMS.binhIphone18)).toEqual({ matched: false, match_id: null, is_new: false });
        await actAs(c, { sub: USERS.binh });
        const r = await swipe(c, ITEMS.anAirpods); // không cần đúng món An đang muốn đổi
        expect(r).toMatchObject({ matched: true, is_new: true });
        expect(await rows(c, 'select user_a, user_b, item_a, item_b from matches where id = $1', [r.match_id]))
          .toEqual([{ user_a: USERS.an, user_b: USERS.binh, item_a: ITEMS.anAirpods, item_b: ITEMS.binhIphone18 }]);
      });
    });
    it('người có id lớn hơn quẹt sau cùng thì match vẫn ghi đúng chiều', async () => {
      await as(c, { sub: USERS.binh }, async () => {
        await swipe(c, ITEMS.anIphone15);
        await actAs(c, { sub: USERS.an });
        const r = await swipe(c, ITEMS.binhCamera);
        expect(await rows(c, 'select user_a, user_b, item_a, item_b from matches where id = $1', [r.match_id]))
          .toEqual([{ user_a: USERS.an, user_b: USERS.binh, item_a: ITEMS.anIphone15, item_b: ITEMS.binhCamera }]);
      });
    });
    it('hai người đã khớp thì thích thêm món khác không tạo match mới', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await swipe(c, ITEMS.binhIphone18);
        await actAs(c, { sub: USERS.binh });
        const first = await swipe(c, ITEMS.anIphone15);
        await actAs(c, { sub: USERS.an });
        expect(await swipe(c, ITEMS.binhCamera)).toEqual({ matched: true, match_id: first.match_id, is_new: false });
        expect((await rows(c, 'select count(*)::int as n from matches where user_a = $1 and user_b = $2', [USERS.an, USERS.binh]))[0].n).toBe(1);
      });
    });
    it('bỏ qua thì không khớp; đổi ý thích lại thì khớp', async () => {
      await as(c, { sub: USERS.binh }, async () => {
        await swipe(c, ITEMS.anIphone15);
        await actAs(c, { sub: USERS.an });
        expect(await swipe(c, ITEMS.binhIphone18, 'pass')).toEqual({ matched: false, match_id: null, is_new: false });
        expect(await rows(c, 'select direction::text from swipes where viewer_id = $1', [USERS.an])).toEqual([{ direction: 'pass' }]);
        expect(await swipe(c, ITEMS.binhIphone18, 'like')).toMatchObject({ matched: true, is_new: true });
        expect(await rows(c, 'select direction::text from swipes where viewer_id = $1', [USERS.an])).toEqual([{ direction: 'like' }]);
      });
    });
    it('lượt thích trên món đã gỡ không còn tính', async () => {
      await as(c, { sub: USERS.binh }, async () => {
        await swipe(c, ITEMS.anIphone15);
        await actAs(c, { sub: USERS.an });
        await c.query('select withdraw_item($1)', [ITEMS.anIphone15]);
        expect(await swipe(c, ITEMS.binhIphone18)).toEqual({ matched: false, match_id: null, is_new: false });
      });
    });
    it('khớp mới thì cả hai nhận thông báo, mỗi người chỉ đọc được thông báo của mình', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await swipe(c, ITEMS.binhIphone18);
        await actAs(c, { sub: USERS.binh });
        const r = await swipe(c, ITEMS.anIphone15);
        for (const who of [USERS.an, USERS.binh]) {
          await actAs(c, { sub: who });
          expect(await rows(c, 'select user_id, type, payload from notifications'))
            .toEqual([{ user_id: who, type: 'match_new', payload: { match_id: r.match_id } }]);
        }
        await actAs(c, { sub: USERS.chi });
        expect(await rows(c, 'select id from notifications')).toHaveLength(0);
      });
    });
    it('hai lượt thích chéo gửi cùng lúc vẫn ra đúng một match', async () => {
      // Hai kết nối, commit thật: lượt của Linh phải chờ lượt của Khánh commit rồi mới kiểm tra.
      const c2 = await connect();
      const users = [USERS.khanh, USERS.linh];
      try {
        await c.query('begin');
        await actAs(c, { sub: USERS.khanh });
        await c2.query('begin');
        await actAs(c2, { sub: USERS.linh });
        expect(await swipe(c, ITEMS.linhLogo)).toMatchObject({ matched: false });
        const second = swipe(c2, ITEMS.khanhLesson);
        const early = await Promise.race([second.then(() => 'returned'), new Promise((r) => setTimeout(() => r('waiting'), 300))]);
        expect(early).toBe('waiting');
        await c.query('commit');
        expect(await second).toMatchObject({ matched: true, is_new: true });
        await c2.query('commit');
        expect((await rows(c, 'select count(*)::int as n from matches where user_a = any($1) and user_b = any($1)', [users]))[0].n).toBe(1);
      } finally {
        await c.query('rollback').catch(() => {});
        await c2.query('rollback').catch(() => {});
        await c.query('delete from matches where user_a = any($1) and user_b = any($1)', [users]);
        await c.query('delete from swipes where viewer_id = any($1)', [users]);
        await c.query('delete from notifications where user_id = any($1)', [users]);
        await c2.end();
      }
    });
  });

  describe('món không quẹt được', () => {
    it('món của mình, món nháp, món chờ duyệt, món không tồn tại', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.anIphone15, 'like'])).toMatch(/your own item/);
        for (const id of [ITEMS.emUkuleleDraft, ITEMS.giangBonsaiPending, '00000000-0000-4000-9000-000000009999']) {
          expect(await expectError(c, 'select * from swipe_item($1, $2)', [id, 'like'])).toMatch(/item is not available/);
        }
        expect(await rows(c, 'select item_id from swipes')).toHaveLength(0);
      });
    });
    it('món của người bị khóa; người bị khóa cũng không quẹt được', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await asService(c, () => c.query('update profiles set banned_at = now() where id = $1', [USERS.binh]));
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.binhIphone18, 'like'])).toMatch(/item is not available/);
        await actAs(c, { sub: USERS.binh });
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.anIphone15, 'like'])).toMatch(/sign in to swipe/);
      });
    });
    it('khách không gọi được', async () => {
      await as(c, 'anon', async () => {
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.anIphone15, 'like'])).toMatch(/permission denied/);
      });
    });
    it('đã chặn nhau thì không quẹt được món của nhau, cả hai chiều, và không lộ lý do', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await c.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [USERS.an, USERS.binh]);
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.binhIphone18, 'like'])).toMatch(/item is not available/);
        await actAs(c, { sub: USERS.binh });
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.anIphone15, 'like'])).toMatch(/item is not available/);
        expect((await rows(c, 'select is_blocked_with($1) as b', [USERS.an]))[0].b).toBe(true);
        expect((await rows(c, 'select is_blocked_with($1) as b', [USERS.chi]))[0].b).toBe(false);
      });
    });
  });

  describe('giới hạn lượt quẹt mỗi 24 giờ (SPEC mục 12)', () => {
    it('đọc từ platform_settings; quẹt lại món cũ không tính thêm; lượt quá 24 giờ không tính', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await setLimit('swipes_per_day', 2);
        await swipe(c, ITEMS.binhIphone18);
        await swipe(c, ITEMS.binhCamera, 'pass');
        expect(await expectError(c, 'select * from swipe_item($1, $2)', [ITEMS.binhExcel, 'like'])).toMatch(/daily swipe limit reached/);
        expect(await swipe(c, ITEMS.binhCamera, 'like')).toMatchObject({ matched: false });
        await asService(c, () => c.query(`update swipes set created_at = now() - interval '25 hours' where item_id = $1`, [ITEMS.binhIphone18]));
        expect(await swipe(c, ITEMS.binhExcel)).toMatchObject({ matched: false });
      });
    });
    it('mặc định 300 lượt; cấu hình sai kiểu thì dùng mặc định', async () => {
      await asOwner(c, async () => {
        expect((await rows(c, `select rate_limit('swipes_per_day', 7) as n`))[0].n).toBe(300);
        await c.query(`update platform_settings set value = '{"swipes_per_day": "nhiều"}' where key = 'rate_limits'`);
        expect((await rows(c, `select rate_limit('swipes_per_day', 7) as n`))[0].n).toBe(7);
        await c.query(`delete from platform_settings where key = 'rate_limits'`);
        expect((await rows(c, `select rate_limit('messages_per_day', 9) as n`))[0].n).toBe(9);
      });
    });
  });

  describe('quyền đọc và ghi (SPEC mục 10)', () => {
    it('lượt quẹt: chỉ người quẹt đọc được; chủ món không biết ai đã thích món của mình', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await swipe(c, ITEMS.binhIphone18);
        expect(await rows(c, 'select item_id from swipes')).toEqual([{ item_id: ITEMS.binhIphone18 }]);
        for (const who of [USERS.binh, USERS.admin]) {
          await actAs(c, { sub: who });
          expect(await rows(c, 'select item_id from swipes where viewer_id = $1', [USERS.an])).toHaveLength(0);
        }
      });
    });
    it('match: chỉ hai người trong cuộc đọc được; người ngoài và admin không; khách bị từ chối', async () => {
      for (const who of [USERS.chi, USERS.dung]) {
        await as(c, { sub: who }, async () => {
          expect(await rows(c, 'select id from matches')).toEqual([{ id: SEED_MATCH }]);
        });
      }
      for (const who of [USERS.an, USERS.admin]) {
        await as(c, { sub: who }, async () => {
          expect(await rows(c, 'select id from matches')).toHaveLength(0);
        });
      }
      await as(c, 'anon', async () => {
        for (const table of ['matches', 'swipes', 'messages', 'blocks', 'notifications', 'match_reads']) {
          expect(await expectError(c, `select * from ${table}`)).toMatch(/permission denied/);
        }
      });
    });
    it('không ai ghi thẳng được lượt quẹt hay match: chỉ đi qua swipe_item', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await expectError(c, `insert into swipes (viewer_id, item_id, direction) values ($1, $2, 'like')`, [USERS.an, ITEMS.binhIphone18])).toMatch(/permission denied/);
        expect(await expectError(c, `insert into swipes (viewer_id, item_id, direction) values ($1, $2, 'like')`, [USERS.binh, ITEMS.anIphone15])).toMatch(/permission denied/);
        expect(await expectError(c, 'insert into matches (user_a, user_b) values ($1, $2)', [USERS.an, USERS.binh])).toMatch(/permission denied/);
        expect(await expectError(c, 'delete from swipes')).toMatch(/permission denied/);
        expect(await expectError(c, 'delete from matches')).toMatch(/permission denied/);
      });
      await as(c, { sub: USERS.chi }, async () => {
        expect(await expectError(c, 'update matches set item_a = null where id = $1', [SEED_MATCH])).toMatch(/permission denied/);
      });
    });
  });

  describe('chặn người dùng (bảng blocks)', () => {
    it('tự chặn và bỏ chặn; chỉ đọc danh sách mình chặn; không chặn hộ, không tự chặn mình', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await c.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [USERS.an, USERS.binh]);
        expect(await expectError(c, 'insert into blocks (blocker_id, blocked_id) values ($1, $2)', [USERS.binh, USERS.chi])).toMatch(/row-level security/);
        expect(await expectError(c, 'insert into blocks (blocker_id, blocked_id) values ($1, $1)', [USERS.an])).toMatch(/check constraint/);
        await actAs(c, { sub: USERS.binh });
        expect(await rows(c, 'select blocked_id from blocks')).toHaveLength(0); // không đọc được ai đang chặn mình
        expect((await c.query('delete from blocks')).rowCount).toBe(0); // và không gỡ được
        await actAs(c, { sub: USERS.an });
        expect(await rows(c, 'select blocked_id from blocks')).toEqual([{ blocked_id: USERS.binh }]);
        expect((await c.query('delete from blocks where blocked_id = $1', [USERS.binh])).rowCount).toBe(1);
      });
    });
  });

  describe('thông báo', () => {
    it('chỉ đánh dấu đã đọc thông báo của mình; không tự tạo, không sửa nội dung', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await swipe(c, ITEMS.binhIphone18);
        await actAs(c, { sub: USERS.binh });
        await swipe(c, ITEMS.anIphone15);
        expect((await c.query('update notifications set read_at = now()')).rowCount).toBe(1);
        expect(await expectError(c, `update notifications set payload = '{}'`)).toMatch(/permission denied/);
        expect(await expectError(c, `insert into notifications (user_id, type) values ($1, 'x')`, [USERS.binh])).toMatch(/permission denied/);
        await actAs(c, { sub: USERS.an });
        expect(await rows(c, 'select read_at from notifications')).toEqual([{ read_at: null }]);
      });
    });
  });

  describe('mong muốn "món cụ thể"', () => {
    it('không chọn món của chính mình; không chọn trùng một món hai lần', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const add = `insert into item_wants (item_id, want_type, wanted_item_id) values ($1, 'item', $2)`;
        expect(await expectError(c, add, [ITEMS.anIphone15, ITEMS.anAirpods])).toMatch(/cannot want your own item/);
        await c.query(add, [ITEMS.anIphone15, ITEMS.binhIphone18]);
        expect(await expectError(c, add, [ITEMS.anIphone15, ITEMS.binhIphone18])).toMatch(/duplicate key/);
      });
    });
  });
});
