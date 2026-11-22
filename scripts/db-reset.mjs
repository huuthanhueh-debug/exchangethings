// Dựng lại database Postgres LOCAL cho dev/test: xóa, tạo mới, chạy shim + migrations + seed.
// Chạy: node scripts/db-reset.mjs [--db exchangethings_dev] [--no-seed]
// Biến môi trường: DATABASE_ADMIN_URL (mặc định postgres://postgres:postgres@127.0.0.1:5432/postgres).
// An toàn: chỉ chạy với Postgres ở localhost; script này XÓA database đích, không bao giờ trỏ vào Supabase.
// tests/db/shim.sql giả lập phần Supabase có sẵn (auth.users, auth.uid(), vai trò anon/authenticated/service_role);
// trên Supabase thật chỉ chạy các file trong supabase/migrations.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export async function resetDatabase({ dbName = 'exchangethings_test', seed = true, quiet = false } = {}) {
  const adminUrl = process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
  if (!LOOPBACK.has(new URL(adminUrl).hostname)) throw new Error('db-reset chỉ chạy với Postgres ở localhost.');
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`invalid database name: ${dbName}`);
  const log = quiet ? () => {} : (...a) => console.log(...a);

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.query(`create database ${dbName}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    const files = [join(root, 'tests/db/shim.sql')];
    const migDir = join(root, 'supabase/migrations');
    for (const f of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) files.push(join(migDir, f));
    const seedFile = join(root, 'supabase/seed.sql');
    if (seed && existsSync(seedFile)) files.push(seedFile);
    for (const f of files) {
      try {
        await db.query(readFileSync(f, 'utf8'));
      } catch (e) {
        e.message = `${f.replace(root + '/', '')}: ${e.message}`;
        throw e;
      }
      log('applied', f.replace(root + '/', ''));
    }
  } finally {
    await db.end();
  }
  return url.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--db');
  const dbName = i > 0 ? process.argv[i + 1] : 'exchangethings_dev';
  resetDatabase({ dbName, seed: !process.argv.includes('--no-seed') })
    .then((u) => console.log('ready:', u.replace(/:[^:@/]+@/, ':***@')))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
