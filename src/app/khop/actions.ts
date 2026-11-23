'use server';

import { MAX_MESSAGE_LENGTH, friendlyChatError, isCursor, markMatchRead, sendMessage, type ChatMessage } from '@/server/chat';
import { isUuid } from '@/server/matches';
import { getViewer } from '@/server/session';

// Server Action của màn chat. Mỗi action tự kiểm tra phiên. Quyền gửi (chỉ hai người trong match), giới hạn
// tần suất và việc che thông tin liên lạc nằm trong hàm send_message của database.

export type SendOutcome = { ok: true; message: ChatMessage } | { ok: false; message: string };

export async function sendMessageAction(matchId: string, body: string): Promise<SendOutcome> {
  if (!isUuid(matchId) || typeof body !== 'string') return { ok: false, message: 'Yêu cầu không hợp lệ.' };
  // Chặn sớm tin quá dài để không đưa cả khối chữ lớn vào database; giới hạn chính thức vẫn ở send_message.
  if (body.length > MAX_MESSAGE_LENGTH * 4) return { ok: false, message: `Tin nhắn dài quá ${MAX_MESSAGE_LENGTH.toLocaleString('vi-VN')} ký tự.` };
  const viewer = await getViewer();
  if (!viewer) return { ok: false, message: 'Phiên đăng nhập đã hết. Tải lại trang để đăng nhập.' };
  try {
    return { ok: true, message: await sendMessage(viewer.id, matchId, body) };
  } catch (e) {
    return { ok: false, message: friendlyChatError(e) };
  }
}

/** Đánh dấu đã đọc tới tin cuối đang hiện trên màn hình. Lỗi thì bỏ qua: lần mở sau sẽ đánh dấu lại. */
export async function markReadAction(matchId: string, upTo: string | null): Promise<void> {
  if (!isUuid(matchId) || (upTo !== null && !isCursor(upTo))) return;
  const viewer = await getViewer();
  if (!viewer) return;
  try {
    await markMatchRead(viewer.id, matchId, upTo ?? undefined);
  } catch {
    // Không thuộc match hoặc lỗi tạm thời: không có gì để báo cho người dùng.
  }
}
