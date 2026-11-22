import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { env } from './env';
import { withActor, type Actor } from './db';
import { DEV_SESSION_COOKIE, verifyDevSession } from './auth/dev-session';
import { supabaseServer } from './auth/supabase';

// Data Access Layer cho phiên đăng nhập (Next 16: kiểm tra quyền gần dữ liệu, không dựa vào layout hay proxy).
// cache() của React gộp các lần gọi trong cùng một request; không lưu chéo giữa các request.
// Mọi hàm ở đây đọc cookie nên chỉ được gọi bên trong <Suspense> hoặc trong Server Action, Route Handler.

/** User id từ phiên hiện tại, hoặc null. Không truy vấn database. */
export const getSessionUserId = cache(async (): Promise<string | null> => {
  // connection(): phần sau cần một request thật. Khi prerender (lúc build, hoặc bước runtime prefetch của
  // partialPrefetching, nơi cookie đã có nhưng đồng hồ thì chưa được đọc), Next dừng ở đây.
  // Nhờ vậy env(), kiểm tra hạn phiên (Date.now) và truy vấn database chỉ chạy lúc có request.
  await connection();
  const store = await cookies();
  const e = env();
  if (e.AUTH_MODE === 'dev') {
    return verifyDevSession(store.get(DEV_SESSION_COOKIE)?.value, e.DEV_AUTH_SECRET!);
  }
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});

export type Viewer = {
  id: string;
  displayName: string;
  role: 'user' | 'admin';
  tier: 'new' | 'regular' | 'high';
  provinceCode: string | null;
  banned: boolean;
  profileComplete: boolean;
};

/** Người đang xem (đọc hồ sơ dưới quyền chính họ), hoặc null nếu chưa đăng nhập. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const id = await getSessionUserId();
  if (!id) return null;
  const row = await withActor({ kind: 'user', id }, async (tx) => {
    const r = await tx.query<{
      display_name: string; role: Viewer['role']; tier: Viewer['tier']; province_code: string | null; banned_at: Date | null; ward_code: string | null;
    }>('select display_name, role, tier, province_code, ward_code, banned_at from profiles where id = $1', [id]);
    return r.rows[0];
  });
  if (!row) return null; // phiên còn nhưng hồ sơ không còn (ví dụ database dev vừa dựng lại)
  return {
    id,
    displayName: row.display_name,
    role: row.role,
    tier: row.tier,
    provinceCode: row.province_code,
    banned: row.banned_at !== null,
    profileComplete: Boolean(row.province_code && row.ward_code),
  };
});

/** Bắt buộc đăng nhập. Proxy đã chuyển hướng (307) từ trước; đây là lớp bảo vệ thứ hai, gần dữ liệu. */
export async function requireViewer(nextPath: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/dang-nhap?next=${encodeURIComponent(nextPath)}`);
  return viewer;
}

export function actorOf(viewer: Viewer | null): Actor {
  return viewer ? { kind: 'user', id: viewer.id } : { kind: 'anon' };
}

/** Đường dẫn quay lại sau đăng nhập: chỉ nhận đường dẫn nội bộ, chống chuyển hướng ra ngoài. */
export function safeNextPath(raw: unknown, fallback = '/'): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  try {
    const u = new URL(raw, 'http://x');
    return u.origin === 'http://x' ? `${u.pathname}${u.search}` : fallback;
  } catch {
    return fallback;
  }
}
