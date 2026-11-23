// Sinh migration dữ liệu hành chính (34 tỉnh/thành, 3.321 phường/xã, có hiệu lực từ 01/07/2025)
// từ data/admin-units/admin-units-2025.json.
// Chạy: node scripts/generate-admin-units-sql.mjs (test kiểm tra file migration luôn khớp output này).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/admin-units/admin-units-2025.json'), 'utf8'));

// Ba miền dùng cho điểm "gần về địa lý" (SPEC mục 8). Mã tỉnh theo danh mục mới.
const REGIONS = {
  north: ['01', '04', '08', '11', '12', '14', '15', '19', '20', '22', '24', '25', '31', '33', '37'],
  central: ['38', '40', '42', '44', '46', '48', '51', '52', '56', '66', '68'],
  south: ['75', '79', '80', '82', '86', '91', '92', '96'],
};
const regionOf = new Map(Object.entries(REGIONS).flatMap(([r, codes]) => codes.map((c) => [c, r])));

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Tên ngắn để hiển thị trên thẻ món: dữ liệu gốc để short_name trùng name ("Thành phố Hà Nội").
// 6 thành phố trực thuộc trung ương bỏ chữ "Thành phố"; TP. Hồ Chí Minh viết "TP.HCM" cho khỏi nhầm.
const shortName = (p) => {
  if (p.place_type !== 'Thành phố Trung Ương') return p.short_name;
  const bare = p.name.replace(/^Thành phố\s+/, '');
  return bare === 'Hồ Chí Minh' ? 'TP.HCM' : bare;
};

export const ADMIN_UNITS_SQL_PATH = join(root, 'supabase/migrations/20261122000310_admin_units.sql');

export function buildAdminUnitsSql() {
  if (data.provinces.length !== 34) throw new Error(`expected 34 provinces, got ${data.provinces.length}`);
  if (data.wards.length !== 3321) throw new Error(`expected 3321 wards, got ${data.wards.length}`);
  for (const p of data.provinces) if (!regionOf.has(p.code)) throw new Error(`no region for province ${p.code}`);
  if (regionOf.size !== 34) throw new Error('region map must cover exactly 34 provinces');

  const lines = [
    '-- Exchangethings.vn: đơn vị hành chính Việt Nam từ 01/07/2025 (34 tỉnh/thành, 3.321 phường/xã).',
    `-- Nguồn: ${data.source}.`,
    '-- File này được sinh bởi scripts/generate-admin-units-sql.mjs; không sửa tay.',
    '',
    'insert into public.provinces (code, name, short_name, place_type, region) values',
    data.provinces
      .map((p) => `  (${q(p.code)}, ${q(p.name)}, ${q(shortName(p))}, ${q(p.place_type)}, ${q(regionOf.get(p.code))})`)
      .join(',\n') + ';',
    '',
  ];
  const CHUNK = 500;
  for (let i = 0; i < data.wards.length; i += CHUNK) {
    lines.push('insert into public.wards (code, name, province_code) values');
    lines.push(
      data.wards
        .slice(i, i + CHUNK)
        .map((w) => `  (${q(w.code)}, ${q(w.name)}, ${q(w.province_code)})`)
        .join(',\n') + ';',
    );
    lines.push('');
  }
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(ADMIN_UNITS_SQL_PATH, buildAdminUnitsSql());
  console.log(`wrote ${ADMIN_UNITS_SQL_PATH}: ${data.provinces.length} provinces, ${data.wards.length} wards`);
}
