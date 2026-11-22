import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowLeftIcon, CaretRightIcon } from '@phosphor-icons/react/ssr';
import { TYPE_ICON } from '@/components/item-visuals';
import { Notice, PageHeader, Skeleton } from '@/components/ui';
import { ITEM_TYPES, ITEM_TYPE_META, isItemType, todayInVietnam } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { requireViewer } from '@/server/session';
import { createItemAction } from './actions';
import { formOptions } from './form-data';
import { ItemForm } from './item-form';

export const metadata: Metadata = { title: 'Đăng món' };

const PAGE_TITLE: Record<(typeof ITEM_TYPES)[number], string> = {
  physical: 'Đăng hàng vật lý',
  digital_file: 'Đăng file số',
  course_code: 'Đăng mã khóa học',
  voucher: 'Đăng voucher, mã giảm giá',
  service: 'Đăng dịch vụ, kiến thức',
  other: 'Đăng món loại Khác',
};

export default function NewItemPage({ searchParams }: PageProps<'/dang-mon'>) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<><Skeleton className="mb-6 h-14 w-2/3" /><Skeleton className="h-96" /></>}>
        <NewItemContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewItemContent({ searchParams }: { searchParams: PageProps<'/dang-mon'>['searchParams'] }) {
  const sp = await searchParams;
  const type = isItemType(sp.loai) ? sp.loai : null;
  const viewer = await requireViewer(type ? `/dang-mon?loai=${type}` : '/dang-mon');

  if (!type) {
    return (
      <>
        <PageHeader title="Đăng món" description="Bạn muốn đổi loại món nào? Mỗi loại có cách giao và thông tin cần điền riêng." />
        {viewer.banned && <div className="mb-5"><Notice tone="bad">Tài khoản của bạn đang bị khóa, chưa đăng món được.</Notice></div>}
        <ul className="grid gap-3 sm:grid-cols-2">
          {ITEM_TYPES.map((t) => {
            const Icon = TYPE_ICON[t];
            const meta = ITEM_TYPE_META[t];
            return (
              <li key={t}>
                <Link href={`/dang-mon?loai=${t}`}
                  className="group flex h-full items-center gap-4 rounded-2xl border border-line bg-surface p-4 shadow-card transition hover:-translate-y-0.5 hover:border-accent/50">
                  <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">
                    <Icon size={26} weight="duotone" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{meta.label}</span>
                    <span className="mt-0.5 block text-sm leading-snug text-ink-2">{meta.example}</span>
                  </span>
                  <CaretRightIcon size={18} className="shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent-ink" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  const catalog = await getCatalog();
  const meta = ITEM_TYPE_META[type];
  return (
    <>
      <Link href="/dang-mon" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:underline">
        <ArrowLeftIcon size={16} aria-hidden /> Chọn loại khác
      </Link>
      <PageHeader title={PAGE_TITLE[type]}
        description={meta.alwaysReviewed ? 'Món loại Khác hiển thị sau khi admin duyệt, thường trong 24 giờ.' : 'Điền thông tin rõ ràng để người khác tin và đề nghị đổi nhanh hơn.'} />
      <ItemForm mode="create" type={type} {...formOptions(catalog, type)} defaults={{}} action={createItemAction} today={todayInVietnam()} />
    </>
  );
}
