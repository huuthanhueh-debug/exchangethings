import 'server-only';
import { ITEM_TYPES, ITEM_TYPE_META, type ItemType } from '@/lib/items';
import type { Catalog } from '@/server/catalog';
import type { ItemDetail } from '@/server/items';
import type { ItemFormValues } from './item-form';

// Dữ liệu cho ItemForm: danh mục của loại món, nhóm danh mục mong muốn, tỉnh/thành, giá trị sẵn có khi sửa.
export function formOptions(catalog: Catalog, type: ItemType) {
  return {
    categories: catalog.categories
      .filter((c) => c.item_type === type)
      .map(({ id, nameVi, item_type, requires_proof, is_phone }) => ({ id, nameVi, item_type, requires_proof, is_phone })),
    wantCategories: ITEM_TYPES.map((t) => ({
      group: ITEM_TYPE_META[t].label,
      options: catalog.categories.filter((c) => c.item_type === t).map(({ id, nameVi }) => ({ id, nameVi })),
    })).filter((g) => g.options.length > 0),
    provinces: catalog.provinces.map((p) => ({ code: p.code, name: p.name })),
  };
}

export function valuesFromItem(item: ItemDetail, imei: string | null): ItemFormValues {
  const money = (n: number) => (n > 0 ? String(n) : '');
  return {
    title: item.title,
    description: item.description ?? '',
    category_id: item.categoryId ?? '',
    condition: item.condition,
    est_value_vnd: String(item.estValueVnd),
    topup_pay_max_vnd: money(item.topupPayMaxVnd),
    topup_receive_max_vnd: money(item.topupReceiveMaxVnd),
    sell_enabled: item.sellPriceVnd !== null,
    sell_price_vnd: item.sellPriceVnd !== null ? String(item.sellPriceVnd) : '',
    delivery_methods: item.deliveryMethods,
    province_code: item.provinceCode ?? '',
    expires_on: item.expiresOn ?? '',
    imei: imei ?? '',
    signed_out_confirmed: item.signedOutConfirmed,
    transfer_right_confirmed: item.transferRightConfirmed,
    duration_minutes: item.durationMinutes ? String(item.durationMinutes) : '',
    wants_categories: item.wants.categories,
    wants_keywords: item.wants.keywords.join(', '),
  };
}
