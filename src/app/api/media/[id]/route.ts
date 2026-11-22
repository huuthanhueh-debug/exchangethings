import type { NextRequest } from 'next/server';
import { withActor } from '@/server/db';
import { getSessionUserId } from '@/server/session';
import { storage, thumbPathOf } from '@/server/storage';

// Trả ảnh món sau khi RLS cho phép đọc dòng item_media tương ứng:
// ảnh sản phẩm của món đang hiển thị ai cũng xem được; ảnh chứng từ chỉ chủ món và admin.
// ?v=thumb trả bản thu nhỏ 480px (thiếu thì dùng ảnh chính). Supabase: chuyển hướng tới signed URL 10 phút. Local: trả thẳng tệp.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response('Không tìm thấy ảnh.', { status: 404 });
  const userId = await getSessionUserId();
  const row = await withActor(userId ? { kind: 'user', id: userId } : { kind: 'anon' }, async (tx) => {
    const r = await tx.query<{ storage_path: string }>('select storage_path from item_media where id = $1', [id]);
    return r.rows[0];
  });
  if (!row) return new Response('Không tìm thấy ảnh.', { status: 404 });
  const wantThumb = request.nextUrl.searchParams.get('v') === 'thumb';
  const file = (wantThumb ? await storage().resolve('item-media', thumbPathOf(row.storage_path)) : null)
    ?? await storage().resolve('item-media', row.storage_path);
  if (!file) return new Response('Không tìm thấy ảnh.', { status: 404 });
  const headers = { 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
  if (file.kind === 'redirect') return new Response(null, { status: 302, headers: { ...headers, Location: file.url } });
  return new Response(new Uint8Array(file.data), { headers: { ...headers, 'Content-Type': file.contentType } });
}
