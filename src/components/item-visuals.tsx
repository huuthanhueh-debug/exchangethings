import Image from 'next/image';
import Link from 'next/link';
import type { Icon } from '@phosphor-icons/react';
import {
  FileTextIcon, GraduationCapIcon, HandshakeIcon, PackageIcon, SparkleIcon, TicketIcon,
} from '@phosphor-icons/react/ssr';
import { formatDateVi, formatVnd } from '@/lib/format';
import { ITEM_TYPE_META, STATUS_LABEL, daysUntil, type ItemStatus, type ItemType } from '@/lib/items';
import type { ItemCard as ItemCardData } from '@/server/items';
import { Badge, cx } from './ui';

export const TYPE_ICON: Record<ItemType, Icon> = {
  physical: PackageIcon,
  digital_file: FileTextIcon,
  course_code: GraduationCapIcon,
  voucher: TicketIcon,
  service: HandshakeIcon,
  other: SparkleIcon,
};

/** Ảnh món qua route kiểm quyền /api/media/[id]. Ảnh đã được tối ưu khi tải lên nên không qua bộ tối ưu của Next. */
export function MediaImage({ id, alt, thumb, sizes, priority, className }: {
  id: string; alt: string; thumb?: boolean; sizes: string; priority?: boolean; className?: string;
}) {
  return (
    <Image
      src={`/api/media/${id}${thumb ? '?v=thumb' : ''}`}
      alt={alt}
      fill
      sizes={sizes}
      unoptimized
      priority={priority}
      className={cx('object-cover', className)}
    />
  );
}

export function TypePlaceholder({ type, className }: { type: ItemType; className?: string }) {
  const Icon = TYPE_ICON[type];
  return (
    <div className={cx('flex size-full flex-col items-center justify-center gap-2 bg-accent-soft text-accent-ink', className)}>
      <Icon size={44} weight="duotone" aria-hidden />
      <span className="text-xs font-semibold">{ITEM_TYPE_META[type].label}</span>
    </div>
  );
}

export function StatusBadge({ status }: { status: ItemStatus }) {
  const tone = status === 'active' ? 'ok' : status === 'pending_review' ? 'warn' : status === 'removed' ? 'bad' : 'neutral';
  return <Badge tone={tone}>{STATUS_LABEL[status]}</Badge>;
}

/** Hạn dùng còn dưới 7 ngày thì cảnh báo (SPEC mục 4, voucher và mã khóa học). */
export function ExpiryBadge({ expiresOn, today }: { expiresOn: string | null; today: string }) {
  if (!expiresOn) return null;
  const left = daysUntil(expiresOn, today);
  if (left < 0) return <Badge tone="bad">Đã hết hạn</Badge>;
  if (left < 7) return <Badge tone="warn">Còn {left} ngày</Badge>;
  return <Badge>HSD {formatDateVi(expiresOn)}</Badge>;
}

export function ItemCard({ item, href, place, today, showStatus, priority }: {
  item: ItemCardData; href: string; place: string | null; today: string; showStatus?: boolean; priority?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:border-accent/40"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-surface-2">
        {item.coverMediaId ? (
          <MediaImage id={item.coverMediaId} thumb alt={item.title} sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw" priority={priority}
            className="transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <TypePlaceholder type={item.type} />
        )}
        <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
          {showStatus && <StatusBadge status={item.status} />}
          <ExpiryBadge expiresOn={item.expiresOn} today={today} />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink">{item.title}</p>
        <p className="tabular text-[15px] font-bold text-accent-ink">{formatVnd(item.estValueVnd)}</p>
        <p className="mt-auto truncate text-xs text-muted">
          {ITEM_TYPE_META[item.type].label}
          {place ? ` · ${place}` : ''}
        </p>
      </div>
    </Link>
  );
}

export function ItemGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4" aria-busy="true" aria-label="Đang tải danh sách món">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="aspect-[4/5] animate-pulse bg-surface-2" />
          <div className="space-y-2 p-3">
            <div className="h-4 w-4/5 animate-pulse rounded-full bg-surface-2" />
            <div className="h-4 w-2/5 animate-pulse rounded-full bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}
