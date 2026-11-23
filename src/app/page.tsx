import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowsLeftRightIcon, HandshakeIcon, ScalesIcon, ShieldCheckIcon } from '@phosphor-icons/react/ssr';
import { ItemCard, ItemGridSkeleton, TYPE_ICON } from '@/components/item-visuals';
import { LinkButton, Notice, cx } from '@/components/ui';
import { formatVnd } from '@/lib/format';
import { ITEM_TYPES, ITEM_TYPE_META, isItemType, todayInVietnam } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { listRecentItems } from '@/server/items';
import { actorOf, getViewer } from '@/server/session';

export default function HomePage({ searchParams }: PageProps<'/'>) {
  return (
    <>
      <Hero />
      <section aria-labelledby="mon-moi" className="mt-12 scroll-mt-20" id="kham-pha">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="mon-moi" className="text-xl font-bold tracking-tight md:text-2xl">Món mới đăng</h2>
        </div>
        <Suspense fallback={<><TypeFilterSkeleton /><ItemGridSkeleton /></>}>
          <Listing searchParams={searchParams} />
        </Suspense>
      </section>
    </>
  );
}

function Hero() {
  return (
    <section className="grid items-center gap-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:gap-12">
      <div className="min-w-0">
        <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-ink">
          <ArrowsLeftRightIcon size={14} weight="bold" aria-hidden />
          Chợ đổi đồ cho người Việt
        </p>
        <h1 className="text-[2rem] font-bold leading-[1.15] tracking-tight text-ink md:text-5xl md:leading-[1.08]">
          Đổi món bạn không dùng lấy món bạn cần
        </h1>
        <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-ink-2 md:text-lg">
          Điện thoại, quần áo, khóa học, voucher hay một buổi dạy kèm đều đổi được. Hai bên cùng đồng ý mới chốt,
          tiền bù được giữ qua trung gian tới khi cả hai nhận đủ.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/quet" size="lg">Bắt đầu quẹt</LinkButton>
          <LinkButton href="/dang-mon" size="lg" variant="secondary">Đăng món</LinkButton>
        </div>
        <ul className="mt-8 grid gap-3 text-sm text-ink-2 sm:grid-cols-3">
          {[
            { Icon: HandshakeIcon, text: 'Hai bên cùng đồng ý mới đổi' },
            { Icon: ScalesIcon, text: 'Cán cân giá trị rõ ràng' },
            { Icon: ShieldCheckIcon, text: 'Ảnh được xóa vị trí GPS' },
          ].map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2">
              <Icon size={20} className="shrink-0 text-accent-ink" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <SwapPreview />
    </section>
  );
}

// Minh họa kịch bản 1 trong SPEC: iPhone 15 + tiền bù đổi lấy iPhone 18. Chỉ là hình minh họa tĩnh.
function SwapPreview() {
  const side = (title: string, value: number, note: string) => (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{note}</p>
      <p className="mt-1 line-clamp-2 text-[15px] font-semibold leading-snug text-ink md:text-base">{title}</p>
      <p className="tabular mt-0.5 text-sm font-bold text-accent-ink">{formatVnd(value)}</p>
    </div>
  );
  return (
    <div className="relative min-w-0 rounded-2xl border border-line bg-surface-2 p-4 shadow-card md:p-6" aria-hidden>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {side('iPhone 15 128GB', 13_000_000, 'Bạn đưa')}
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-accent text-on-accent">
          <ArrowsLeftRightIcon size={20} weight="bold" />
        </span>
        {side('iPhone 18 256GB', 17_000_000, 'Bạn nhận')}
      </div>
      <div className="mt-4 rounded-2xl bg-surface p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-ink-2">Tiền bù bạn trả</span>
          <span className="tabular font-bold text-ink">{formatVnd(3_000_000)}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full w-[94%] rounded-full bg-ok" />
        </div>
        <p className="mt-2 text-xs font-semibold text-ok">Lệch 5,9%: cân bằng tốt</p>
      </div>
    </div>
  );
}

async function Listing({ searchParams }: { searchParams: PageProps<'/'>['searchParams'] }) {
  const sp = await searchParams;
  const type = isItemType(sp.loai) ? sp.loai : undefined;
  const viewer = await getViewer();
  const [items, catalog] = await Promise.all([listRecentItems(actorOf(viewer), { type, limit: 24 }), getCatalog()]);
  const today = todayInVietnam();
  return (
    <>
      <Notice tone="accent" title="Bản thử nghiệm">
        Đã có: đăng món, quẹt, khớp và nhắn tin. Đề nghị đổi và thanh toán qua trung gian có ở các bản tiếp theo.
      </Notice>
      <TypeFilter current={type} />
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-8 text-center">
          <p className="font-semibold text-ink">Chưa có món nào thuộc loại này.</p>
          <p className="mt-1 text-sm text-ink-2">Bạn có thể là người đăng đầu tiên.</p>
          <LinkButton href={type ? `/dang-mon?loai=${type}` : '/dang-mon'} className="mt-4">Đăng món</LinkButton>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {items.map((item, i) => (
            <ItemCard key={item.id} item={item} href={`/mon/${item.id}`} today={today} priority={i < 4}
              place={item.provinceCode ? catalog.provinceByCode.get(item.provinceCode)?.shortName ?? null : null} />
          ))}
        </div>
      )}
    </>
  );
}

function TypeFilter({ current }: { current?: string }) {
  const chip = (active: boolean) => cx(
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-semibold transition',
    active ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-ink-2 hover:border-accent/40 hover:text-ink',
  );
  return (
    <nav aria-label="Lọc theo loại món" className="relative my-4">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        <li className="shrink-0"><Link href="/#kham-pha" scroll={false} className={chip(!current)} aria-current={!current ? 'page' : undefined}>Tất cả</Link></li>
        {ITEM_TYPES.map((t) => {
          const Icon = TYPE_ICON[t];
          return (
            <li key={t} className="shrink-0">
              <Link href={`/?loai=${t}#kham-pha`} scroll={false} className={chip(current === t)} aria-current={current === t ? 'page' : undefined}>
                <Icon size={16} aria-hidden />
                {ITEM_TYPE_META[t].label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TypeFilterSkeleton() {
  return (
    <div className="my-4 flex gap-2 overflow-hidden" aria-hidden>
      {[72, 96, 84, 110, 132, 90].map((w) => <div key={w} className="h-9 shrink-0 animate-pulse rounded-full bg-surface-2" style={{ width: w }} />)}
    </div>
  );
}
