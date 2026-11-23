import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS, bestWant, isRemote, keywordMatches, normalizeForMatch, normalizeWeights, proximity, rankDeck,
  scoreCandidate, valueBalance, type Candidate, type MatchItem, type Region, type Viewer, type Want,
} from '@/lib/matching';

// PLAN M2: "Unit test điểm gợi ý pass". Mốc chính là ví dụ trong SPEC mục 8.

const REGION: Record<string, Region> = { '01': 'north', '31': 'north', '46': 'central', '48': 'central', '79': 'south', '92': 'south' };
const regionOf = (code: string) => REGION[code];

const item = (id: string, title: string, value: number, extra: Partial<MatchItem> = {}): MatchItem => ({
  id, title, categoryId: null, estValueVnd: value, topupPayMaxVnd: 0, topupReceiveMaxVnd: 0, wants: [], ...extra,
});
const candidate = (base: MatchItem, extra: Partial<Candidate> = {}): Candidate => ({
  ...base, deliveryMethods: ['carrier', 'meetup'], provinceCode: '79', ownerTrustScore: 50, ...extra,
});

// Dữ liệu mẫu kịch bản 1 (scripts/generate-seed.mjs).
const anIphone15 = item('an-iphone15', 'iPhone 15 128GB', 13_000_000, {
  categoryId: 'phones', topupPayMaxVnd: 3_000_000, wants: [{ kind: 'category', categoryId: 'phones' }, { kind: 'keyword', keyword: 'iPhone 18' }],
});
const anAirpods = item('an-airpods', 'Tai nghe AirPods Pro 2', 3_200_000, { categoryId: 'electronics' });
const anCoffee = item('an-coffee', 'Hướng dẫn pha cà phê phin tại nhà', 250_000, { categoryId: 'hands-on' });
const an: Viewer = { provinceCode: '48', items: [anIphone15, anAirpods, anCoffee] };
const binhIphone18 = candidate(item('binh-iphone18', 'iPhone 18 256GB', 17_000_000, {
  categoryId: 'phones', topupReceiveMaxVnd: 4_000_000,
  wants: [{ kind: 'item', itemId: 'an-iphone15' }, { kind: 'keyword', keyword: 'MacBook Air' }, { kind: 'category', categoryId: 'cameras' }],
}), { ownerTrustScore: 92 });

describe('ví dụ trong SPEC mục 8: An xem iPhone 18 của Bình', () => {
  const r = scoreCandidate(binhIphone18, an, regionOf);
  it('wants_fit 0,85: Bình muốn đúng iPhone 15 của An (1), An muốn danh mục điện thoại (0,7)', () => {
    expect(r.theyWant).toBe('item');
    expect(r.iWant).toBe('category');
    expect(r.parts.wantsFit).toBeCloseTo(0.85, 10);
  });
  it('value_balance 0,94: An chịu bù tối đa 3 triệu, còn lệch 1 triệu trên 17 triệu', () => {
    expect(r.parts.valueBalance).toBeCloseTo(16 / 17, 10);
    expect(r.parts.valueBalance.toFixed(2)).toBe('0.94');
  });
  it('proximity 0,3 (Đà Nẵng và TP.HCM khác miền), trust 0,92', () => {
    expect(r.parts.proximity).toBe(0.3);
    expect(r.parts.trust).toBe(0.92);
  });
  it('score ≈ 0,78 và ghép với iPhone 15, không phải AirPods', () => {
    expect(r.score).toBeCloseTo(0.35 * 0.85 + 0.25 * (16 / 17) + 0.2 * 0.3 + 0.2 * 0.92, 10);
    expect(r.score.toFixed(2)).toBe('0.78');
    expect(r.pairedItemId).toBe('an-iphone15');
  });
});

describe('wants_fit', () => {
  const phone = { id: 'x', title: 'iPhone 18 256GB', categoryId: 'phones' };
  const w = (...wants: Want[]) => wants;
  it('món cụ thể 1 > danh mục 0,7 > từ khóa 0,4; lấy mức cao nhất', () => {
    expect(bestWant(w({ kind: 'keyword', keyword: 'iphone 18' }), phone)).toBe('keyword');
    expect(bestWant(w({ kind: 'keyword', keyword: 'iphone 18' }, { kind: 'category', categoryId: 'phones' }), phone)).toBe('category');
    expect(bestWant(w({ kind: 'category', categoryId: 'phones' }, { kind: 'item', itemId: 'x' }, { kind: 'keyword', keyword: 'iphone' }), phone)).toBe('item');
    expect(bestWant(w({ kind: 'item', itemId: 'y' }, { kind: 'category', categoryId: 'cameras' }, { kind: 'keyword', keyword: 'macbook' }), phone)).toBeNull();
    expect(bestWant([], phone)).toBeNull();
  });
  it('món không có danh mục thì không khớp theo danh mục', () => {
    expect(bestWant(w({ kind: 'category', categoryId: 'phones' }), { id: 'x', title: 'Điện thoại', categoryId: null })).toBeNull();
  });
  it('từ khóa: không phân biệt hoa thường và dấu, khớp nguyên từ, tách chữ dính số', () => {
    expect(keywordMatches('máy ảnh', 'Máy ảnh Fujifilm X-T30')).toBe(true);
    expect(keywordMatches('may anh', 'Máy ảnh Fujifilm X-T30')).toBe(true);
    expect(keywordMatches('MÁY ẢNH', 'may anh fujifilm')).toBe(true);
    expect(keywordMatches('iphone18', 'iPhone 18 256GB')).toBe(true);
    expect(keywordMatches('iPhone 1', 'iPhone 18 256GB')).toBe(false);
    expect(keywordMatches('phone', 'iPhone 18 256GB')).toBe(false);
    expect(keywordMatches('đàn', 'Đàn ukulele concert')).toBe(true);
    expect(keywordMatches('18 256', 'iPhone 18 256GB')).toBe(true);
    expect(keywordMatches('   ', 'iPhone 18')).toBe(false);
    expect(keywordMatches('!!!', 'iPhone 18')).toBe(false);
  });
  it('normalizeForMatch', () => {
    expect(normalizeForMatch('  Đồng hồ Casio G-Shock  ')).toBe('dong ho casio g shock');
    expect(normalizeForMatch('X-T30/256GB')).toBe('x t 30 256 gb');
  });
  it('mong muốn của người xem gộp từ mọi món của họ; mong muốn của người đăng chỉ tính trên món đang xét', () => {
    const viewer: Viewer = {
      provinceCode: '79',
      items: [item('v-laptop', 'MacBook Air M2', 15_000_000), item('v-book', 'Sách cũ', 100_000, { wants: [{ kind: 'category', categoryId: 'phones' }] })],
    };
    const phoneWantsLaptop = candidate(item('c', 'Samsung S24', 14_000_000, { categoryId: 'phones', wants: [{ kind: 'keyword', keyword: 'macbook air' }] }));
    const r = scoreCandidate(phoneWantsLaptop, viewer, regionOf);
    expect(r.iWant).toBe('category'); // ghi trên cuốn sách (món thứ hai), vẫn tính cho người xem
    expect(r.theyWant).toBe('keyword');
    expect(r.pairedItemId).toBe('v-laptop');
    expect(r.parts.wantsFit).toBeCloseTo((0.7 + 0.4) / 2, 10);
  });
});

describe('value_balance', () => {
  const v = (value: number, pay = 0, receive = 0) => ({ estValueVnd: value, topupPayMaxVnd: pay, topupReceiveMaxVnd: receive });
  it('bằng giá thì 1; lệch nằm trong mức bù hai bên chấp nhận thì 1', () => {
    expect(valueBalance(v(5_000_000), v(5_000_000))).toBe(1);
    expect(valueBalance(v(13_000_000, 4_000_000), v(17_000_000, 0, 4_000_000))).toBe(1);
  });
  it('mức bù khả thi là số nhỏ hơn giữa "chịu trả" của bên giá thấp và "chịu nhận" của bên giá cao', () => {
    expect(valueBalance(v(13_000_000, 3_000_000), v(17_000_000, 0, 4_000_000))).toBeCloseTo(16 / 17, 10);
    expect(valueBalance(v(13_000_000, 9_000_000), v(17_000_000, 0, 1_000_000))).toBeCloseTo(14 / 17, 10);
    expect(valueBalance(v(13_000_000, 3_000_000), v(17_000_000))).toBeCloseTo(13 / 17, 10); // bên kia không nhận bù
  });
  it('đối xứng: đổi vai hai bên cho cùng kết quả', () => {
    const a = v(13_000_000, 3_000_000, 500_000);
    const b = v(17_000_000, 1_000_000, 4_000_000);
    expect(valueBalance(a, b)).toBe(valueBalance(b, a));
  });
  it('món của người xem đắt hơn thì người đăng là bên bù', () => {
    expect(valueBalance(v(20_000_000, 0, 2_000_000), v(15_000_000, 5_000_000))).toBeCloseTo(17 / 20, 10);
  });
  it('biên: hai món 0 đồng thì 1; một bên 0 đồng thì 0; không bao giờ ra ngoài 0 đến 1', () => {
    expect(valueBalance(v(0), v(0))).toBe(1);
    expect(valueBalance(v(0), v(1_000_000))).toBe(0);
    expect(valueBalance(v(1000), v(10_000_000_000))).toBeGreaterThanOrEqual(0);
    expect(valueBalance(v(1_000_000, -5), v(2_000_000, 0, 9_000_000))).toBe(0.5); // mức bù âm coi như 0
  });
});

describe('proximity', () => {
  const physical = { deliveryMethods: ['carrier', 'meetup'] as const, provinceCode: '79' };
  it('cùng tỉnh/thành 1; cùng miền 0,6; khác miền 0,3', () => {
    expect(proximity(physical, '79', regionOf)).toBe(1);
    expect(proximity(physical, '92', regionOf)).toBe(0.6);
    expect(proximity(physical, '01', regionOf)).toBe(0.3);
  });
  it('thiếu tỉnh/thành ở một bên, hoặc mã lạ, thì 0,3', () => {
    expect(proximity(physical, null, regionOf)).toBe(0.3);
    expect(proximity({ ...physical, provinceCode: null }, '79', regionOf)).toBe(0.3);
    expect(proximity({ ...physical, provinceCode: '00' }, '99', regionOf)).toBe(0.3);
  });
  it('đồ số và dịch vụ online luôn 1; dịch vụ chỉ gặp trực tiếp thì tính theo nơi ở', () => {
    expect(proximity({ deliveryMethods: ['digital'], provinceCode: '01' }, '79', regionOf)).toBe(1);
    expect(proximity({ deliveryMethods: ['meetup', 'online_session'], provinceCode: '01' }, '79', regionOf)).toBe(1);
    expect(proximity({ deliveryMethods: ['meetup'], provinceCode: '01' }, '79', regionOf)).toBe(0.3);
    expect(isRemote(['carrier'])).toBe(false);
  });
});

describe('trọng số', () => {
  it('mặc định theo SPEC, tổng bằng 1', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ wants: 0.35, value: 0.25, proximity: 0.2, trust: 0.2 });
    expect(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it('cấu hình hợp lệ được dùng; tổng khác 1 thì chia lại', () => {
    expect(normalizeWeights({ wants: 0.35, value: 0.25, proximity: 0.2, trust: 0.2 })).toEqual(DEFAULT_WEIGHTS);
    expect(normalizeWeights({ wants: 2, value: 1, proximity: 1, trust: 0 })).toEqual({ wants: 0.5, value: 0.25, proximity: 0.25, trust: 0 });
  });
  it.each([null, undefined, 'x', 7, [], {}, { wants: 1 }, { wants: '0.35', value: 0.25, proximity: 0.2, trust: 0.2 },
    { wants: -1, value: 1, proximity: 1, trust: 1 }, { wants: 0, value: 0, proximity: 0, trust: 0 }, { wants: NaN, value: 1, proximity: 1, trust: 1 }])(
    'cấu hình hỏng %j thì dùng mặc định', (raw) => {
      expect(normalizeWeights(raw)).toEqual(DEFAULT_WEIGHTS);
    });
  it('trọng số tùy chỉnh đổi thứ hạng', () => {
    const near = candidate(item('near', 'Loa', 1_000_000), { provinceCode: '48', ownerTrustScore: 10 });
    const trusted = candidate(item('trusted', 'Loa', 1_000_000), { provinceCode: '01', ownerTrustScore: 100 });
    const viewer: Viewer = { provinceCode: '48', items: [] };
    const byProximity = rankDeck([trusted, near], viewer, regionOf, { weights: normalizeWeights({ wants: 0, value: 0, proximity: 1, trust: 0 }) });
    const byTrust = rankDeck([near, trusted], viewer, regionOf, { weights: normalizeWeights({ wants: 0, value: 0, proximity: 0, trust: 1 }) });
    expect(byProximity.map((c) => c.id)).toEqual(['near', 'trusted']);
    expect(byTrust.map((c) => c.id)).toEqual(['trusted', 'near']);
  });
});

describe('người xem và ứng viên ở các ca biên', () => {
  it('người xem chưa có món: wants_fit 0, value_balance 0,5, không có món ghép', () => {
    const r = scoreCandidate(binhIphone18, { provinceCode: '79', items: [] }, regionOf);
    expect(r.parts).toEqual({ wantsFit: 0, valueBalance: 0.5, proximity: 1, trust: 0.92 });
    expect(r).toMatchObject({ iWant: null, theyWant: null, pairedItemId: null });
    expect(r.score).toBeCloseTo(0.25 * 0.5 + 0.2 + 0.2 * 0.92, 10);
  });
  it('nhiều món: chọn món cho tổng mong muốn và cán cân cao nhất, kể cả khi món khác khớp mong muốn hơn nhưng lệch giá nhiều', () => {
    const viewer: Viewer = {
      provinceCode: '79',
      items: [item('cheap-wanted', 'Ốp lưng iPhone', 100_000, { categoryId: 'electronics' }), item('fair', 'Samsung S23', 16_000_000, { categoryId: 'phones' })],
    };
    const c = candidate(item('c', 'iPhone 18', 17_000_000, { categoryId: 'phones', wants: [{ kind: 'category', categoryId: 'electronics' }] }));
    const r = scoreCandidate(c, viewer, regionOf);
    // Ốp lưng: 0,35 × 0,7 / 2 + 0,25 × (100k/17tr) ≈ 0,124. Samsung: 0 + 0,25 × (16/17) ≈ 0,235.
    expect(r.pairedItemId).toBe('fair');
    expect(r.theyWant).toBeNull();
    expect(r.parts.valueBalance).toBeCloseTo(16 / 17, 10);
  });
  it('hai món của người xem ngang nhau thì lấy món đứng trước', () => {
    const viewer: Viewer = { provinceCode: '79', items: [item('first', 'A', 1_000_000), item('second', 'B', 1_000_000)] };
    expect(scoreCandidate(candidate(item('c', 'C', 1_000_000)), viewer, regionOf).pairedItemId).toBe('first');
  });
  it('điểm uy tín ngoài khoảng 0 đến 100 được kẹp lại; điểm luôn nằm trong 0 đến 1', () => {
    for (const trust of [-20, 0, 35, 100, 250, Number.NaN]) {
      const r = scoreCandidate(candidate(item('c', 'C', 1_000_000), { ownerTrustScore: trust }), an, regionOf);
      expect(r.parts.trust).toBeGreaterThanOrEqual(0);
      expect(r.parts.trust).toBeLessThanOrEqual(1);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
  it('điểm tối đa là 1: muốn đúng món của nhau, bằng giá, cùng tỉnh, uy tín 100', () => {
    const mine = item('mine', 'A', 2_000_000, { wants: [{ kind: 'item', itemId: 'theirs' }] });
    const theirs = candidate(item('theirs', 'B', 2_000_000, { wants: [{ kind: 'item', itemId: 'mine' }] }), { provinceCode: '48', ownerTrustScore: 100 });
    expect(scoreCandidate(theirs, { provinceCode: '48', items: [mine] }, regionOf).score).toBeCloseTo(1, 10);
  });
});

describe('xếp chồng thẻ', () => {
  const viewer: Viewer = { provinceCode: '48', items: [anIphone15] };
  const camera = candidate(item('camera', 'Máy ảnh Fujifilm X-T30', 14_000_000, { categoryId: 'cameras' }), { ownerTrustScore: 92 });
  const book = candidate(item('book', 'Sách cũ', 80_000, { categoryId: 'books' }), { provinceCode: '92', ownerTrustScore: 35 });
  const wantsPhones = candidate(item('wants-phones', 'Bàn phím cơ', 1_800_000, { wants: [{ kind: 'category', categoryId: 'phones' }] }), { provinceCode: '46', ownerTrustScore: 71 });

  it('điểm cao đứng trước; kèm chi tiết điểm của từng thẻ', () => {
    const deck = rankDeck([book, camera, binhIphone18, wantsPhones], viewer, regionOf);
    expect(deck.map((c) => c.id)).toEqual(['binh-iphone18', 'camera', 'wants-phones', 'book']);
    expect(deck[0].match.score).toBeGreaterThan(deck[1].match.score);
    expect(deck[0].title).toBe('iPhone 18 256GB');
  });
  it('bằng điểm thì giữ thứ tự đầu vào; limit cắt đúng số thẻ', () => {
    const twin = (id: string) => candidate(item(id, 'Loa', 500_000));
    expect(rankDeck([twin('b'), twin('a'), twin('c')], viewer, regionOf).map((c) => c.id)).toEqual(['b', 'a', 'c']);
    expect(rankDeck([book, camera, binhIphone18], viewer, regionOf, { limit: 2 }).map((c) => c.id)).toEqual(['binh-iphone18', 'camera']);
    expect(rankDeck([], viewer, regionOf)).toEqual([]);
  });
  it('"chỉ món hợp với đồ tôi có": giữ món mà người đăng muốn thứ tôi đang có', () => {
    const deck = rankDeck([book, camera, binhIphone18, wantsPhones], { ...viewer, items: [anIphone15] }, regionOf, { onlyCompatible: true });
    expect(deck.map((c) => c.id)).toEqual(['binh-iphone18', 'wants-phones']);
    expect(rankDeck([book, camera], { provinceCode: '48', items: [] }, regionOf, { onlyCompatible: true })).toEqual([]);
  });
  it('không sửa dữ liệu đầu vào', () => {
    const input = [book, camera];
    const copy = JSON.stringify(input);
    rankDeck(input, viewer, regionOf);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
