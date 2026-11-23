import 'server-only';
import { formatDateVi, formatVnd } from '@/lib/format';
import { CONDITION_LABEL, ITEM_TYPE_META, daysUntil, type ItemType } from '@/lib/items';
import { TIER_LABEL } from '@/lib/tiers';
import type { Catalog } from '@/server/catalog';
import type { DeckCard, GuestCard } from '@/server/deck';

// Dữ liệu một thẻ đã sẵn chữ để hiển thị. Dựng ở server để trình duyệt không phải tải danh mục, tỉnh/thành
// và không phải tự định dạng tiền.

export type CardTag = { text: string; tone: 'accent' | 'ok' | 'warn' | 'neutral' };

export type CardView = {
  id: string;
  type: ItemType;
  title: string;
  value: string;
  /** Dòng phụ: tình trạng (nếu có), danh mục, nơi giao. */
  meta: string[];
  photoIds: string[];
  /** null với khách xem thử: thông tin người đăng chỉ hiện sau khi đăng nhập. */
  owner: { name: string; tier: string; trustScore: number } | null;
  wants: string[];
  tags: CardTag[];
  /** Điểm gợi ý theo phần trăm (SPEC mục 8); null với khách xem thử. */
  score: number | null;
  reasons: string[];
};

function durationText(m: number) {
  if (m < 60) return `${m} phút`;
  return m % 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m / 60} giờ`;
}

export function toCardView(card: DeckCard | GuestCard, catalog: Catalog, today: string): CardView {
  const category = card.categoryId ? catalog.categoryById.get(card.categoryId) : undefined;
  const place = card.provinceCode ? catalog.provinceByCode.get(card.provinceCode)?.shortName : undefined;
  const meta = [
    card.condition !== 'not_applicable' ? CONDITION_LABEL[card.condition] : undefined,
    category?.nameVi ?? ITEM_TYPE_META[card.type].label,
    place,
  ].filter((x): x is string => Boolean(x));

  const tags: CardTag[] = [];
  if (card.expiresOn) {
    const left = daysUntil(card.expiresOn, today);
    tags.push(left < 7 ? { text: left < 0 ? 'Đã hết hạn' : `Còn ${left} ngày`, tone: 'warn' } : { text: `HSD ${formatDateVi(card.expiresOn)}`, tone: 'neutral' });
  }
  if (card.durationMinutes) tags.push({ text: durationText(card.durationMinutes), tone: 'neutral' });
  if (card.topupReceiveMaxVnd > 0) tags.push({ text: `Nhận bù tối đa ${formatVnd(card.topupReceiveMaxVnd)}`, tone: 'accent' });
  if (card.topupPayMaxVnd > 0) tags.push({ text: `Chịu bù tối đa ${formatVnd(card.topupPayMaxVnd)}`, tone: 'accent' });
  if (card.sellPriceVnd !== null) tags.push({ text: `Bán thẳng ${formatVnd(card.sellPriceVnd)}`, tone: 'neutral' });
  if (card.imeiConfirmed) tags.push({ text: 'Có IMEI, đã thoát iCloud/Google', tone: 'ok' });
  if (category?.requires_proof) tags.push({ text: 'Đã gửi chứng từ hàng hiệu', tone: 'ok' });

  const reasons: string[] = [];
  const personal = 'match' in card ? card : null;
  if (personal) {
    const { match, owner } = personal;
    if (match.pairedItem && match.theyWant === 'item') reasons.push(`${owner.name} muốn đúng món "${match.pairedItem.title}" của bạn`);
    else if (match.pairedItem && match.theyWant) reasons.push(`${owner.name} đang tìm món như "${match.pairedItem.title}" của bạn`);
    if (match.iWant === 'item') reasons.push('Đúng món bạn đã chọn muốn đổi');
    else if (match.iWant === 'category') reasons.push('Thuộc danh mục bạn đang tìm');
    else if (match.iWant === 'keyword') reasons.push('Khớp từ khóa bạn đang tìm');
    if (card.remote) reasons.push('Giao từ xa, không lo khoảng cách');
    else if (match.parts.proximity === 1) reasons.push('Cùng tỉnh/thành với bạn');
  } else if (card.remote) {
    reasons.push('Giao từ xa, không lo khoảng cách');
  }

  return {
    id: card.id,
    type: card.type,
    title: card.title,
    value: formatVnd(card.estValueVnd),
    meta,
    photoIds: card.photoIds,
    owner: personal ? { name: personal.owner.name, tier: TIER_LABEL[personal.owner.tier], trustScore: personal.owner.trustScore } : null,
    wants: [
      ...card.wants.items.map((i) => i.title),
      ...card.wants.categories.map((id) => catalog.categoryById.get(id)?.nameVi ?? id),
      ...card.wants.keywords,
    ],
    tags,
    score: personal ? Math.round(personal.match.score * 100) : null,
    reasons: reasons.slice(0, 2),
  };
}
