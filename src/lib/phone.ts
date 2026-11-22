// Số di động Việt Nam: lưu dạng E.164 (+84 và 9 chữ số), khớp ràng buộc profile_private.phone_e164.
// Đầu số di động hiện hành: 03x, 05x, 07x, 08x, 09x.

const MOBILE_PREFIX = /^[35789]\d{8}$/;

/**
 * "0905 123 456", "+84 905-123-456", "84905123456" -> "+84905123456".
 * Trả null nếu không phải số di động Việt Nam hợp lệ.
 */
export function normalizeVnMobile(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
  else return null;
  return MOBILE_PREFIX.test(digits) ? `+84${digits}` : null;
}

/** "+84905123456" -> "0905 123 456" để hiển thị. */
export function formatVnMobile(e164: string): string {
  const m = /^\+84(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Che số khi hiển thị cho người khác (dùng từ M2): "+84905123456" -> "0905 *** 456". */
export function maskVnMobile(e164: string): string {
  const m = /^\+84(\d{3})\d{3}(\d{3})$/.exec(e164);
  return m ? `0${m[1]} *** ${m[2]}` : '***';
}
