import 'server-only';
import { withActor } from './db';
import { isUuid } from './matches';

// Tin nhắn trong một match. Đọc dưới quyền người xem (RLS: chỉ hai người trong match).
// Gửi qua hàm send_message của database: giới hạn tần suất và che thông tin liên lạc nằm ở đó,
// nên không có đường nào ghi tin mà bỏ qua được hai bước này.

export type ChatMessage = {
  id: string;
  mine: boolean;
  body: string;
  /** Tin đã bị che số điện thoại, số tài khoản, liên kết hoặc email. */
  masked: boolean;
  at: string;
  /** Mốc thời gian chính xác tới micro giây, dùng để hỏi "tin sau mốc này". */
  cursor: string;
};

export const MAX_MESSAGE_LENGTH = 1000;
const PAGE = 200;
const CURSOR = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
export const isCursor = (v: unknown): v is string => typeof v === 'string' && CURSOR.test(v);

const COLUMNS = `x.id, x.sender_id = auth.uid() as mine, x.body, x.masked, x.created_at,
  to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor`;
type Row = { id: string; mine: boolean; body: string | null; masked: boolean; created_at: Date; cursor: string };
const toMessage = (r: Row): ChatMessage => ({ id: r.id, mine: r.mine, body: r.body ?? '', masked: r.masked, at: r.created_at.toISOString(), cursor: r.cursor });

/**
 * Tin của một match theo thứ tự cũ tới mới. Không có `after`: 200 tin gần nhất. Có `after`: các tin sau mốc đó.
 * Trả null khi người xem không thuộc match (hoặc match không tồn tại).
 */
export function listMessages(userId: string, matchId: string, after?: string): Promise<ChatMessage[] | null> {
  if (!isUuid(matchId) || (after !== undefined && !isCursor(after))) return Promise.resolve(null);
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const visible = await tx.query('select 1 from matches where id = $1', [matchId]);
    if (visible.rowCount === 0) return null;
    const r = after
      ? await tx.query<Row>(
        `select ${COLUMNS} from messages x where x.match_id = $1 and x.created_at > $2::timestamptz
          order by x.created_at, x.id limit $3`, [matchId, after, PAGE])
      : await tx.query<Row>(
        `select * from (select ${COLUMNS} from messages x where x.match_id = $1 order by x.created_at desc, x.id desc limit $2) t
          order by created_at, id`, [matchId, PAGE]);
    return r.rows.map(toMessage);
  });
}

export function sendMessage(userId: string, matchId: string, body: string): Promise<ChatMessage> {
  return withActor({ kind: 'user', id: userId }, async (tx) => {
    const r = await tx.query<Row>(
      `select ${COLUMNS} from send_message($1, $2) as x`, [matchId, body]);
    return toMessage(r.rows[0]);
  });
}

/** Đánh dấu đã đọc tới mốc của tin cuối đang hiện; không có tin nào thì tới hiện tại (để tắt nhãn "mới khớp"). */
export async function markMatchRead(userId: string, matchId: string, upTo?: string): Promise<void> {
  await withActor({ kind: 'user', id: userId }, (tx) =>
    tx.query('select mark_match_read($1, $2::timestamptz)', [matchId, upTo ?? null]));
}

const DB_MESSAGES: [RegExp, string][] = [
  [/daily message limit reached/, 'Bạn đã gửi hết số tin nhắn của hôm nay. Quay lại sau nhé.'],
  [/cannot message this user/, 'Không gửi được tin cho người này.'],
  [/message is empty/, 'Tin nhắn đang trống.'],
  [/message is too long/, `Tin nhắn dài quá ${MAX_MESSAGE_LENGTH.toLocaleString('vi-VN')} ký tự.`],
  [/match not found/, 'Không tìm thấy cuộc trò chuyện.'],
  [/sign in to send messages/, 'Tài khoản chưa gửi tin được. Đăng nhập lại rồi thử lần nữa.'],
];

export function friendlyChatError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [re, text] of DB_MESSAGES) if (re.test(msg)) return text;
  return 'Chưa gửi được tin. Thử lại sau ít phút.';
}
