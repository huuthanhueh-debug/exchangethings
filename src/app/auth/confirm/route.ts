import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { supabaseServer } from '@/server/auth/supabase';
import { safeNextPath } from '@/server/session';

// Link đăng nhập trong email (luồng token_hash, mở được ở trình duyệt khác với nơi bấm gửi).
// emailRedirectTo đã là {APP_URL}/auth/confirm?next=..., nên mẫu email "Magic Link" trên Supabase đặt link là:
//   {{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;
  const next = safeNextPath(params.get('next'));
  if (tokenHash && type) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) redirect(next);
  }
  redirect('/dang-nhap?loi=link');
}
