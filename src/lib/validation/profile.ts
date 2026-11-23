import { z } from 'zod';
import { normalizeVnMobile } from '@/lib/phone';

// Validation form hồ sơ. Phường/xã phải thuộc tỉnh/thành: database kiểm tra lại (trigger check_profile_ward).

export type ProfileInput = {
  display_name: string;
  bio: string | null;
  province_code: string | null;
  ward_code: string | null;
  phone_e164: string | null;
};

export type ProfileField = keyof ProfileInput;
export type ProfileErrors = Partial<Record<ProfileField | 'form', string[]>>;

const str = z.string().trim().default('');
const shape = z.object({ display_name: str, bio: str, province_code: str, ward_code: str, phone: str });

export function validateProfile(
  input: Record<string, unknown>,
  ctx: { provinceCodes: ReadonlySet<string>; wardBelongsTo: (ward: string, province: string) => boolean },
): { ok: true; value: ProfileInput } | { ok: false; errors: ProfileErrors } {
  const v = shape.parse(input);
  const errors: ProfileErrors = {};
  const add = (f: ProfileField | 'form', m: string) => ((errors[f] ??= []).push(m));

  if (v.display_name.length < 2) add('display_name', 'Tên hiển thị cần ít nhất 2 ký tự.');
  else if (v.display_name.length > 40) add('display_name', 'Tên hiển thị tối đa 40 ký tự.');
  if (v.bio.length > 280) add('bio', 'Giới thiệu tối đa 280 ký tự.');

  const province = v.province_code || null;
  const ward = v.ward_code || null;
  if (province && !ctx.provinceCodes.has(province)) add('province_code', 'Tỉnh/thành không hợp lệ.');
  if (ward && !province) add('province_code', 'Chọn tỉnh/thành trước khi chọn phường/xã.');
  if (ward && province && !ctx.wardBelongsTo(ward, province)) add('ward_code', 'Phường/xã không thuộc tỉnh/thành đã chọn.');

  let phone: string | null = null;
  if (v.phone) {
    phone = normalizeVnMobile(v.phone);
    if (!phone) add('phone_e164', 'Số di động Việt Nam gồm 10 chữ số, ví dụ 0905 123 456.');
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { display_name: v.display_name, bio: v.bio || null, province_code: province, ward_code: ward, phone_e164: phone } };
}
