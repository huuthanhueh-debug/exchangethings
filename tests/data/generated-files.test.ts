import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ADMIN_UNITS_SQL_PATH, buildAdminUnitsSql } from '../../scripts/generate-admin-units-sql.mjs';
import { SEED_SQL_PATH, buildSeedSql } from '../../scripts/generate-seed.mjs';

// File SQL sinh tự động không được sửa tay: nội dung phải khớp từng byte với output của script.
// Nếu test này đỏ, chạy lại script tương ứng thay vì sửa file SQL.
describe('file SQL sinh tự động', () => {
  it('migration địa giới hành chính khớp scripts/generate-admin-units-sql.mjs', () => {
    expect(readFileSync(ADMIN_UNITS_SQL_PATH, 'utf8')).toBe(buildAdminUnitsSql());
  });
  it('supabase/seed.sql khớp scripts/generate-seed.mjs', () => {
    expect(readFileSync(SEED_SQL_PATH, 'utf8')).toBe(buildSeedSql().sql);
  });
  it('script sinh seed cho cùng kết quả mỗi lần chạy', () => {
    expect(buildSeedSql().sql).toBe(buildSeedSql().sql);
  });
  it('dữ liệu mẫu phủ đủ 6 loại món ở 6 tỉnh/thành', () => {
    expect(buildSeedSql().summary).toEqual({ users: 11, items: 30, types: 6, provinces: 6, media: 57, wants: 11 });
  });
});
