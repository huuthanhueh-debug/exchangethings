import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_UNITS_SQL_PATH, buildAdminUnitsSql } from '../../scripts/generate-admin-units-sql.mjs';
import { SEED_SQL_PATH, buildSeedSql } from '../../scripts/generate-seed.mjs';
import { SETUP_SQL_PATH, UPGRADE_SQL_PATH, buildSetupSql, buildUpgradeSql, loadMigrations, parseDatabaseUrl as parseJs } from '../../scripts/lib/db-tools.mjs';
import { parseDatabaseUrl as parseTs } from '@/server/db-url';

// File SQL sinh tự động không được sửa tay: nội dung phải khớp từng byte với output của script.
// Nếu test này đỏ, chạy lại script tương ứng thay vì sửa file SQL.
describe('file SQL sinh tự động', () => {
  it('migration địa giới hành chính khớp scripts/generate-admin-units-sql.mjs', () => {
    expect(readFileSync(ADMIN_UNITS_SQL_PATH, 'utf8')).toBe(buildAdminUnitsSql());
  });
  it('supabase/seed.sql khớp scripts/generate-seed.mjs', () => {
    expect(readFileSync(SEED_SQL_PATH, 'utf8')).toBe(buildSeedSql().sql);
  });
  it('supabase/setup.sql khớp scripts/build-setup-sql.mjs (chạy pnpm db:setup-sql sau khi thêm migration)', () => {
    expect(readFileSync(SETUP_SQL_PATH, 'utf8')).toBe(buildSetupSql(loadMigrations()));
  });
  it('supabase/upgrade.sql khớp scripts/build-setup-sql.mjs', () => {
    expect(readFileSync(UPGRADE_SQL_PATH, 'utf8')).toBe(buildUpgradeSql(loadMigrations()));
  });
  it('script và app đọc DATABASE_URL theo cùng một quy tắc', () => {
    const outcome = (fn: (u: string) => unknown, u: string) => { try { return fn(u); } catch { return 'từ chối'; } };
    for (const u of [
      'postgres://postgres:postgres@127.0.0.1:5432/exchangethings_dev', 'postgresql://u:p%40ss@[::1]:5433/db?application_name=x',
      'postgres://postgres.abc:pw@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require',
      'postgres://u:p@localhost/app?host=db.prod.example.com', 'postgres://u:p@LOCALHOST/db', 'postgres://u:p@%6cocalhost/db',
      'mysql://u:p@localhost/db', 'postgres://u:p@localhost/', 'not a url',
    ]) {
      expect(outcome(parseJs, u)).toEqual(outcome(parseTs, u));
    }
  });
  it('script sinh seed cho cùng kết quả mỗi lần chạy', () => {
    expect(buildSeedSql().sql).toBe(buildSeedSql().sql);
  });
  it('dữ liệu mẫu phủ đủ 6 loại món ở 6 tỉnh/thành', () => {
    expect(buildSeedSql().summary).toEqual({ users: 11, items: 30, types: 6, provinces: 6, media: 57, wants: 11 });
  });
});
