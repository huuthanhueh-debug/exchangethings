import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { ITEMS, SEED_MATCH, USERS, connect, dbTestsEnabled, rows } from './helpers';
import { SEED_SQL_PATH } from '../../scripts/generate-seed.mjs';

const d = dbTestsEnabled ? describe : describe.skip;

// Bảng do seed ghi, khóa sắp xếp, và các cột bỏ qua khi so: dấu thời gian do now() sinh và khóa identity tự tăng.
const TABLES: [table: string, orderBy: string, ignore: string[]][] = [
  ['profiles', 'id', ['created_at', 'updated_at']],
  ['profile_private', 'id', ['created_at', 'updated_at']],
  ['items', 'id', ['updated_at']],
  ['item_private', 'item_id', ['created_at', 'updated_at']],
  ['item_media', 'id', ['created_at', 'updated_at']],
  ['item_wants', 'item_id, want_type, category_id, keyword, wanted_item_id', ['id', 'created_at']],
  ['swipes', 'viewer_id, item_id', []],
  ['matches', 'id', []],
  ['messages', 'id', []],
  ['match_reads', 'match_id, user_id', []],
];

d('dữ liệu mẫu (PLAN M1: seed chạy lại cho cùng kết quả)', () => {
  let c: pg.Client;
  beforeAll(async () => {
    c = await connect();
    await c.query(`set time zone 'UTC'`); // định dạng timestamptz giống nhau trên mọi máy
  });
  afterAll(async () => { await c?.end(); });

  async function fingerprint() {
    const out: Record<string, string> = {};
    for (const [table, orderBy, ignore] of TABLES) {
      const r = await rows<{ n: number; h: string }>(c,
        `select count(*)::int as n,
                md5(coalesce(string_agg((to_jsonb(x) - $1::text[])::text, '|' order by ${orderBy}), '')) as h
           from public.${table} x`, [ignore]);
      out[table] = `${r[0].n} dòng, md5 ${r[0].h}`;
    }
    return out;
  }

  it('chạy lại seed hai lần, dữ liệu giữ nguyên', async () => {
    const seed = readFileSync(SEED_SQL_PATH, 'utf8');
    const before = await fingerprint();
    await c.query(seed);
    expect(await fingerprint()).toEqual(before);
    await c.query(seed);
    expect(await fingerprint()).toEqual(before);
  });

  it('11 người dùng: 1 tài khoản mới, 1 uy tín cao, 1 admin; 9 người đã xác minh SĐT', async () => {
    const r = await rows(c, `
      select count(*)::int as users,
             count(*) filter (where tier = 'new')::int as new_accounts,
             count(*) filter (where tier = 'high')::int as high_trust,
             count(*) filter (where role = 'admin')::int as admins,
             (select count(*)::int from profile_private where phone_verified_at is not null) as phone_verified
        from profiles`);
    expect(r[0]).toEqual({ users: 11, new_accounts: 1, high_trust: 1, admins: 1, phone_verified: 9 });
    const giang = await rows(c, 'select tier::text, trust_score from profiles where id = $1', [USERS.giang]);
    expect(giang[0]).toEqual({ tier: 'new', trust_score: 35 });
  });

  it('30 món: 28 hiển thị, 1 nháp, 1 chờ duyệt; đủ 6 loại ở 6 tỉnh/thành', async () => {
    const byStatus = await rows(c, 'select status::text, count(*)::int as n from items group by 1 order by 1');
    expect(byStatus).toEqual([{ status: 'active', n: 28 }, { status: 'draft', n: 1 }, { status: 'pending_review', n: 1 }]);
    // Loại "khác" luôn qua admin duyệt, nên món loại này trong seed nằm ở hàng chờ để demo luồng duyệt.
    const spread = await rows(c, `
      select count(distinct type)::int as types,
             count(distinct type) filter (where status = 'active')::int as active_types,
             count(distinct province_code) filter (where status = 'active')::int as active_provinces
        from items`);
    expect(spread[0]).toEqual({ types: 6, active_types: 5, active_provinces: 6 });
    const media = await rows(c, `select count(*) filter (where kind = 'photo')::int as photos, count(*) filter (where kind = 'proof')::int as proofs from item_media`);
    expect(media[0]).toEqual({ photos: 54, proofs: 3 });
  });

  it('kịch bản 1: iPhone 15 của An và iPhone 18 của Bình tìm thấy nhau qua mong muốn', async () => {
    const r = await rows(c, `
      select i.id, i.owner_id, i.est_value_vnd::int as value, i.topup_pay_max_vnd::int as pay, i.topup_receive_max_vnd::int as receive,
             i.imei_last4, array_agg(coalesce(w.keyword, w.category_id, w.wanted_item_id::text) order by w.id) as wants
        from items i join item_wants w on w.item_id = i.id
       where i.id = any($1) group by i.id order by i.id`, [[ITEMS.anIphone15, ITEMS.binhIphone18]]);
    expect(r).toEqual([
      { id: ITEMS.anIphone15, owner_id: USERS.an, value: 13000000, pay: 3000000, receive: 0, imei_last4: '4821', wants: ['phones', 'iPhone 18'] },
      { id: ITEMS.binhIphone18, owner_id: USERS.binh, value: 17000000, pay: 0, receive: 4000000, imei_last4: '7730', wants: [ITEMS.anIphone15, 'MacBook Air', 'cameras'] },
    ]);
  });

  it('kịch bản 2 đã khớp sẵn: Chi và Dũng thích món của nhau, có 3 tin nhắn, Dũng còn 1 tin chưa đọc', async () => {
    const m = await rows(c, 'select user_a, user_b, item_a, item_b from matches where id = $1', [SEED_MATCH]);
    expect(m).toEqual([{ user_a: USERS.chi, user_b: USERS.dung, item_a: ITEMS.chiGucci, item_b: ITEMS.dungZegna }]);
    const unread = await rows(c, `
      select r.user_id, (select count(*)::int from messages x
                          where x.match_id = r.match_id and x.sender_id <> r.user_id and x.created_at > r.last_read_at) as unread
        from match_reads r where r.match_id = $1 order by r.user_id`, [SEED_MATCH]);
    expect(unread).toEqual([{ user_id: USERS.chi, unread: 0 }, { user_id: USERS.dung, unread: 1 }]);
    expect((await rows(c, 'select count(*)::int as n from messages where match_id = $1 and not masked', [SEED_MATCH]))[0].n).toBe(3);
  });

  it('kịch bản 2: áo Gucci và giày Zegna đều có ảnh chứng từ, mong muốn chéo nhau', async () => {
    const r = await rows(c, `
      select i.category_id, w.category_id as wants,
             (select count(*)::int from item_media m where m.item_id = i.id and m.kind = 'proof') as proofs
        from items i join item_wants w on w.item_id = i.id
       where i.id = any($1) order by i.id`, [[ITEMS.chiGucci, ITEMS.dungZegna]]);
    expect(r).toEqual([
      { category_id: 'luxury-fashion', wants: 'luxury-shoes', proofs: 1 },
      { category_id: 'luxury-shoes', wants: 'luxury-fashion', proofs: 1 },
    ]);
  });
});
