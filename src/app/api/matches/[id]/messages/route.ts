import type { NextRequest } from 'next/server';
import { isCursor, listMessages } from '@/server/chat';
import { isUuid } from '@/server/matches';
import { getSessionUserId } from '@/server/session';

// Tin mới của một cuộc trò chuyện, cho màn chat hỏi lại mỗi vài giây (DECISIONS D-32).
// ?after=<mốc> chỉ trả các tin sau mốc đó. RLS chỉ cho hai người trong match đọc; người khác nhận 404.
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const after = request.nextUrl.searchParams.get('after') ?? undefined;
  if (!isUuid(id) || (after !== undefined && !isCursor(after))) return Response.json({ error: 'not_found' }, { status: 404, headers });
  const userId = await getSessionUserId();
  if (!userId) return Response.json({ error: 'unauthorized' }, { status: 401, headers });
  const messages = await listMessages(userId, id, after);
  if (!messages) return Response.json({ error: 'not_found' }, { status: 404, headers });
  return Response.json({ messages }, { headers });
}
