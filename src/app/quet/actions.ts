'use server';

import { parseDeckFilters } from '@/lib/deck-filters';
import { todayInVietnam } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { friendlySwipeError, getDeck, swipeItem } from '@/server/deck';
import { getMatch, isUuid } from '@/server/matches';
import { getViewer } from '@/server/session';
import { toCardView, type CardView } from './card-view';

// Server Action của màn quẹt. Mỗi action tự kiểm tra phiên; chỉ tin id và hướng quẹt từ trình duyệt.
// Giới hạn tần suất, luật khớp và kiểm tra món có quẹt được không nằm trong hàm swipe_item của database.

export type MatchCelebration = {
  matchId: string;
  otherName: string;
  theirItem: { title: string; coverMediaId: string | null } | null;
  myItem: { title: string; coverMediaId: string | null } | null;
};

export type SwipeOutcome =
  | { ok: true; matched: boolean; isNew: boolean; matchId: string | null; celebration: MatchCelebration | null }
  | { ok: false; code: 'auth' | 'limit' | 'gone' | 'error'; message: string };

export async function swipeAction(itemId: string, direction: 'like' | 'pass'): Promise<SwipeOutcome> {
  if (!isUuid(itemId) || (direction !== 'like' && direction !== 'pass')) {
    return { ok: false, code: 'error', message: 'Yêu cầu không hợp lệ.' };
  }
  const viewer = await getViewer();
  if (!viewer) return { ok: false, code: 'auth', message: 'Phiên đăng nhập đã hết. Đăng nhập lại để quẹt tiếp.' };
  try {
    const r = await swipeItem(viewer.id, itemId, direction);
    let celebration: MatchCelebration | null = null;
    if (r.matched && r.isNew && r.matchId) {
      const m = await getMatch(viewer.id, r.matchId);
      if (m) celebration = { matchId: m.id, otherName: m.other.name, theirItem: m.theirItem, myItem: m.myItem };
    }
    return { ok: true, matched: r.matched, isNew: r.isNew, matchId: r.matchId, celebration };
  } catch (e) {
    const raw = e instanceof Error ? e.message : '';
    const code = /daily swipe limit/.test(raw) ? 'limit' : /not available|your own item/.test(raw) ? 'gone' : /sign in/.test(raw) ? 'auth' : 'error';
    return { ok: false, code, message: friendlySwipeError(e) };
  }
}

/** Lô thẻ tiếp theo theo cùng bộ lọc. Món đã quẹt không quay lại; trình duyệt tự bỏ thẻ đang cầm. */
export async function loadDeckAction(params: Record<string, string>): Promise<{ ok: true; cards: CardView[] } | { ok: false }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false };
  const safe = typeof params === 'object' && params !== null ? params : {};
  const [deck, catalog] = await Promise.all([getDeck(viewer, parseDeckFilters(safe)), getCatalog()]);
  const today = todayInVietnam();
  return { ok: true, cards: deck.cards.map((c) => toCardView(c, catalog, today)) };
}
