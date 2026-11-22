'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { DEV_SESSION_COOKIE, DEV_SESSION_MAX_AGE, signDevSession } from '@/server/auth/dev-session';
import { supabaseServer } from '@/server/auth/supabase';
import { withAnon } from '@/server/db';
import { env } from '@/server/env';
import { safeNextPath } from '@/server/session';

export type EmailState = { status: 'idle' | 'sent' | 'error'; message?: string; email?: string };

/** Đăng nhập bằng link gửi qua email (Supabase Auth). */
export async function emailSignIn(_prev: EmailState, formData: FormData): Promise<EmailState> {
  const e = env();
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (e.AUTH_MODE !== 'supabase') {
    return { status: 'error', email, message: 'Máy dev chưa nối Supabase nên chưa gửi được email. Chọn người dùng mẫu bên dưới.' };
  }
  if (!z.email().safeParse(email).success) return { status: 'error', email, message: 'Email chưa đúng định dạng.' };
  const next = safeNextPath(formData.get('next'));
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${e.APP_URL}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) return { status: 'error', email, message: 'Chưa gửi được email. Đợi một phút rồi thử lại.' };
  return { status: 'sent', email };
}

/** Đăng nhập bằng Google (Supabase Auth, OAuth). */
export async function googleSignIn(formData: FormData) {
  const e = env();
  if (e.AUTH_MODE !== 'supabase') redirect('/dang-nhap?loi=google');
  const next = safeNextPath(formData.get('next'));
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${e.APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect('/dang-nhap?loi=google');
  redirect(data.url);
}

/** Chỉ máy dev (AUTH_MODE=dev): đăng nhập bằng người dùng mẫu có sẵn trong database. */
export async function devSignIn(formData: FormData) {
  const e = env(); // env() từ chối AUTH_MODE=dev nếu database không ở localhost hoặc chạy trên Vercel
  if (e.AUTH_MODE !== 'dev') redirect('/dang-nhap');
  const userId = String(formData.get('user_id') ?? '');
  const exists = await withAnon(async (tx) => {
    const r = await tx.query('select 1 from profiles where id = $1', [userId]);
    return r.rowCount === 1;
  }).catch(() => false);
  if (!exists) redirect('/dang-nhap?loi=mau');
  const store = await cookies();
  store.set(DEV_SESSION_COOKIE, await signDevSession(userId, e.DEV_AUTH_SECRET!), {
    httpOnly: true, sameSite: 'lax', secure: e.APP_URL.startsWith('https://'), path: '/', maxAge: DEV_SESSION_MAX_AGE,
  });
  redirect(safeNextPath(formData.get('next')));
}

export async function signOut() {
  const e = env();
  if (e.AUTH_MODE === 'dev') {
    (await cookies()).delete(DEV_SESSION_COOKIE);
  } else {
    const supabase = await supabaseServer();
    await supabase.auth.signOut();
  }
  redirect('/');
}
