import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeftIcon, ArrowsLeftRightIcon, PackageIcon, ShieldCheckIcon } from '@phosphor-icons/react/ssr';
import { MediaImage } from '@/components/item-visuals';
import { Skeleton } from '@/components/ui';
import { TIER_LABEL } from '@/lib/tiers';
import { listMessages } from '@/server/chat';
import { getMatch, type MatchItemRef, type MatchSummary } from '@/server/matches';
import { requireViewer } from '@/server/session';
import { Chat } from './chat';

export const metadata: Metadata = { title: 'Trò chuyện' };

export default function ChatPage({ params }: PageProps<'/khop/[id]'>) {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/khop" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:underline">
        <ArrowLeftIcon size={16} aria-hidden /> Khớp
      </Link>
      <Suspense fallback={<div className="space-y-3" aria-busy="true" aria-label="Đang tải cuộc trò chuyện"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>}>
        <Conversation params={params} />
      </Suspense>
    </div>
  );
}

async function Conversation({ params }: { params: PageProps<'/khop/[id]'>['params'] }) {
  const { id } = await params;
  const viewer = await requireViewer(`/khop/${id}`);
  // RLS chỉ trả match và tin nhắn cho hai người trong cuộc; người khác nhận trang 404.
  const [match, messages] = await Promise.all([getMatch(viewer.id, id), listMessages(viewer.id, id)]);
  if (!match || !messages) notFound();
  return (
    <>
      <Header match={match} />
      <Chat key={`${viewer.id}:${match.id}`} matchId={match.id} initial={messages} otherName={match.other.name} />
    </>
  );
}

function Header({ match }: { match: MatchSummary }) {
  const { other } = match;
  return (
    <header className="rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink" aria-hidden>
          {other.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight tracking-tight">{other.name}</h1>
          {other.tier && (
            <p className="text-sm text-ink-2">
              {TIER_LABEL[other.tier]}
              {other.trustScore !== null && <> · uy tín <span className="tabular">{other.trustScore}</span></>}
              {other.swaps !== null && <> · <span className="tabular">{other.swaps}</span> lần đổi</>}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <ItemChip label="Món của bạn" item={match.myItem} />
        <ArrowsLeftRightIcon size={18} className="text-muted" aria-hidden />
        <ItemChip label={`Món của ${other.name}`} item={match.theirItem} />
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <ShieldCheckIcon size={14} className="mt-0.5 shrink-0 text-accent-ink" aria-hidden />
        Số điện thoại, số tài khoản và liên kết được ẩn cho tới khi giao dịch được khóa. Đừng chuyển tiền ngoài Exchangethings.vn.
      </p>
    </header>
  );
}

function ItemChip({ label, item }: { label: string; item: MatchItemRef | null }) {
  const body = (
    <>
      <span className="relative size-10 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2">
        {item?.coverMediaId
          ? <MediaImage id={item.coverMediaId} thumb alt="" sizes="40px" />
          : <span className="flex size-full items-center justify-center text-accent-ink"><PackageIcon size={18} aria-hidden /></span>}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold text-muted">{label}</span>
        <span className="block truncate text-sm font-semibold text-ink">{item?.title ?? 'Không còn hiển thị'}</span>
      </span>
    </>
  );
  const className = 'flex min-w-0 items-center gap-2 rounded-xl border border-line bg-surface-2/60 p-1.5';
  return item
    ? <Link href={`/mon/${item.id}`} className={`${className} transition-colors hover:border-accent/40`}>{body}</Link>
    : <div className={className}>{body}</div>;
}
