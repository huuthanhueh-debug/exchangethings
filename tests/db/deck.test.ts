import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, SEED_MATCH, USERS, connect, dbTestsEnabled } from './helpers';
import { NO_FILTERS } from '@/lib/deck-filters';

// Test tích hợp lớp server của M2 (src/server/deck.ts, matches.ts, chat.ts) trên database thật.
// Các hàm này commit thật, nên mỗi test dọn lại lượt quẹt, match, tin nhắn và mốc đã đọc về đúng dữ liệu mẫu.
const d = dbTestsEnabled ? describe : describe.skip;

d('lớp server M2: chồng thẻ, khớp, chat', () => {
  let admin: pg.Client;
  let deck: typeof import('@/server/deck');
  let matches: typeof import('@/server/matches');
  let chat: typeof import('@/server/chat');
  let db: typeof import('@/server/db');
  const an = { id: USERS.an, provinceCode: '48' };

  beforeAll(async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      AUTH_MODE: 'dev',
      DEV_AUTH_SECRET: 'test-secret-'.padEnd(40, 'x'),
      STORAGE_DRIVER: 'local',
    });
    [deck, matches, chat, db] = await Promise.all([
      import('@/server/deck'), import('@/server/matches'), import('@/server/chat'), import('@/server/db'),
    ]);
    admin = await connect();
  });
  afterEach(async () => {
    await admin.query(`delete from messages where id::text not like '00000000-0000-4000-c000-%'`);
    await admin.query('delete from matches where id <> $1', [SEED_MATCH]);
    await admin.query('delete from swipes where viewer_id not in ($1, $2)', [USERS.chi, USERS.dung]);
    await admin.query('delete from blocks');
    await admin.query('delete from notifications');
    await admin.query(`update match_reads set last_read_at = case when user_id = $1 then '2026-11-20T03:12:00Z'::timestamptz else '2026-11-20T03:09:00Z' end`, [USERS.chi]);
    await admin.query('delete from match_reads where match_id <> $1', [SEED_MATCH]);
  });
  afterAll(async () => {
    await admin?.end();
    await db?.endPool();
  });

  describe('chồng thẻ', () => {
    it('An thấy iPhone 18 của Bình đứng đầu với đúng điểm trong SPEC mục 8 (≈ 0,78)', async () => {
      const { cards, myActiveItems } = await deck.getDeck(an, NO_FILTERS);
      expect(myActiveItems).toBe(3);
      const top = cards[0];
      expect(top).toMatchObject({ id: ITEMS.binhIphone18, title: 'iPhone 18 256GB', estValueVnd: 17_000_000, provinceCode: '79' });
      expect(top.owner).toEqual({ name: 'Bình', tier: 'high', trustScore: 92, swaps: 25, rating: 4.9 });
      expect(top.match.score.toFixed(2)).toBe('0.78');
      expect(top.match.parts.wantsFit).toBeCloseTo(0.85, 10);
      expect(top.match.parts.valueBalance.toFixed(2)).toBe('0.94');
      expect(top.match.parts.proximity).toBe(0.3);
      expect(top.match.parts.trust).toBe(0.92);
      expect(top.match).toMatchObject({ iWant: 'category', theyWant: 'item', pairedItem: { id: ITEMS.anIphone15, title: 'iPhone 15 128GB' } });
      expect(top.wants).toEqual({ categories: ['cameras'], keywords: ['MacBook Air'], items: [{ id: ITEMS.anIphone15, title: 'iPhone 15 128GB' }] });
      expect(top.coverMediaId).toMatch(/^[0-9a-f-]{36}$/);
      expect(top.photoCount).toBe(3);
    });
    it('không có món của mình, món nháp, món chờ duyệt; điểm giảm dần; tối đa 20 thẻ', async () => {
      const { cards } = await deck.getDeck(an, NO_FILTERS);
      expect(cards).toHaveLength(20);
      const ids = cards.map((c) => c.id);
      for (const hidden of [ITEMS.anIphone15, ITEMS.anAirpods, ITEMS.emUkuleleDraft, ITEMS.giangBonsaiPending]) expect(ids).not.toContain(hidden);
      const scores = cards.map((c) => c.match.score);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      // An có 3 món, còn 25 món đang hiển thị của người khác.
      expect((await deck.getDeck(an, NO_FILTERS, 100)).cards).toHaveLength(25);
    });
    it('món đã quẹt (thích hay bỏ qua) không quay lại chồng thẻ', async () => {
      await deck.swipeItem(USERS.an, ITEMS.binhIphone18, 'like');
      await deck.swipeItem(USERS.an, ITEMS.binhCamera, 'pass');
      const ids = (await deck.getDeck(an, NO_FILTERS, 100)).cards.map((c) => c.id);
      expect(ids).toHaveLength(23);
      expect(ids).not.toContain(ITEMS.binhIphone18);
      expect(ids).not.toContain(ITEMS.binhCamera);
    });
    it('chặn nhau thì món của nhau biến mất khỏi chồng thẻ của cả hai', async () => {
      await admin.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [USERS.binh, USERS.an]);
      const forAn = (await deck.getDeck(an, NO_FILTERS, 100)).cards;
      expect(forAn.some((c) => c.owner.name === 'Bình')).toBe(false);
      expect(forAn).toHaveLength(22); // Bình có 3 món đang hiển thị
      const forBinh = (await deck.getDeck({ id: USERS.binh, provinceCode: '79' }, NO_FILTERS, 100)).cards;
      expect(forBinh.some((c) => c.owner.name === 'An')).toBe(false);
    });
    it('bộ lọc: loại, danh mục, khoảng giá trị, tỉnh/thành', async () => {
      const get = async (f: Partial<typeof NO_FILTERS>) => (await deck.getDeck(an, { ...NO_FILTERS, ...f }, 100)).cards;
      expect((await get({ type: 'voucher' })).map((c) => c.type)).toEqual(expect.arrayContaining(['voucher']));
      expect((await get({ type: 'voucher' })).every((c) => c.type === 'voucher')).toBe(true);
      expect((await get({ type: 'voucher' }))).toHaveLength(3);
      expect((await get({ categoryId: 'phones' })).map((c) => c.id)).toEqual([ITEMS.binhIphone18]);
      // Danh mục quyết định loại: chọn loại voucher kèm danh mục điện thoại vẫn ra điện thoại.
      expect((await get({ type: 'voucher', categoryId: 'phones' })).map((c) => c.id)).toEqual([ITEMS.binhIphone18]);
      const mid = await get({ valueRange: '5tr-10tr' });
      expect(mid.length).toBeGreaterThan(0);
      expect(mid.every((c) => c.estValueVnd >= 5_000_000 && c.estValueVnd < 10_000_000)).toBe(true);
      expect((await get({ valueRange: 'tren-10tr' })).map((c) => c.id).sort()).toEqual([ITEMS.binhIphone18, ITEMS.binhCamera].sort());
      const hanoi = await get({ provinceCode: '01' });
      expect(hanoi.length).toBeGreaterThan(0);
      expect(hanoi.every((c) => c.provinceCode === '01')).toBe(true);
      // Giá trị lạ bị bỏ qua, không làm hỏng truy vấn.
      expect(await get({ categoryId: 'khong-co', provinceCode: '00' })).toHaveLength(25);
    });
    it('"chỉ món hợp với đồ tôi có": chỉ còn món mà người đăng muốn thứ An đang có', async () => {
      const { cards } = await deck.getDeck(an, { ...NO_FILTERS, onlyCompatible: true }, 100);
      expect(cards.map((c) => c.id)).toContain(ITEMS.binhIphone18);
      expect(cards.every((c) => c.match.theyWant !== null)).toBe(true);
      expect(cards.length).toBeLessThan(25);
    });
    it('người chưa có món nào vẫn quẹt được; chồng thẻ xếp theo khoảng cách và uy tín', async () => {
      const noItems = { id: USERS.admin, provinceCode: '01' }; // tài khoản quản trị trong dữ liệu mẫu không đăng món nào
      const { cards, myActiveItems } = await deck.getDeck(noItems, NO_FILTERS, 100);
      expect(myActiveItems).toBe(0);
      expect(cards).toHaveLength(28);
      expect(cards.every((c) => c.match.pairedItem === null && c.match.parts.wantsFit === 0 && c.match.parts.valueBalance === 0.5)).toBe(true);
      expect(cards[0].match.score).toBeGreaterThan(cards[27].match.score);
      expect((await deck.getDeck(noItems, { ...NO_FILTERS, onlyCompatible: true })).cards).toEqual([]);
    });
    it('trọng số đọc từ platform_settings: chỉ tính uy tín thì món của Bình (92 điểm) lên đầu', async () => {
      const before = (await admin.query(`select value from platform_settings where key = 'match_weights'`)).rows[0].value;
      try {
        await admin.query(`update platform_settings set value = '{"wants": 0, "value": 0, "proximity": 0, "trust": 1}' where key = 'match_weights'`);
        const { cards } = await deck.getDeck(an, NO_FILTERS, 3);
        expect(cards.map((c) => c.owner.name)).toEqual(['Bình', 'Bình', 'Bình']);
        expect(cards[0].match.score).toBeCloseTo(0.92, 10);
      } finally {
        await admin.query(`update platform_settings set value = $1 where key = 'match_weights'`, [JSON.stringify(before)]);
      }
    });
  });

  describe('quẹt và trạng thái quan tâm', () => {
    it('e2e mức server: An thích iPhone 18, Bình thích iPhone 15 thì khớp, cả hai thấy match', async () => {
      expect(await deck.swipeItem(USERS.an, ITEMS.binhIphone18, 'like')).toEqual({ matched: false, matchId: null, isNew: false });
      expect(await deck.getInterest(USERS.an, ITEMS.binhIphone18, USERS.binh)).toEqual({ direction: 'like', matchId: null });
      const r = await deck.swipeItem(USERS.binh, ITEMS.anIphone15, 'like');
      expect(r).toMatchObject({ matched: true, isNew: true });
      expect(await deck.getInterest(USERS.an, ITEMS.binhIphone18, USERS.binh)).toEqual({ direction: 'like', matchId: r.matchId });
      const forAn = await matches.getMatch(USERS.an, r.matchId!);
      expect(forAn).toMatchObject({
        other: { name: 'Bình', tier: 'high', trustScore: 92 }, theirItem: { id: ITEMS.binhIphone18, title: 'iPhone 18 256GB' },
        myItem: { id: ITEMS.anIphone15, title: 'iPhone 15 128GB' }, last: null, unread: 0, isNew: true,
      });
      const forBinh = await matches.getMatch(USERS.binh, r.matchId!);
      expect(forBinh).toMatchObject({ other: { name: 'An' }, theirItem: { id: ITEMS.anIphone15 }, myItem: { id: ITEMS.binhIphone18 }, isNew: true });
      expect(await matches.getMatch(USERS.chi, r.matchId!)).toBeNull();
      expect(await matches.countAttentionMatches(USERS.an)).toBe(1);
    });
    it('lỗi từ database được dịch sang câu tiếng Việt', async () => {
      const err = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { return deck.friendlySwipeError(e); } throw new Error('không lỗi'); };
      expect(await err(() => deck.swipeItem(USERS.an, ITEMS.anIphone15, 'like'))).toBe('Đây là món của bạn.');
      expect(await err(() => deck.swipeItem(USERS.an, ITEMS.emUkuleleDraft, 'like'))).toBe('Món này không còn hiển thị.');
      expect(deck.friendlySwipeError(new Error('daily swipe limit reached'))).toMatch(/hết lượt/);
      expect(deck.friendlySwipeError(new Error('lỗi lạ'))).toBe('Chưa ghi được lượt quẹt. Thử lại sau ít phút.');
    });
  });

  describe('danh sách khớp và chat', () => {
    it('Chi và Dũng thấy match mẫu kèm tin cuối; Dũng có 1 tin chưa đọc; người ngoài không thấy gì', async () => {
      const chi = await matches.listMatches(USERS.chi);
      expect(chi).toHaveLength(1);
      expect(chi[0]).toMatchObject({
        id: SEED_MATCH, other: { name: 'Dũng' }, theirItem: { id: ITEMS.dungZegna }, myItem: { id: ITEMS.chiGucci }, unread: 0, isNew: false,
        last: { mine: true, body: 'Em mặc hai lần thôi ạ. Cuối tuần mình gặp ở Quận 1 để xem hàng được không anh?' },
      });
      const dung = await matches.listMatches(USERS.dung);
      expect(dung[0]).toMatchObject({ id: SEED_MATCH, other: { name: 'Chi' }, unread: 1, last: { mine: false } });
      expect(await matches.countAttentionMatches(USERS.dung)).toBe(1);
      expect(await matches.countAttentionMatches(USERS.chi)).toBe(0);
      expect(await matches.listMatches(USERS.an)).toEqual([]);
      expect(await matches.getMatch(USERS.an, SEED_MATCH)).toBeNull();
      expect(await matches.getMatch(USERS.chi, 'khong-phai-uuid')).toBeNull();
    });
    it('đọc tin theo thứ tự, hỏi tiếp "tin sau mốc" không sót, không lặp', async () => {
      const all = await chat.listMessages(USERS.dung, SEED_MATCH);
      expect(all?.map((m) => m.mine)).toEqual([false, true, false]);
      expect(all?.[0].cursor).toBe('2026-11-20T03:05:00.000000Z');
      const last = all![2].cursor;
      expect(await chat.listMessages(USERS.dung, SEED_MATCH, last)).toEqual([]);
      const sent = await chat.sendMessage(USERS.chi, SEED_MATCH, 'Em tới sớm 10 phút nhé');
      const fresh = await chat.listMessages(USERS.dung, SEED_MATCH, last);
      expect(fresh).toEqual([{ ...sent, mine: false }]);
      expect(await chat.listMessages(USERS.dung, SEED_MATCH, fresh![0].cursor)).toEqual([]);
      expect(await chat.listMessages(USERS.dung, SEED_MATCH, all![0].cursor)).toHaveLength(3);
    });
    it('người ngoài, mã lạ, mốc sai định dạng đều trả null', async () => {
      expect(await chat.listMessages(USERS.an, SEED_MATCH)).toBeNull();
      expect(await chat.listMessages(USERS.chi, 'x')).toBeNull();
      expect(await chat.listMessages(USERS.chi, SEED_MATCH, `2026-11-20'; drop table messages; --`)).toBeNull();
      expect(await chat.listMessages(USERS.chi, SEED_MATCH, '2026-11-20T03:05:00Z')).toBeNull();
    });
    it('gửi tin có số điện thoại: bản trả về và bản lưu đều đã che', async () => {
      const m = await chat.sendMessage(USERS.dung, SEED_MATCH, 'Gọi anh 0905 123 456 nhé');
      expect(m).toMatchObject({ mine: true, body: 'Gọi anh [đã ẩn số điện thoại] nhé', masked: true });
      const stored = await admin.query('select body, masked from messages where id = $1', [m.id]);
      expect(stored.rows[0]).toEqual({ body: 'Gọi anh [đã ẩn số điện thoại] nhé', masked: true });
    });
    it('đánh dấu đã đọc tới mốc tin cuối: hết chấm đỏ; có tin mới thì hiện lại', async () => {
      const all = await chat.listMessages(USERS.dung, SEED_MATCH);
      await chat.markMatchRead(USERS.dung, SEED_MATCH, all!.at(-1)!.cursor);
      expect(await matches.countAttentionMatches(USERS.dung)).toBe(0);
      expect((await matches.listMatches(USERS.dung))[0].unread).toBe(0);
      await chat.sendMessage(USERS.chi, SEED_MATCH, 'Anh ơi?');
      expect(await matches.countAttentionMatches(USERS.dung)).toBe(1);
      expect((await matches.listMatches(USERS.dung))[0]).toMatchObject({ unread: 1, last: { body: 'Anh ơi?', mine: false } });
    });
    it('chặn nhau thì match ẩn ở cả hai phía và không gửi tin được', async () => {
      await admin.query('insert into blocks (blocker_id, blocked_id) values ($1, $2)', [USERS.chi, USERS.dung]);
      expect(await matches.listMatches(USERS.chi)).toEqual([]);
      expect(await matches.listMatches(USERS.dung)).toEqual([]);
      expect(await matches.countAttentionMatches(USERS.dung)).toBe(0);
      await expect(chat.sendMessage(USERS.dung, SEED_MATCH, 'alo')).rejects.toThrow(/cannot message this user/);
    });
    it('lỗi chat được dịch sang câu tiếng Việt', async () => {
      const err = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { return chat.friendlyChatError(e); } throw new Error('không lỗi'); };
      expect(await err(() => chat.sendMessage(USERS.chi, SEED_MATCH, '   '))).toBe('Tin nhắn đang trống.');
      expect(await err(() => chat.sendMessage(USERS.chi, SEED_MATCH, 'a'.repeat(1001)))).toBe('Tin nhắn dài quá 1.000 ký tự.');
      expect(await err(() => chat.sendMessage(USERS.an, SEED_MATCH, 'chen vào'))).toBe('Không tìm thấy cuộc trò chuyện.');
      expect(chat.friendlyChatError(new Error('daily message limit reached'))).toMatch(/hết số tin nhắn/);
    });
  });
});
