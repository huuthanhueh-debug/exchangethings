import { countAttentionMatches } from '@/server/matches';
import { getSessionUserId } from '@/server/session';

// Số cuộc trò chuyện cần xem (mới khớp chưa mở, hoặc có tin chưa đọc) cho chấm đỏ trên mục "Khớp".
// Thanh điều hướng nằm trong layout nên không tự vẽ lại khi chuyển trang; trình duyệt hỏi lại route này.
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ signedIn: false, count: 0 }, { headers });
  return Response.json({ signedIn: true, count: await countAttentionMatches(userId) }, { headers });
}
