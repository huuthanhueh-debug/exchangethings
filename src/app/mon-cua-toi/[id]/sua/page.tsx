import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ArrowLeftIcon } from '@phosphor-icons/react/ssr';
import { Notice, PageHeader, Skeleton } from '@/components/ui';
import { todayInVietnam } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { getItem, getItemImei } from '@/server/items';
import { requireViewer } from '@/server/session';
import { updateItemAction } from '@/app/dang-mon/actions';
import { formOptions, valuesFromItem } from '@/app/dang-mon/form-data';
import { ItemForm } from '@/app/dang-mon/item-form';

export const metadata: Metadata = { title: 'Sửa món' };

export default function EditItemPage({ params }: PageProps<'/mon-cua-toi/[id]/sua'>) {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<><Skeleton className="mb-6 h-14 w-2/3" /><Skeleton className="h-96" /></>}>
        <EditContent params={params} />
      </Suspense>
    </div>
  );
}

async function EditContent({ params }: { params: PageProps<'/mon-cua-toi/[id]/sua'>['params'] }) {
  const { id } = await params;
  const viewer = await requireViewer(`/mon-cua-toi/${id}/sua`);
  const item = await getItem({ kind: 'user', id: viewer.id }, id);
  if (!item || item.ownerId !== viewer.id) notFound();
  const [catalog, imei] = await Promise.all([getCatalog(), getItemImei(viewer.id, id)]);
  const editable = ['draft', 'pending_review', 'active', 'removed'].includes(item.status);
  return (
    <>
      <Link href={`/mon-cua-toi/${id}`} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:underline">
        <ArrowLeftIcon size={16} aria-hidden /> Quay lại món
      </Link>
      <PageHeader title="Sửa món" description="Ảnh được thêm, xóa ở trang món. Món đang hiển thị thì không đổi được danh mục; gỡ món trước nếu cần." />
      {editable ? (
        <ItemForm mode="edit" type={item.type} {...formOptions(catalog, item.type)} defaults={valuesFromItem(item, imei)}
          action={updateItemAction.bind(null, item.id)} today={todayInVietnam()} />
      ) : (
        <Notice tone="warn">Món đang trong giao dịch hoặc đã đổi xong nên không sửa được.</Notice>
      )}
    </>
  );
}
