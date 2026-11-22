import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { DEV_SESSION_COOKIE, verifyDevSession } from '@/server/auth/dev-session';

// Proxy (Next 16, trước đây là middleware), chạy trên Node.js trước mỗi request trang:
// 1. Làm mới phiên Supabase và ghi cookie mới vào response (Server Component không ghi được cookie).
// 2. Chặn lạc quan các trang cần đăng nhập bằng chuyển hướng 307 thật tới /dang-nhap?next=...
//    Đây không phải lớp phân quyền: mỗi trang, Server Action và Route Handler tự kiểm tra lại (src/server/session.ts),
//    và RLS ở database là lớp cuối.
// Request của Server Action không đi qua đây (xem matcher): action tự làm mới phiên, và body upload ảnh
// không bị proxy đệm hay cắt.

const PROTECTED_PREFIXES = ['/ho-so', '/dang-mon', '/mon-cua-toi'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function devAuthAllowed(): boolean {
  if (process.env.AUTH_MODE !== 'dev' || process.env.VERCEL) return false;
  try {
    return LOOPBACK.has(new URL(process.env.DATABASE_URL ?? '').hostname);
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });
  let userId: string | null = null;

  if (process.env.AUTH_MODE === 'dev') {
    // Sai cấu hình (dev ở môi trường thật) thì coi như chưa đăng nhập: thất bại theo hướng an toàn.
    if (devAuthAllowed()) {
      userId = await verifyDevSession(request.cookies.get(DEV_SESSION_COOKIE)?.value, process.env.DEV_AUTH_SECRET ?? '');
    }
  } else if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: request.headers } });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          // Response có cookie phiên không được để CDN cache (yêu cầu của @supabase/ssr).
          for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    userId = data?.claims?.sub ?? null;
  }

  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!userId && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/dang-nhap';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    const redirect = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set('Cache-Control', 'private, no-store');
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|api/media|api/wards|favicon.ico|icon|apple-icon|robots.txt|sitemap.xml).*)',
      missing: [{ type: 'header', key: 'next-action' }],
    },
  ],
};
