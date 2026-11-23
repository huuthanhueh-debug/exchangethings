// Sinh hai file SQL để dán vào SQL Editor của Supabase (không cần token, không cần dòng lệnh):
// - supabase/setup.sql: cài database cho project MỚI.
// - supabase/upgrade.sql: cập nhật project ĐÃ CÀI lên bản mới nhất (chỉ chạy migration còn thiếu).
// Dùng: pnpm db:setup-sql   (test kiểm tra hai file luôn khớp output này)
import { writeFileSync } from 'node:fs';
import { SETUP_SQL_PATH, UPGRADE_SQL_PATH, buildSetupSql, buildUpgradeSql, loadMigrations } from './lib/db-tools.mjs';

const migrations = loadMigrations();
const kb = (sql) => `${Math.round(Buffer.byteLength(sql) / 1024)} KB`;
const setup = buildSetupSql(migrations);
writeFileSync(SETUP_SQL_PATH, setup);
const upgrade = buildUpgradeSql(migrations);
writeFileSync(UPGRADE_SQL_PATH, upgrade);
console.log(`supabase/setup.sql: ${migrations.length} migration, ${kb(setup)}`);
console.log(`supabase/upgrade.sql: ${kb(upgrade)}`);
