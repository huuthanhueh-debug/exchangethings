import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { SEED_MATCH, USERS, actAs, as, asOwner, asService, connect, dbTestsEnabled, expectError, rows } from './helpers';

// M2: chat trong match. Quyền đọc (SPEC mục 10), che thông tin liên lạc và giới hạn tần suất (mục 12).
const d = dbTestsEnabled ? describe : describe.skip;

type Message = { id: string; match_id: string; sender_id: string; body: string; masked: boolean; created_at: Date };

d('chat', () => {
  let c: pg.Client;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c?.end(); });

  const send = async (body: string, match = SEED_MATCH) =>
    (await rows<Message>(c, 'select * from send_message($1, $2)', [match, body]))[0];
  const sendError = (body: string, match = SEED_MATCH) => expectError(c, 'select * from send_message($1, $2)', [match, body]);

  describe('quyền đọc và gửi', () => {
    it('hai người trong match gửi và đọc được; người ngoài, admin không đọc, không gửi được', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const m = await send('Dạ vâng, hẹn anh thứ Bảy ạ');
        expect(m).toMatchObject({ match_id: SEED_MATCH, sender_id: USERS.chi, body: 'Dạ vâng, hẹn anh thứ Bảy ạ', masked: false });
        await actAs(c, { sub: USERS.dung });
        expect((await rows(c, 'select count(*)::int as n from messages where match_id = $1', [SEED_MATCH]))[0].n).toBe(4);
        expect(await send('Ok em')).toMatchObject({ sender_id: USERS.dung });
        for (const who of [USERS.an, USERS.admin]) {
          await actAs(c, { sub: who });
          expect(await rows(c, 'select id from messages')).toHaveLength(0);
          expect(await sendError('Chen vào')).toMatch(/match not found/);
        }
      });
    });
    it('khách không đọc, không gửi được', async () => {
      await as(c, 'anon', async () => {
        expect(await expectError(c, 'select * from messages')).toMatch(/permission denied/);
        expect(await sendError('xin chào')).toMatch(/permission denied/);
      });
    });
    it('không ai ghi thẳng, sửa hay xóa tin nhắn', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        expect(await expectError(c, `insert into messages (match_id, sender_id, body) values ($1, $2, '0905123456')`, [SEED_MATCH, USERS.chi])).toMatch(/permission denied/);
        expect(await expectError(c, `update messages set body = 'sửa'`)).toMatch(/permission denied/);
        expect(await expectError(c, 'delete from messages')).toMatch(/permission denied/);
      });
    });
    it('đã chặn nhau thì không nhắn được, cả hai chiều', async () => {
      await as(c, { sub: USERS.dung }, async () => {
        await c.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [USERS.dung, USERS.chi]);
        expect(await sendError('alo')).toMatch(/cannot message this user/);
        await actAs(c, { sub: USERS.chi });
        expect(await sendError('alo')).toMatch(/cannot message this user/);
      });
    });
    it('người bị khóa không nhắn được, và không ai nhắn được cho người bị khóa', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        await asService(c, () => c.query('update profiles set banned_at = now() where id = $1', [USERS.dung]));
        expect(await sendError('alo')).toMatch(/cannot message this user/);
        await actAs(c, { sub: USERS.dung });
        expect(await sendError('alo')).toMatch(/sign in to send messages/);
      });
    });
  });

  describe('che thông tin liên lạc cho tới khi giao dịch được khóa', () => {
    it('số điện thoại, số tài khoản, liên kết, email bị che trước khi lưu; không còn bản gốc trong database', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const m = await send('Gọi em 0905 123 456 hoặc ck 19035551234567 VCB, xem zalo.me/chi, mail chi@example.com');
        expect(m.body).toBe('Gọi em [đã ẩn số điện thoại] hoặc ck [đã ẩn dãy số] VCB, xem [đã ẩn liên kết], mail [đã ẩn email]');
        expect(m.masked).toBe(true);
        await asService(c, async () => {
          const leaked = await rows(c, `select id from messages where body ~ '0905|1903555|zalo|example'`);
          expect(leaked).toHaveLength(0);
        });
      });
    });
    it('tin bình thường giữ nguyên văn: số tiền, ngày giờ, emoji', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const text = 'Áo 8.000.000 ₫, em bù 1.000.000 nhé. Hẹn 28/11/2026 lúc 14:30 ❤️ 👨‍👩‍👧';
        expect(await send(text)).toMatchObject({ body: text, masked: false });
      });
    });
    it('có giao dịch đã khóa giữa hai người thì không che nữa; mới chấp nhận thì vẫn che', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const txn = await asService(c, async () => {
          const offer = (await rows<{ id: string }>(c, 'insert into offers (from_user, to_user) values ($1, $2) returning id', [USERS.chi, USERS.dung]))[0].id;
          const version = (await rows<{ id: string }>(c, 'insert into offer_versions (offer_id, version, author_id) values ($1, 1, $2) returning id', [offer, USERS.chi]))[0].id;
          return (await rows<{ id: string }>(c, `insert into transactions (offer_version_id, kind, status) values ($1, 'meetup', 'accepted') returning id`, [version]))[0].id;
        });
        expect(await send('Số em 0905123456')).toMatchObject({ body: 'Số em [đã ẩn số điện thoại]', masked: true });
        await asService(c, () => c.query(`update transactions set status = 'locked' where id = $1`, [txn]));
        expect(await send('Số em 0905123456')).toMatchObject({ body: 'Số em 0905123456', masked: false });
        await actAs(c, { sub: USERS.dung });
        expect(await send('Anh 0911222333')).toMatchObject({ masked: false });
      });
    });

    // Bảng ca cho hàm che. Cột 2 là kết quả mong đợi; null nghĩa là giữ nguyên văn.
    const CASES: [input: string, expected: string | null][] = [
      // Số điện thoại Việt Nam
      ['gọi 0905 123 456 nhé', 'gọi [đã ẩn số điện thoại] nhé'],
      ['sdt: 0905.123.456', 'sdt: [đã ẩn số điện thoại]'],
      ['0905-123-456', '[đã ẩn số điện thoại]'],
      ['+84 905 123 456', '[đã ẩn số điện thoại]'],
      ['(+84)905123456', '[đã ẩn số điện thoại]'],
      ['84905123456', '[đã ẩn số điện thoại]'],
      ['0 9 0 5 1 2 3 4 5 6', '[đã ẩn số điện thoại]'],
      ['bàn 028 3822 1234', 'bàn [đã ẩn số điện thoại]'],
      ['zalo0905123456', 'zalo[đã ẩn số điện thoại]'],
      ['０９０５１２３４５６', '[đã ẩn số điện thoại]'], // số fullwidth
      ['09' + '​' + '05123456', '[đã ẩn số điện thoại]'], // ký tự vô hình chen giữa
      // Số tài khoản, số thẻ, IMEI
      ['stk 19035551234567 techcombank', 'stk [đã ẩn dãy số] techcombank'],
      ['vcb 0011004123456', 'vcb [đã ẩn dãy số]'],
      ['thẻ 9704123456789012345', 'thẻ [đã ẩn dãy số]'],
      ['1234 5678 9012 3456', '[đã ẩn dãy số]'],
      ['1234-5678-9012', '[đã ẩn dãy số]'],
      ['imei 353912000084821', 'imei [đã ẩn dãy số]'],
      ['ok.0905123456', 'ok.[đã ẩn dãy số]'],
      // Liên kết và email
      ['xem https://momo.vn/pay/abc?x=1 nhé', 'xem [đã ẩn liên kết] nhé'],
      ['HTTP://EXAMPLE.COM/a', '[đã ẩn liên kết]'],
      ['vào www.example.com', 'vào [đã ẩn liên kết]'],
      ['t.me/abc và bit.ly/xyz', '[đã ẩn liên kết] và [đã ẩn liên kết]'],
      ['zalo.me/0905123456', '[đã ẩn liên kết]'],
      ['mail an.nguyen+x@gmail.com nha', 'mail [đã ẩn email] nha'],
      ['Xem shopee.vn/abc-i.12, rồi báo em.', 'Xem [đã ẩn liên kết], rồi báo em.'], // dấu câu cuối không bị nuốt
      ['(https://example.com/a?b=1)!', '([đã ẩn liên kết])!'],
      // Không che: tiền, ngày giờ, thông số, chữ thường
      ['giá 13.000.000 ₫', null],
      ['bù 2.600.000 hoặc 1.250.000.000', null],
      ['13.000.000 2.600.000', null],
      ['10.035.000.000', null],
      ['150000000 nhé', null],
      ['150 000 000', null],
      ['hẹn 25/11/2026 lúc 14:30', null],
      ['02.09.2026', null],
      ['2026-11-25 14:30:00', null],
      ['đời 2019 2020 2021', null],
      ['iPhone 15 128GB đổi iPhone 18 256GB bù 3tr', null],
      ['Máy còn bảo hành tới 2027, pin 92%. Tp.HCM giao được.', null],
      ['duoc.co gi dau', null],
      ['Em mặc 2 lần, size M, cao 1m65 nặng 52kg', null],
      ['', null],
    ];
    it(`mask_contacts: ${CASES.length} ca che đúng và không che nhầm`, async () => {
      await asOwner(c, async () => {
        const got = await rows<{ input: string; out: string }>(c,
          'select t.input, mask_contacts(t.input) as out from unnest($1::text[]) as t(input)', [CASES.map(([input]) => input)]);
        expect(got.map((g) => [g.input, g.out])).toEqual(CASES.map(([input, expected]) => [input, expected ?? input]));
        expect((await rows(c, 'select mask_contacts(null) as out'))[0].out).toBeNull();
      });
    });
  });

  describe('nội dung và giới hạn', () => {
    it('tin rỗng và tin quá 1.000 ký tự bị từ chối; ký tự điều khiển bị bỏ, xuống dòng được giữ', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        expect(await sendError('  \n\t ')).toMatch(/message is empty/);
        expect(await sendError('\u0007')).toMatch(/message is empty/);
        expect(await sendError('a'.repeat(1001))).toMatch(/message is too long/);
        expect((await send('a'.repeat(1000))).body).toHaveLength(1000);
        expect((await send('  dòng 1\u0007\r\ndòng 2\n\n\n\n\ndòng 3  ')).body).toBe('dòng 1\ndòng 2\n\ndòng 3');
      });
    });
    it('tin toàn liên kết: bản đã che dài hơn bản gốc vẫn lưu được, cắt ở 2.000 ký tự', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const m = await send(Array.from({ length: 200 }, () => 'a.vn').join(' '));
        expect(m.masked).toBe(true);
        expect(m.body.length).toBe(2000);
        expect(m.body.startsWith('[đã ẩn liên kết] [đã ẩn liên kết]')).toBe(true);
      });
    });
    it('giới hạn tin nhắn mỗi 24 giờ đọc từ platform_settings', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        await asService(c, () => c.query(`update platform_settings set value = jsonb_set(value, '{messages_per_day}', '3') where key = 'rate_limits'`));
        // Chi có 2 tin trong dữ liệu mẫu nhưng đã quá 24 giờ nên không tính.
        await send('một');
        await send('hai');
        await send('ba');
        expect(await sendError('bốn')).toMatch(/daily message limit reached/);
        await actAs(c, { sub: USERS.dung });
        expect(await send('giới hạn tính riêng từng người')).toMatchObject({ sender_id: USERS.dung });
      });
    });
    it('giờ của tin tăng dần theo thứ tự gửi trong một match', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const a = await send('một');
        await actAs(c, { sub: USERS.dung });
        const b = await send('hai');
        await actAs(c, { sub: USERS.chi });
        const third = await send('ba');
        expect(a.created_at.getTime()).toBeLessThanOrEqual(b.created_at.getTime());
        expect(b.created_at.getTime()).toBeLessThanOrEqual(third.created_at.getTime());
        const order = await rows<{ body: string }>(c, 'select body from messages where match_id = $1 order by created_at desc, id desc limit 3', [SEED_MATCH]);
        expect(order.map((r) => r.body)).toEqual(['ba', 'hai', 'một']);
      });
    });
  });

  describe('đã đọc và chưa đọc', () => {
    const unread = async () => (await rows<{ n: number }>(c, `
      select count(*)::int as n from messages x
       where x.match_id = $1 and x.sender_id <> auth.uid()
         and x.created_at > coalesce((select r.last_read_at from match_reads r where r.match_id = x.match_id and r.user_id = auth.uid()), '-infinity')`,
      [SEED_MATCH]))[0].n;

    it('mốc đã đọc chỉ tiến, không lùi, không vượt quá hiện tại', async () => {
      await as(c, { sub: USERS.dung }, async () => {
        expect(await unread()).toBe(1);
        await c.query('select mark_match_read($1, $2)', [SEED_MATCH, '2026-11-20T03:12:00Z']);
        expect(await unread()).toBe(0);
        await c.query('select mark_match_read($1, $2)', [SEED_MATCH, '2026-11-20T03:00:00Z']);
        expect(await unread()).toBe(0);
        await c.query('select mark_match_read($1, $2)', [SEED_MATCH, '2999-01-01T00:00:00Z']);
        const at = (await rows<{ ok: boolean }>(c, 'select last_read_at <= clock_timestamp() as ok from match_reads where user_id = auth.uid()'))[0];
        expect(at.ok).toBe(true);
      });
    });
    it('gửi tin thì tin của mình coi như đã đọc, bên kia thêm một tin chưa đọc', async () => {
      await as(c, { sub: USERS.dung }, async () => {
        await send('Thứ Bảy 10 giờ nhé em');
        expect(await unread()).toBe(0);
        await actAs(c, { sub: USERS.chi });
        expect(await unread()).toBe(1);
        await c.query('select mark_match_read($1)', [SEED_MATCH]);
        expect(await unread()).toBe(0);
      });
    });
    it('chỉ đọc mốc của mình; người ngoài không đánh dấu được', async () => {
      await as(c, { sub: USERS.dung }, async () => {
        expect(await rows(c, 'select user_id from match_reads')).toEqual([{ user_id: USERS.dung }]);
        expect(await expectError(c, `update match_reads set last_read_at = now()`)).toMatch(/permission denied/);
        await actAs(c, { sub: USERS.an });
        expect(await expectError(c, 'select mark_match_read($1)', [SEED_MATCH])).toMatch(/match not found/);
      });
    });
  });
});
