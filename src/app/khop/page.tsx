import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ChatsCircleIcon, PackageIcon } from '@phosphor-icons/react/ssr';
import { MediaImage } from '@/components/item-visuals';
import { Badge, LinkButton, PageHeader, Skeleton, cx } from '@/components/ui';
import { formatWhenVn } from '@/lib/format';
import { todayInVietnam } from '@/lib/items';
import { listMatches, type MatchSummary } from '@/server/matches';
import { requireViewer } from '@/server/session';

export const metadata: Metadata = { title: 'Khớp' };

export default function MatchesPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Khớp" description="Những người cùng quan tâm món của nhau. Nhắn tin để bàn chuyện đổi." />
      <Suspense fallback={<div className="space-y-2" aria-busy="true" aria-label="Đang tải danh sách khớp">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[4.5rem]" />)}</div>}>
        <MatchList />
      </Suspense>
    </div>
  );
}

async function MatchList() {
  const viewer = await requireViewer('/khop');
  const matches = await listMatches(viewer.id);
  if (matches.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
        <p className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
          <ChatsCircleIcon size={24} aria-hidden />
        </p>
        <h2 className="mt-3 text-lg font-bold">Chưa có lượt khớp nào</h2>
        <p className="mx-auto mt-1 max-w-[38ch] text-[15px] leading-relaxed text-ink-2">
          Khi bạn quan tâm một món và chủ món cũng quan tâm một món của bạn, hai người sẽ khớp và nhắn tin được ở đây.
        </p>
        <LinkButton href="/quet" className="mt-5">Bắt đầu quẹt</LinkButton>
      </div>
    );
  }
  const today = todayInVietnam();
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      {matches.map((m) => <MatchRow key={m.id} match={m} today={today} />)}
    </ul>
  );
}

function MatchRow({ match: m, today }: { match: MatchSummary; today: string }) {
  const attention = m.unread > 0 || m.isNew;
  const preview = m.last
    ? `${m.last.mine ? 'Bạn: ' : ''}${m.last.body}`
    : 'Mới khớp. Gửi lời chào đầu tiên.';
  return (
    <li>
      <Link href={`/khop/${m.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
        <span className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
          {m.theirItem?.coverMediaId
            ? <MediaImage id={m.theirItem.coverMediaId} thumb alt="" sizes="56px" />
            : <span className="flex size-full items-center justify-center text-accent-ink"><PackageIcon size={24} aria-hidden /></span>}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={cx('truncate text-[15px] text-ink', attention ? 'font-bold' : 'font-semibold')}>{m.other.name}</span>
            <span className="tabular shrink-0 text-xs text-muted">{formatWhenVn(m.last?.at ?? m.createdAt, today)}</span>
          </span>
          <span className="block truncate text-xs text-muted">
            {m.theirItem ? m.theirItem.title : 'Món không còn hiển thị'}
            {m.myItem ? ` ⇄ ${m.myItem.title}` : ''}
          </span>
          <span className="mt-0.5 flex items-center justify-between gap-3">
            <span className={cx('truncate text-sm', attention ? 'font-semibold text-ink' : 'text-ink-2')}>{preview}</span>
            {m.unread > 0
              ? <span className="tabular inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-bold leading-5 text-on-accent">{m.unread > 99 ? '99+' : m.unread}<span className="sr-only"> tin chưa đọc</span></span>
              : m.isNew ? <Badge tone="accent" className="shrink-0">Mới</Badge> : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
