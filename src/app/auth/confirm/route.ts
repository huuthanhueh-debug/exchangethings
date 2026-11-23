import type { EmailOtpType } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { safeNextPath } from '@/lib/safe-path';
import { supabaseServer } from '@/server/auth/supabase';
import { env } from '@/server/env';

// Link đăng nhập trong email. Nhận cả hai kiểu, để không phải sửa mẫu email trên Supabase:
// - ?code=...        mẫu email mặc định của Supabase (PKCE): mở link trên cùng trình duyệt đã bấm gửi.
// - ?token_hash=...  mẫu tùy chỉnh "{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email": mở ở đâu cũng được.
const OTP_TYPES: ReadonlySet<string> = new Set(['email', 'magiclink', 'signup', 'recovery', 'invite', 'email_change']);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get('next'));
  // Chỉ dùng khi đăng nhập qua Supabase; ở máy dev thì quay về trang đăng nhập.
  if (env().AUTH_MODE !== 'supabase') redirect('/dang-nhap');

  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  const code = params.get('code');
  let ok = false;
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const supabase = await supabaseServer();
    ok = !(await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash })).error;
  } else if (code) {
    const supabase = await supabaseServer();
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  redirect(ok ? next : '/dang-nhap?loi=link');
}
