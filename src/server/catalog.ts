import 'server-only';
import { withAnon } from './db';
import type { CategoryInfo } from '@/lib/validation/item';

// Dữ liệu tham chiếu (tỉnh/thành, phường/xã, danh mục): chỉ đổi qua migration, nên nhớ tạm trong tiến trình 10 phút.
// Đọc dưới quyền khách vì đây là dữ liệu công khai.

export type Province = { code: string; name: string; shortName: string; region: 'north' | 'central' | 'south' };
export type Category = CategoryInfo & { nameVi: string; sort: number };
export type Ward = { code: string; name: string };
export type Catalog = {
  provinces: Province[];
  provinceByCode: Map<string, Province>;
  categories: Category[];
  categoryById: Map<string, Category>;
};

const TTL_MS = 10 * 60 * 1000;
let catalogMemo: { at: number; value: Promise<Catalog> } | undefined;
const wardMemo = new Map<string, Promise<Ward[]>>();

async function loadCatalog(): Promise<Catalog> {
  return withAnon(async (tx) => {
    const p = await tx.query<{ code: string; name: string; short_name: string; region: Province['region'] }>(
      'select code, name, short_name, region from provinces order by short_name collate "C"');
    const c = await tx.query<{ id: string; item_type: Category['item_type']; name_vi: string; requires_proof: boolean; is_phone: boolean; sort: number }>(
      'select id, item_type, name_vi, requires_proof, is_phone, sort from categories order by sort, id');
    const provinces = p.rows.map((r) => ({ code: r.code, name: r.name, shortName: r.short_name, region: r.region }))
      .sort((a, b) => a.shortName.localeCompare(b.shortName, 'vi'));
    const categories = c.rows.map((r) => ({
      id: r.id, item_type: r.item_type, nameVi: r.name_vi, requires_proof: r.requires_proof, is_phone: r.is_phone, sort: r.sort,
    }));
    return {
      provinces,
      provinceByCode: new Map(provinces.map((x) => [x.code, x])),
      categories,
      categoryById: new Map(categories.map((x) => [x.id, x])),
    };
  });
}

export function getCatalog(): Promise<Catalog> {
  const now = Date.now();
  if (!catalogMemo || now - catalogMemo.at > TTL_MS) {
    const value = loadCatalog();
    catalogMemo = { at: now, value };
    value.catch(() => { if (catalogMemo?.value === value) catalogMemo = undefined; }); // lỗi thì lần sau thử lại
  }
  return catalogMemo.value;
}

export function getWards(provinceCode: string): Promise<Ward[]> {
  if (!/^\d{2}$/.test(provinceCode)) return Promise.resolve([]);
  let value = wardMemo.get(provinceCode);
  if (!value) {
    value = withAnon(async (tx) => {
      const r = await tx.query<Ward>('select code, name from wards where province_code = $1', [provinceCode]);
      return r.rows.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    });
    wardMemo.set(provinceCode, value);
    value.catch(() => wardMemo.delete(provinceCode));
  }
  return value;
}
