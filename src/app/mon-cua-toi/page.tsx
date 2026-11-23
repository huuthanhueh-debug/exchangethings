import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ItemCard, ItemGridSkeleton } from '@/components/item-visuals';
import { LinkButton, PageHeader, cx } from '@/components/ui';
import { STATUS_LABEL, todayInVietnam, type ItemStatus } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { listMyItems } from '@/server/items';
import { requireViewer } from '@/server/session';

export const metadata: Metadata = { title: 'Món của tôi' };

const FILTERS: (ItemStatus | 'all')[] = ['all', 'active', 'draft', 'pending_review', 'removed'];

export default function MyItemsPage({ searchParams }: PageProps<'/mon-cua-toi'>) {
  return (
    <>
      <PageHeader title="Món của tôi" description="Món nháp chỉ mình bạn thấy. Món đang hiển thị thì ai cũng xem được."
        action={<LinkButton href="/dang-mon">Đăng món</LinkButton>} />
      <Suspense fallback={<ItemGridSkeleton count={4} />}>
        <MyItems searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function MyItems({ searchParams }: { searchParams: PageProps<'/mon-cua-toi'>['searchParams'] }) {
  const sp = await searchParams;
  const viewer = await requireViewer('/mon-cua-toi');
  const [items, catalog] = await Promise.all([listMyItems(viewer.id), getCatalog()]);
  const filter = FILTERS.find((f) => f === sp['trang-thai']) ?? 'all';
  const shown = filter === 'all' ? items : items.filter((i) => i.status === filter);
  const count = (f: (typeof FILTERS)[number]) => (f === 'all' ? items.length : items.filter((i) => i.status === f).length);
  const today = todayInVietnam();

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center">
        <p className="text-lg font-semibold">Bạn chưa đăng món nào</p>
        <p className="mt-1 text-ink-2">Đăng món đầu tiên để người khác thấy và đề nghị đổi.</p>
        <LinkButton href="/dang-mon" className="mt-5">Đăng món đầu tiên</LinkButton>
      </div>
    );
  }
  return (
    <>
      <nav aria-label="Lọc theo trạng thái" className="mb-4">
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
          {FILTERS.map((f) => (
            <li key={f} className="shrink-0">
              <Link href={f === 'all' ? '/mon-cua-toi' : `/mon-cua-toi?trang-thai=${f}`} aria-current={filter === f ? 'page' : undefined}
                className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold transition',
                  filter === f ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-ink-2 hover:text-ink')}>
                {f === 'all' ? 'Tất cả' : STATUS_LABEL[f]}
                <span className="tabular opacity-75">{count(f)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center text-ink-2">Không có món nào ở trạng thái này.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {shown.map((item) => (
            <ItemCard key={item.id} item={item} href={`/mon-cua-toi/${item.id}`} today={today} showStatus
              place={item.provinceCode ? catalog.provinceByCode.get(item.provinceCode)?.shortName ?? null : null} />
          ))}
        </div>
      )}
    </>
  );
}
