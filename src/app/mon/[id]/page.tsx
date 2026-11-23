import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeftIcon, ArrowsLeftRightIcon, SealCheckIcon, ShieldCheckIcon, StarIcon } from '@phosphor-icons/react/ssr';
import { ItemFacts } from '@/components/item-facts';
import { ExpiryBadge, MediaImage, StatusBadge, TypePlaceholder } from '@/components/item-visuals';
import { Badge, Card, LinkButton, Skeleton, buttonClass } from '@/components/ui';
import { formatVnd } from '@/lib/format';
import { ITEM_TYPE_META, todayInVietnam } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { getItem } from '@/server/items';
import { actorOf, getViewer } from '@/server/session';

export const metadata: Metadata = { title: 'Chi tiết món' };

const TIER = { new: 'Thành viên mới', regular: 'Thành viên', high: 'Uy tín cao' } as const;

export default function ItemPage({ params }: PageProps<'/mon/[id]'>) {
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/#kham-pha" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:underline">
        <ArrowLeftIcon size={16} aria-hidden /> Khám phá
      </Link>
      <Suspense fallback={<div className="grid gap-6 md:grid-cols-2"><Skeleton className="aspect-[4/5]" /><Skeleton className="h-96" /></div>}>
        <ItemContent params={params} />
      </Suspense>
    </div>
  );
}

async function ItemContent({ params }: { params: PageProps<'/mon/[id]'>['params'] }) {
  const { id } = await params;
  const viewer = await getViewer();
  const item = await getItem(actorOf(viewer), id);
  if (!item) notFound();
  const catalog = await getCatalog();
  const isOwner = viewer?.id === item.ownerId;
  const photos = item.media.filter((m) => m.kind === 'photo');
  const category = item.categoryId ? catalog.categoryById.get(item.categoryId) : undefined;
  const meta = ITEM_TYPE_META[item.type];

  return (
    <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-8">
      <Gallery title={item.title} photos={photos} type={item.type} />

      <div className="min-w-0 space-y-5">
        <div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {item.status !== 'active' && <StatusBadge status={item.status} />}
            <Badge>{meta.label}</Badge>
            <ExpiryBadge expiresOn={item.expiresOn} today={todayInVietnam()} />
          </div>
          <h1 className="text-2xl font-bold leading-tight tracking-tight md:text-3xl">{item.title}</h1>
          <p className="tabular mt-2 text-2xl font-bold text-accent-ink">{formatVnd(item.estValueVnd)}</p>
          <p className="mt-0.5 text-sm text-muted">Giá trị do người đăng ước tính</p>
        </div>

        {(category?.requires_proof || (category?.is_phone && item.imeiLast4)) && item.status === 'active' && (
          <ul className="space-y-1.5 text-sm">
            {category?.requires_proof && (
              <li className="flex items-center gap-2 text-ok"><SealCheckIcon size={18} weight="fill" aria-hidden />Người đăng đã gửi chứng từ hàng hiệu cho admin</li>
            )}
            {category?.is_phone && item.imeiLast4 && (
              <li className="flex items-center gap-2 text-ok"><ShieldCheckIcon size={18} weight="fill" aria-hidden />Đã khai IMEI và xác nhận thoát iCloud/Google</li>
            )}
          </ul>
        )}

        <Card className="flex items-center gap-3 p-4">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink">
            {item.ownerName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{item.ownerName}</p>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              <span>{TIER[item.ownerTier]}</span>
              <span aria-hidden>·</span>
              <span className="tabular">{item.ownerSwaps} lần đổi</span>
              {item.ownerRating !== null && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular inline-flex items-center gap-0.5"><StarIcon size={14} weight="fill" className="text-warn" aria-hidden />{item.ownerRating.toLocaleString('vi-VN')}</span>
                </>
              )}
            </p>
          </div>
        </Card>

        {isOwner ? (
          <LinkButton href={`/mon-cua-toi/${item.id}`} className="w-full" size="lg">Quản lý món này</LinkButton>
        ) : (
          <div className="space-y-2">
            <button type="button" disabled className={buttonClass('primary', 'lg', 'w-full')}>
              <ArrowsLeftRightIcon size={20} weight="bold" aria-hidden /> Đề nghị đổi
            </button>
            <p className="text-center text-sm text-muted">Quẹt, khớp và đề nghị đổi có ở bản tiếp theo.</p>
          </div>
        )}

        <Card className="p-5">
          <ItemFacts item={item} catalog={catalog} />
        </Card>
      </div>
    </div>
  );
}

function Gallery({ title, photos, type }: { title: string; photos: { id: string }[]; type: Parameters<typeof TypePlaceholder>[0]['type'] }) {
  if (photos.length === 0) {
    return <div className="aspect-[4/5] overflow-hidden rounded-2xl border border-line"><TypePlaceholder type={type} /></div>;
  }
  return (
    <div className="min-w-0">
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 md:pb-0"
        aria-label={`Ảnh của ${title}`}>
        {photos.map((p, i) => (
          <li key={p.id} className={`relative aspect-[4/5] w-[85%] shrink-0 snap-center overflow-hidden rounded-2xl border border-line bg-surface-2 md:w-auto ${i === 0 ? 'md:col-span-2' : ''}`}>
            <MediaImage id={p.id} alt={`${title}, ảnh ${i + 1}/${photos.length}`} priority={i === 0}
              sizes={i === 0 ? '(min-width: 768px) 50vw, 85vw' : '(min-width: 768px) 25vw, 85vw'} />
          </li>
        ))}
      </ul>
      {photos.length > 1 && <p className="mt-1 text-center text-xs text-muted md:hidden">Vuốt ngang để xem {photos.length} ảnh</p>}
    </div>
  );
}
