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
