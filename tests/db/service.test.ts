import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, USERS, connect, dbTestsEnabled } from './helpers';
import type { ItemInput } from '@/lib/validation/item';

// Test tích hợp lớp service của app (src/server/*) trên database thật: cùng cơ chế vai trò + RLS như khi chạy.
// Món tạo ra được xóa ở afterAll để các file test khác vẫn thấy đúng dữ liệu mẫu.
const d = dbTestsEnabled ? describe : describe.skip;

d('lớp service: đăng, sửa, rút món dưới quyền người dùng', () => {
  let admin: pg.Client;
  let storageDir: string;
  let svc: typeof import('@/server/item-service');
  let items: typeof import('@/server/items');
  let images: typeof import('@/server/images');
  let db: typeof import('@/server/db');
  const created: string[] = [];

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'et-media-'));
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      AUTH_MODE: 'dev',
      DEV_AUTH_SECRET: 'test-secret-'.padEnd(40, 'x'),
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: storageDir,
    });
    [svc, items, images, db] = await Promise.all([
      import('@/server/item-service'), import('@/server/items'), import('@/server/images'), import('@/server/db'),
    ]);
    admin = await connect();
  });
  afterAll(async () => {
    if (created.length) await admin.query('delete from items where id = any($1)', [created]);
    await admin?.end();
    await db?.endPool();
  });

  const photo = async (seed: number) => images.processPhoto(
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: { r: seed * 40, g: 118, b: 110 } } }).jpeg().toBuffer());
  // Đếm ảnh chính trong kho; mỗi ảnh chính phải có bản thu nhỏ đi kèm.
  const files = async () => {
    const names = await readdir(join(storageDir, 'item-media', 'items', USERS.an)).catch(() => [] as string[]);
    const main = names.filter((n) => !n.endsWith('.thumb.webp'));
    expect(names.filter((n) => n.endsWith('.thumb.webp')).sort()).toEqual(main.map((n) => n.replace(/\.webp$/, '.thumb.webp')).sort());
    return main.length;
  };

  const speaker: ItemInput = {
    type: 'physical', title: 'Loa Marshall Emberton', description: 'Còn bảo hành 6 tháng.', category_id: 'electronics',
    condition: 'like_new', est_value_vnd: 2_500_000, topup_pay_max_vnd: 0, topup_receive_max_vnd: 500_000, sell_price_vnd: null,
    delivery_methods: ['carrier', 'meetup'], province_code: '48', expires_on: null, imei: null, signed_out_confirmed: false,
    transfer_right_confirmed: false, duration_minutes: null, wants: { categories: ['cameras'], keywords: ['máy ảnh film'] },
  };

  it('tạo nháp kèm 3 ảnh: ảnh nằm trong kho, dòng item_media do server ghi', async () => {
    const id = await svc.createDraftItem(USERS.an, speaker, [await photo(1), await photo(2), await photo(3)], []);
    created.push(id);
    expect(await files()).toBe(3);
    const detail = await items.getItem({ kind: 'user', id: USERS.an }, id);
    expect(detail).toMatchObject({ status: 'draft', photoCount: 3, title: speaker.title, estValueVnd: 2_500_000 });
    expect(detail?.wants).toEqual({ categories: ['cameras'], keywords: ['máy ảnh film'] });
    // Khách và người khác không thấy món nháp.
    expect(await items.getItem({ kind: 'anon' }, id)).toBeNull();
    expect(await items.getItem({ kind: 'user', id: USERS.binh }, id)).toBeNull();
  });

  it('đăng món nháp đủ điều kiện thì hiện cho khách', async () => {
    const id = created[0];
    expect(await svc.publishItem(USERS.an, id)).toBe('active');
    const pub = await items.getItem({ kind: 'anon' }, id);
    expect(pub?.media.filter((m) => m.kind === 'photo')).toHaveLength(3);
    expect((await items.listRecentItems({ kind: 'anon' }, { limit: 100 })).map((i) => i.id)).toContain(id);
  });

  it('sửa món đang hiển thị được; đổi danh mục thì bị chặn với thông báo tiếng Việt', async () => {
    const id = created[0];
    await svc.updateItem(USERS.an, id, { ...speaker, title: 'Loa Marshall Emberton II' });
    expect((await items.getItem({ kind: 'anon' }, id))?.title).toBe('Loa Marshall Emberton II');
    const err = await svc.updateItem(USERS.an, id, { ...speaker, category_id: 'luxury-bags' }).catch((e) => e);
    expect(svc.friendlyDbError(err)).toBe('Gỡ món trước khi đổi danh mục.');
  });

  it('người khác không sửa, không thêm ảnh, không rút được món của An', async () => {
    const id = created[0];
    await expect(svc.updateItem(USERS.binh, id, speaker)).rejects.toThrow(/Không sửa được/);
    await expect(svc.addItemMedia(USERS.binh, id, [await photo(4)], [])).rejects.toThrow(/Không tìm thấy món của bạn/);
    const err = await svc.withdrawItem(USERS.binh, id).catch((e) => e);
    expect(svc.friendlyDbError(err)).toMatch(/Không tìm thấy món/);
  });

  it('không xóa ảnh khi món đang hiển thị; rút món rồi thì xóa được, tệp trong kho cũng mất', async () => {
    const id = created[0];
    const mediaId = (await items.getItem({ kind: 'user', id: USERS.an }, id))!.media[0].id;
    await expect(svc.deleteItemMedia(USERS.an, mediaId)).rejects.toThrow(/nháp hoặc món đã gỡ/);
    await svc.withdrawItem(USERS.an, id);
    await svc.deleteItemMedia(USERS.an, mediaId);
    expect(await files()).toBe(2);
    const err = await svc.publishItem(USERS.an, id).catch((e) => e);
    expect(svc.friendlyDbError(err)).toBe('Hàng vật lý cần ít nhất 3 ảnh sản phẩm.');
  });

  it('điện thoại: IMEI đầy đủ chỉ chủ món đọc được, 4 số cuối hiện công khai sau khi đăng', async () => {
    const phone: ItemInput = { ...speaker, title: 'Samsung Galaxy S24', category_id: 'phones', imei: '490154203237518', signed_out_confirmed: true, wants: { categories: [], keywords: [] } };
    const id = await svc.createDraftItem(USERS.an, phone, [await photo(5), await photo(6), await photo(7)], []);
    created.push(id);
    expect(await svc.publishItem(USERS.an, id)).toBe('active');
    expect(await items.getItemImei(USERS.an, id)).toBe('490154203237518');
    expect(await items.getItemImei(USERS.binh, id)).toBeNull();
    expect((await items.getItem({ kind: 'anon' }, id))?.imeiLast4).toBe('7518');
  });

  it('database từ chối thì ảnh vừa tải lên được dọn khỏi kho', async () => {
    const before = await files();
    // Danh mục không khớp loại món: trigger check_item_category từ chối sau khi ảnh đã lên kho.
    const err = await svc.createDraftItem(USERS.an, { ...speaker, category_id: 'templates' }, [await photo(8)], []).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(await files()).toBe(before);
  });

  it('ảnh chứng từ chỉ chủ món thấy, khách không thấy', async () => {
    const bag: ItemInput = { ...speaker, title: 'Túi Coach Tabby 26', category_id: 'luxury-bags', wants: { categories: [], keywords: [] } };
    const id = await svc.createDraftItem(USERS.an, bag, [await photo(1), await photo(2), await photo(3)], [await photo(9)]);
    created.push(id);
    expect(await svc.publishItem(USERS.an, id)).toBe('active');
    expect((await items.getItem({ kind: 'anon' }, id))?.media.map((m) => m.kind)).toEqual(['photo', 'photo', 'photo']);
    expect((await items.getItem({ kind: 'user', id: USERS.an }, id))?.media.filter((m) => m.kind === 'proof')).toHaveLength(1);
  });

  it('danh sách món của tôi chỉ gồm món của mình, đủ mọi trạng thái', async () => {
    const mine = await items.listMyItems(USERS.em);
    expect(mine.map((i) => i.id)).toContain(ITEMS.emUkuleleDraft);
    expect(new Set(mine.map((i) => i.ownerName))).toEqual(new Set(['Em']));
  });
});
