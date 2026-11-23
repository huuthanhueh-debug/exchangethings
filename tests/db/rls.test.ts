import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, USERS, actAs, as, asOwner, connect, dbTestsEnabled, expectError, rows } from './helpers';

const d = dbTestsEnabled ? describe : describe.skip;

d('RLS và quyền truy cập (SPEC mục 10)', () => {
  let c: pg.Client;
  beforeAll(async () => { c = await connect(); });
  afterAll(async () => { await c?.end(); });

  describe('dữ liệu tham chiếu', () => {
    it('khách đọc được 34 tỉnh/thành và 3.321 phường/xã', async () => {
      await as(c, 'anon', async () => {
        expect((await rows(c, 'select count(*)::int as n from provinces'))[0].n).toBe(34);
        expect((await rows(c, 'select count(*)::int as n from wards'))[0].n).toBe(3321);
      });
    });
    it('chỉ admin đọc được danh sách từ khóa cấm', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await rows(c, 'select * from banned_keywords')).toHaveLength(0);
      });
      await as(c, { sub: USERS.admin }, async () => {
        expect((await rows(c, 'select * from banned_keywords')).length).toBeGreaterThan(10);
      });
    });
  });

  describe('món đồ', () => {
    it('khách chỉ thấy món đang hiển thị', async () => {
      await as(c, 'anon', async () => {
        const r = await rows<{ status: string; n: number }>(c, 'select status, count(*)::int as n from items group by status');
        expect(r).toEqual([{ status: 'active', n: 28 }]);
      });
    });
    it('người khác không thấy món nháp và món chờ duyệt; chủ món và admin thấy', async () => {
      const ids = [ITEMS.emUkuleleDraft, ITEMS.giangBonsaiPending];
      await as(c, { sub: USERS.binh }, async () => {
        expect(await rows(c, 'select id from items where id = any($1)', [ids])).toHaveLength(0);
      });
      await as(c, { sub: USERS.em }, async () => {
        expect(await rows(c, 'select id from items where id = $1', [ITEMS.emUkuleleDraft])).toHaveLength(1);
      });
      await as(c, { sub: USERS.admin }, async () => {
        expect(await rows(c, 'select id from items where id = any($1)', [ids])).toHaveLength(2);
      });
    });
    it('không sửa được món của người khác', async () => {
      await as(c, { sub: USERS.binh }, async () => {
        const r = await c.query(`update items set title = 'Đổi tên trộm' where id = $1`, [ITEMS.anIphone15]);
        expect(r.rowCount).toBe(0);
      });
    });
    it('chủ món sửa được nội dung, nhưng không tự đổi được trạng thái', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const r = await c.query(`update items set title = 'iPhone 15 128GB xanh' where id = $1`, [ITEMS.anIphone15]);
        expect(r.rowCount).toBe(1);
        const msg = await expectError(c, `update items set status = 'swapped' where id = $1`, [ITEMS.anIphone15]);
        expect(msg).toMatch(/permission denied/);
      });
    });
    it('không đăng món dưới tên người khác', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const msg = await expectError(c,
          `insert into items (owner_id, type, title, est_value_vnd, delivery_methods) values ($1, 'physical', 'Món giả danh', 100000, '{meetup}')`,
          [USERS.binh]);
        expect(msg).toMatch(/row-level security/);
      });
    });
    it('món của tài khoản bị khóa biến mất khỏi mắt người khác', async () => {
      await asOwner(c, async () => {
        await c.query(`update profiles set banned_at = now() where id = $1`, [USERS.binh]);
        await actAs(c, 'anon');
        expect(await rows(c, 'select id from items where owner_id = $1', [USERS.binh])).toHaveLength(0);
      });
    });
  });

  describe('dữ liệu riêng tư', () => {
    it('khách và người khác không đọc được số điện thoại, IMEI đầy đủ', async () => {
      await as(c, 'anon', async () => {
        expect(await expectError(c, 'select * from profile_private')).toMatch(/permission denied/);
        expect(await expectError(c, 'select * from item_private')).toMatch(/permission denied/);
      });
      await as(c, { sub: USERS.binh }, async () => {
        expect(await rows(c, 'select * from profile_private where id = $1', [USERS.an])).toHaveLength(0);
        expect(await rows(c, 'select * from item_private where item_id = $1', [ITEMS.anIphone15])).toHaveLength(0);
      });
    });
    it('chủ sở hữu và admin đọc được', async () => {
      await as(c, { sub: USERS.an }, async () => {
        expect(await rows(c, 'select phone_e164 from profile_private where id = $1', [USERS.an])).toHaveLength(1);
        expect((await rows<{ imei_full: string }>(c, 'select imei_full from item_private where item_id = $1', [ITEMS.anIphone15]))[0].imei_full).toMatch(/^\d{15}$/);
      });
      await as(c, { sub: USERS.admin }, async () => {
        expect(await rows(c, 'select * from item_private')).toHaveLength(2);
      });
    });
    it('người dùng không tự đánh dấu đã xác minh số điện thoại; đổi số thì mất xác minh', async () => {
      await as(c, { sub: USERS.an }, async () => {
        const msg = await expectError(c, `update profile_private set phone_verified_at = now() where id = $1`, [USERS.an]);
        expect(msg).toMatch(/permission denied/);
        await c.query(`update profile_private set phone_e164 = '+84905999999' where id = $1`, [USERS.an]);
        const r = await rows<{ phone_verified_at: string | null }>(c, 'select phone_verified_at from profile_private where id = $1', [USERS.an]);
        expect(r[0].phone_verified_at).toBeNull();
      });
    });
    it('người dùng không tự nâng điểm uy tín, hạng hay vai trò', async () => {
      await as(c, { sub: USERS.giang }, async () => {
        for (const col of ['trust_score = 100', `tier = 'high'`, `role = 'admin'`, 'completed_swaps = 99']) {
          const msg = await expectError(c, `update profiles set ${col} where id = $1`, [USERS.giang]);
          expect(msg).toMatch(/permission denied/);
        }
      });
    });
    it('phường/xã phải thuộc đúng tỉnh/thành', async () => {
      await as(c, { sub: USERS.an }, async () => {
        // 00004 là Phường Ba Đình (Hà Nội), không thuộc Đà Nẵng (48).
        const msg = await expectError(c, `update profiles set province_code = '48', ward_code = '00004' where id = $1`, [USERS.an]);
        expect(msg).toMatch(/does not belong to province/);
      });
    });
  });

  describe('ảnh và ảnh chứng từ', () => {
    it('khách xem được ảnh của món đang hiển thị', async () => {
      await as(c, 'anon', async () => {
        expect(await rows(c, `select id from item_media where item_id = $1 and kind = 'photo'`, [ITEMS.chiGucci])).toHaveLength(3);
      });
    });
    it('ảnh chứng từ hàng hiệu chỉ chủ món và admin xem được', async () => {
      const q = `select id from item_media where item_id = $1 and kind = 'proof'`;
      await as(c, { sub: USERS.binh }, async () => { expect(await rows(c, q, [ITEMS.chiGucci])).toHaveLength(0); });
      await as(c, { sub: USERS.chi }, async () => { expect(await rows(c, q, [ITEMS.chiGucci])).toHaveLength(1); });
      await as(c, { sub: USERS.admin }, async () => { expect(await rows(c, q, [ITEMS.chiGucci])).toHaveLength(1); });
    });
    it('người dùng không tự ghi bảng ảnh (chỉ server ghi sau khi xóa EXIF)', async () => {
      await as(c, { sub: USERS.chi }, async () => {
        const msg = await expectError(c,
          `insert into item_media (item_id, owner_id, kind, storage_path, exif_stripped) values ($1, $2, 'photo', 'x/y.webp', true)`,
          [ITEMS.chiGucci, USERS.chi]);
        expect(msg).toMatch(/permission denied/);
      });
    });
  });

  describe('bảng của các mốc sau bị khóa mặc định', () => {
    it('chưa có chính sách thì không đọc, không ghi được', async () => {
      await as(c, { sub: USERS.an }, async () => {
        for (const t of ['swipes', 'matches', 'offers', 'transactions', 'escrow_payments', 'vault_entries', 'messages', 'disputes']) {
          expect(await rows(c, `select * from ${t}`)).toHaveLength(0);
        }
        const msg = await expectError(c, `insert into swipes (viewer_id, item_id, direction) values ($1, $2, 'like')`, [USERS.an, ITEMS.binhIphone18]);
        expect(msg).toMatch(/permission denied/);
      });
    });
    it('nhật ký giao dịch chỉ được thêm, không sửa', async () => {
      await asOwner(c, async () => {
        const ov = await rows<{ id: string }>(c,
          `insert into offers (from_user, to_user) values ($1, $2) returning id`, [USERS.an, USERS.binh]);
        const v = await rows<{ id: string }>(c,
          `insert into offer_versions (offer_id, version, author_id) values ($1, 1, $2) returning id`, [ov[0].id, USERS.an]);
        const t = await rows<{ id: string }>(c,
          `insert into transactions (offer_version_id, kind) values ($1, 'carrier') returning id`, [v[0].id]);
        await c.query(`insert into transaction_events (transaction_id, to_status) values ($1, 'accepted')`, [t[0].id]);
        const msg = await expectError(c, `update transaction_events set reason = 'sửa lén'`);
        expect(msg).toMatch(/append-only/);
      });
    });
  });
});
