import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, USERS, actAs, addMedia, as, asService, connect, dbTestsEnabled, expectError, rows } from './helpers';

const d = dbTestsEnabled ? describe : describe.skip;

d('đăng món, rút món, duyệt món (SPEC mục 6, 8)', () => {
  let c: pg.Client;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c?.end(); });

  // Tạo món nháp dưới vai trò hiện tại (chịu RLS và quyền cột như ứng dụng thật).
  async function draft(owner: string, fields: Record<string, unknown>) {
    const cols = Object.keys(fields);
    const r = await rows<{ id: string }>(c,
      `insert into items (owner_id, ${cols.join(', ')}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
      [owner, ...Object.values(fields)]);
    return r[0].id;
  }
  const publish = async (id: string) => (await rows<{ s: string }>(c, 'select publish_item($1)::text as s', [id]))[0].s;
  const statusOf = async (id: string) => (await rows<{ status: string }>(c, 'select status from items where id = $1', [id]))[0]?.status;

  const speaker = { type: 'physical', category_id: 'electronics', title: 'Loa bluetooth JBL', est_value_vnd: 500000, delivery_methods: '{meetup}', province_code: '48' };

  describe('điều kiện đăng', () => {
    it('khách vãng lai không gọi được hàm đăng món', async () => {
      await as(c, 'anon', async () => {
        expect(await expectError(c, 'select publish_item($1)', [ITEMS.emUkuleleDraft])).toMatch(/permission denied/);
      });
    });
    it('hàng vật lý: 2 ảnh bị chặn, đủ 3 ảnh thì lên', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const id = await draft(USERS.an, speaker);
        await addMedia(c, id, USERS.an, 2);
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/at least 3 photos/);
        await addMedia(c, id, USERS.an, 1);
        expect(await publish(id)).toBe('active');
      });
    });
    it('ảnh chứng từ không tính là ảnh sản phẩm', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const id = await draft(USERS.an, speaker);
        await addMedia(c, id, USERS.an, 2);
        await addMedia(c, id, USERS.an, 1, 'proof');
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/at least 3 photos/);
      });
    });
    it('hàng hiệu cần ảnh chứng từ', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const id = await draft(USERS.chi, { ...speaker, category_id: 'luxury-bags', title: 'Túi Louis Vuitton Neverfull', province_code: '79' });
        await addMedia(c, id, USERS.chi, 3);
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/proof of authenticity/);
        await addMedia(c, id, USERS.chi, 1, 'proof');
        expect(await publish(id)).toBe('active');
      });
    });
    it('điện thoại cần IMEI đầy đủ và cam kết đã thoát tài khoản; 4 số cuối tự đồng bộ', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const id = await draft(USERS.an, { ...speaker, category_id: 'phones', title: 'Samsung Galaxy S24', est_value_vnd: 9000000 });
        await addMedia(c, id, USERS.an, 3);
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/IMEI/);

        await c.query('insert into item_private (item_id, owner_id, imei_full) values ($1, $2, $3)', [id, USERS.an, '356938035643809']);
        expect((await rows<{ l: string }>(c, 'select imei_last4 as l from items where id = $1', [id]))[0].l).toBe('3809');
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/sign-out/);

        await c.query('update items set signed_out_confirmed = true where id = $1', [id]);
        expect(await publish(id)).toBe('active');
      });
    });
    it('người dùng không tự ghi 4 số cuối IMEI', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const msg = await expectError(c, `update items set imei_last4 = '0000' where id = $1`, [ITEMS.anIphone15]);
        expect(msg).toMatch(/permission denied/);
      });
    });
    it('mã khóa học phải có hạn dùng', async () => {
      await as(c, { sub: USERS.em }, async () => {
        const id = await draft(USERS.em, { type: 'course_code', category_id: 'courses', title: 'Mã khóa học thiếu hạn', est_value_vnd: 500000, delivery_methods: '{digital}', transfer_right_confirmed: true });
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/items_ready_rules/);
        await c.query(`update items set expires_on = '2027-06-30' where id = $1`, [id]);
        expect(await publish(id)).toBe('active');
      });
    });
    it('danh mục phải khớp loại món', async () => {
      await as(c, { sub: USERS.em }, async () => {
        const msg = await expectError(c,
          `insert into items (owner_id, type, category_id, title, est_value_vnd, delivery_methods) values ($1, 'digital_file', 'phones', 'Sai danh mục', 1000, '{digital}')`,
          [USERS.em]);
        expect(msg).toMatch(/category/);
      });
    });
    it('chỉ chủ món đăng được', async () => {
      await as(c, { sub: USERS.binh }, async () => {
        expect(await expectError(c, 'select publish_item($1)', [ITEMS.emUkuleleDraft])).toMatch(/not found/);
      });
    });
    it('món nháp đủ điều kiện thì lên; món đã lên không đăng lại được', async () => {
      await as(c, { sub: USERS.em }, async () => {
        expect(await publish(ITEMS.emUkuleleDraft)).toBe('active');
        expect(await expectError(c, 'select publish_item($1)', [ITEMS.emUkuleleDraft])).toMatch(/already active/);
      });
    });
  });

  describe('kiểm duyệt', () => {
    it('loại "khác" chờ duyệt; người thường không duyệt được; admin duyệt thì lên', async () => {
      await as(c, { sub: USERS.giang }, async () => {
        const id = await draft(USERS.giang, { type: 'other', category_id: 'other', title: 'Bộ sưu tập tem', est_value_vnd: 300000, delivery_methods: '{meetup}' });
        await addMedia(c, id, USERS.giang, 3);
        expect(await publish(id)).toBe('pending_review');
        expect(await expectError(c, 'select admin_review_item($1, true)', [id])).toMatch(/admin only/);
      });
      await as(c, { sub: USERS.admin }, async () => {
        const r = await rows<{ s: string }>(c, 'select admin_review_item($1, true, $2)::text as s', [ITEMS.giangBonsaiPending, 'Hợp lệ']);
        expect(r[0].s).toBe('active');
      });
    });
    it('từ khóa cấm chặn đăng; từ khóa cần duyệt thì chờ duyệt', async () => {
      await as(c, { sub: USERS.khanh }, async () => {
        const lesson = { type: 'service', est_value_vnd: 200000, delivery_methods: '{meetup}', duration_minutes: 60 };
        const bad = await draft(USERS.khanh, { ...lesson, category_id: 'lessons', title: 'Dạy bắn súng hơi' });
        expect(await expectError(c, 'select publish_item($1)', [bad])).toMatch(/banned keyword/);
        const flagged = await draft(USERS.khanh, { ...lesson, category_id: 'hands-on', title: 'Hướng dẫn huấn luyện chó cơ bản' });
        expect(await publish(flagged)).toBe('pending_review');
      });
    });
    it('món bị admin từ chối: sửa rồi đăng lại vẫn phải chờ duyệt', async () => {
      let id = '';
      await as(c, { sub: USERS.an }, async () => {
        id = await draft(USERS.an, { ...speaker, title: 'Tai nghe kèm rượu vang tặng' });
        await addMedia(c, id, USERS.an, 3);
        expect(await publish(id)).toBe('pending_review');
        await actAs(c, { sub: USERS.admin });
        expect((await rows<{ s: string }>(c, `select admin_review_item($1, false, 'Hàng có cồn')::text as s`, [id]))[0].s).toBe('removed');
        await actAs(c, { sub: USERS.an });
        await c.query(`update items set title = 'Tai nghe Sony WH-1000XM5' where id = $1`, [id]);
        expect(await publish(id)).toBe('pending_review');
      });
    });
    it('từ cấm thêm sau khi món vào hàng chờ vẫn được áp dụng lúc admin duyệt', async () => {
      await as(c, { sub: USERS.admin }, async () => {
        await asService(c, async () => {
          await c.query(`insert into banned_keywords (keyword, severity) values ('bonsai', 'block')`);
        });
        expect(await expectError(c, 'select admin_review_item($1, true)', [ITEMS.giangBonsaiPending])).toMatch(/banned keyword/);
        // Từ chối thì vẫn được, để gỡ món khỏi hàng chờ.
        expect((await rows<{ s: string }>(c, 'select admin_review_item($1, false)::text as s', [ITEMS.giangBonsaiPending]))[0].s).toBe('removed');
      });
    });
  });

  describe('sửa món đã đăng', () => {
    const airpods = '00000000-0000-4000-9000-000000000010';
    it('thêm từ cần duyệt thì món quay về chờ duyệt', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await c.query(`update items set title = 'Tai nghe kèm rượu vang' where id = $1`, [airpods]);
        expect(await statusOf(airpods)).toBe('pending_review');
      });
    });
    it('thêm từ cấm thì bị chặn, kể cả khi món đang chờ duyệt', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await expectError(c, `update items set description = 'Bán kèm vape' where id = $1`, [airpods])).toMatch(/banned keyword/);
      });
      await as(c, { sub: USERS.giang }, async () => {
        const msg = await expectError(c, `update items set description = 'Bonsai kèm súng hơi' where id = $1`, [ITEMS.giangBonsaiPending]);
        expect(msg).toMatch(/banned keyword/);
      });
    });
    it('không đổi danh mục khi món đang hiển thị (tránh né yêu cầu chứng từ)', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const msg = await expectError(c, `update items set category_id = 'luxury-bags' where id = $1`, [airpods]);
        expect(msg).toMatch(/withdraw the item/);
      });
    });
    it('rút món rồi mới đổi danh mục; đăng lại phải qua đủ điều kiện mới', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await c.query('select withdraw_item($1)', [airpods]);
        expect(await statusOf(airpods)).toBe('removed');
        await c.query(`update items set category_id = 'luxury-bags' where id = $1`, [airpods]);
        expect(await expectError(c, 'select publish_item($1)', [airpods])).toMatch(/proof of authenticity/);
      });
    });
    it('món đang giao dịch bị khóa sửa', async () => {
      await as(c, { sub: USERS.an }, async () => {
        await asService(c, async () => { await c.query(`update items set status = 'reserved' where id = $1`, [ITEMS.anIphone15]); });
        const r = await c.query(`update items set title = 'iPhone 15 đổi tên' where id = $1`, [ITEMS.anIphone15]);
        expect(r.rowCount).toBe(0);
      });
    });
  });

  describe('rút món và tài khoản bị khóa', () => {
    it('chủ món rút được; người khác không; khách không còn thấy món đã rút', async () => {
      await as(c, { sub: USERS.binh }, async () => {
        expect(await expectError(c, 'select withdraw_item($1)', [ITEMS.chiGucci])).toMatch(/not found/);
      });
      await as(c, { sub: USERS.chi }, async () => {
        await c.query('select withdraw_item($1)', [ITEMS.chiGucci]);
        await actAs(c, 'anon');
        expect(await rows(c, 'select id from items where id = $1', [ITEMS.chiGucci])).toHaveLength(0);
        expect(await rows(c, 'select id from item_media where item_id = $1', [ITEMS.chiGucci])).toHaveLength(0);
      });
    });
    it('tài khoản bị khóa không tạo món mới, không đăng món nháp; ảnh món cũ cũng ẩn', async () => {
      await as(c, { sub: USERS.khanh }, async () => {
        const id = await draft(USERS.khanh, { ...speaker, province_code: '31' });
        await asService(c, async () => { await c.query('update profiles set banned_at = now() where id = $1', [USERS.khanh]); });
        expect(await expectError(c, 'select publish_item($1)', [id])).toMatch(/banned/);
        expect(await expectError(c,
          `insert into items (owner_id, type, title, est_value_vnd, delivery_methods) values ($1, 'physical', 'Món mới', 1000, '{meetup}')`,
          [USERS.khanh])).toMatch(/row-level security/);
        await actAs(c, 'anon');
        const media = await rows(c, 'select m.id from item_media m where m.owner_id = $1', [USERS.khanh]);
        expect(media).toHaveLength(0);
      });
    });
  });
});
