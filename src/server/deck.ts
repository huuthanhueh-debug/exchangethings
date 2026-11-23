import 'server-only';
import { withActor } from './db';
import { getCatalog } from './catalog';
import { valueBounds, type DeckFilters } from '@/lib/deck-filters';
import type { Condition, DeliveryMethod, ItemType } from '@/lib/items';
import { normalizeWeights, rankDeck, type Candidate, type MatchItem, type ScoreParts, type Want, type WantKind } from '@/lib/matching';

// Chồng thẻ của màn quẹt (SPEC mục 5.3, 8). Mọi truy vấn chạy dưới quyền người xem:
// RLS quyết định món nào thấy được; lượt đã quẹt và người đã chặn nhau bị loại ngay trong truy vấn.
// Lấy tối đa POOL món mới nhất khớp bộ lọc, chấm điểm bằng src/lib/matching.ts, trả các thẻ điểm cao nhất.

const POOL = 300;
export const DECK_SIZE = 20;

export type Tier = 'new' | 'regular' | 'high';

export type DeckCard = {
  id: string;
  type: ItemType;
  title: string;
  estValueVnd: number;
  categoryId: string | null;
  provinceCode: string | null;
  condition: Condition;
  expiresOn: string | null;
  coverMediaId: string | null;
  photoCount: number;
  owner: { name: string; tier: Tier; trustScore: number; swaps: number; rating: number | null };
  wants: { categories: string[]; keywords: string[]; items: { id: string; title: string }[] };
  match: {
    score: number;
    parts: ScoreParts;
    iWant: WantKind | null;
    theyWant: WantKind | null;
    pairedItem: { id: string; title: string } | null;
  };
};

export type Deck = { cards: DeckCard[]; myActiveItems: number };

type WantRow = { t: 'item' | 'category' | 'keyword'; i: string | null; c: string | null; k: string | null; n: string | null };

function toWants(rows: WantRow[]): Want[] {
  const out: Want[] = [];
  for (const w of rows) {
    if (w.t === 'item' && w.i) out.push({ kind: 'item', itemId: w.i });
    else if (w.t === 'category' && w.c) out.push({ kind: 'category', categoryId: w.c });
    else if (w.t === 'keyword' && w.k) out.push({ kind: 'keyword', keyword: w.k });
  }
  return out;
}

// Mong muốn kèm tên món cụ thể (chỉ khi người xem được phép thấy món đó).
const WANTS_JSON = `coalesce((
  select jsonb_agg(jsonb_build_object('t', w.want_type, 'i', w.wanted_item_id, 'c', w.category_id, 'k', w.keyword,
                                      'n', (select x.title from items x where x.id = w.wanted_item_id)) order by w.id)
    from item_wants w where w.item_id = i.id), '[]'::jsonb)`;

type CandidateRow = {
  id: string; type: ItemType; title: string; category_id: string | null; est_value_vnd: string; topup_pay_max_vnd: string;
  topup_receive_max_vnd: string; delivery_methods: DeliveryMethod[]; province_code: string | null; condition: Condition;
  expires_on: string | null; cover_media_id: string | null; photo_count: number; wants: WantRow[];
  owner_name: string; trust_score: number; tier: Tier; completed_swaps: number; rating_avg: string | null;
};
type MineRow = { id: string; title: string; category_id: string | null; est_value_vnd: string; topup_pay_max_vnd: string; topup_receive_max_vnd: string; wants: WantRow[] };

export async function getDeck(viewer: { id: string; provinceCode: string | null }, filters: DeckFilters, limit = DECK_SIZE): Promise<Deck> {
  const catalog = await getCatalog();
  // Danh mục đã chọn thì loại món suy ra từ danh mục; danh mục lạ thì coi như không lọc.
  const category = filters.categoryId ? catalog.categoryById.get(filters.categoryId) : undefined;
  const type = category ? category.item_type : filters.type;
  const { min, max } = valueBounds(filters.valueRange);
  const province = filters.provinceCode && catalog.provinceByCode.has(filters.provinceCode) ? filters.provinceCode : null;

  const data = await withActor({ kind: 'user', id: viewer.id }, async (tx) => {
    const mine = await tx.query<MineRow>(
      `select i.id, i.title, i.category_id, i.est_value_vnd, i.topup_pay_max_vnd, i.topup_receive_max_vnd, ${WANTS_JSON} as wants
         from items i
        where i.owner_id = auth.uid() and i.status = 'active'
        order by i.created_at, i.id`);
    const candidates = await tx.query<CandidateRow>(
      `select i.id, i.type, i.title, i.category_id, i.est_value_vnd, i.topup_pay_max_vnd, i.topup_receive_max_vnd,
              i.delivery_methods::text[] as delivery_methods, i.province_code, i.condition, i.expires_on::text as expires_on,
              (select m.id from item_media m where m.item_id = i.id and m.kind = 'photo' order by m.sort, m.created_at limit 1) as cover_media_id,
              (select count(*)::int from item_media m where m.item_id = i.id and m.kind = 'photo') as photo_count,
              ${WANTS_JSON} as wants,
              p.display_name as owner_name, p.trust_score, p.tier, p.completed_swaps, p.rating_avg
         from items i join profiles p on p.id = i.owner_id
        where i.status = 'active'
          and i.owner_id <> auth.uid()
          and not exists (select 1 from swipes s where s.viewer_id = auth.uid() and s.item_id = i.id)
          and not is_blocked_with(i.owner_id)
          and ($1::item_type is null or i.type = $1)
          and ($2::text is null or i.category_id = $2)
          and ($3::bigint is null or i.est_value_vnd >= $3)
          and ($4::bigint is null or i.est_value_vnd < $4)
          and ($5::text is null or i.province_code = $5)
        order by i.created_at desc, i.id
        limit $6`,
      [type ?? null, category ? filters.categoryId : null, min, max, province, POOL]);
    const weights = await tx.query<{ value: unknown }>(`select value from platform_settings where key = 'match_weights'`);
    return { mine: mine.rows, candidates: candidates.rows, weights: weights.rows[0]?.value };
  });

  const myItems: MatchItem[] = data.mine.map((r) => ({
    id: r.id, title: r.title, categoryId: r.category_id, estValueVnd: Number(r.est_value_vnd),
    topupPayMaxVnd: Number(r.topup_pay_max_vnd), topupReceiveMaxVnd: Number(r.topup_receive_max_vnd), wants: toWants(r.wants),
  }));
  const myTitles = new Map(myItems.map((i) => [i.id, i.title]));
  const pool: (Candidate & { row: CandidateRow })[] = data.candidates.map((r) => ({
    id: r.id, title: r.title, categoryId: r.category_id, estValueVnd: Number(r.est_value_vnd),
    topupPayMaxVnd: Number(r.topup_pay_max_vnd), topupReceiveMaxVnd: Number(r.topup_receive_max_vnd), wants: toWants(r.wants),
    deliveryMethods: r.delivery_methods, provinceCode: r.province_code, ownerTrustScore: r.trust_score, row: r,
  }));

  const ranked = rankDeck(pool, { provinceCode: viewer.provinceCode, items: myItems },
    (code) => catalog.provinceByCode.get(code)?.region,
    { weights: normalizeWeights(data.weights), limit, onlyCompatible: filters.onlyCompatible });

  const cards = ranked.map(({ row: r, match }): DeckCard => ({
    id: r.id, type: r.type, title: r.title, estValueVnd: Number(r.est_value_vnd), categoryId: r.category_id,
    provinceCode: r.province_code, condition: r.condition, expiresOn: r.expires_on, coverMediaId: r.cover_media_id, photoCount: r.photo_count,
    owner: {
      name: r.owner_name, tier: r.tier, trustScore: r.trust_score, swaps: r.completed_swaps,
      rating: r.rating_avg === null ? null : Number(r.rating_avg),
    },
    wants: {
      categories: r.wants.filter((w) => w.t === 'category' && w.c).map((w) => w.c!),
      keywords: r.wants.filter((w) => w.t === 'keyword' && w.k).map((w) => w.k!),
      items: r.wants.filter((w) => w.t === 'item' && w.i && w.n).map((w) => ({ id: w.i!, title: w.n! })),
    },
    match: {
      score: match.score, parts: match.parts, iWant: match.iWant, theyWant: match.theyWant,
      pairedItem: match.pairedItemId ? { id: match.pairedItemId, title: myTitles.get(match.pairedItemId) ?? '' } : null,
    },
  }));
  return { cards, myActiveItems: myItems.length };
}

export type SwipeResult = { matched: boolean; matchId: string | null; isNew: boolean };

/** Ghi một lượt quẹt qua hàm swipe_item của database (giới hạn tần suất và luật khớp nằm ở đó). */
export function swipeItem(userId: string, itemId: string, direction: 'like' | 'pass'): Promise<SwipeResult> {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<{ matched: boolean; match_id: string | null; is_new: boolean }>('select * from swipe_item($1, $2)', [itemId, direction]);
    const row = r.rows[0];
    return { matched: row.matched, matchId: row.match_id, isNew: row.is_new };
  });
}

/** Người xem đã quẹt món này chưa, và đã khớp với chủ món chưa (cho nút "Quan tâm" ở trang món). */
export function getInterest(userId: string, itemId: string, ownerId: string): Promise<{ direction: 'like' | 'pass' | null; matchId: string | null }> {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<{ direction: 'like' | 'pass' | null; match_id: string | null }>(
      `select (select s.direction::text from swipes s where s.viewer_id = auth.uid() and s.item_id = $1) as direction,
              (select m.id from matches m
                where (m.user_a = auth.uid() and m.user_b = $2) or (m.user_b = auth.uid() and m.user_a = $2)) as match_id`,
      [itemId, ownerId]);
    return { direction: r.rows[0].direction, matchId: r.rows[0].match_id };
  });
}

const DB_MESSAGES: [RegExp, string][] = [
  [/daily swipe limit reached/, 'Bạn đã quẹt hết lượt của hôm nay. Quay lại sau nhé.'],
  [/item is not available/, 'Món này không còn hiển thị.'],
  [/cannot swipe your own item/, 'Đây là món của bạn.'],
  [/sign in to swipe/, 'Tài khoản chưa quẹt được. Đăng nhập lại rồi thử lần nữa.'],
];

export function friendlySwipeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, text] of DB_MESSAGES) if (re.test(msg)) return text;
  return 'Chưa ghi được lượt quẹt. Thử lại sau ít phút.';
}
