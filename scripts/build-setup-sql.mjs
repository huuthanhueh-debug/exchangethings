// Sinh supabase/setup.sql: một file duy nhất để dán vào SQL Editor của Supabase (cài database không cần token).
// Dùng: pnpm db:setup-sql   (test kiểm tra file luôn khớp output này)
import { writeFileSync } from 'node:fs';
import { SETUP_SQL_PATH, buildSetupSql, loadMigrations } from './lib/db-tools.mjs';

const migrations = loadMigrations();
const sql = buildSetupSql(migrations);
writeFileSync(SETUP_SQL_PATH, sql);
console.log(`supabase/setup.sql: ${migrations.length} migration, ${Math.round(Buffer.byteLength(sql) / 1024)} KB`);
