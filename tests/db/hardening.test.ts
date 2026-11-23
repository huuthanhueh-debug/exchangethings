import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, USERS, actAs, addMedia, as, asOwner, connect, dbTestsEnabled, expectError, iid, rows } from './helpers';

// Các lỗi do đợt rà soát độc lập tìm ra trước khi lên mạng (DECISIONS D-27). Mỗi test khóa một lỗi đã vá.
const d = dbTestsEnabled ? describe : describe.skip;
const AIRPODS = iid(10); // món điện tử đang hiển thị của An

d('chống lách sau rà soát độc lập', () => {
  let c: pg.Client;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c?.end(); });

  const statusOf = async (id: string) => (await rows<{ status: string }>(c, 'select status from items where id = $1', [id]))[0]?.status;
  async function draft(owner: string, fields: Record<string, unknown>) {
    const cols = Object.keys(fields);
    return (await rows<{ id: string }>(c,
      `insert into items (owner_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
      [owner, ...Object.values(fields)]))[0].id;
  }
  const speaker = { type: 'physical', category_id: 'electronics', title: 'Loa bluetooth JBL', est_value_vnd: 500000, delivery_methods: '{meetup}', province_code: '48' };
  const lesson = { type: 'service', category_id: 'lessons', title: 'Dạy tiếng Anh giao tiếp', est_value_vnd: 200000, delivery_methods: '{online_session}', duration_minutes: 60 };

  describe('mục "muốn đổi lấy" cũng qua bộ lọc và có giới hạn', () => {
    it('món đang hiển thị: từ cấm bị chặn, từ cần duyệt đưa món về chờ duyệt', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const msg = await expectError(c, `insert into item_wants (item_id, want_type, keyword) values ($1, 'keyword', 'v​ape')`, [AIRPODS]);
        expect(msg).toMatch(/banned keyword/);
        await c.query(`insert into item_wants (item_id, want_type, keyword) values ($1, 'keyword', 'USDT')`, [AIRPODS]);
        expect(await statusOf(AIRPODS)).toBe('pending_review');
      });
    });
    it('món nháp có từ cấm ở mong muốn thì không đăng được', async () => {
      await as(c, { sub: USERS.khanh }, async () => {
        const id = await draft(USERS.khanh, lesson);
        await c.query(`insert into item_wants (item_id, want_type, keyword) values ($1, 'keyword', 'súng hơi')`, [id]);
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/banned keyword/);
      });
    });
    it('tối đa 5 mong muốn mỗi món', async () => {
      await as(c, { sub: USERS.khanh }, async () => {
        const id = await draft(USERS.khanh, lesson);
        for (let k = 0; k < 5; k++) await c.query(`insert into item_wants (item_id, want_type, keyword) values ($1, 'keyword', $2)`, [id, `mong muốn ${k}`]);
        expect(await expectError(c, `insert into item_wants (item_id, want_type, keyword) values ($1, 'keyword', 'thứ sáu')`, [id])).toMatch(/too many wants/);
      });
    });
    it('người dùng không gọi thẳng được bộ lọc để dò danh sách từ cấm; chỉ xem kết quả của món mình', async () => {
      await as(c, { sub: USERS.khanh }, async () => {
        expect(await expectError(c, `select banned_keyword_severity('vape')`)).toMatch(/permission denied/);
        const id = await draft(USERS.khanh, { ...lesson, category_id: 'hands-on', title: 'Huấn luyện chó cơ bản' });
        expect((await rows(c, 'select my_item_severity($1)::text as s', [id]))[0].s).toBe('flag');
        await actAs(c, { sub: USERS.binh });
        expect((await rows(c, 'select my_item_severity($1)::text as s', [id]))[0].s).toBeNull();
      });
    });
  });

  describe('món loại "khác" phải duyệt lại khi đổi nội dung', () => {
    it('đã được duyệt rồi đổi tên thì quay về chờ duyệt; món loại thường thì không', async () => {
      await as(c, { sub: USERS.admin }, async () => {
        await c.query('select admin_review_item($1, true)', [ITEMS.giangBonsaiPending]);
        await actAs(c, { sub: USERS.giang });
        expect(await statusOf(ITEMS.giangBonsaiPending)).toBe('active');
        await c.query(`update items set title = 'Món hoàn toàn khác' where id = $1`, [ITEMS.giangBonsaiPending]);
        expect(await statusOf(ITEMS.giangBonsaiPending)).toBe('pending_review');
      });
      await as(c, { sub: USERS.an }, async () => {
        await c.query(`update items set title = 'Tai nghe AirPods Pro 2 fullbox' where id = $1`, [AIRPODS]);
        expect(await statusOf(AIRPODS)).toBe('active');
      });
    });
    it('đã được duyệt rồi thêm ảnh cũng phải duyệt lại', async () => {
      await as(c, { sub: USERS.admin }, async () => {
        await c.query('select admin_review_item($1, true)', [ITEMS.giangBonsaiPending]);
        await addMedia(c, ITEMS.giangBonsaiPending, USERS.giang, 1);
        expect(await statusOf(ITEMS.giangBonsaiPending)).toBe('pending_review');
      });
    });
  });

  describe('ghi chú duyệt và nhật ký duyệt', () => {
    it('ghi chú khi duyệt là nội bộ: không nằm trên món, chỉ admin đọc trong nhật ký', async () => {
      await as(c, { sub: USERS.admin }, async () => {
        await c.query('select admin_review_item($1, true, $2)', [ITEMS.giangBonsaiPending, 'Ghi chú nội bộ']);
        expect(await rows(c, 'select approved, note from item_reviews where item_id = $1', [ITEMS.giangBonsaiPending]))
          .toEqual([{ approved: true, note: 'Ghi chú nội bộ' }]);
        expect(await expectError(c, `update item_reviews set note = 'sửa'`)).toMatch(/append-only|permission denied/);
        for (const who of [{ sub: USERS.giang }, { sub: USERS.binh }, 'anon'] as const) {
          await actAs(c, who);
          expect((await rows(c, 'select review_note from items where id = $1', [ITEMS.giangBonsaiPending]))[0].review_note).toBeNull();
          if (who === 'anon') expect(await expectError(c, 'select id from item_reviews')).toMatch(/permission denied/);
          else expect(await rows(c, 'select id from item_reviews')).toHaveLength(0);
        }
      });
    });
    it('lý do từ chối: chủ món đọc được, người khác không', async () => {
      await as(c, { sub: USERS.admin }, async () => {
        await c.query('select admin_review_item($1, false, $2)', [ITEMS.giangBonsaiPending, 'Ảnh chưa rõ']);
        await actAs(c, { sub: USERS.giang });
        expect(await rows(c, 'select approved, note from item_reviews')).toEqual([{ approved: false, note: 'Ảnh chưa rõ' }]);
        expect((await rows(c, 'select review_note from items where id = $1', [ITEMS.giangBonsaiPending]))[0].review_note).toBe('Ảnh chưa rõ');
        await actAs(c, { sub: USERS.binh });
        expect(await rows(c, 'select id from item_reviews')).toHaveLength(0);
        expect(await rows(c, 'select id from items where id = $1', [ITEMS.giangBonsaiPending])).toHaveLength(0);
      });
    });
  });

  describe('giới hạn và khóa ảnh ở tầng database', () => {
    it('tối đa 10 ảnh sản phẩm và 4 ảnh chứng từ, kể cả khi server ghi', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const id = await draft(USERS.an, speaker);
        await addMedia(c, id, USERS.an, 10);
        await addMedia(c, id, USERS.an, 4, 'proof');
        await c.query('set local role service_role');
        const one = (kind: string) => expectError(c,
          `insert into item_media (item_id, owner_id, kind, storage_path, exif_stripped) values ($1, $2, $3, $4, true)`, [id, USERS.an, kind, `t/${id}/${kind}-over.webp`]);
        expect(await one('photo')).toMatch(/too many photos/);
        expect(await one('proof')).toMatch(/too many proofs/);
      });
    });
    it('không xóa được ảnh của món đã đăng, kể cả bằng quyền server; món nháp thì xóa được', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const id = await draft(USERS.an, speaker);
        await addMedia(c, id, USERS.an, 3);
        await c.query('set local role service_role');
        expect(await expectError(c, 'delete from item_media where item_id = $1', [AIRPODS])).toMatch(/cannot delete media of a listed item/);
        expect((await c.query('delete from item_media where item_id = $1', [id])).rowCount).toBe(3);
      });
    });
    it('xóa hẳn một món thì ảnh của món được xóa theo', async () => {
      await asOwner(c, async () => {
        expect((await c.query('delete from items where id = $1', [AIRPODS])).rowCount).toBe(1);
        expect(await rows(c, 'select id from item_media where item_id = $1', [AIRPODS])).toHaveLength(0);
      });
    });
  });

  describe('điện thoại đã đăng: không đổi IMEI, không bỏ cam kết thoát tài khoản', () => {
    it('đổi IMEI hoặc bỏ cam kết khi món đang hiển thị thì bị chặn; ghi lại đúng IMEI cũ thì được', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await expectError(c, `update item_private set imei_full = '490154203237518' where item_id = $1`, [ITEMS.anIphone15])).toMatch(/changing its IMEI/);
        expect(await expectError(c, `update items set signed_out_confirmed = false where id = $1`, [ITEMS.anIphone15])).toMatch(/sign-out confirmation/);
        const same = await c.query(`update item_private set imei_full = imei_full where item_id = $1`, [ITEMS.anIphone15]);
        expect(same.rowCount).toBe(1);
        expect((await rows(c, 'select imei_last4 from items where id = $1', [ITEMS.anIphone15]))[0].imei_last4).toBe('4821');
      });
    });
    it('gỡ món rồi thì đổi được IMEI, 4 số cuối đổi theo', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await c.query('select withdraw_item($1)', [ITEMS.anIphone15]);
        await c.query(`update item_private set imei_full = '490154203237518' where item_id = $1`, [ITEMS.anIphone15]);
        expect((await rows(c, 'select imei_last4 from items where id = $1', [ITEMS.anIphone15]))[0].imei_last4).toBe('7518');
      });
    });
  });

  describe('quyền gọi hàm', () => {
    // Supabase mặc định cho anon/authenticated gọi mọi hàm mới trong schema public. Test này canh danh sách:
    // thêm hàm mới mà quên thu hồi quyền thì test đỏ.
    it('khách và người dùng chỉ gọi được đúng các hàm trong danh sách cho phép', async () => {
      const callable = async (role: string) => (await rows<{ name: string }>(c,
        `select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.name);
      const forAnon = ['is_active_user', 'is_admin', 'is_banned'];
      expect(await callable('anon')).toEqual(forAnon);
      expect(await callable('authenticated')).toEqual([...forAnon, 'admin_review_item', 'is_blocked_with', 'mark_match_read',
        'my_item_severity', 'my_profile', 'publish_item', 'send_message', 'swipe_item', 'withdraw_item'].sort());
    });
  });

  describe('quyền trên bảng', () => {
    // Supabase cấp sẵn ALL trên mọi bảng MỚI cho anon và authenticated. Ba test này canh danh sách:
    // thêm bảng mới mà quên thu hồi, hoặc cấp thừa một cột, thì test đỏ.
    const tablePrivileges = (role: string, privileges: string[]) => rows<{ t: string; p: string }>(c, `
      select c.relname::text as t, p.priv as p
        from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest($2::text[]) as p(priv)
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and has_table_privilege($1, c.oid, p.priv)
       order by 1, 2`, [role, privileges]);
    const columnPrivileges = (role: string) => rows<{ t: string; p: string; cols: string }>(c, `
      select c.relname::text as t, p.priv as p, string_agg(a.attname::text, ' ' order by a.attname) as cols
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped,
             unnest(array['INSERT', 'UPDATE']) as p(priv)
       where n.nspname = 'public' and c.relkind in ('r', 'p') and has_column_privilege($1, c.oid, a.attnum, p.priv)
       group by 1, 2 order by 1, 2`, [role]);
    const WRITE = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];

    it('khách không ghi được bảng nào, cột nào; chỉ đọc được dữ liệu tham chiếu, hồ sơ công khai, món và đánh giá', async () => {
      expect(await tablePrivileges('anon', WRITE)).toEqual([]);
      expect(await columnPrivileges('anon')).toEqual([]);
      expect((await tablePrivileges('anon', ['SELECT'])).map((r) => r.t))
        .toEqual(['categories', 'item_media', 'item_wants', 'items', 'platform_settings', 'provinces', 'reviews', 'wards']);
    });
    it('người dùng chỉ có đúng các quyền ghi mức bảng trong danh sách', async () => {
      expect(await tablePrivileges('authenticated', WRITE)).toEqual([{ t: 'blocks', p: 'DELETE' }, { t: 'item_wants', p: 'DELETE' }]);
    });
    it('người dùng chỉ ghi được đúng các cột trong danh sách', async () => {
      const itemColumns = 'category_id condition delivery_methods description duration_minutes est_value_vnd expires_on province_code '
        + 'sell_price_vnd signed_out_confirmed title topup_pay_max_vnd topup_receive_max_vnd transfer_right_confirmed';
      expect(await columnPrivileges('authenticated')).toEqual([
        { t: 'blocks', p: 'INSERT', cols: 'blocked_id blocker_id' },
        { t: 'item_private', p: 'INSERT', cols: 'imei_full item_id owner_id' },
        { t: 'item_private', p: 'UPDATE', cols: 'imei_full' },
        { t: 'item_wants', p: 'INSERT', cols: 'category_id item_id keyword want_type wanted_item_id' },
        { t: 'items', p: 'INSERT', cols: itemColumns.replace('category_id ', 'category_id ').replace('expires_on ', 'expires_on owner_id ').replace(' title', ' title').replace('transfer_right_confirmed', 'transfer_right_confirmed type') },
        { t: 'items', p: 'UPDATE', cols: itemColumns },
        { t: 'notifications', p: 'UPDATE', cols: 'read_at' },
        { t: 'profile_private', p: 'UPDATE', cols: 'phone_e164 street_address' },
        { t: 'profiles', p: 'UPDATE', cols: 'avatar_path bio display_name locale province_code ward_code' },
      ]);
    });
  });

  describe('hồ sơ: cột riêng tư và nội dung công khai', () => {
    it('phường/xã, vai trò, ngày khóa không đọc được bằng SELECT; cột công khai thì được', async () => {
      for (const who of ['anon', { sub: USERS.binh }] as const) {
        await as(c, who, async () => {
          for (const col of ['ward_code', 'role', 'banned_at', 'lost_disputes_90d', '*']) {
            expect(await expectError(c, `select ${col} from profiles where id = $1`, [USERS.an])).toMatch(/permission denied/);
          }
          expect(await rows(c, 'select display_name, province_code, tier, trust_score from profiles where id = $1', [USERS.an]))
            .toEqual([{ display_name: 'An', province_code: '48', tier: 'regular', trust_score: 74 }]);
        });
      }
    });
    it('chủ tài khoản đọc hồ sơ đầy đủ của mình qua my_profile(); khách không gọi được', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const r = await rows<{ id: string; ward_code: string; role: string }>(c, 'select id, ward_code, role from my_profile()');
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ id: USERS.an, role: 'user' });
        expect(r[0].ward_code).toMatch(/^\d{5}$/);
      });
      await as(c, 'anon', async () => {
        expect(await expectError(c, 'select * from my_profile()')).toMatch(/permission denied/);
      });
    });
    it('tên hiển thị và lời giới thiệu không chứa từ cấm', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await expectError(c, `update profiles set display_name = 'Shop vape giá rẻ' where id = $1`, [USERS.an])).toMatch(/banned keyword/);
        expect(await expectError(c, `update profiles set bio = 'Nhận ship ma  túy' where id = $1`, [USERS.an])).toMatch(/banned keyword/);
        expect((await c.query(`update profiles set bio = 'Hay đổi đồ công nghệ ở Hải Châu' where id = $1`, [USERS.an])).rowCount).toBe(1);
      });
    });
    it('tài khoản mới: tên mặc định trung tính, không lấy từ email; tên có từ cấm bị thay', async () => {
      await asOwner(c, async () => {
        await c.query(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'nguyen.van.thanh@example.com')`);
        await c.query(`insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-4000-8000-0000000000a2', 'x@example.com', '{"display_name":"Shop vape"}')`);
        const r = await rows<{ display_name: string }>(c, `select display_name from profiles where id::text like '%-0000000000a_' order by id`);
        expect(r.map((x) => x.display_name)).toEqual(['Thành viên 0000', 'Thành viên 0000']);
      });
    });
  });
});
