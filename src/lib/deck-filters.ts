// Bộ lọc của màn quẹt (SPEC mục 5.3): loại, danh mục, khoảng giá trị, tỉnh/thành, "chỉ món hợp với đồ tôi có".
// Bộ lọc nằm trên URL (/quet?loai=...&dm=...&gia=...&tinh=...&hop=1) nên chia sẻ được và bấm lùi vẫn đúng.

import { isItemType, type ItemType } from './items';

/** Khoảng giá trị: từ min (tính cả) tới dưới max. */
export const VALUE_RANGES = [
  { id: 'duoi-500k', label: 'Dưới 500.000 ₫', min: null, max: 500_000 },
  { id: '500k-2tr', label: '500.000 ₫ đến dưới 2 triệu', min: 500_000, max: 2_000_000 },
  { id: '2tr-5tr', label: '2 đến dưới 5 triệu', min: 2_000_000, max: 5_000_000 },
  { id: '5tr-10tr', label: '5 đến dưới 10 triệu', min: 5_000_000, max: 10_000_000 },
  { id: 'tren-10tr', label: 'Từ 10 triệu', min: 10_000_000, max: null },
] as const;
export type ValueRangeId = (typeof VALUE_RANGES)[number]['id'];

export type DeckFilters = {
  type?: ItemType;
  categoryId?: string;
  valueRange?: ValueRangeId;
  provinceCode?: string;
  onlyCompatible: boolean;
};

export const NO_FILTERS: DeckFilters = { onlyCompatible: false };

type Params = Record<string, unknown>;
// Dữ liệu từ URL hoặc từ trình duyệt: chỉ nhận chuỗi, mọi kiểu khác coi như không có.
const one = (v: unknown): string | undefined => {
  const x: unknown = Array.isArray(v) ? v[0] : v;
  return typeof x === 'string' ? x : undefined;
};

/** Đọc bộ lọc từ tham số URL hoặc dữ liệu gửi lên. Giá trị lạ bị bỏ qua, không báo lỗi. */
export function parseDeckFilters(params: Params): DeckFilters {
  const type = one(params.loai);
  const category = one(params.dm);
  const range = one(params.gia);
  const province = one(params.tinh);
  return {
    type: isItemType(type) ? type : undefined,
    categoryId: category && /^[a-z0-9-]{2,40}$/.test(category) ? category : undefined,
    valueRange: VALUE_RANGES.find((r) => r.id === range)?.id,
    provinceCode: province && /^[0-9]{2}$/.test(province) ? province : undefined,
    onlyCompatible: one(params.hop) === '1',
  };
}

export function deckFiltersToParams(f: DeckFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.type) out.loai = f.type;
  if (f.categoryId) out.dm = f.categoryId;
  if (f.valueRange) out.gia = f.valueRange;
  if (f.provinceCode) out.tinh = f.provinceCode;
  if (f.onlyCompatible) out.hop = '1';
  return out;
}

export function countDeckFilters(f: DeckFilters): number {
  return Object.keys(deckFiltersToParams(f)).length;
}

export function valueBounds(id: ValueRangeId | undefined): { min: number | null; max: number | null } {
  const r = VALUE_RANGES.find((x) => x.id === id);
  return { min: r?.min ?? null, max: r?.max ?? null };
}
