// Đường dẫn quay lại sau đăng nhập: chỉ nhận đường dẫn nội bộ, chống chuyển hướng ra trang ngoài (open redirect).
// Kiểm tra cả kết quả sau khi chuẩn hóa: "/.//evil.example" là đường dẫn hợp lệ nhưng chuẩn hóa thành
// "//evil.example", thứ trình duyệt hiểu là một trang khác.
const BASE = 'http://internal.invalid';

export function safeNextPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || raw.length > 2000 || !raw.startsWith('/')) return fallback;
  // Dấu \ và ký tự điều khiển được mỗi trình duyệt hiểu một kiểu: không nhận.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const u = new URL(raw, BASE);
    if (u.origin !== BASE) return fallback;
    const path = `${u.pathname}${u.search}`;
    if (!path.startsWith('/') || path.startsWith('//')) return fallback;
    return new URL(path, BASE).origin === BASE ? path : fallback;
  } catch {
    return fallback;
  }
}
