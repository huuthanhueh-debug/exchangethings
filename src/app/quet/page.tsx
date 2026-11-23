import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/ssr';
import { Skeleton, buttonClass, cx, inputClass } from '@/components/ui';
import { VALUE_RANGES, countDeckFilters, deckFiltersToParams, parseDeckFilters, type DeckFilters } from '@/lib/deck-filters';
import { ITEM_TYPES, ITEM_TYPE_META, todayInVietnam } from '@/lib/items';
import { getCatalog, type Catalog } from '@/server/catalog';
import { DECK_SIZE, GUEST_DECK_SIZE, getDeck, getGuestDeck } from '@/server/deck';
import { getViewer } from '@/server/session';
import { toCardView } from './card-view';
import { SwipeDeck } from './swipe-deck';

export const metadata: Metadata = { title: 'Quẹt' };

export default function SwipePage({ searchParams }: PageProps<'/quet'>) {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="sr-only">Quẹt món</h1>
      <Suspense fallback={<DeckSkeleton />}>
        <Deck searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Deck({ searchParams }: { searchParams: PageProps<'/quet'>['searchParams'] }) {
  const sp = await searchParams;
  const filters = parseDeckFilters(sp);
  const params = deckFiltersToParams(filters);
  const query = new URLSearchParams(params).toString();
  const canonical = query ? `/quet?${query}` : '/quet';
  const viewer = await getViewer();
  // Form GET gửi cả ô để trống ("gia=&tinh="), và URL có thể mang giá trị lạ: đưa về dạng gọn, chỉ gồm bộ lọc hợp lệ.
  const given = Object.entries(sp).filter(([, v]) => v !== undefined);
  if (given.length !== Object.keys(params).length || given.some(([k, v]) => params[k] !== v)) redirect(canonical);
  const today = todayInVietnam();

  // Khách chưa đăng nhập: xem thử vài thẻ mới nhất, không có thông tin người đăng (SPEC mục 3).
  if (!viewer) {
    const [cards, catalog] = await Promise.all([getGuestDeck(filters), getCatalog()]);
    const loginHref = `/dang-nhap?next=${encodeURIComponent(canonical)}`;
    return (
      <div className="space-y-4">
        <p className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent-ink" role="status">
          <span className="font-semibold">Bạn đang xem thử.</span>{' '}
          <Link href={loginHref} className="font-semibold underline underline-offset-2">Đăng nhập</Link> để khớp.
        </p>
        <FilterBar key={`f-${query}`} filters={filters} catalog={catalog} />
        <SwipeDeck key={`guest:${query}`} initial={cards.map((c) => toCardView(c, catalog, today))} filterParams={params} pageSize={GUEST_DECK_SIZE} guestLoginHref={loginHref} />
      </div>
    );
  }

  const [deck, catalog] = await Promise.all([getDeck(viewer, filters), getCatalog()]);
  return (
    <div className="space-y-4">
      {/* key theo bộ lọc: ô chọn là uncontrolled, phải dựng lại khi bộ lọc đổi để không giữ giá trị cũ. */}
      <FilterBar key={`f-${query}`} filters={filters} catalog={catalog} />
      {deck.myActiveItems === 0 && (
        <p className="rounded-2xl border border-accent/30 bg-accent-soft px-4 py-2.5 text-sm text-accent-ink" role="status">
          <span className="font-semibold">Bạn chưa có món nào đang hiển thị</span> nên chưa ai khớp được với bạn.{' '}
          <Link href="/dang-mon" className="font-semibold underline underline-offset-2">Đăng món</Link>
        </p>
      )}
      {/* key theo người xem và bộ lọc: đăng nhập, đổi tài khoản hoặc đổi bộ lọc thì chồng thẻ dựng lại từ đầu,
          không giữ thẻ của phiên trước. */}
      <SwipeDeck key={`${viewer.id}:${query}`} initial={deck.cards.map((c) => toCardView(c, catalog, today))} filterParams={params} pageSize={DECK_SIZE} />
    </div>
  );
}

// Bộ lọc là form GET thuần: chạy được cả khi JavaScript chưa tải xong, và nằm trên URL nên bấm lùi vẫn đúng.
function FilterBar({ filters, catalog }: { filters: DeckFilters; catalog: Catalog }) {
  const active = countDeckFilters(filters);
  const selectClass = cx(inputClass, 'py-2 text-sm');
  const label = 'mb-1 block text-xs font-semibold text-ink-2';
  return (
    <details className="group rounded-2xl border border-line bg-surface" open={false}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontalIcon size={18} aria-hidden />
          Bộ lọc
          {active > 0 && <span className="tabular rounded-full bg-accent px-2 py-0.5 text-xs text-on-accent">{active}</span>}
        </span>
        <span className="text-xs font-medium text-muted group-open:hidden">{active > 0 ? 'Đang lọc' : 'Tất cả món'}</span>
        <span className="hidden text-xs font-medium text-muted group-open:inline">Thu gọn</span>
      </summary>
      <form action="/quet" method="get" className="grid grid-cols-2 gap-3 border-t border-line p-4">
        <div>
          <label htmlFor="f-loai" className={label}>Loại món</label>
          <select id="f-loai" name="loai" defaultValue={filters.type ?? ''} className={selectClass}>
            <option value="">Tất cả</option>
            {ITEM_TYPES.map((t) => <option key={t} value={t}>{ITEM_TYPE_META[t].label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-dm" className={label}>Danh mục</label>
          <select id="f-dm" name="dm" defaultValue={filters.categoryId ?? ''} className={selectClass}>
            <option value="">Tất cả</option>
            {ITEM_TYPES.map((t) => (
              <optgroup key={t} label={ITEM_TYPE_META[t].label}>
                {catalog.categories.filter((c) => c.item_type === t).map((c) => <option key={c.id} value={c.id}>{c.nameVi}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-gia" className={label}>Giá trị</label>
          <select id="f-gia" name="gia" defaultValue={filters.valueRange ?? ''} className={selectClass}>
            <option value="">Mọi mức</option>
            {VALUE_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="f-tinh" className={label}>Tỉnh/thành</label>
          <select id="f-tinh" name="tinh" defaultValue={filters.provinceCode ?? ''} className={selectClass}>
            <option value="">Cả nước</option>
            {catalog.provinces.map((p) => <option key={p.code} value={p.code}>{p.shortName}</option>)}
          </select>
        </div>
        <label className="col-span-2 flex items-start gap-2.5 text-sm text-ink">
          <input type="checkbox" name="hop" value="1" defaultChecked={filters.onlyCompatible} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>Chỉ món hợp với đồ tôi có<span className="block text-xs text-muted">Người đăng đang tìm đúng thứ bạn có.</span></span>
        </label>
        <div className="col-span-2 flex items-center gap-2">
          <button type="submit" className={buttonClass('primary', 'sm', 'flex-1')}>Áp dụng</button>
          {active > 0 && <Link href="/quet" className={buttonClass('secondary', 'sm')}>Bỏ lọc</Link>}
        </div>
      </form>
    </details>
  );
}

function DeckSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Đang tải chồng thẻ">
      <Skeleton className="h-11" />
      <Skeleton className="h-[min(56dvh,34rem)] min-h-[22rem]" />
      <div className="flex justify-center gap-6">
        <Skeleton className="size-16 rounded-full" />
        <Skeleton className="size-16 rounded-full" />
      </div>
    </div>
  );
}
