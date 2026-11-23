// Sinh supabase/seed.sql: 10 người dùng của 5 kịch bản + 1 admin, 30 món đủ 6 loại ở 6 tỉnh/thành.
// Tất định: ID cố định, chạy lại seed cho cùng kết quả. Chỉ dùng cho môi trường dev/test, không chạy trên production.
// Chạy: node scripts/generate-seed.mjs (test kiểm tra supabase/seed.sql luôn khớp output này).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const units = JSON.parse(readFileSync(join(root, 'data/admin-units/admin-units-2025.json'), 'utf8'));
const firstWard = (province) => {
  const w = units.wards.find((x) => x.province_code === province);
  if (!w) throw new Error(`no ward for province ${province}`);
  return w.code;
};

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iid = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const mid = (n, k) => `00000000-0000-4000-a000-${String(n * 100 + k).padStart(12, '0')}`;
// IMEI mẫu hợp lệ theo Luhn, giữ nguyên 4 số cuối: dò chữ số thứ 11 cho đúng tổng kiểm tra.
const luhnOk = (d) => [...d].reduce((sum, ch, i) => {
  let n = Number(ch);
  if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
  return sum + n;
}, 0) % 10 === 0;
const imeiFor = (last4) => {
  for (let x = 0; x <= 9; x++) {
    const imei = `3539120000${x}${last4}`;
    if (luhnOk(imei)) return imei;
  }
  throw new Error(`no Luhn-valid IMEI ending in ${last4}`);
};
const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// Người dùng: điểm uy tín theo công thức SPEC mục 9 với tỉ lệ hoàn tất giả định 0,9.
const users = [
  { n: 1, slug: 'an', name: 'An', province: '48', tier: 'regular', swaps: 8, rating: 4.6, ratings: 8, trust: 74, phone: '+84905000001' },
  { n: 2, slug: 'binh', name: 'Bình', province: '79', tier: 'high', swaps: 25, rating: 4.9, ratings: 22, trust: 92, phone: '+84905000002' },
  { n: 3, slug: 'chi', name: 'Chi', province: '79', tier: 'regular', swaps: 5, rating: 4.7, ratings: 5, trust: 72, phone: '+84905000003' },
  { n: 4, slug: 'dung', name: 'Dũng', province: '79', tier: 'regular', swaps: 6, rating: 4.5, ratings: 6, trust: 71, phone: '+84905000004' },
  { n: 5, slug: 'em', name: 'Em', province: '01', tier: 'regular', swaps: 3, rating: 4.4, ratings: 3, trust: 67, phone: '+84905000005' },
  { n: 6, slug: 'phuc', name: 'Phúc', province: '01', tier: 'regular', swaps: 4, rating: 4.6, ratings: 4, trust: 70, phone: '+84905000006' },
  { n: 7, slug: 'giang', name: 'Giang', province: '92', tier: 'new', swaps: 0, rating: null, ratings: 0, trust: 35, phone: null },
  { n: 8, slug: 'hoa', name: 'Hòa', province: '92', tier: 'regular', swaps: 7, rating: 4.8, ratings: 7, trust: 76, phone: '+84905000008' },
  { n: 9, slug: 'khanh', name: 'Khánh', province: '31', tier: 'regular', swaps: 3, rating: 4.3, ratings: 3, trust: 66, phone: '+84905000009' },
  { n: 10, slug: 'linh', name: 'Linh', province: '46', tier: 'regular', swaps: 4, rating: 4.7, ratings: 4, trust: 71, phone: '+84905000010' },
  { n: 11, slug: 'admin', name: 'Quản trị viên', province: '01', tier: 'regular', swaps: 0, rating: null, ratings: 0, trust: 50, phone: null, role: 'admin' },
];
const U = Object.fromEntries(users.map((u) => [u.slug, u]));

const PHYS = ['carrier', 'meetup'];
// [n, owner, type, category, title, value, extra]
const items = [
  // Kịch bản 1 đến 5
  [1, 'an', 'physical', 'phones', 'iPhone 15 128GB', 13000000, { condition: 'good', pay: 3000000, delivery: PHYS, imei: '4821', wants: [['category', 'phones'], ['keyword', 'iPhone 18']] }],
  [2, 'binh', 'physical', 'phones', 'iPhone 18 256GB', 17000000, { condition: 'like_new', receive: 4000000, delivery: PHYS, imei: '7730', wants: [['item', 1], ['keyword', 'MacBook Air'], ['category', 'cameras']] }],
  [3, 'chi', 'physical', 'luxury-fashion', 'Áo sơ mi Gucci size M', 8000000, { condition: 'like_new', delivery: ['meetup'], proof: true, wants: [['category', 'luxury-shoes']] }],
  [4, 'dung', 'physical', 'luxury-shoes', 'Giày da Zegna size 42', 9000000, { condition: 'good', delivery: ['meetup'], proof: true, wants: [['category', 'luxury-fashion']] }],
  [5, 'em', 'course_code', 'courses', 'Mã kích hoạt khóa học thiết kế UI online', 1200000, { expires: '2026-12-31', wants: [['category', 'templates']] }],
  [6, 'phuc', 'digital_file', 'templates', 'Bộ template thiết kế mạng xã hội', 1000000, { wants: [['category', 'courses']] }],
  [7, 'hoa', 'voucher', 'vouchers-shopping', 'Voucher mua sắm 500.000 ₫', 500000, { sell: 350000, expires: '2026-12-15' }],
  [8, 'khanh', 'service', 'lessons', 'Một buổi dạy tiếng Anh giao tiếp 60 phút', 300000, { duration: 60, delivery: ['online_session'], wants: [['category', 'creative']] }],
  [9, 'linh', 'service', 'consulting', 'Một buổi tư vấn thiết kế logo', 400000, { duration: 60, delivery: ['online_session'], wants: [['category', 'lessons']] }],
  // Món bổ sung
  [10, 'an', 'physical', 'electronics', 'Tai nghe AirPods Pro 2', 3200000, { condition: 'good', delivery: PHYS }],
  [11, 'binh', 'physical', 'cameras', 'Máy ảnh Fujifilm X-T30', 14000000, { condition: 'good', delivery: PHYS }],
  [12, 'chi', 'physical', 'luxury-bags', 'Túi xách Coach Tabby', 6500000, { condition: 'like_new', delivery: ['meetup'], proof: true }],
  [13, 'dung', 'physical', 'watches', 'Đồng hồ Casio G-Shock', 2800000, { condition: 'good', delivery: PHYS }],
  [14, 'em', 'digital_file', 'ebooks', 'Ebook Thiết kế UX cơ bản', 150000, {}],
  [15, 'phuc', 'digital_file', 'presets', 'Bộ preset ảnh Lightroom tông phim', 200000, {}],
  [16, 'giang', 'physical', 'books', 'Sách Đắc nhân tâm bản cũ', 80000, { condition: 'fair', delivery: PHYS }],
  [17, 'hoa', 'voucher', 'vouchers-services', 'Voucher spa 1.000.000 ₫', 1000000, { sell: 700000, expires: '2027-01-31' }],
  [18, 'khanh', 'physical', 'sports', 'Xe đạp thể thao khung nhôm', 4500000, { condition: 'good', delivery: ['meetup'] }],
  [19, 'linh', 'physical', 'electronics', 'Bàn phím cơ không dây', 1800000, { condition: 'like_new', delivery: PHYS }],
  [20, 'an', 'service', 'hands-on', 'Hướng dẫn pha cà phê phin tại nhà', 250000, { duration: 90, delivery: ['meetup'] }],
  [21, 'binh', 'course_code', 'courses', 'Mã khóa học Excel nâng cao', 900000, { expires: '2027-03-31' }],
  [22, 'chi', 'physical', 'fashion', 'Váy liền Zara size S', 600000, { condition: 'like_new', delivery: PHYS }],
  [23, 'dung', 'physical', 'games', 'Máy chơi game Nintendo Switch OLED', 5500000, { condition: 'good', delivery: PHYS }],
  [24, 'em', 'physical', 'music', 'Đàn ukulele concert gỗ mahogany', 900000, { condition: 'good', delivery: PHYS, status: 'draft' }],
  [25, 'phuc', 'physical', 'home', 'Máy pha cà phê mini', 1500000, { condition: 'good', delivery: PHYS }],
  [26, 'hoa', 'physical', 'home', 'Bộ nồi inox 5 món', 1200000, { condition: 'new', delivery: PHYS }],
  [27, 'khanh', 'voucher', 'tickets', 'Mã 2 vé xem phim', 200000, { expires: '2026-12-31' }],
  [28, 'linh', 'service', 'creative', 'Vẽ minh họa chân dung theo yêu cầu', 500000, { duration: 120, delivery: ['online_session'] }],
  [29, 'giang', 'other', 'other', 'Chậu bonsai mini để bàn', 350000, { condition: 'good', delivery: ['meetup'], status: 'pending_review' }],
  [30, 'khanh', 'physical', 'books', 'Bộ sách Harry Potter 7 tập', 700000, { condition: 'good', delivery: PHYS }],
];

export const SEED_SQL_PATH = join(root, 'supabase/seed.sql');
/** Match mẫu giữa Chi và Dũng (kịch bản 2). */
export const SEED_MATCH_ID = '00000000-0000-4000-b000-000000000001';

/** Danh sách ảnh mẫu (đường dẫn trong bucket item-media) kèm tên món, cho scripts/generate-seed-media.mjs. */
export function seedMediaManifest() {
  const out = [];
  for (const [n, , type, , title, , x] of items) {
    if (type === 'physical' || type === 'other') {
      for (let k = 1; k <= 3; k++) out.push({ path: `seed/${iid(n)}/photo-${k}.webp`, title, n, k, kind: 'photo' });
    }
    if (x.proof) out.push({ path: `seed/${iid(n)}/proof-1.webp`, title, n, k: 9, kind: 'proof' });
  }
  return out;
}

export function buildSeedSql() {
  const out = [];
  out.push('-- Exchangethings.vn: dữ liệu mẫu cho dev/test. Sinh bởi scripts/generate-seed.mjs; không sửa tay.');
  out.push('-- Không chạy trên production. Người dùng mẫu đăng nhập bằng magic link; không có mật khẩu mặc định.');
  out.push('begin;');
  out.push(`delete from auth.users where id in (${users.map((u) => q(uid(u.n))).join(', ')});`);
  out.push('');
  out.push('insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data) values');
  out.push(users.map((u) => `  (${q(uid(u.n))}, 'authenticated', 'authenticated', ${q(`${u.slug}@exchangethings.test`)}, '2026-11-01T00:00:00Z', ${q(JSON.stringify({ display_name: u.name }))})`).join(',\n') + ';');
  out.push('');
  for (const u of users) {
    out.push(`update public.profiles set province_code = ${q(u.province)}, ward_code = ${q(firstWard(u.province))}, trust_score = ${u.trust}, tier = ${q(u.tier)}, completed_swaps = ${u.swaps}, rating_avg = ${u.rating ?? 'null'}, rating_count = ${u.ratings}, role = ${q(u.role ?? 'user')} where id = ${q(uid(u.n))};`);
    if (u.phone) out.push(`update public.profile_private set phone_e164 = ${q(u.phone)}, phone_verified_at = '2026-11-01T00:00:00Z' where id = ${q(uid(u.n))};`);
  }
  out.push('');

  const media = [];
  const privates = [];
  const wants = [];
  out.push('insert into public.items (id, owner_id, type, category_id, title, description, condition, est_value_vnd, topup_pay_max_vnd, topup_receive_max_vnd, sell_price_vnd, delivery_methods, province_code, expires_on, signed_out_confirmed, transfer_right_confirmed, duration_minutes, status, created_at) values');
  out.push(items.map(([n, owner, type, cat, title, value, x]) => {
    const u = U[owner];
    const digital = ['digital_file', 'course_code', 'voucher'].includes(type);
    const delivery = digital ? ['digital'] : x.delivery;
    if (x.imei) privates.push(`  (${q(iid(n))}, ${q(uid(u.n))}, ${q(imeiFor(x.imei))})`);
    if (type === 'physical' || type === 'other') {
      for (let k = 1; k <= 3; k++) media.push(`  (${q(mid(n, k))}, ${q(iid(n))}, ${q(uid(u.n))}, 'photo', ${q(`seed/${iid(n)}/photo-${k}.webp`)}, 1200, 1500, true, ${k})`);
    }
    if (x.proof) media.push(`  (${q(mid(n, 9))}, ${q(iid(n))}, ${q(uid(u.n))}, 'proof', ${q(`seed/${iid(n)}/proof-1.webp`)}, 1200, 1600, true, 0)`);
    for (const [t, v] of x.wants ?? []) {
      wants.push(`  (${q(iid(n))}, ${q(t)}, ${t === 'item' ? q(iid(v)) : 'null'}, ${t === 'category' ? q(v) : 'null'}, ${t === 'keyword' ? q(v) : 'null'})`);
    }
    const created = `2026-11-${String(1 + (n % 20)).padStart(2, '0')}T08:00:00Z`;
    return `  (${q(iid(n))}, ${q(uid(u.n))}, ${q(type)}, ${q(cat)}, ${q(title)}, ${q(`Mô tả mẫu cho món: ${title}.`)}, ${q(x.condition ?? 'not_applicable')}, ${value}, ${x.pay ?? 0}, ${x.receive ?? 0}, ${x.sell ?? 'null'}, ${q(`{${delivery.join(',')}}`)}, ${q(u.province)}, ${x.expires ? q(x.expires) : 'null'}, ${Boolean(x.imei)}, ${digital}, ${x.duration ?? 'null'}, 'draft', ${q(created)})`;
  }).join(',\n') + ';');
  out.push('');
  out.push('insert into public.item_private (item_id, owner_id, imei_full) values');
  out.push(privates.join(',\n') + ';');
  out.push('');
  out.push('insert into public.item_media (id, item_id, owner_id, kind, storage_path, width, height, exif_stripped, sort) values');
  out.push(media.join(',\n') + ';');
  out.push('');
  out.push('insert into public.item_wants (item_id, want_type, wanted_item_id, category_id, keyword) values');
  out.push(wants.join(',\n') + ';');
  // Món được tạo ở nháp (IMEI, ảnh chỉ ghi được khi món chưa đăng), giờ mới đặt trạng thái cuối.
  out.push('');
  for (const status of ['active', 'pending_review']) {
    const ids = items.filter(([, , , , , , x]) => (x.status ?? 'active') === status).map(([n]) => q(iid(n)));
    if (ids.length) out.push(`update public.items set status = ${q(status)} where id in (${ids.join(', ')});`);
  }
  // Kịch bản 2 đã qua bước khớp: Chi thích giày Zegna của Dũng, Dũng thích áo Gucci của Chi, hai người đang trò chuyện.
  // Các cặp còn lại để trống cho người dùng thử tự quẹt (kịch bản 1: An và Bình).
  out.push('');
  const chi = uid(U.chi.n);
  const dung = uid(U.dung.n);
  const [userA, userB, itemA, itemB] = chi < dung ? [chi, dung, iid(3), iid(4)] : [dung, chi, iid(4), iid(3)];
  out.push('insert into public.swipes (viewer_id, item_id, direction, created_at) values');
  out.push([
    `  (${q(chi)}, ${q(iid(4))}, 'like', '2026-11-20T02:00:00Z')`,
    `  (${q(dung)}, ${q(iid(3))}, 'like', '2026-11-20T03:00:00Z')`,
  ].join(',\n') + ';');
  out.push('insert into public.matches (id, user_a, user_b, item_a, item_b, created_at) values');
  out.push(`  (${q(SEED_MATCH_ID)}, ${q(userA)}, ${q(userB)}, ${q(itemA)}, ${q(itemB)}, '2026-11-20T03:00:00Z');`);
  const chat = [
    [chi, 'Chào anh, em thích đôi Zegna của anh. Giày còn hộp và hóa đơn không ạ?', '2026-11-20T03:05:00Z'],
    [dung, 'Chào em, còn đủ hộp và hóa đơn. Áo Gucci của em mặc mấy lần rồi?', '2026-11-20T03:09:00Z'],
    [chi, 'Em mặc hai lần thôi ạ. Cuối tuần mình gặp ở Quận 1 để xem hàng được không anh?', '2026-11-20T03:12:00Z'],
  ];
  out.push('insert into public.messages (id, match_id, sender_id, body, created_at) values');
  out.push(chat.map(([sender, body, at], k) => `  (${q(`00000000-0000-4000-c000-${String(k + 1).padStart(12, '0')}`)}, ${q(SEED_MATCH_ID)}, ${q(sender)}, ${q(body)}, ${q(at)})`).join(',\n') + ';');
  // Chi đã đọc hết; Dũng chưa đọc tin cuối của Chi.
  out.push('insert into public.match_reads (match_id, user_id, last_read_at) values');
  out.push(`  (${q(SEED_MATCH_ID)}, ${q(chi)}, '2026-11-20T03:12:00Z'),\n  (${q(SEED_MATCH_ID)}, ${q(dung)}, '2026-11-20T03:09:00Z');`);
  out.push('commit;');
  const summary = {
    users: users.length,
    items: items.length,
    types: new Set(items.map((i) => i[2])).size,
    provinces: new Set(items.map((i) => U[i[1]].province)).size,
    media: media.length,
    wants: wants.length,
  };
  return { sql: out.join('\n') + '\n', summary };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { sql, summary: s } = buildSeedSql();
  writeFileSync(SEED_SQL_PATH, sql);
  console.log(`seed.sql: ${s.users} users, ${s.items} items, ${s.types} types, ${s.provinces} provinces, ${s.media} media, ${s.wants} wants`);
}
