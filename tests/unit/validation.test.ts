import { describe, expect, it } from 'vitest';
import { itemFormToObject, validateItem, type CategoryInfo } from '@/lib/validation/item';
import { validateProfile } from '@/lib/validation/profile';

const categories: CategoryInfo[] = [
  { id: 'phones', item_type: 'physical', requires_proof: false, is_phone: true },
  { id: 'electronics', item_type: 'physical', requires_proof: false, is_phone: false },
  { id: 'luxury-bags', item_type: 'physical', requires_proof: true, is_phone: false },
  { id: 'templates', item_type: 'digital_file', requires_proof: false, is_phone: false },
  { id: 'courses', item_type: 'course_code', requires_proof: false, is_phone: false },
  { id: 'vouchers-shopping', item_type: 'voucher', requires_proof: false, is_phone: false },
  { id: 'lessons', item_type: 'service', requires_proof: false, is_phone: false },
  { id: 'other', item_type: 'other', requires_proof: false, is_phone: false },
];
const ctx = { categories, provinceCodes: new Set(['01', '48', '79']), today: '2026-11-22' };

const phone = {
  type: 'physical', title: 'iPhone 15 128GB', category_id: 'phones', condition: 'good',
  est_value_vnd: '13.000.000', topup_pay_max_vnd: '3.000.000', delivery_methods: ['carrier', 'meetup'],
  province_code: '48', imei: '353912000084821', signed_out_confirmed: 'on', wants_categories: ['phones'], wants_keywords: 'iPhone 18',
};

describe('validateItem', () => {
  it('kịch bản 1: iPhone 15 của An hợp lệ, chuẩn hóa tiền và mong muốn', () => {
    const r = validateItem(phone, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      est_value_vnd: 13_000_000, topup_pay_max_vnd: 3_000_000, topup_receive_max_vnd: 0, sell_price_vnd: null,
      delivery_methods: ['carrier', 'meetup'], imei: '353912000084821', signed_out_confirmed: true,
      wants: { categories: ['phones'], keywords: ['iPhone 18'] },
    });
  });
  it('báo mọi lỗi trong một lượt, không dừng ở lỗi đầu tiên', () => {
    const r = validateItem({ type: 'physical', title: 'ab', category_id: 'phones', imei: '123' }, ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(
      ['condition', 'delivery_methods', 'est_value_vnd', 'imei', 'province_code', 'signed_out_confirmed', 'title'].sort());
  });
  it('IMEI sai số kiểm tra bị từ chối', () => {
    const r = validateItem({ ...phone, imei: '353912000014821' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.imei?.[0]).toMatch(/không đúng/);
  });
  it('danh mục phải thuộc đúng loại món', () => {
    const r = validateItem({ ...phone, type: 'digital_file', category_id: 'phones', transfer_right_confirmed: 'on' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.category_id).toBeDefined();
  });
  it('file số: cách giao cố định là két số, bắt buộc xác nhận quyền chia sẻ', () => {
    const base = { type: 'digital_file', title: 'Bộ template', category_id: 'templates', est_value_vnd: '1000000', delivery_methods: ['meetup'] };
    const bad = validateItem(base, ctx);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors)).toEqual(['transfer_right_confirmed']);
    const good = validateItem({ ...base, transfer_right_confirmed: 'on' }, ctx);
    expect(good.ok && good.value.delivery_methods).toEqual(['digital']);
    expect(good.ok && good.value.condition).toBe('not_applicable');
  });
  it('mã khóa học: hạn dùng bắt buộc và chưa qua', () => {
    const base = { type: 'course_code', title: 'Mã khóa học UI', category_id: 'courses', est_value_vnd: '1200000', transfer_right_confirmed: 'on' };
    const missing = validateItem(base, ctx);
    expect(!missing.ok && missing.errors.expires_on?.[0]).toMatch(/Nhập hạn dùng/);
    const past = validateItem({ ...base, expires_on: '2026-11-21' }, ctx);
    expect(!past.ok && past.errors.expires_on?.[0]).toMatch(/đã qua/);
    const today = validateItem({ ...base, expires_on: '2026-11-22' }, ctx);
    expect(today.ok).toBe(true);
  });
  it('voucher cần điều kiện áp dụng; bán thẳng cần giá', () => {
    const base = { type: 'voucher', title: 'Voucher 500.000 ₫', category_id: 'vouchers-shopping', est_value_vnd: '500000', expires_on: '2026-12-15', transfer_right_confirmed: 'on', sell_enabled: 'on' };
    const r = validateItem(base, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['description', 'sell_price_vnd']);
    const ok = validateItem({ ...base, description: 'Áp dụng đơn từ 1.000.000 ₫', sell_price_vnd: '350.000' }, ctx);
    expect(ok.ok && ok.value.sell_price_vnd).toBe(350_000);
  });
  it('dịch vụ: thời lượng bắt buộc; gặp trực tiếp thì cần tỉnh/thành', () => {
    const base = { type: 'service', title: 'Dạy tiếng Anh 60 phút', category_id: 'lessons', est_value_vnd: '300000', delivery_methods: ['meetup'] };
    const r = validateItem(base, ctx);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['duration_minutes', 'province_code']);
    const online = validateItem({ ...base, delivery_methods: ['online_session'], duration_minutes: '60' }, ctx);
    expect(online.ok && online.value.duration_minutes).toBe(60);
    const tooLong = validateItem({ ...base, delivery_methods: ['online_session'], duration_minutes: '600' }, ctx);
    expect(!tooLong.ok && tooLong.errors.duration_minutes).toBeDefined();
  });
  it('loại khác cần mô tả rõ', () => {
    const r = validateItem({ type: 'other', title: 'Chậu bonsai', category_id: 'other', est_value_vnd: '350000', delivery_methods: ['meetup'], province_code: '79', description: 'Cây đẹp' }, ctx);
    expect(!r.ok && r.errors.description?.[0]).toMatch(/30 ký tự/);
  });
  it('cách giao không hợp loại món bị từ chối (chống sửa form)', () => {
    const r = validateItem({ ...phone, delivery_methods: ['digital'] }, ctx);
    expect(!r.ok && r.errors.delivery_methods?.[0]).toMatch(/không hợp/);
  });
  it('tối đa 5 mong muốn; danh mục mong muốn phải tồn tại', () => {
    const r = validateItem({ ...phone, wants_categories: ['phones', 'electronics', 'templates'], wants_keywords: 'a1, b2, c3' }, ctx);
    expect(!r.ok && r.errors.wants_keywords?.[0]).toMatch(/Tối đa 5/);
    const unknown = validateItem({ ...phone, wants_categories: ['khong-co'] }, ctx);
    expect(!unknown.ok && unknown.errors.wants_categories).toBeDefined();
  });
  it('giá trị ước tính tối thiểu 1.000 ₫', () => {
    const r = validateItem({ ...phone, est_value_vnd: '500' }, ctx);
    expect(!r.ok && r.errors.est_value_vnd?.[0]).toMatch(/Tối thiểu/);
  });
  it('gom FormData nhiều giá trị thành mảng, bỏ qua tệp', () => {
    const f = new FormData();
    f.append('type', 'physical');
    f.append('delivery_methods', 'carrier');
    f.append('delivery_methods', 'meetup');
    f.append('photos', new Blob(['x']), 'a.jpg');
    expect(itemFormToObject(f)).toEqual({ type: 'physical', delivery_methods: ['carrier', 'meetup'] });
  });
});

describe('validateProfile', () => {
  const pctx = { provinceCodes: new Set(['01', '48']), wardBelongsTo: (w: string, p: string) => w.startsWith('2') === (p === '48') };
  it('hợp lệ: chuẩn hóa số điện thoại', () => {
    const r = validateProfile({ display_name: 'An', province_code: '48', ward_code: '20194', phone: '0905 000 001' }, pctx);
    expect(r.ok && r.value).toEqual({ display_name: 'An', bio: null, province_code: '48', ward_code: '20194', phone_e164: '+84905000001' });
  });
  it('báo lỗi tên ngắn, phường sai tỉnh, số điện thoại sai', () => {
    const r = validateProfile({ display_name: 'A', province_code: '01', ward_code: '20194', phone: '12345' }, pctx);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(['display_name', 'phone_e164', 'ward_code']);
  });
});
