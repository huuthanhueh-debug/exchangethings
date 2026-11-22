import { randomUUID } from 'node:crypto';
import pg from 'pg';

export const dbTestsEnabled = process.env.SKIP_DB_TESTS !== '1';

// ID cố định của dữ liệu mẫu (scripts/generate-seed.mjs).
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const iid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
export const USERS = { an: uid(1), binh: uid(2), chi: uid(3), dung: uid(4), em: uid(5), phuc: uid(6), giang: uid(7), hoa: uid(8), khanh: uid(9), linh: uid(10), admin: uid(11) };
export const ITEMS = { anIphone15: iid(1), binhIphone18: iid(2), chiGucci: iid(3), dungZegna: iid(4), emCourse: iid(5), hoaVoucher: iid(7), emUkuleleDraft: iid(24), giangBonsaiPending: iid(29) };

export async function connect() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (global setup did not run)');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export type Who = 'anon' | { sub: string };

// Đặt vai trò và JWT claims cho phần còn lại của transaction hiện tại (giống request qua Supabase).
export async function actAs(client: pg.Client, who: Who) {
  const claims = who === 'anon' ? { role: 'anon' } : { sub: who.sub, role: 'authenticated' };
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await client.query(`set local role ${claims.role}`);
}

// Chạy fn trong một transaction với vai trò anon hoặc authenticated, rồi rollback.
export async function as<T>(client: pg.Client, who: Who, fn: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    await actAs(client, who);
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

// Chạy với quyền quản trị database (bỏ qua RLS) trong transaction, rồi rollback.
export async function asOwner<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('begin');
  try {
    return await fn();
  } finally {
    await client.query('rollback');
  }
}

// Trong một lượt as(): tạm chạy với quyền server (service role, bỏ qua RLS), rồi trả lại vai trò cũ.
// Dùng cho thao tác chỉ server làm, như ghi item_media sau khi xóa EXIF.
export async function asService<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  const { rows: r } = await client.query<{ role: string }>('select current_user as role');
  await client.query('set local role service_role');
  // Không dùng finally: nếu fn lỗi thì transaction đã hỏng, lệnh đổi vai trò sẽ che mất lỗi gốc.
  const result = await fn();
  await client.query(`set local role ${client.escapeIdentifier(r[0].role)}`);
  return result;
}

export async function addMedia(client: pg.Client, itemId: string, ownerId: string, count: number, kind: 'photo' | 'proof' = 'photo') {
  await asService(client, async () => {
    for (let k = 0; k < count; k++) { // tên tệp ngẫu nhiên: storage_path là duy nhất
      await client.query(
        `insert into item_media (item_id, owner_id, kind, storage_path, exif_stripped) values ($1, $2, $3, $4, true)`,
        [itemId, ownerId, kind, `test/${itemId}/${kind}-${randomUUID()}.webp`],
      );
    }
  });
}

export async function rows<T = Record<string, unknown>>(client: pg.Client, sql: string, params: unknown[] = []) {
  return (await client.query(sql, params)).rows as T[];
}

// Bắt lỗi trong transaction mà không làm hỏng transaction ngoài.
export async function expectError(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  await client.query('savepoint sp_expect');
  try {
    await client.query(sql, params);
  } catch (e) {
    await client.query('rollback to savepoint sp_expect');
    return (e as Error).message;
  }
  await client.query('release savepoint sp_expect');
  throw new Error(`expected an error from: ${sql}`);
}
