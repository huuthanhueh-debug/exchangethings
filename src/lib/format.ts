// Định dạng hiển thị dùng chung cho server và client. Tiền tệ duy nhất là VND (SPEC mục 7, Thông tư 32/2013/TT-NHNN).

const vndFormatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

/** 13000000 -> "13.000.000 ₫" (khoảng trắng không ngắt dòng trước ₫). */
export function formatVnd(amount: number | bigint): string {
  return vndFormatter.format(amount);
}

/** 13000000 -> "13.000.000" (dùng trong ô nhập). */
export function formatNumber(amount: number | bigint): string {
  return numberFormatter.format(amount);
}

/**
 * Đọc số tiền người dùng gõ: "13.000.000", "13,000,000", "13 000 000 ₫" đều thành 13000000.
 * Trả null khi không có chữ số nào hoặc vượt giới hạn an toàn của số nguyên.
 */
export function parseVnd(input: string | null | undefined): number | null {
  if (!input) return null;
  const digits = input.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

/** "2026-12-31" -> "31/12/2026". Chỉ nhận ngày dạng ISO; giữ nguyên chuỗi khác. */
export function formatDateVi(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

// Giờ Việt Nam cố định UTC+7, không có giờ mùa hè: tự cộng 7 giờ thay vì dùng Intl, để server và trình duyệt
// luôn ra cùng một chuỗi (không lệch khi hydrate).
const VN_OFFSET_MS = 7 * 3_600_000;
const vnIso = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : new Date(ms + VN_OFFSET_MS).toISOString();
};

/** "2026-11-20T03:05:00Z" -> "10:05" theo giờ Việt Nam. */
export function formatTimeVn(iso: string): string {
  return vnIso(iso)?.slice(11, 16) ?? '';
}

/** Ngày theo giờ Việt Nam, dạng YYYY-MM-DD: dùng để gom tin nhắn theo ngày. */
export function vnDayKey(iso: string): string {
  return vnIso(iso)?.slice(0, 10) ?? '';
}

/** Mốc thời gian ngắn cho danh sách: cùng ngày thì "10:05", khác ngày thì "20/11", khác năm thì "20/11/2025". */
export function formatWhenVn(iso: string, todayKey: string): string {
  const day = vnDayKey(iso);
  if (!day) return '';
  if (day === todayKey) return formatTimeVn(iso);
  const [y, m, d] = day.split('-');
  return y === todayKey.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
}
