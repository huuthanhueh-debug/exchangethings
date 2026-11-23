import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { GoogleLogoIcon } from '@phosphor-icons/react/ssr';
import { SubmitButton } from '@/components/form-bits';
import { Badge, Card, Notice, Skeleton } from '@/components/ui';
import { elevate, withActor } from '@/server/db';
import { env } from '@/server/env';
import { getCatalog } from '@/server/catalog';
import { getViewer, safeNextPath } from '@/server/session';
import { devSignIn, googleSignIn } from './actions';
import { EmailForm } from './email-form';

export const metadata: Metadata = { title: 'Đăng nhập' };

const ERRORS: Record<string, string> = {
  link: 'Link đăng nhập đã hết hạn hoặc đã dùng. Gửi lại link mới nhé.',
  google: 'Chưa đăng nhập được bằng Google. Thử lại hoặc dùng email.',
  mau: 'Không tìm thấy người dùng mẫu này.',
};

export default function LoginPage({ searchParams }: PageProps<'/dang-nhap'>) {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Đăng nhập</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
        Không cần mật khẩu. Nhận link qua email hoặc dùng tài khoản Google.
      </p>
      <Suspense fallback={<Skeleton className="mt-6 h-72" />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function LoginContent({ searchParams }: { searchParams: PageProps<'/dang-nhap'>['searchParams'] }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const viewer = await getViewer();
  if (viewer) redirect(next);
  const devMode = env().AUTH_MODE === 'dev';
  const error = typeof sp.loi === 'string' ? ERRORS[sp.loi] : undefined;

  return (
    <div className="mt-6 space-y-5">
      {error && <Notice tone="bad">{error}</Notice>}
      <Card className="space-y-5 p-5">
        <form action={googleSignIn}>
          <input type="hidden" name="next" value={next} />
          <SubmitButton variant="secondary" className="w-full" pendingText="Đang chuyển tới Google..." disabled={devMode}>
            <GoogleLogoIcon size={18} weight="bold" aria-hidden />
            Tiếp tục với Google
          </SubmitButton>
        </form>
        <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line" />hoặc<span className="h-px flex-1 bg-line" />
        </div>
        <EmailForm next={next} disabled={devMode} />
      </Card>
      {devMode && <DevUsers next={next} />}
      <p className="text-center text-sm text-muted">
        Khi đăng nhập, bạn đồng ý với Điều khoản sử dụng và Chính sách quyền riêng tư của Exchangethings.vn.
      </p>
    </div>
  );
}

const TIER: Record<string, string> = { new: 'Thành viên mới', regular: 'Thành viên', high: 'Uy tín cao' };

// Chỉ hiện ở máy dev (AUTH_MODE=dev): đăng nhập nhanh bằng người dùng trong dữ liệu mẫu.
async function DevUsers({ next }: { next: string }) {
  const [users, catalog] = await Promise.all([
    // Cột role là riêng tư nên đọc bằng quyền server; trang này chỉ tồn tại ở máy dev.
    withActor({ kind: 'anon' }, (tx) => elevate(tx, { kind: 'anon' }, async () => (await tx.query<{ id: string; display_name: string; tier: string; role: string; province_code: string | null; completed_swaps: number }>(
      `select id, display_name, tier, role, province_code, completed_swaps from profiles order by role desc, id limit 20`)).rows)),
    getCatalog(),
  ]);
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">Người dùng mẫu</h2>
        <Badge tone="warn">Chỉ máy dev</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-2">Máy dev chưa nối Supabase, nên đăng nhập bằng một người trong dữ liệu mẫu.</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {users.map((u) => (
          <li key={u.id}>
            <form action={devSignIn}>
              <input type="hidden" name="user_id" value={u.id} />
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition hover:border-accent/50 hover:bg-accent-soft/40">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink">
                  {u.display_name.charAt(0)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{u.display_name}</span>
                  <span className="block truncate text-xs text-muted">
                    {u.role === 'admin' ? 'Quản trị viên' : `${TIER[u.tier]} · ${u.completed_swaps} lần đổi`}
                    {u.province_code ? ` · ${catalog.provinceByCode.get(u.province_code)?.shortName ?? ''}` : ''}
                  </span>
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
