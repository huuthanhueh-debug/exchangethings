// Công cụ database không cần token Supabase: chỉ cần DATABASE_URL (chuỗi kết nối Postgres).
// Dùng chung cho: scripts/db-migrate.mjs, db-doctor.mjs, build-setup-sql.mjs, db-reset.mjs và test.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations');
export const SETUP_SQL_PATH = join(ROOT, 'supabase/setup.sql');

/** Lỗi có thông báo dành cho người dùng (không kèm stack). */
export class DbToolError extends Error {}

// --- Chuỗi kết nối: cùng quy tắc với src/server/db-url.ts (test canh hai bản khớp nhau) -------------------------
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const IGNORED_PARAMS = new Set(['ssl', 'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat', 'pgbouncer', 'connection_limit', 'connect_timeout']);

export function parseDatabaseUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new DbToolError('DATABASE_URL không phải URL hợp lệ.'); }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new DbToolError('DATABASE_URL phải bắt đầu bằng postgres:// hoặc postgresql://.');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host.includes('%')) throw new DbToolError('DATABASE_URL thiếu tên máy chủ hợp lệ.');
  let applicationName;
  for (const [key, value] of u.searchParams) {
    if (key === 'application_name') applicationName = value;
    else if (!IGNORED_PARAMS.has(key)) throw new DbToolError(`DATABASE_URL có tham số "${key}" không được hỗ trợ. Máy chủ, cổng và tài khoản phải nằm trong phần chính của URL.`);
  }
  let user, password, database;
  try {
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
    database = decodeURIComponent(u.pathname.replace(/^\//, ''));
  } catch { throw new DbToolError('DATABASE_URL có ký tự mã hóa % không hợp lệ.'); }
  if (!database || database.includes('/')) throw new DbToolError('DATABASE_URL thiếu tên database.');
  return {
    host, port: u.port ? Number(u.port) : 5432, user, password, database, applicationName,
    isLoopback: LOOPBACK.has(host), isSupabase: /(^|\.)supabase\.(com|co)$/.test(host),
  };
}

function supabaseRootCa() {
  const src = readFileSync(join(ROOT, 'src/server/supabase-ca.ts'), 'utf8');
  return src.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)[0];
}

/** Kết nối theo DATABASE_URL. Database ở xa luôn TLS có kiểm tra chứng chỉ. Không bao giờ in mật khẩu. */
export async function connect(url = process.env.DATABASE_URL, env = process.env) {
  if (!url) throw new DbToolError('Thiếu DATABASE_URL. Trên Supabase: bấm Connect, chép chuỗi ở mục Transaction pooler và điền mật khẩu database.');
  const target = parseDatabaseUrl(url);
  let ssl;
  if (!target.isLoopback) {
    const custom = env.DATABASE_CA_CERT?.trim().replace(/\\n/g, '\n');
    const ca = custom || (target.isSupabase ? supabaseRootCa() : undefined);
    ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
  }
  const where = `${target.host}:${target.port}/${target.database}`;
  const client = new pg.Client({
    host: target.host, port: target.port, user: target.user, password: target.password, database: target.database,
    ssl, application_name: 'exchangethings-db-tools', connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
  } catch (e) {
    throw new DbToolError(`Không kết nối được tới ${where}: ${e.message}`);
  }
  return { client, target, where, tls: client.connection?.stream instanceof TLSSocket };
}

// --- Migration -------------------------------------------------------------------------------------------------
export function loadMigrations(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const bad = files.filter((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f));
  if (bad.length) throw new DbToolError(`Tên file migration sai mẫu <14 chữ số>_<ten>.sql: ${bad.join(', ')}`);
  return files.map((file) => {
    const sql = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    // Mỗi file chạy trong một transaction do bộ chạy mở. File tự commit/rollback sẽ phá cam kết "lỗi thì không để lại gì".
    if (/^\s*(begin|commit|rollback|start\s+transaction)\s*;/im.test(sql)) {
      throw new DbToolError(`${file} tự điều khiển transaction (begin/commit/rollback). Bỏ các lệnh đó: bộ chạy đã bọc mỗi file trong một transaction.`);
    }
    return { version: file.slice(0, 14), name: file.slice(15, -4), file, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

// Sổ migration nằm ở schema riêng, không lộ qua API của Supabase.
export const LEDGER_SQL = `create schema if not exists app_meta;
create table if not exists app_meta.migrations (
  version text primary key check (version ~ '^[0-9]{14}$'),
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user
);`;
// Khóa theo transaction: dùng được cả khi kết nối qua pooler chế độ transaction của Supabase.
const LOCK_SQL = `select pg_advisory_xact_lock(hashtext('exchangethings.migrations'))`;

async function assertSupabaseLike(client) {
  const r = (await client.query(`select (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) = 3 as roles,
    to_regclass('auth.users') is not null as users, to_regprocedure('auth.uid()') is not null as uid`)).rows[0];
  if (!r.roles || !r.users || !r.uid) {
    throw new DbToolError('Database này không phải Supabase (thiếu vai trò anon/authenticated/service_role hoặc schema auth). Với Postgres local, dùng: pnpm db:reset');
  }
}

export async function status(client, migrations) {
  const hasLedger = (await client.query(`select to_regclass('app_meta.migrations') is not null as ok`)).rows[0].ok;
  const rows = hasLedger ? (await client.query('select version, checksum from app_meta.migrations')).rows : [];
  const done = new Map(rows.map((r) => [r.version, r.checksum]));
  const known = new Set(migrations.map((m) => m.version));
  const newest = [...done.keys()].sort().at(-1) ?? '';
  const pending = migrations.filter((m) => !done.has(m.version));
  return {
    hasLedger,
    applied: migrations.filter((m) => done.get(m.version) === m.checksum),
    modified: migrations.filter((m) => done.has(m.version) && done.get(m.version) !== m.checksum),
    pending,
    outOfOrder: pending.filter((m) => m.version < newest),
    unknown: [...done.keys()].filter((v) => !known.has(v)).sort(),
  };
}

const lineOf = (sql, position) => (position ? ` (dòng ${sql.slice(0, Number(position) - 1).split('\n').length})` : '');

/**
 * Chạy các migration còn thiếu, theo thứ tự. Mỗi file một transaction: lỗi thì file đó không để lại gì và dừng ngay.
 * Chạy lại bao nhiêu lần cũng được. Không sửa file đã chạy: đổi nội dung là bị từ chối.
 */
export async function migrate(client, migrations, { log = () => {}, dryRun = false } = {}) {
  await assertSupabaseLike(client);
  const orphanMessage = 'Database đã có bảng của Exchangethings.vn nhưng chưa có sổ migration (app_meta.migrations). Không chạy đè. Dùng project Supabase mới, hoặc cài bằng supabase/setup.sql.';
  const hasItems = async () => (await client.query(`select to_regclass('public.items') is not null as ok`)).rows[0].ok;
  if (dryRun) {
    const st = await status(client, migrations);
    if (st.applied.length + st.modified.length + st.unknown.length === 0 && (await hasItems())) throw new DbToolError(orphanMessage);
    return { ...st, ran: [] };
  }
  // Tạo sổ và kiểm tra "có bảng mà chưa có sổ" trong cùng một khóa: lượt chạy khác không thể đang dở giữa chừng.
  await client.query('begin');
  try {
    await client.query(LOCK_SQL);
    await client.query(LEDGER_SQL);
    const empty = (await client.query('select count(*) = 0 as ok from app_meta.migrations')).rows[0].ok;
    if (empty && (await hasItems())) throw new DbToolError(orphanMessage);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
  let st = await status(client, migrations);
  if (st.modified.length) throw new DbToolError(`Migration đã chạy nhưng nội dung file đã đổi: ${st.modified.map((m) => m.file).join(', ')}. Không sửa migration đã chạy; tạo file migration mới.`);
  if (st.outOfOrder.length) throw new DbToolError(`Migration cũ hơn bản đã chạy: ${st.outOfOrder.map((m) => m.file).join(', ')}. Đặt tên file mới với thời gian sau bản mới nhất.`);
  const ran = [];
  for (const m of st.pending) {
    await client.query('begin');
    try {
      await client.query(LOCK_SQL);
      // Lượt chạy khác có thể vừa làm xong file này trong lúc mình chờ khóa.
      const seen = await client.query('select 1 from app_meta.migrations where version = $1', [m.version]);
      if (seen.rowCount === 0) {
        await client.query(m.sql);
        await client.query('insert into app_meta.migrations (version, name, checksum) values ($1, $2, $3)', [m.version, m.name, m.checksum]);
        ran.push(m.file);
        log(`đã chạy ${m.file}`);
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw new DbToolError(`${m.file}${lineOf(m.sql, e.position)}: ${e.message}. File này chưa được áp dụng; các file trước đó giữ nguyên.`);
    }
  }
  st = await status(client, migrations);
  return { ...st, ran };
}

// --- Khám database: đúng những thứ app cần để chạy ----------------------------------------------------------------
const ANON_FUNCTIONS = ['is_active_user', 'is_admin', 'is_banned'];
const USER_FUNCTIONS = [...ANON_FUNCTIONS, 'admin_review_item', 'is_blocked_with', 'mark_match_read', 'my_item_severity', 'my_profile',
  'publish_item', 'send_message', 'swipe_item', 'withdraw_item'].sort();
const NEED_POLICY = ['blocks', 'categories', 'item_media', 'item_private', 'item_reviews', 'item_wants', 'items', 'match_reads', 'matches',
  'messages', 'notifications', 'profile_private', 'profiles', 'provinces', 'swipes', 'wards'];

/**
 * Trả danh sách { id, label, ok (true/false/null = bỏ qua), detail, fix }. Chỉ đọc, không đổi dữ liệu.
 * @param {import('pg').Client} client
 * @param {{ version: string, name: string, file: string, sql: string, checksum: string }[]} migrations
 * @param {{ tls?: boolean | null, loopback?: boolean }} [options]
 * @returns {Promise<{ id: string, label: string, ok: boolean | null, detail: string, fix: string }[]>}
 */
export async function doctor(client, migrations, { tls = null, loopback = false } = {}) {
  const out = [];
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const check = async (id, label, fix, fn) => {
    try {
      const r = await fn();
      out.push({ id, label, ok: r.ok, detail: r.detail ?? '', fix: r.ok === false ? fix : '' });
    } catch (e) {
      out.push({ id, label, ok: false, detail: e.message, fix });
    }
  };

  await check('tls', 'Kết nối được mã hóa (TLS)', 'Dùng chuỗi kết nối của Supabase, không thêm tham số tắt TLS.',
    async () => (loopback ? { ok: null, detail: 'Postgres local' } : { ok: tls === true }));
  await check('platform', 'Nền Supabase: vai trò và schema auth', 'Tạo project trên supabase.com rồi dùng chuỗi kết nối của project đó.',
    async () => { await assertSupabaseLike(client); return { ok: true }; });
  await check('ctype', 'Database hiểu chữ tiếng Việt (LC_CTYPE Unicode)', 'Tạo lại project Supabase với cấu hình mặc định.',
    async () => ({ ok: (await q(`select 'ú' ~ '[[:alpha:]]' and lower('ĐẠN') = 'đạn' as ok`))[0].ok }));
  await check('migrations', `Đã chạy đủ ${migrations.length} migration`, 'Chạy: pnpm db:migrate (hoặc dán supabase/setup.sql vào SQL Editor nếu là project mới).', async () => {
    const st = await status(client, migrations);
    const bad = [...st.pending.map((m) => `chưa chạy ${m.file}`), ...st.modified.map((m) => `file đã bị sửa ${m.file}`)];
    return { ok: bad.length === 0 && st.applied.length === migrations.length, detail: bad.join('; ') };
  });
  await check('roles', 'Chuyển được sang vai trò anon, authenticated, service_role', 'Kết nối bằng tài khoản postgres của Supabase (chuỗi kết nối mặc định).', async () => {
    await client.query('begin');
    try {
      for (const role of ['anon', 'authenticated', 'service_role']) await client.query(`set local role ${role}`);
    } finally {
      await client.query('rollback');
    }
    const bypass = (await q(`select rolbypassrls as ok from pg_roles where rolname = 'service_role'`))[0]?.ok;
    return { ok: bypass === true, detail: bypass ? '' : 'service_role không có BYPASSRLS' };
  });
  await check('rls', 'Mọi bảng đều bật Row Level Security', 'Chạy lại migration phân quyền; không tắt RLS bằng tay.', async () => {
    const off = (await q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`)).map((r) => r.relname);
    const have = new Set((await q(`select distinct tablename from pg_policies where schemaname = 'public'`)).map((r) => r.tablename));
    const noPolicy = NEED_POLICY.filter((t) => !have.has(t));
    const detail = [off.length ? `chưa bật RLS: ${off.join(', ')}` : '', noPolicy.length ? `thiếu chính sách: ${noPolicy.join(', ')}` : ''].filter(Boolean).join('; ');
    return { ok: detail === '', detail };
  });
  await check('grants', 'Người dùng không có quyền ghi vượt mức', 'Chạy lại migration phân quyền.', async () => {
    const r = (await q(`select has_table_privilege('anon', 'public.items', 'insert') as "khách thêm món",
      has_table_privilege('authenticated', 'public.item_media', 'insert') as "người dùng tự ghi ảnh",
      has_column_privilege('authenticated', 'public.items', 'status', 'update') as "người dùng tự đổi trạng thái món",
      has_column_privilege('authenticated', 'public.profiles', 'trust_score', 'update') as "người dùng tự sửa điểm uy tín",
      has_column_privilege('anon', 'public.profiles', 'ward_code', 'select') as "khách đọc phường/xã của người khác",
      has_table_privilege('authenticated', 'public.swipes', 'insert') as "người dùng tự ghi lượt quẹt",
      has_table_privilege('authenticated', 'public.matches', 'insert') as "người dùng tự tạo match",
      has_table_privilege('authenticated', 'public.messages', 'insert') as "người dùng tự ghi tin nhắn (bỏ qua bước che liên lạc)",
      has_table_privilege('anon', 'public.messages', 'select') as "khách đọc tin nhắn"`))[0];
    const bad = Object.entries(r).filter(([, v]) => v).map(([k]) => k);
    return { ok: bad.length === 0, detail: bad.join('; ') };
  });
  await check('functions', 'Chỉ đúng các hàm cho phép mới gọi được từ bên ngoài', 'Chạy lại migration phân quyền (mục 11 chốt quyền gọi hàm).', async () => {
    const callable = async (role) => (await q(`select p.proname as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.name);
    const extra = [
      ...(await callable('anon')).filter((f) => !ANON_FUNCTIONS.includes(f)).map((f) => `khách gọi được ${f}`),
      ...(await callable('authenticated')).filter((f) => !USER_FUNCTIONS.includes(f)).map((f) => `người dùng gọi được ${f}`),
    ];
    return { ok: extra.length === 0, detail: extra.join('; ') };
  });
  await check('data', 'Dữ liệu gốc: 34 tỉnh/thành, 3.321 phường/xã, 27 danh mục', 'Chạy lại migration dữ liệu tham chiếu.', async () => {
    const r = (await q(`select (select count(*)::int from public.provinces) as p, (select count(*)::int from public.wards) as w,
      (select count(*)::int from public.categories) as c, (select count(*)::int from public.banned_keywords) as k`))[0];
    return { ok: r.p === 34 && r.w === 3321 && r.c === 27 && r.k > 0, detail: `${r.p} tỉnh/thành, ${r.w} phường/xã, ${r.c} danh mục, ${r.k} từ khóa` };
  });
  await check('filter', 'Bộ lọc từ khóa bắt được chữ giấu ký tự vô hình, không bắt nhầm', 'Kiểm tra LC_CTYPE và chạy lại migration.', async () => {
    const r = (await q(`select public.banned_keyword_severity('va' || chr(8203) || 'pe')::text as hidden, public.banned_keyword_severity('Đàn ukulele gỗ')::text as clean`))[0];
    return { ok: r.hidden === 'block' && r.clean === null };
  });
  await check('chat', 'Chat che số điện thoại, số tài khoản; không che số tiền', 'Chạy lại migration M2 (quẹt, khớp, chat).', async () => {
    const r = (await q(`select public.mask_contacts('gọi 0905 123 456') as phone, public.mask_contacts('ck 19035551234567') as account,
      public.mask_contacts('giá 13.000.000 ₫') as money`))[0];
    return { ok: r.phone === 'gọi [đã ẩn số điện thoại]' && r.account === 'ck [đã ẩn dãy số]' && r.money === 'giá 13.000.000 ₫' };
  });
  await check('signup', 'Tài khoản mới tự có hồ sơ (trigger trên auth.users)', 'Chạy lại migration schema.', async () => {
    const n = (await q(`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'auth' and c.relname = 'users' and t.tgname = 'on_auth_user_created' and t.tgenabled <> 'D'`))[0].n;
    return { ok: n === 1 };
  });
  await check('storage', 'Kho ảnh item-media (riêng tư) và avatars', 'Chạy lại migration phân quyền trên project Supabase.', async () => {
    if (!(await q(`select to_regclass('storage.buckets') is not null as ok`))[0].ok) return { ok: null, detail: 'không có Supabase Storage (Postgres local)' };
    const b = await q(`select id, public from storage.buckets where id in ('item-media', 'avatars')`);
    const media = b.find((x) => x.id === 'item-media');
    return { ok: Boolean(media && !media.public && b.some((x) => x.id === 'avatars')), detail: media?.public ? 'item-media đang để công khai' : '' };
  });
  return out;
}

export function formatReport(results) {
  const lines = results.map((r) => {
    if (r.ok === null) return `  –  ${r.label} (bỏ qua: ${r.detail})`;
    if (r.ok) return `  ✓  ${r.label}${r.detail ? ` (${r.detail})` : ''}`;
    return `  ✗  ${r.label}${r.detail ? `: ${r.detail}` : ''}\n     Cách sửa: ${r.fix}`;
  });
  const failed = results.filter((r) => r.ok === false).length;
  lines.push('', failed === 0 ? 'Kết quả: database sẵn sàng cho app.' : `Kết quả: còn ${failed} mục chưa đạt.`);
  return lines.join('\n');
}

// --- Một file SQL duy nhất để dán vào SQL Editor của Supabase ------------------------------------------------------
export function buildSetupSql(migrations) {
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const parts = [
    '-- Exchangethings.vn: cài đặt database cho một project Supabase MỚI.',
    '-- Cách dùng: Supabase > SQL Editor > New query > dán toàn bộ file này > Run. Không cần token, không cần dòng lệnh.',
    '-- Chạy trong một transaction: lỗi ở đâu thì không có gì thay đổi. Chạy lần hai sẽ bị từ chối, không ghi đè.',
    '-- File sinh tự động bởi scripts/build-setup-sql.mjs từ supabase/migrations; không sửa tay.',
    '',
    'begin;',
    '',
    'do $check$',
    'begin',
    "  if (select count(*) from pg_roles where rolname in ('anon', 'authenticated', 'service_role')) < 3 or to_regclass('auth.users') is null then",
    "    raise exception 'Đây không phải project Supabase: thiếu vai trò anon/authenticated/service_role hoặc bảng auth.users.';",
    '  end if;',
    "  if to_regclass('public.items') is not null or to_regclass('public.profiles') is not null or to_regclass('app_meta.migrations') is not null then",
    "    raise exception 'Database đã có bảng của Exchangethings.vn. File này chỉ dành cho project mới; không có gì thay đổi.';",
    '  end if;',
    'end $check$;',
    '',
    LEDGER_SQL,
  ];
  for (const m of migrations) {
    parts.push('', `-- ===== ${m.file} =====`, m.sql.trimEnd(), '',
      `insert into app_meta.migrations (version, name, checksum) values (${q(m.version)}, ${q(m.name)}, ${q(m.checksum)});`);
  }
  parts.push('', 'commit;', '',
    '-- Kết quả hiện ngay dưới khung soạn thảo: mọi dòng phải là true.',
    'select * from (values',
    "  ('Tài khoản kết nối chuyển được sang anon, authenticated, service_role',",
    "    pg_has_role(current_user, 'anon', 'member') and pg_has_role(current_user, 'authenticated', 'member') and pg_has_role(current_user, 'service_role', 'member')),",
    "  ('34 tỉnh/thành, 3.321 phường/xã, 27 danh mục',",
    '    (select count(*) from public.provinces) = 34 and (select count(*) from public.wards) = 3321 and (select count(*) from public.categories) = 27),',
    "  ('Mọi bảng đều bật Row Level Security',",
    "    not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)),",
    "  ('Bộ lọc từ khóa hoạt động', public.banned_keyword_severity('va' || chr(8203) || 'pe') = 'block'),",
    `  ('Sổ migration ghi đủ ${migrations.length} file', (select count(*) from app_meta.migrations) = ${migrations.length})`,
    ') as t("Kiểm tra", "Đạt");', '');
  return parts.join('\n');
}

// --- Tiện ích cho lệnh chạy tay --------------------------------------------------------------------------------
/** Máy dev: nếu chưa có DATABASE_URL trong môi trường thì đọc từ .env.local (chỉ hai biến về database). */
export function loadLocalEnv(env = process.env) {
  if (env.DATABASE_URL) return;
  let text;
  try { text = readFileSync(join(ROOT, '.env.local'), 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const m = /^(DATABASE_URL|DATABASE_CA_CERT)=(.*)$/.exec(line.trim());
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

/** Chạy một lệnh CLI: in lỗi gọn cho người dùng, đặt mã thoát, luôn đóng kết nối. */
export async function runCli(fn) {
  let conn;
  try {
    loadLocalEnv();
    conn = await connect();
    console.log(`Database: ${conn.where}${conn.target.isLoopback ? ' (local)' : conn.tls ? ' (TLS)' : ''}`);
    await fn(conn);
  } catch (e) {
    console.error(e instanceof DbToolError ? `Lỗi: ${e.message}` : e);
    process.exitCode = 1;
  } finally {
    await conn?.client.end().catch(() => {});
  }
}
