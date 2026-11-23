import type { NextRequest } from 'next/server';
import { getWards } from '@/server/catalog';

// Danh sách phường/xã của một tỉnh/thành cho form hồ sơ. Dữ liệu công khai, chỉ đổi theo migration.
export async function GET(request: NextRequest) {
  const province = request.nextUrl.searchParams.get('province') ?? '';
  if (!/^\d{2}$/.test(province)) return Response.json({ error: 'province phải là mã 2 chữ số' }, { status: 400 });
  const wards = await getWards(province);
  if (wards.length === 0) return Response.json({ error: 'không có tỉnh/thành này' }, { status: 404 });
  return Response.json(wards, { headers: { 'Cache-Control': 'public, max-age=86400' } });
}
