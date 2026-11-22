'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ITEM_TYPE_META, todayInVietnam } from '@/lib/items';
import { itemFormToObject, validateItem, type FieldErrors } from '@/lib/validation/item';
import { getCatalog } from '@/server/catalog';
import { IMAGE_ERROR_MESSAGE, ImageError, processPhoto, type ProcessedImage } from '@/server/images';
import { createDraftItem, friendlyDbError, publishItem, updateItem } from '@/server/item-service';
import { getViewer } from '@/server/session';

export type ItemFormState = {
  status: 'idle' | 'error';
  errors?: FieldErrors & { photos?: string[]; proof?: string[] };
  message?: string;
};

const MAX_PHOTOS = 10;
const MAX_PROOFS = 2;

const filesOf = (fd: FormData, key: string) => fd.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);

async function processAll(files: File[], label: string) {
  const images: ProcessedImage[] = [];
  const errors: string[] = [];
  for (const [i, file] of files.entries()) {
    try {
      images.push(await processPhoto(new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      errors.push(`${label} ${i + 1}: ${e instanceof ImageError ? e.message : IMAGE_ERROR_MESSAGE.corrupt}`);
    }
  }
  return { images, errors };
}

async function validationContext() {
  const catalog = await getCatalog();
  return { catalog, ctx: { categories: catalog.categories, provinceCodes: new Set(catalog.provinces.map((p) => p.code)), today: todayInVietnam() } };
}

/** Tạo món mới. intent=publish: lưu rồi đăng ngay; intent=draft: chỉ lưu nháp (cho phép thiếu ảnh). */
export async function createItemAction(_prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const viewer = await getViewer();
  if (!viewer) redirect('/dang-nhap?next=/dang-mon');
  if (viewer.banned) return { status: 'error', message: 'Tài khoản của bạn đang bị khóa, chưa đăng món được.' };

  const intent = formData.get('intent') === 'draft' ? 'draft' : 'publish';
  const { catalog, ctx } = await validationContext();
  const v = validateItem(itemFormToObject(formData), ctx);
  const photos = filesOf(formData, 'photos');
  const proofs = filesOf(formData, 'proof');
  const errors: NonNullable<ItemFormState['errors']> = v.ok ? {} : { ...v.errors };
  if (photos.length > MAX_PHOTOS) errors.photos = [`Tối đa ${MAX_PHOTOS} ảnh sản phẩm.`];
  if (proofs.length > MAX_PROOFS) errors.proof = [`Tối đa ${MAX_PROOFS} ảnh chứng từ.`];
  if (v.ok && intent === 'publish') {
    const min = ITEM_TYPE_META[v.value.type].minPhotos;
    if (photos.length < min) errors.photos = [`Cần ít nhất ${min} ảnh sản phẩm để đăng. Muốn bổ sung sau thì bấm Lưu nháp.`];
    if (catalog.categoryById.get(v.value.category_id)?.requires_proof && proofs.length === 0) {
      errors.proof = ['Danh mục hàng hiệu cần ảnh chứng từ để đăng.'];
    }
  }
  if (!v.ok || Object.keys(errors).length > 0) return { status: 'error', errors };

  const p = await processAll(photos, 'Ảnh');
  const q = await processAll(proofs, 'Ảnh chứng từ');
  if (p.errors.length || q.errors.length) {
    return { status: 'error', errors: { ...(p.errors.length && { photos: p.errors }), ...(q.errors.length && { proof: q.errors }) } };
  }

  let itemId: string;
  try {
    itemId = await createDraftItem(viewer.id, v.value, p.images, q.images);
  } catch (e) {
    return { status: 'error', message: friendlyDbError(e) };
  }
  let result = 'nhap';
  if (intent === 'publish') {
    try {
      result = (await publishItem(viewer.id, itemId)) === 'active' ? 'da-dang' : 'cho-duyet';
    } catch {
      result = 'chua-dang'; // trang quản lý món hiện danh sách điều kiện còn thiếu
    }
  }
  revalidatePath('/mon-cua-toi');
  revalidatePath('/');
  redirect(`/mon-cua-toi/${itemId}?ket-qua=${result}`);
}

/** Sửa món (không đổi loại món; ảnh quản lý ở trang món). */
export async function updateItemAction(itemId: string, _prev: ItemFormState, formData: FormData): Promise<ItemFormState> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/dang-nhap?next=/mon-cua-toi/${itemId}/sua`);
  const { ctx } = await validationContext();
  const v = validateItem(itemFormToObject(formData), ctx);
  if (!v.ok) return { status: 'error', errors: v.errors };
  try {
    await updateItem(viewer.id, itemId, v.value);
  } catch (e) {
    return { status: 'error', message: friendlyDbError(e) };
  }
  revalidatePath('/mon-cua-toi');
  revalidatePath(`/mon/${itemId}`);
  revalidatePath('/');
  redirect(`/mon-cua-toi/${itemId}?ket-qua=da-luu`);
}
