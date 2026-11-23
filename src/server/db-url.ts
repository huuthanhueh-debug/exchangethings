// Phân tích DATABASE_URL một lần và kết nối bằng đúng các thành phần đã phân tích (không đưa cả chuỗi cho pg).
// Lý do: pg đọc thêm tham số như ?host=... trong chuỗi kết nối và dùng nó làm máy chủ thật, nên một URL trông như
// "localhost" có thể trỏ đi nơi khác, qua mặt cả việc bắt buộc TLS lẫn điều kiện "chỉ localhost" của AUTH_MODE=dev.
// Module thuần (không import gì của Next) để proxy cũng dùng được.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
// Tham số vô hại hay gặp trong chuỗi kết nối chép từ trang quản trị: bỏ qua. TLS do app tự quyết (src/server/db.ts).
const IGNORED_PARAMS = new Set(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat', 'pgbouncer', 'connection_limit', 'connect_timeout']);

export type DatabaseTarget = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  applicationName?: string;
  isLoopback: boolean;
  isSupabase: boolean;
};

export function parseDatabaseUrl(raw: string): DatabaseTarget {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL không phải URL hợp lệ.');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL phải bắt đầu bằng postgres:// hoặc postgresql://.');
  }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host.includes('%')) throw new Error('DATABASE_URL thiếu tên máy chủ hợp lệ.');
  let applicationName: string | undefined;
  for (const [key, value] of u.searchParams) {
    if (key === 'application_name') applicationName = value;
    else if (!IGNORED_PARAMS.has(key)) {
      throw new Error(`DATABASE_URL có tham số "${key}" không được hỗ trợ. Máy chủ, cổng và tài khoản phải nằm trong phần chính của URL.`);
    }
  }
  let user: string, password: string, database: string;
  try {
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
    database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL có ký tự mã hóa % không hợp lệ.');
  }
  if (!database || database.includes('/')) throw new Error('DATABASE_URL thiếu tên database.');
  const port = u.port ? Number(u.port) : 5432;
  return {
    host, port, user, password, database, applicationName,
    isLoopback: LOOPBACK.has(host),
    isSupabase: /(^|\.)supabase\.(com|co)$/.test(host),
  };
}

/** true chỉ khi URL hợp lệ và trỏ về máy này. URL lỗi hoặc có tham số lạ thì coi như không phải local. */
export function isLoopbackDatabase(raw: string | undefined): boolean {
  try {
    return parseDatabaseUrl(raw ?? '').isLoopback;
  } catch {
    return false;
  }
}
