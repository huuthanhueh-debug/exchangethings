import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import {
  ArrowLeftIcon, CheckCircleIcon, EyeIcon, InfoIcon, PencilSimpleIcon, TrashIcon, WarningCircleIcon, XCircleIcon,
} from '@phosphor-icons/react/ssr';
import { SubmitButton } from '@/components/form-bits';
import { MediaImage, StatusBadge, TypePlaceholder } from '@/components/item-visuals';
import { Card, LinkButton, Notice, Skeleton } from '@/components/ui';
import { formatVnd } from '@/lib/format';
import { ITEM_TYPE_META } from '@/lib/items';
import { getCatalog } from '@/server/catalog';
import { withActor } from '@/server/db';
import { getItem, getItemImei } from '@/server/items';
import { requireViewer } from '@/server/session';
import { addPhotosAction, deletePhotoAction, publishItemAction, withdrawItemAction } from '../actions';
import { AddPhotosForm } from './add-photos-form';
import { ItemFacts } from '@/components/item-facts';

export const metadata: Metadata = { title: 'Quản lý món' };

const RESULTS: Record<string, { tone: 'ok' | 'warn' | 'bad' | 'accent' | 'neutral'; text: string }> = {
  'da-dang': { tone: 'ok', text: 'Món đã lên sàn. Người khác đã xem được món này.' },
  'cho-duyet': { tone: 'warn', text: 'Món đang chờ admin duyệt, thường trong 24 giờ. Món loại Khác hoặc có từ cần xem lại đều qua bước này.' },
  'chua-dang': { tone: 'bad', text: 'Món đã được lưu nháp nhưng chưa đăng được. Xem các điều kiện còn thiếu bên dưới.' },
  nhap: { tone: 'accent', text: 'Đã lưu nháp. Bổ sung đủ điều kiện rồi bấm Đăng món.' },
  'da-luu': { tone: 'ok', text: 'Đã lưu thay đổi.' },
  'da-go': { tone: 'neutral', text: 'Đã gỡ món. Người khác không còn thấy món này.' },
  loi: { tone: 'bad', text: 'Chưa thực hiện được. Thử lại sau ít phút.' },
  'loi-anh': { tone: 'bad', text: 'Chỉ xóa được ảnh khi món đang là nháp hoặc đã gỡ.' },
};

export default function ManageItemPage({ params, searchParams }: PageProps<'/mon-cua-toi/[id]'>) {
  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/mon-cua-toi" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent-ink hover:underline">
        <ArrowLeftIcon size={16} aria-hidden /> Món của tôi
      </Link>
      <Suspense fallback={<div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_320px]"><Skeleton className="h-96" /><Skeleton className="h-72" /></div>}>
        <ManageContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ManageContent({ params, searchParams }: Pick<PageProps<'/mon-cua-toi/[id]'>, 'params' | 'searchParams'>) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireViewer(`/mon-cua-toi/${id}`);
  const item = await getItem({ kind: 'user', id: viewer.id }, id);
  if (!item || item.ownerId !== viewer.id) notFound();

  const [catalog, severity, imei] = await Promise.all([
    getCatalog(),
    withActor({ kind: 'user', id: viewer.id }, async (tx) =>
      (await tx.query<{ s: string | null }>('select banned_keyword_severity($1)::text as s', [`${item.title} ${item.description ?? ''}`])).rows[0].s),
    getItemImei(viewer.id, id),
  ]);
  const meta = ITEM_TYPE_META[item.type];
  const category = item.categoryId ? catalog.categoryById.get(item.categoryId) : undefined;
  const photos = item.media.filter((m) => m.kind === 'photo');
  const proofs = item.media.filter((m) => m.kind === 'proof');
  const canPublish = item.status === 'draft' || item.status === 'removed';
  const canWithdraw = ['draft', 'pending_review', 'active'].includes(item.status);
  const canEdit = ['draft', 'pending_review', 'active', 'removed'].includes(item.status);
  const canDeletePhotos = canPublish;
  const result = typeof sp['ket-qua'] === 'string' ? RESULTS[sp['ket-qua']] : undefined;

  // Điều kiện đăng: khớp với kiểm tra trong publish_item ở database.
  const checks: { ok: boolean; text: string }[] = [];
  if (meta.minPhotos > 0) checks.push({ ok: photos.length >= meta.minPhotos, text: `Ít nhất ${meta.minPhotos} ảnh sản phẩm (đang có ${photos.length})` });
  if (category?.requires_proof) checks.push({ ok: proofs.length > 0, text: 'Ảnh chứng từ hàng hiệu' });
  if (category?.is_phone) checks.push({ ok: Boolean(imei && item.signedOutConfirmed), text: 'IMEI và xác nhận đã thoát iCloud hoặc Google' });
  checks.push({ ok: severity !== 'block', text: 'Tên và mô tả không có từ ngữ bị cấm' });
  const reviewReasons = [
    meta.alwaysReviewed && 'Món loại Khác luôn được admin duyệt trước khi hiển thị.',
    severity === 'flag' && 'Nội dung có từ cần admin xem lại, nên món sẽ chờ duyệt.',
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-5">
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      {item.status === 'removed' && item.reviewNote && <Notice tone="warn" title="Ghi chú của admin">{item.reviewNote}</Notice>}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1.5 flex flex-wrap gap-1.5"><StatusBadge status={item.status} /></div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{item.title}</h1>
          <p className="tabular mt-1 text-lg font-bold text-accent-ink">{formatVnd(item.estValueVnd)}</p>
        </div>
      </div>

      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <Card className="p-5">
            <h2 className="mb-3 text-lg font-bold tracking-tight">Ảnh</h2>
            {item.media.length === 0 ? (
              <div className="aspect-[4/3] max-w-sm overflow-hidden rounded-xl"><TypePlaceholder type={item.type} /></div>
            ) : (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {item.media.map((m, i) => (
                  <li key={m.id} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-surface-2">
                    <MediaImage id={m.id} thumb alt={`${m.kind === 'proof' ? 'Ảnh chứng từ' : 'Ảnh'} ${i + 1} của ${item.title}`} sizes="160px" />
                    {m.kind === 'proof' && <span className="absolute bottom-1 left-1 rounded-full bg-ink/75 px-2 py-0.5 text-[11px] font-semibold text-surface">Chứng từ</span>}
                    {canDeletePhotos && (
                      <form action={deletePhotoAction.bind(null, item.id, m.id)} className="absolute right-1 top-1">
                        <button type="submit" aria-label={`Xóa ảnh ${i + 1}`}
                          className="inline-flex size-8 items-center justify-center rounded-full bg-ink/70 text-surface backdrop-blur transition hover:bg-bad">
                          <TrashIcon size={15} aria-hidden />
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (photos.length < 10 || category?.requires_proof) && (meta.minPhotos > 0 || item.type === 'other' || category?.requires_proof) && (
              <div className="mt-5 border-t border-line pt-5">
                <AddPhotosForm action={addPhotosAction.bind(null, item.id)} remaining={10 - photos.length} allowProof={Boolean(category?.requires_proof)} />
              </div>
            )}
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-lg font-bold tracking-tight">Thông tin</h2>
            <ItemFacts item={item} catalog={catalog} />
            {imei && <p className="mt-3 text-sm text-ink-2">IMEI đầy đủ (chỉ bạn thấy): <span className="tabular font-semibold text-ink">{imei}</span></p>}
          </Card>
        </div>

        <div className="space-y-5 md:sticky md:top-20">
          <Card className="space-y-3 p-5">
            {canPublish && (
              <form action={publishItemAction.bind(null, item.id)}>
                <SubmitButton className="w-full" pendingText="Đang đăng...">Đăng món</SubmitButton>
              </form>
            )}
            {item.status === 'active' && (
              <LinkButton href={`/mon/${item.id}`} variant="secondary" className="w-full"><EyeIcon size={18} aria-hidden /> Xem như người khác</LinkButton>
            )}
            {canEdit && <LinkButton href={`/mon-cua-toi/${item.id}/sua`} variant="secondary" className="w-full"><PencilSimpleIcon size={18} aria-hidden /> Sửa thông tin</LinkButton>}
            {canWithdraw && (
              <form action={withdrawItemAction.bind(null, item.id)}>
                <SubmitButton variant="danger" className="w-full" pendingText="Đang gỡ...">Gỡ món</SubmitButton>
              </form>
            )}
          </Card>
          {canPublish && (
            <Card className="p-5">
              <h2 className="font-semibold">Điều kiện để đăng</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {checks.map((c) => (
                  <li key={c.text} className="flex items-start gap-2">
                    {c.ok ? <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-ok" aria-label="Đạt" />
                      : <XCircleIcon size={20} weight="fill" className="shrink-0 text-bad" aria-label="Chưa đạt" />}
                    <span className={c.ok ? 'text-ink-2' : 'font-semibold text-ink'}>{c.text}</span>
                  </li>
                ))}
                {reviewReasons.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <InfoIcon size={20} weight="fill" className="shrink-0 text-warn" aria-hidden />
                    <span className="text-ink-2">{r}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {item.status === 'pending_review' && (
            <Notice tone="warn" title="Đang chờ duyệt">
              <span className="inline-flex items-start gap-1.5"><WarningCircleIcon size={18} className="mt-0.5 shrink-0" aria-hidden />Admin xem món trong 24 giờ. Bạn vẫn sửa được nội dung trong lúc chờ.</span>
            </Notice>
          )}
        </div>
      </div>
    </div>
  );
}
