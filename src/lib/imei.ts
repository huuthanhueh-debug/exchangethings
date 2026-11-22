// IMEI 15 chữ số, chữ số cuối là số kiểm tra theo thuật toán Luhn (chuẩn GSMA).
// Kiểm tra ngay khi nhập giúp bắt lỗi gõ nhầm trước khi món lên sàn.

export function normalizeImei(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{15}$/.test(digits) ? digits : null;
}

export function isValidImei(input: string | null | undefined): boolean {
  const imei = normalizeImei(input);
  if (!imei) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = imei.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}
