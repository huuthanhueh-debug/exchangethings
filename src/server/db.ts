import 'server-only';
import pg from 'pg';
import { parseDatabaseUrl } from './db-url';
import { env } from './env';
import { SUPABASE_ROOT_CA_2021 } from './supabase-ca';

// Lớp truy cập dữ liệu (DECISIONS D-13, D-23). Mọi truy vấn của người dùng chạy trong một transaction đã đặt
// vai trò (anon hoặc authenticated) và JWT claims, giống cách Supabase/PostgREST làm, nên RLS áp dụng y hệt.
// Bộ test database dùng đúng cơ chế này (tests/db/helpers.ts), nên quyền đã test là quyền app chạy thật.
// Tương thích Supavisor ở chế độ transaction: set_config(..., true) chỉ sống trong transaction.

export type Actor = { kind: 'anon' } | { kind: 'user'; id: string };
export type Tx = pg.PoolClient;

type GlobalWithPool = typeof globalThis & { __exchangethingsPool?: pg.Pool };

/**
 * Cấu hình kết nối, dựng từ các thành phần đã phân tích của DATABASE_URL (xem db-url.ts).
 * Database ở xa thì luôn mã hóa TLS và luôn kiểm tra chứng chỉ: dùng DATABASE_CA_CERT nếu có,
 * database Supabase thì dùng CA gốc của Supabase đóng gói sẵn, còn lại dùng CA hệ thống.
 */
export function poolConfig(e: { DATABASE_URL: string; DATABASE_CA_CERT?: string }): pg.PoolConfig {
  const t = parseDatabaseUrl(e.DATABASE_URL);
  let ssl: pg.PoolConfig['ssl'];
  if (!t.isLoopback) {
    const custom = e.DATABASE_CA_CERT?.trim().replace(/\\n/g, '\n');
    const ca = custom || (t.isSupabase ? SUPABASE_ROOT_CA_2021 : undefined);
    ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
  }
  return {
    host: t.host, port: t.port, user: t.user, password: t.password, database: t.database,
    application_name: t.applicationName, ssl, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000,
  };
}

function pool(): pg.Pool {
  const g = globalThis as GlobalWithPool;
  if (!g.__exchangethingsPool) g.__exchangethingsPool = new pg.Pool(poolConfig(env()));
  return g.__exchangethingsPool;
}

async function inTransaction<T>(setup: (tx: Tx) => Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query('begin');
    await setup(client);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function claimsFor(actor: Actor) {
  return actor.kind === 'anon'
    ? { role: 'anon' as const, claims: { role: 'anon' } }
    : { role: 'authenticated' as const, claims: { sub: actor.id, role: 'authenticated' } };
}

/** Chạy fn dưới quyền của actor: RLS và quyền cột áp dụng như request từ ứng dụng. */
export function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const { role, claims } = claimsFor(actor);
  return inTransaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true), set_config('role', $2, true)`, [JSON.stringify(claims), role]);
  }, fn);
}

/**
 * Trong một transaction của withActor: tạm chuyển sang service_role (bỏ qua RLS) cho thao tác chỉ server
 * được làm, ví dụ ghi item_media sau khi đã xóa EXIF. Gọi xong tự trả lại vai trò cũ.
 * Chỉ dùng sau khi đã kiểm tra quyền sở hữu bằng truy vấn dưới quyền người dùng.
 */
export async function elevate<T>(tx: Tx, actor: Actor, fn: () => Promise<T>): Promise<T> {
  await tx.query(`select set_config('role', 'service_role', true)`);
  const result = await fn();
  await tx.query(`select set_config('role', $1, true)`, [claimsFor(actor).role]);
  return result;
}

/** Truy vấn dữ liệu tham chiếu công khai (tỉnh/thành, danh mục) dưới quyền khách. */
export function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withActor({ kind: 'anon' }, fn);
}

/** Lỗi Postgres do trigger/hàm raise: dùng để dịch sang thông báo tiếng Việt. */
export function pgErrorMessage(e: unknown): string | null {
  return e instanceof Error && 'code' in e ? e.message : null;
}

/** Đóng pool (dùng trong script và test để tiến trình thoát gọn). */
export async function endPool(): Promise<void> {
  const g = globalThis as GlobalWithPool;
  const p = g.__exchangethingsPool;
  g.__exchangethingsPool = undefined;
  await p?.end();
}
