// Điểm gợi ý cho chồng thẻ (SPEC mục 8). Hàm thuần, không đọc database: dùng chung cho server và test.
//
//   score = 0,35 × wants_fit + 0,25 × value_balance + 0,20 × proximity + 0,20 × trust
//
// Cách hiểu các chỗ SPEC để mở (DECISIONS D-31):
// - Mong muốn của người xem là mọi mong muốn họ ghi trên các món đang hiển thị của mình.
// - Mong muốn của người đăng là mong muốn ghi trên chính món đang xét.
// - "Món tốt nhất" của người xem là món cho tổng (wants_fit, value_balance) có trọng số cao nhất.
// - Người xem chưa có món nào: wants_fit = 0, value_balance = 0,5 (không thưởng, không phạt).

import type { DeliveryMethod } from './items';

export type MatchWeights = { wants: number; value: number; proximity: number; trust: number };
export const DEFAULT_WEIGHTS: MatchWeights = { wants: 0.35, value: 0.25, proximity: 0.2, trust: 0.2 };

/** Mức khớp mong muốn theo SPEC: món cụ thể 1; danh mục 0,7; từ khóa 0,4. */
export const WANT_FIT = { item: 1, category: 0.7, keyword: 0.4 } as const;
export type WantKind = keyof typeof WANT_FIT;

export type Want =
  | { kind: 'item'; itemId: string }
  | { kind: 'category'; categoryId: string }
  | { kind: 'keyword'; keyword: string };

/** Phần của một món mà phép ghép cặp cần. */
export type MatchItem = {
  id: string;
  title: string;
  categoryId: string | null;
  estValueVnd: number;
  topupPayMaxVnd: number;
  topupReceiveMaxVnd: number;
  wants: Want[];
};

export type Candidate = MatchItem & {
  deliveryMethods: readonly DeliveryMethod[];
  provinceCode: string | null;
  /** Điểm uy tín của người đăng, 0 đến 100. */
  ownerTrustScore: number;
};

export type Region = 'north' | 'central' | 'south';

export type Viewer = {
  provinceCode: string | null;
  /** Các món đang hiển thị của người xem. */
  items: MatchItem[];
};

export type ScoreParts = { wantsFit: number; valueBalance: number; proximity: number; trust: number };

export type Scored = {
  score: number;
  parts: ScoreParts;
  /** Người xem muốn món này theo kiểu nào (mức cao nhất), hoặc null. */
  iWant: WantKind | null;
  /** Người đăng muốn món của người xem theo kiểu nào, hoặc null. */
  theyWant: WantKind | null;
  /** Món của người xem hợp nhất để đổi lấy món này. */
  pairedItemId: string | null;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Chuẩn hóa để so từ khóa với tên món: chữ thường, bỏ dấu, tách chữ dính số ("iphone18" thành "iphone 18"),
 * mọi ký tự khác thành khoảng trắng. Gõ có dấu hay không dấu đều khớp.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .trim();
}

/** Từ khóa khớp khi mọi chữ của nó xuất hiện liền nhau, nguyên từ, trong tên món. */
export function keywordMatches(keyword: string, title: string): boolean {
  const k = normalizeForMatch(keyword);
  return k !== '' && ` ${normalizeForMatch(title)} `.includes(` ${k} `);
}

/** Kiểu mong muốn khớp mạnh nhất giữa danh sách mong muốn và một món, hoặc null. */
export function bestWant(wants: readonly Want[], item: Pick<MatchItem, 'id' | 'title' | 'categoryId'>): WantKind | null {
  let best: WantKind | null = null;
  for (const w of wants) {
    const hit =
      w.kind === 'item' ? w.itemId === item.id
      : w.kind === 'category' ? item.categoryId !== null && w.categoryId === item.categoryId
      : keywordMatches(w.keyword, item.title);
    if (hit && (best === null || WANT_FIT[w.kind] > WANT_FIT[best])) best = w.kind;
  }
  return best;
}

const fitOf = (kind: WantKind | null) => (kind === null ? 0 : WANT_FIT[kind]);

type Money = Pick<MatchItem, 'estValueVnd' | 'topupPayMaxVnd' | 'topupReceiveMaxVnd'>;

/**
 * 1 − min(1, phần lệch còn lại / giá trị lớn hơn). Phần lệch còn lại là chênh lệch giá trị sau khi trừ mức bù
 * khả thi: bên có món giá thấp hơn chịu trả tối đa bao nhiêu, và bên kia chịu nhận tối đa bao nhiêu (lấy số nhỏ hơn).
 */
export function valueBalance(mine: Money, theirs: Money): number {
  const max = Math.max(mine.estValueVnd, theirs.estValueVnd);
  if (!(max > 0)) return 1;
  const gap = Math.abs(mine.estValueVnd - theirs.estValueVnd);
  const [payer, receiver] = mine.estValueVnd <= theirs.estValueVnd ? [mine, theirs] : [theirs, mine];
  const topup = Math.max(0, Math.min(payer.topupPayMaxVnd, receiver.topupReceiveMaxVnd));
  return clamp01(1 - Math.max(0, gap - topup) / max);
}

/** Món giao được từ xa (két số hoặc buổi online) thì khoảng cách không còn ý nghĩa. */
export function isRemote(deliveryMethods: readonly DeliveryMethod[]): boolean {
  return deliveryMethods.includes('digital') || deliveryMethods.includes('online_session');
}

/** Cùng tỉnh/thành 1; cùng miền 0,6; khác miền hoặc thiếu thông tin 0,3; giao từ xa 1. */
export function proximity(
  candidate: Pick<Candidate, 'deliveryMethods' | 'provinceCode'>,
  viewerProvince: string | null,
  regionOf: (provinceCode: string) => Region | undefined,
): number {
  if (isRemote(candidate.deliveryMethods)) return 1;
  if (!candidate.provinceCode || !viewerProvince) return 0.3;
  if (candidate.provinceCode === viewerProvince) return 1;
  const a = regionOf(candidate.provinceCode);
  const b = regionOf(viewerProvince);
  return a !== undefined && a === b ? 0.6 : 0.3;
}

/**
 * Trọng số từ platform_settings.match_weights. Thiếu, sai kiểu hoặc âm thì dùng mặc định;
 * tổng khác 1 thì chia lại cho tổng để điểm luôn nằm trong 0 đến 1.
 */
export function normalizeWeights(raw: unknown): MatchWeights {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_WEIGHTS;
  const r = raw as Record<string, unknown>;
  const keys = ['wants', 'value', 'proximity', 'trust'] as const;
  const values = keys.map((k) => r[k]);
  if (!values.every((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)) return DEFAULT_WEIGHTS;
  const sum = values.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return DEFAULT_WEIGHTS;
  const [wants, value, prox, trust] = values.map((v) => v / sum);
  return { wants, value, proximity: prox, trust };
}

export function scoreCandidate(
  candidate: Candidate,
  viewer: Viewer,
  regionOf: (provinceCode: string) => Region | undefined,
  weights: MatchWeights = DEFAULT_WEIGHTS,
): Scored {
  // Chiều A: món này có khớp mong muốn của người xem không.
  const iWant = bestWant(viewer.items.flatMap((i) => i.wants), candidate);
  const fitA = fitOf(iWant);

  // Chiều B và cán cân giá trị: chọn món của người xem hợp nhất với món này.
  let theyWant: WantKind | null = null;
  let balance = 0.5;
  let pairedItemId: string | null = null;
  let bestPair = -1;
  for (const mine of viewer.items) {
    const kind = bestWant(candidate.wants, mine);
    const vb = valueBalance(mine, candidate);
    const pair = (weights.wants * fitOf(kind)) / 2 + weights.value * vb;
    if (pair > bestPair + 1e-12 || (Math.abs(pair - bestPair) <= 1e-12 && vb > balance)) {
      bestPair = pair;
      theyWant = kind;
      balance = vb;
      pairedItemId = mine.id;
    }
  }

  const parts: ScoreParts = {
    wantsFit: (fitA + fitOf(theyWant)) / 2,
    valueBalance: balance,
    proximity: proximity(candidate, viewer.provinceCode, regionOf),
    trust: clamp01(candidate.ownerTrustScore / 100),
  };
  const score = clamp01(
    weights.wants * parts.wantsFit + weights.value * parts.valueBalance
    + weights.proximity * parts.proximity + weights.trust * parts.trust);
  return { score, parts, iWant, theyWant, pairedItemId };
}

/**
 * Xếp chồng thẻ: điểm cao trước; bằng điểm thì giữ thứ tự đầu vào (server đưa vào theo món mới nhất trước).
 * onlyCompatible: chỉ giữ món mà người đăng muốn đổi lấy thứ người xem đang có.
 */
export function rankDeck<C extends Candidate>(
  candidates: readonly C[],
  viewer: Viewer,
  regionOf: (provinceCode: string) => Region | undefined,
  options: { weights?: MatchWeights; limit?: number; onlyCompatible?: boolean } = {},
): (C & { match: Scored })[] {
  const scored = candidates.map((c, index) => ({ card: { ...c, match: scoreCandidate(c, viewer, regionOf, options.weights) }, index }));
  const kept = options.onlyCompatible ? scored.filter((s) => s.card.match.theyWant !== null) : scored;
  kept.sort((a, b) => b.card.match.score - a.card.match.score || a.index - b.index);
  return kept.slice(0, options.limit ?? kept.length).map((s) => s.card);
}
