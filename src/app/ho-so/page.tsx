import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SealCheckIcon, SignOutIcon } from '@phosphor-icons/react/ssr';
import { SubmitButton } from '@/components/form-bits';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge, Card, Notice, PageHeader, Skeleton } from '@/components/ui';
import { formatVnMobile } from '@/lib/phone';
import { getCatalog, getWards } from '@/server/catalog';
import { withActor } from '@/server/db';
import { requireViewer } from '@/server/session';
import { signOut } from '../dang-nhap/actions';
import { ProfileForm } from './profile-form';

export const metadata: Metadata = { title: 'Hồ sơ' };

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Hồ sơ của bạn" description="Tên và khu vực giúp người đổi đồ biết bạn ở đâu, để hẹn giao thuận tiện." />
      <Suspense fallback={<div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]"><Skeleton className="h-[420px]" /><Skeleton className="h-60" /></div>}>
        <ProfileContent />
      </Suspense>
    </div>
  );
}

const TIERS = {
  new: { label: 'Thành viên mới', tone: 'neutral', rule: 'Khi giao qua vận chuyển, cọc 20% giá trị món bạn nhận. Mỗi giao dịch tối đa 5.000.000 ₫.', next: 'Xác minh số điện thoại và đổi xong 3 lần để lên Thành viên.' },
  regular: { label: 'Thành viên', tone: 'accent', rule: 'Khi giao qua vận chuyển, cọc 10% giá trị món bạn nhận.', next: 'Đổi xong 20 lần, điểm đánh giá từ 4,8 và không thua khiếu nại trong 90 ngày để lên Uy tín cao.' },
  high: { label: 'Uy tín cao', tone: 'ok', rule: 'Không cần đặt cọc khi giao qua vận chuyển.', next: 'Giữ điểm đánh giá từ 4,8 và không thua khiếu nại để giữ hạng.' },
} as const;

async function ProfileContent() {
  const viewer = await requireViewer('/ho-so');
  const [row, catalog] = await Promise.all([
    withActor({ kind: 'user', id: viewer.id }, async (tx) => (await tx.query<{
      display_name: string; bio: string | null; province_code: string | null; ward_code: string | null; trust_score: number;
      tier: keyof typeof TIERS; completed_swaps: number; rating_avg: string | null; rating_count: number;
      phone_e164: string | null; phone_verified_at: Date | null;
    }>(`select p.display_name, p.bio, p.province_code, p.ward_code, p.trust_score, p.tier, p.completed_swaps, p.rating_avg, p.rating_count,
               pp.phone_e164, pp.phone_verified_at
          from my_profile() p left join profile_private pp on pp.id = p.id`)).rows[0]),
    getCatalog(),
  ]);
  const wards = row.province_code ? await getWards(row.province_code) : [];
  const tier = TIERS[row.tier];

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
      <Card className="p-5 md:p-6">
        {!viewer.profileComplete && (
          <div className="mb-5"><Notice title="Hoàn thiện hồ sơ">Chọn tỉnh/thành và phường/xã để món của bạn hiện đúng khu vực.</Notice></div>
        )}
        <ProfileForm
          initial={{
            display_name: row.display_name, bio: row.bio ?? '', province_code: row.province_code ?? '', ward_code: row.ward_code ?? '',
            phone: row.phone_e164 ? formatVnMobile(row.phone_e164) : '',
          }}
          provinces={catalog.provinces.map((p) => ({ code: p.code, name: p.name }))}
          initialWards={wards}
          phoneVerified={row.phone_verified_at !== null}
        />
      </Card>
      <div className="space-y-5">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <SealCheckIcon size={22} className="text-accent-ink" aria-hidden />
            <h2 className="font-semibold">Uy tín</h2>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="tabular text-3xl font-bold">{row.trust_score}</span>
            <span className="text-sm text-muted">/ 100</span>
            <Badge tone={tier.tone} className="ml-auto">{tier.label}</Badge>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-surface-2 p-2.5"><dt className="text-muted">Lần đổi xong</dt><dd className="tabular font-semibold">{row.completed_swaps}</dd></div>
            <div className="rounded-xl bg-surface-2 p-2.5"><dt className="text-muted">Đánh giá</dt><dd className="tabular font-semibold">{row.rating_avg ? `${Number(row.rating_avg).toLocaleString('vi-VN')} (${row.rating_count})` : 'Chưa có'}</dd></div>
          </dl>
          <p className="mt-3 text-sm leading-relaxed text-ink-2">{tier.rule}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{tier.next}</p>
        </Card>
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="text-sm font-semibold">Giao diện sáng, tối</span>
          <ThemeToggle />
        </Card>
        <form action={signOut}>
          <SubmitButton variant="danger" className="w-full" pendingText="Đang đăng xuất...">
            <SignOutIcon size={18} aria-hidden />
            Đăng xuất
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
