import 'server-only';
import { withActor } from './db';
import type { Tier } from './deck';

// Danh sách khớp và từng cuộc trò chuyện. Chạy dưới quyền người xem: RLS chỉ trả match mà họ là một trong hai người.
// Hai người đã chặn nhau thì match bị ẩn ở cả hai phía (SPEC mục 12).

export type MatchItemRef = { id: string; title: string; coverMediaId: string | null };

export type MatchSummary = {
  id: string;
  createdAt: string;
  other: { name: string; tier: Tier | null; trustScore: number | null; swaps: number | null };
  /** Món của người kia mà mình đã thích; null khi món không còn hiển thị. */
  theirItem: MatchItemRef | null;
  myItem: MatchItemRef | null;
  last: { body: string; mine: boolean; at: string } | null;
  unread: number;
  /** Mới khớp, mình chưa mở lần nào. */
  isNew: boolean;
};

type Row = {
  id: string; created_at: Date; other_name: string | null; other_tier: Tier | null; other_trust: number | null; other_swaps: number | null;
  their_item_id: string | null; their_item_title: string | null; their_cover: string | null;
  my_item_id: string | null; my_item_title: string | null; my_cover: string | null;
  last_body: string | null; last_mine: boolean | null; last_at: Date | null; unread: number; opened: boolean;
};

const cover = (alias: string) =>
  `(select m.id from item_media m where m.item_id = ${alias}.id and m.kind = 'photo' order by m.sort, m.created_at limit 1)`;

const SUMMARY_SQL = `
  with mine as (
    select m.id, m.created_at,
           case when m.user_a = auth.uid() then m.user_b else m.user_a end as other_id,
           case when m.user_a = auth.uid() then m.item_a else m.item_b end as my_item_id,
           case when m.user_a = auth.uid() then m.item_b else m.item_a end as their_item_id
      from matches m
     where auth.uid() in (m.user_a, m.user_b) and ($1::uuid is null or m.id = $1)
  )
  select mine.id, mine.created_at,
         p.display_name as other_name, p.tier as other_tier, p.trust_score as other_trust, p.completed_swaps as other_swaps,
         ti.id as their_item_id, ti.title as their_item_title, ${cover('ti')} as their_cover,
         mi.id as my_item_id, mi.title as my_item_title, ${cover('mi')} as my_cover,
         lm.body as last_body, lm.mine as last_mine, lm.created_at as last_at,
         (select count(*)::int from messages x
           where x.match_id = mine.id and x.sender_id <> auth.uid()
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)) as unread,
         r.match_id is not null as opened
    from mine
    left join profiles p on p.id = mine.other_id
    left join items ti on ti.id = mine.their_item_id
    left join items mi on mi.id = mine.my_item_id
    left join match_reads r on r.match_id = mine.id and r.user_id = auth.uid()
    left join lateral (
      select x.body, x.sender_id = auth.uid() as mine, x.created_at
        from messages x where x.match_id = mine.id order by x.created_at desc, x.id desc limit 1) lm on true
   where not is_blocked_with(mine.other_id)
   order by coalesce(lm.created_at, mine.created_at) desc, mine.id
   limit 200`;

function toSummary(r: Row): MatchSummary {
  return {
    id: r.id,
    createdAt: r.created_at.toISOString(),
    // Hồ sơ của người bị khóa không đọc được nữa: hiện tên trung tính.
    other: { name: r.other_name ?? 'Tài khoản không còn hoạt động', tier: r.other_tier, trustScore: r.other_trust, swaps: r.other_swaps },
    theirItem: r.their_item_id && r.their_item_title ? { id: r.their_item_id, title: r.their_item_title, coverMediaId: r.their_cover } : null,
    myItem: r.my_item_id && r.my_item_title ? { id: r.my_item_id, title: r.my_item_title, coverMediaId: r.my_cover } : null,
    last: r.last_body !== null && r.last_at ? { body: r.last_body, mine: r.last_mine === true, at: r.last_at.toISOString() } : null,
    unread: r.unread,
    isNew: !r.opened,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export function listMatches(userId: string): Promise<MatchSummary[]> {
  return withActor({ kind: 'user', id: userId }, async (tx) => (await tx.query<Row>(SUMMARY_SQL, [null])).rows.map(toSummary));
}

export function getMatch(userId: string, matchId: string): Promise<MatchSummary | null> {
  if (!isUuid(matchId)) return Promise.resolve(null);
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const row = (await tx.query<Row>(SUMMARY_SQL, [matchId])).rows[0];
    return row ? toSummary(row) : null;
  });
}

/** Số cuộc trò chuyện cần xem: mới khớp chưa mở, hoặc có tin chưa đọc. Dùng cho chấm đỏ ở thanh điều hướng. */
export function countAttentionMatches(userId: string): Promise<number> {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<{ n: number }>(
      `select count(*)::int as n
         from matches m
         left join match_reads r on r.match_id = m.id and r.user_id = auth.uid()
        where auth.uid() in (m.user_a, m.user_b)
          and not is_blocked_with(case when m.user_a = auth.uid() then m.user_b else m.user_a end)
          and (r.match_id is null or exists (
                select 1 from messages x
                 where x.match_id = m.id and x.sender_id <> auth.uid() and x.created_at > r.last_read_at))`);
    return r.rows[0].n;
  });
}
