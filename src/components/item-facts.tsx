import { formatDateVi, formatVnd } from '@/lib/format';
import { CONDITION_LABEL, DELIVERY_LABEL, ITEM_TYPE_META } from '@/lib/items';
import type { Catalog } from '@/server/catalog';
import type { ItemDetail } from '@/server/items';
import { Badge } from './ui';

function durationText(m: number) {
  if (m < 60) return `${m} phút`;
  return m % 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m / 60} giờ`;
}

/** Bảng thông tin món, dùng chung cho trang công khai và trang quản lý. */
export function ItemFacts({ item, catalog }: { item: ItemDetail; catalog: Catalog }) {
  const meta = ITEM_TYPE_META[item.type];
  const category = item.categoryId ? catalog.categoryById.get(item.categoryId) : undefined;
  const rows: [string, React.ReactNode][] = [
    ['Loại', meta.label],
    ['Danh mục', category?.nameVi ?? 'Chưa chọn'],
  ];
  if (meta.hasCondition && item.condition !== 'not_applicable') rows.push(['Tình trạng', CONDITION_LABEL[item.condition]]);
  rows.push(['Cách giao', item.deliveryMethods.map((d) => DELIVERY_LABEL[d]).join(', ')]);
  if (item.provinceCode) rows.push(['Nơi giao', catalog.provinceByCode.get(item.provinceCode)?.name ?? item.provinceCode]);
  if (item.expiresOn) rows.push(['Hạn dùng', formatDateVi(item.expiresOn)]);
  if (item.durationMinutes) rows.push(['Thời lượng', durationText(item.durationMinutes)]);
  if (category?.is_phone && item.imeiLast4) rows.push(['IMEI', <span key="imei" className="tabular">···{item.imeiLast4}{item.signedOutConfirmed ? ', đã thoát iCloud/Google' : ''}</span>]);
  if (item.topupPayMaxVnd > 0) rows.push(['Chủ món bù thêm tối đa', <span key="p" className="tabular">{formatVnd(item.topupPayMaxVnd)}</span>]);
  if (item.topupReceiveMaxVnd > 0) rows.push(['Chủ món nhận bù tối đa', <span key="r" className="tabular">{formatVnd(item.topupReceiveMaxVnd)}</span>]);
  if (item.sellPriceVnd !== null) rows.push(['Bán thẳng', <span key="s" className="tabular">{formatVnd(item.sellPriceVnd)}</span>]);

  const wants = [
    ...item.wants.categories.map((id) => catalog.categoryById.get(id)?.nameVi ?? id),
    ...item.wants.keywords,
  ];

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line text-[15px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-start justify-between gap-4 py-2.5 first:pt-0">
            <dt className="shrink-0 text-ink-2">{k}</dt>
            <dd className="min-w-0 text-right font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1.5 text-sm font-semibold text-ink">Muốn đổi lấy</p>
        {wants.length ? (
          <div className="flex flex-wrap gap-1.5">{wants.map((w) => <Badge key={w} tone="accent">{w}</Badge>)}</div>
        ) : (
          <p className="text-sm text-ink-2">Sẵn sàng xem mọi đề nghị.</p>
        )}
      </div>
      {item.description && (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink">{item.type === 'voucher' ? 'Điều kiện áp dụng' : 'Mô tả'}</p>
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink-2">{item.description}</p>
        </div>
      )}
    </div>
  );
}
