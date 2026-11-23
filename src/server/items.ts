import 'server-only';
import { withActor, type Actor } from './db';
import type { Condition, DeliveryMethod, ItemStatus, ItemType } from '@/lib/items';

// Truy vấn đọc món. Chạy dưới quyền người xem: RLS quyết định món nào, ảnh nào được thấy.

export type ItemCard = {
  id: string;
  type: ItemType;
  title: string;
  estValueVnd: number;
  status: ItemStatus;
  provinceCode: string | null;
  categoryId: string | null;
  expiresOn: string | null;
  coverMediaId: string | null;
  photoCount: number;
  ownerName: string;
  createdAt: Date;
};

export type ItemDetail = ItemCard & {
  ownerId: string;
  ownerTier: 'new' | 'regular' | 'high';
  ownerSwaps: number;
  ownerRating: number | null;
  description: string | null;
  condition: Condition;
  topupPayMaxVnd: number;
  topupReceiveMaxVnd: number;
  sellPriceVnd: number | null;
  deliveryMethods: DeliveryMethod[];
  imeiLast4: string | null;
  signedOutConfirmed: boolean;
  transferRightConfirmed: boolean;
  durationMinutes: number | null;
  reviewNote: string | null;
  media: { id: string; kind: 'photo' | 'proof'; width: number | null; height: number | null }[];
  /** items: món cụ thể muốn đổi lấy; chỉ gồm món mà người xem được phép thấy. */
  wants: { categories: string[]; keywords: string[]; items: { id: string; title: string }[] };
};

const CARD_COLUMNS = `
  i.id, i.type, i.title, i.est_value_vnd, i.status, i.province_code, i.category_id, i.expires_on::text as expires_on, i.created_at,
  p.display_name as owner_name,
  (select m.id from item_media m where m.item_id = i.id and m.kind = 'photo' order by m.sort, m.created_at limit 1) as cover_media_id,
  (select count(*)::int from item_media m where m.item_id = i.id and m.kind = 'photo') as photo_count`;

type CardRow = {
  id: string; type: ItemType; title: string; est_value_vnd: string; status: ItemStatus; province_code: string | null;
  category_id: string | null; expires_on: string | null; created_at: Date; owner_name: string; cover_media_id: string | null; photo_count: number;
};

function toCard(r: CardRow): ItemCard {
  return {
    id: r.id, type: r.type, title: r.title, estValueVnd: Number(r.est_value_vnd), status: r.status,
    provinceCode: r.province_code, categoryId: r.category_id, expiresOn: r.expires_on, coverMediaId: r.cover_media_id,
    photoCount: r.photo_count, ownerName: r.owner_name, createdAt: r.created_at,
  };
}

/** Món đang hiển thị mới nhất, có thể lọc theo loại. */
export function listRecentItems(actor: Actor, { limit = 24, type }: { limit?: number; type?: ItemType } = {}) {
  return withActor(actor, async (tx) => {
    const r = await tx.query<CardRow>(
      `select ${CARD_COLUMNS}
         from items i join profiles p on p.id = i.owner_id
        where i.status = 'active' and ($2::item_type is null or i.type = $2)
        order by i.created_at desc, i.id
        limit $1`, [limit, type ?? null]);
    return r.rows.map(toCard);
  });
}

/** Món của chính người dùng, mọi trạng thái. */
export function listMyItems(userId: string) {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<CardRow>(
      `select ${CARD_COLUMNS}
         from items i join profiles p on p.id = i.owner_id
        where i.owner_id = auth.uid()
        order by i.updated_at desc, i.id`);
    return r.rows.map(toCard);
  });
}

/** Chi tiết một món nếu người xem được phép thấy (RLS), ngược lại null. */
export function getItem(actor: Actor, id: string): Promise<ItemDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Promise.resolve(null);
  return withActor(actor, async (tx) => {
    const r = await tx.query<CardRow & {
      owner_id: string; tier: ItemDetail['ownerTier']; completed_swaps: number; rating_avg: string | null; description: string | null;
      condition: Condition; topup_pay_max_vnd: string; topup_receive_max_vnd: string; sell_price_vnd: string | null;
      delivery_methods: DeliveryMethod[]; imei_last4: string | null; signed_out_confirmed: boolean; transfer_right_confirmed: boolean;
      duration_minutes: number | null; review_note: string | null;
    }>(
      `select ${CARD_COLUMNS}, i.owner_id, p.tier, p.completed_swaps, p.rating_avg, i.description, i.condition,
              i.topup_pay_max_vnd, i.topup_receive_max_vnd, i.sell_price_vnd, i.delivery_methods::text[] as delivery_methods,
              i.imei_last4, i.signed_out_confirmed, i.transfer_right_confirmed, i.duration_minutes, i.review_note
         from items i join profiles p on p.id = i.owner_id
        where i.id = $1`, [id]);
    const row = r.rows[0];
    if (!row) return null;
    const media = await tx.query<ItemDetail['media'][number]>(
      `select id, kind, width, height from item_media where item_id = $1 order by kind desc, sort, created_at`, [id]);
    const wants = await tx.query<{ want_type: string; category_id: string | null; keyword: string | null; wanted_item_id: string | null; wanted_title: string | null }>(
      `select w.want_type, w.category_id, w.keyword, w.wanted_item_id, x.title as wanted_title
         from item_wants w left join items x on x.id = w.wanted_item_id
        where w.item_id = $1 order by w.id`, [id]);
    return {
      ...toCard(row),
      ownerId: row.owner_id,
      ownerTier: row.tier,
      ownerSwaps: row.completed_swaps,
      ownerRating: row.rating_avg === null ? null : Number(row.rating_avg),
      description: row.description,
      condition: row.condition,
      topupPayMaxVnd: Number(row.topup_pay_max_vnd),
      topupReceiveMaxVnd: Number(row.topup_receive_max_vnd),
      sellPriceVnd: row.sell_price_vnd === null ? null : Number(row.sell_price_vnd),
      deliveryMethods: row.delivery_methods,
      imeiLast4: row.imei_last4,
      signedOutConfirmed: row.signed_out_confirmed,
      transferRightConfirmed: row.transfer_right_confirmed,
      durationMinutes: row.duration_minutes,
      reviewNote: row.review_note,
      media: media.rows,
      wants: {
        categories: wants.rows.filter((w) => w.want_type === 'category' && w.category_id).map((w) => w.category_id!),
        keywords: wants.rows.filter((w) => w.want_type === 'keyword' && w.keyword).map((w) => w.keyword!),
        items: wants.rows.filter((w) => w.want_type === 'item' && w.wanted_item_id && w.wanted_title)
          .map((w) => ({ id: w.wanted_item_id!, title: w.wanted_title! })),
      },
    };
  });
}

/** IMEI đầy đủ: chỉ chủ món (và admin) đọc được, RLS chặn người khác. */
export function getItemImei(userId: string, itemId: string): Promise<string | null> {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<{ imei_full: string }>('select imei_full from item_private where item_id = $1', [itemId]);
    return r.rows[0]?.imei_full ?? null;
  });
}
