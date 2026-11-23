import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { supabaseServer } from '@/server/auth/supabase';
import { env } from '@/server/env';
import { safeNextPath } from '@/server/session';

// Google trả về đây kèm ?code=...; đổi code lấy phiên đăng nhập rồi quay về trang cũ.
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = safeNextPath(request.nextUrl.searchParams.get('next'));
  // Chỉ dùng khi đăng nhập qua Supabase; ở máy dev thì quay về trang đăng nhập.
  if (env().AUTH_MODE !== 'supabase') redirect('/dang-nhap');
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) redirect(next);
  }
  redirect('/dang-nhap?loi=google');
}
