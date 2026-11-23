import { z } from 'zod';
import { parseVnd } from '@/lib/format';
import { isValidImei, normalizeImei } from '@/lib/imei';
import {
  CONDITIONS, DELIVERY_METHODS, ITEM_TYPE_META, ITEM_TYPES, MAX_WANTS,
  type Condition, type DeliveryMethod, type ItemType,
} from '@/lib/items';

// Validation form đăng/sửa món, báo mọi lỗi trong một lượt bằng tiếng Việt theo từng ô.
// Database kiểm tra lại các ràng buộc cốt lõi (CHECK, trigger, publish_item); lớp này chặn sớm và giải thích.

export type CategoryInfo = { id: string; item_type: ItemType; requires_proof: boolean; is_phone: boolean };

export type ItemInput = {
  type: ItemType;
  title: string;
  description: string | null;
  category_id: string;
  condition: Condition;
  est_value_vnd: number;
  topup_pay_max_vnd: number;
  topup_receive_max_vnd: number;
  sell_price_vnd: number | null;
  delivery_methods: DeliveryMethod[];
  province_code: string | null;
  expires_on: string | null;
  imei: string | null;
  signed_out_confirmed: boolean;
  transfer_right_confirmed: boolean;
  duration_minutes: number | null;
  wants: { categories: string[]; keywords: string[] };
};

export type ItemField = Exclude<keyof ItemInput, 'wants'> | 'wants_categories' | 'wants_keywords' | 'sell_enabled';
export type FieldErrors = Partial<Record<ItemField | 'form', string[]>>;

export type ValidationContext = {
  categories: CategoryInfo[];
  provinceCodes: ReadonlySet<string>;
  /** Ngày hiện tại theo giờ Việt Nam (YYYY-MM-DD); truyền vào để mọi kiểm tra hạn dùng cùng một mốc. */
  today: string;
};

const MAX_VND = 10_000_000_000;
const checkbox = z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean());
const str = z.string().trim().default('');

// Chỉ chuẩn hóa hình dạng dữ liệu; không chặn ở bước này để gom đủ lỗi nghiệp vụ phía dưới.
const shape = z.object({
  type: z.enum(ITEM_TYPES, { error: 'Chọn loại món.' }),
  title: str,
  description: str,
  category_id: str,
  condition: str,
  est_value_vnd: str,
  topup_pay_max_vnd: str,
  topup_receive_max_vnd: str,
  sell_enabled: checkbox,
  sell_price_vnd: str,
  delivery_methods: z.array(z.string()).default([]),
  province_code: str,
  expires_on: str,
  imei: str,
  signed_out_confirmed: checkbox,
  transfer_right_confirmed: checkbox,
  duration_minutes: str,
  wants_categories: z.array(z.string()).default([]),
  wants_keywords: str,
});

/** Gom FormData thành object; các ô nhiều giá trị (nhóm checkbox) thành mảng. Bỏ qua tệp. */
export function itemFormToObject(form: FormData): Record<string, unknown> {
  const multi = new Set(['delivery_methods', 'wants_categories']);
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== 'string') continue;
    if (multi.has(key)) ((out[key] ??= []) as string[]).push(value);
    else out[key] = value;
  }
  return out;
}

export function validateItem(
  input: Record<string, unknown>,
  ctx: ValidationContext,
): { ok: true; value: ItemInput } | { ok: false; errors: FieldErrors } {
  const parsed = shape.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: { type: ['Chọn loại món.'] } };
  }
  const v = parsed.data;
  const meta = ITEM_TYPE_META[v.type];
  const errors: FieldErrors = {};
  const add = (field: ItemField | 'form', msg: string) => ((errors[field] ??= []).push(msg));

  // Tên, mô tả
  if (v.title.length < 3) add('title', 'Tên món cần ít nhất 3 ký tự.');
  else if (v.title.length > 80) add('title', 'Tên món tối đa 80 ký tự.');
  if (v.description.length > 2000) add('description', 'Mô tả tối đa 2.000 ký tự.');
  // Voucher cần điều kiện áp dụng, loại "khác" cần mô tả rõ (SPEC mục 4).
  if (v.type === 'voucher' && v.description.length < 10) add('description', 'Ghi điều kiện áp dụng của voucher (ít nhất 10 ký tự).');
  if (v.type === 'other' && v.description.length < 30) add('description', 'Mô tả rõ món này (ít nhất 30 ký tự) để admin duyệt nhanh.');

  // Danh mục
  const category = ctx.categories.find((c) => c.id === v.category_id);
  if (!v.category_id) add('category_id', 'Chọn danh mục.');
  else if (!category || category.item_type !== v.type) add('category_id', 'Danh mục không thuộc loại món đã chọn.');

  // Tình trạng
  let condition: Condition = 'not_applicable';
  if (meta.hasCondition) {
    const c = (CONDITIONS as readonly string[]).includes(v.condition) ? (v.condition as Condition) : null;
    if (c && c !== 'not_applicable') condition = c;
    else if (v.type === 'physical') add('condition', 'Chọn tình trạng món.');
  }

  // Tiền
  const money = (field: ItemField, label: string, raw: string, required: boolean, min = 0): number => {
    const n = parseVnd(raw);
    if (n === null) {
      if (required) add(field, `Nhập ${label}.`);
      return 0;
    }
    if (n < min) add(field, `Tối thiểu ${min.toLocaleString('vi-VN')} ₫.`);
    else if (n > MAX_VND) add(field, 'Số tiền quá lớn.');
    return n;
  };
  const estValue = money('est_value_vnd', 'giá trị ước tính', v.est_value_vnd, true, 1000);
  const payMax = money('topup_pay_max_vnd', 'mức bù bạn trả', v.topup_pay_max_vnd, false);
  const receiveMax = money('topup_receive_max_vnd', 'mức bù bạn nhận', v.topup_receive_max_vnd, false);
  const sell = v.sell_enabled ? money('sell_price_vnd', 'giá bán', v.sell_price_vnd, true, 1000) : null;

  // Cách giao: loại chỉ có một cách giao thì cố định, không cần chọn.
  let delivery: DeliveryMethod[];
  if (meta.delivery.length === 1) delivery = [...meta.delivery];
  else {
    const picked = [...new Set(v.delivery_methods)];
    delivery = picked.filter((d): d is DeliveryMethod => (DELIVERY_METHODS as readonly string[]).includes(d));
    if (picked.length === 0) add('delivery_methods', 'Chọn ít nhất một cách giao.');
    else if (delivery.length !== picked.length || delivery.some((d) => !meta.delivery.includes(d))) {
      add('delivery_methods', 'Cách giao không hợp với loại món.');
    }
  }

  // Tỉnh/thành: bắt buộc với hàng vật lý và khi có gặp trực tiếp.
  const province = v.province_code || null;
  if (province && !ctx.provinceCodes.has(province)) add('province_code', 'Tỉnh/thành không hợp lệ.');
  else if (!province && (v.type === 'physical' || delivery.includes('meetup'))) add('province_code', 'Chọn tỉnh/thành nơi giao.');

  // Hạn dùng
  let expires: string | null = null;
  if (meta.needsExpiry) {
    if (!v.expires_on) add('expires_on', 'Nhập hạn dùng.');
    else if (!z.iso.date().safeParse(v.expires_on).success) add('expires_on', 'Ngày không hợp lệ.');
    else if (v.expires_on < ctx.today) add('expires_on', 'Hạn dùng đã qua.');
    else expires = v.expires_on;
  }

  if (meta.needsTransferRight && !v.transfer_right_confirmed) {
    add('transfer_right_confirmed', v.type === 'digital_file'
      ? 'Xác nhận bạn có quyền chia sẻ file này.'
      : 'Xác nhận mã được phép chuyển nhượng.');
  }

  // Thời lượng dịch vụ
  let duration: number | null = null;
  if (meta.needsDuration) {
    const d = /^\d{1,3}$/.test(v.duration_minutes) ? Number(v.duration_minutes) : NaN;
    if (!v.duration_minutes) add('duration_minutes', 'Chọn thời lượng.');
    else if (!(d >= 15 && d <= 480)) add('duration_minutes', 'Thời lượng từ 15 đến 480 phút.');
    else duration = d;
  }

  // Điện thoại: IMEI hợp lệ và cam kết đã thoát iCloud/Google.
  let imei: string | null = null;
  if (category?.is_phone && category.item_type === v.type) {
    imei = normalizeImei(v.imei);
    if (!imei) add('imei', 'IMEI gồm 15 chữ số (bấm *#06# để xem).');
    else if (!isValidImei(imei)) add('imei', 'IMEI không đúng, kiểm tra lại từng chữ số.');
    if (!v.signed_out_confirmed) add('signed_out_confirmed', 'Xác nhận máy đã thoát iCloud hoặc tài khoản Google.');
  }

  // Muốn đổi lấy
  const known = new Set(ctx.categories.map((c) => c.id));
  const wantCats = [...new Set(v.wants_categories)];
  if (wantCats.some((c) => !known.has(c))) add('wants_categories', 'Danh mục mong muốn không hợp lệ.');
  const keywords = [...new Set(v.wants_keywords.split(',').map((k) => k.trim()).filter(Boolean))];
  if (keywords.some((k) => k.length < 2 || k.length > 40)) add('wants_keywords', 'Mỗi từ khóa dài 2 đến 40 ký tự.');
  if (wantCats.length + keywords.length > MAX_WANTS) add('wants_keywords', `Tối đa ${MAX_WANTS} mong muốn (danh mục và từ khóa cộng lại).`);

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type: v.type,
      title: v.title,
      description: v.description || null,
      category_id: v.category_id,
      condition,
      est_value_vnd: estValue,
      topup_pay_max_vnd: payMax,
      topup_receive_max_vnd: receiveMax,
      sell_price_vnd: sell,
      delivery_methods: delivery,
      province_code: province,
      expires_on: expires,
      imei,
      signed_out_confirmed: imei !== null && v.signed_out_confirmed,
      transfer_right_confirmed: meta.needsTransferRight && v.transfer_right_confirmed,
      duration_minutes: duration,
      wants: { categories: wantCats, keywords },
    },
  };
}
