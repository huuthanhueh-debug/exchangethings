'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { IMAGE_ERROR_MESSAGE, ImageError, processPhoto, type ProcessedImage } from '@/server/images';
import { ItemActionError, addItemMedia, deleteItemMedia, publishItem, withdrawItem } from '@/server/item-service';
import { getViewer } from '@/server/session';

/** seq tăng sau mỗi lần tải thành công, để form làm mới ô chọn ảnh. */
export type PhotoState = { status: 'idle' | 'saved' | 'error'; message?: string; seq: number };

async function requireUserId(next: string) {
  const viewer = await getViewer();
  if (!viewer) redirect(`/dang-nhap?next=${encodeURIComponent(next)}`);
  return viewer.id;
}

function refresh(itemId: string) {
  revalidatePath('/mon-cua-toi');
  revalidatePath(`/mon-cua-toi/${itemId}`);
  revalidatePath(`/mon/${itemId}`);
  revalidatePath('/');
}

export async function publishItemAction(itemId: string) {
  const userId = await requireUserId(`/mon-cua-toi/${itemId}`);
  let result: string;
  try {
    result = (await publishItem(userId, itemId)) === 'active' ? 'da-dang' : 'cho-duyet';
  } catch {
    result = 'chua-dang';
  }
  refresh(itemId);
  redirect(`/mon-cua-toi/${itemId}?ket-qua=${result}`);
}

export async function withdrawItemAction(itemId: string) {
  const userId = await requireUserId(`/mon-cua-toi/${itemId}`);
  let result = 'da-go';
  try {
    await withdrawItem(userId, itemId);
  } catch {
    result = 'loi';
  }
  refresh(itemId);
  redirect(`/mon-cua-toi/${itemId}?ket-qua=${result}`);
}

export async function addPhotosAction(itemId: string, prev: PhotoState, formData: FormData): Promise<PhotoState> {
  const userId = await requireUserId(`/mon-cua-toi/${itemId}`);
  const pick = (key: string) => formData.getAll(key).filter((v): v is File => v instanceof File && v.size > 0);
  const photos = pick('photos');
  const proofs = pick('proof');
  if (photos.length + proofs.length === 0) return { status: 'error', message: 'Chọn ít nhất một ảnh.', seq: prev.seq };
  if (proofs.length > 2) return { status: 'error', message: 'Tối đa 2 ảnh chứng từ mỗi lần.', seq: prev.seq };
  const toImages = async (files: File[]) => {
    const out: ProcessedImage[] = [];
    for (const f of files) out.push(await processPhoto(new Uint8Array(await f.arrayBuffer())));
    return out;
  };
  try {
    await addItemMedia(userId, itemId, await toImages(photos), await toImages(proofs));
  } catch (e) {
    const message = e instanceof ImageError ? e.message : e instanceof ItemActionError ? e.message : IMAGE_ERROR_MESSAGE.corrupt;
    return { status: 'error', message, seq: prev.seq };
  }
  refresh(itemId);
  return { status: 'saved', seq: prev.seq + 1 };
}

export async function deletePhotoAction(itemId: string, mediaId: string) {
  const userId = await requireUserId(`/mon-cua-toi/${itemId}`);
  let ok = true;
  try {
    await deleteItemMedia(userId, mediaId);
  } catch {
    ok = false;
  }
  refresh(itemId);
  // Chỉ đưa mã kết quả cố định lên URL, không đưa câu chữ: tránh link giả mạo chèn nội dung lên trang.
  if (!ok) redirect(`/mon-cua-toi/${itemId}?ket-qua=loi-anh`);
}
