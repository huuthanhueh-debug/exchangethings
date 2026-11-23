'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { PaperPlaneRightIcon, ShieldCheckIcon } from '@phosphor-icons/react/ssr';
import { ATTENTION_EVENT } from '@/components/nav';
import { Notice, cx } from '@/components/ui';
import { formatDateVi, formatTimeVn, vnDayKey } from '@/lib/format';
import type { ChatMessage } from '@/server/chat';
import { markReadAction, sendMessageAction } from '../actions';

// Màn chat của một match. Tin mới được hỏi lại từ server mỗi 3 giây khi tab đang mở (DECISIONS D-32);
// tab ẩn thì dừng, hiện lại thì hỏi ngay. Tin gửi đi hiện theo bản server trả về, vì server có thể đã che
// số điện thoại, số tài khoản hoặc liên kết.

const POLL_MS = 3000;
const MAX_LENGTH = 1000;

/** Gộp tin mới vào danh sách, bỏ tin trùng, giữ thứ tự thời gian. */
function merge(list: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const known = new Set(list.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (fresh.length === 0) return list;
  return [...list, ...fresh].sort((a, b) => (a.cursor < b.cursor ? -1 : a.cursor > b.cursor ? 1 : a.id < b.id ? -1 : 1));
}

export function Chat({ matchId, initial, otherName }: { matchId: string; initial: ChatMessage[]; otherName: string }) {
  const [messages, setMessages] = useState(initial);
  const [length, setLength] = useState(0);
  const [closed, setClosed] = useState(false);
  const cursor = useRef(initial.at(-1)?.cursor);
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const scrollToEnd = useCallback((smooth: boolean) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    bottom.current?.scrollIntoView({ block: 'end', behavior: smooth && !reduce ? 'smooth' : 'auto' });
  }, []);

  const markRead = useCallback(() => {
    void markReadAction(matchId, cursor.current ?? null).then(() => window.dispatchEvent(new Event(ATTENTION_EVENT)));
  }, [matchId]);

  const receive = useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return;
    const last = incoming.reduce((a, b) => (a.cursor > b.cursor ? a : b));
    if (!cursor.current || last.cursor > cursor.current) cursor.current = last.cursor;
    const nearEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
    setMessages((list) => merge(list, incoming));
    if (incoming.some((m) => !m.mine)) markRead();
    if (nearEnd || incoming.some((m) => m.mine)) window.requestAnimationFrame(() => scrollToEnd(true));
  }, [markRead, scrollToEnd]);

  // Mở chat: xuống tin mới nhất và đánh dấu đã đọc.
  useEffect(() => {
    scrollToEnd(false);
    markRead();
  }, [markRead, scrollToEnd]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    const tick = async () => {
      window.clearTimeout(timer);
      if (stopped || document.visibilityState !== 'visible') return;
      controller = new AbortController();
      try {
        const query = cursor.current ? `?after=${encodeURIComponent(cursor.current)}` : '';
        const r = await fetch(`/api/matches/${matchId}/messages${query}`, { cache: 'no-store', signal: controller.signal });
        if (stopped) return;
        if (r.ok) {
          const data: { messages?: ChatMessage[] } = await r.json();
          if (!stopped && data.messages?.length) receive(data.messages);
        } else if (r.status === 401 || r.status === 404) {
          // Hết phiên, hoặc cuộc trò chuyện không còn (ví dụ một bên đã chặn): dừng hỏi.
          stopped = true;
          setClosed(true);
          return;
        }
      } catch {
        // Mất mạng tạm thời: lượt sau thử lại.
      }
      if (!stopped) timer = window.setTimeout(tick, POLL_MS);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void tick(); };
    timer = window.setTimeout(tick, POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [matchId, receive]);

  const resize = () => {
    const el = field.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    setLength(el.value.length);
  };

  // Gửi bằng form action của React: bấm gửi trước khi trang nạp xong vẫn được ghi nhận và chạy lại sau.
  // Sau mỗi lượt React đặt ô nhập về defaultValue: gửi được thì trống, lỗi thì giữ nguyên chữ đã gõ.
  const [form, send, sending] = useActionState(async (_prev: { error: string | null; draft: string }, data: FormData) => {
    const text = String(data.get('body') ?? '').trim();
    if (!text || closed) return { error: null, draft: text };
    let outcome: Awaited<ReturnType<typeof sendMessageAction>>;
    try {
      outcome = await sendMessageAction(matchId, text);
    } catch {
      outcome = { ok: false, message: 'Mất kết nối, chưa gửi được tin. Thử lại nhé.' };
    }
    if (!outcome.ok) return { error: outcome.message, draft: text };
    if (field.current) field.current.style.height = 'auto';
    setLength(0);
    receive([outcome.message]);
    return { error: null, draft: '' };
  }, { error: null, draft: '' });

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Bàn phím thật: Enter gửi, Shift+Enter xuống dòng. Màn cảm ứng: Enter xuống dòng, bấm nút để gửi.
    // Đang gõ dở bộ gõ tiếng Việt (isComposing) thì không gửi.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  };

  return (
    <div className="flex min-h-[calc(100dvh-21rem)] flex-col">
      <ol className="flex-1 space-y-1.5 py-4" aria-label={`Tin nhắn với ${otherName}`}>
        {messages.length === 0 && (
          <li className="py-10 text-center text-[15px] text-ink-2">Hai bạn vừa khớp. Gửi lời chào để bắt đầu.</li>
        )}
        {messages.map((m, i) => {
          const day = vnDayKey(m.at);
          const showDay = i === 0 || vnDayKey(messages[i - 1].at) !== day;
          return (
            <li key={m.id}>
              {showDay && <p className="tabular py-3 text-center text-xs font-semibold text-muted">{formatDateVi(day)}</p>}
              <div className={cx('flex', m.mine ? 'justify-end' : 'justify-start')}>
                <div className={cx('max-w-[82%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed',
                  m.mine ? 'rounded-br-md bg-accent text-on-accent' : 'rounded-bl-md border border-line bg-surface text-ink')}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={cx('tabular mt-0.5 text-right text-[11px]', m.mine ? 'text-on-accent/80' : 'text-muted')}>
                    <span className="sr-only">{m.mine ? 'Bạn gửi lúc ' : `${otherName} gửi lúc `}</span>{formatTimeVn(m.at)}
                  </p>
                </div>
              </div>
              {m.masked && (
                <p className={cx('mt-1 flex items-center gap-1 text-xs text-muted', m.mine ? 'justify-end' : 'justify-start')}>
                  <ShieldCheckIcon size={14} aria-hidden />
                  {m.mine ? 'Thông tin liên lạc trong tin này đã được ẩn.' : 'Thông tin liên lạc đã được ẩn.'}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div ref={bottom} aria-hidden />

      <div className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-line bg-canvas/95 px-4 pb-3 pt-3 backdrop-blur md:bottom-0 md:mx-0 md:px-0">
        {closed && <Notice tone="warn">Cuộc trò chuyện này không còn nhận tin. Tải lại trang để kiểm tra.</Notice>}
        {form.error && <div className="mb-2"><Notice tone="bad">{form.error}</Notice></div>}
        <form action={send} className="flex items-end gap-2">
          <label htmlFor="tin-nhan" className="sr-only">Tin nhắn gửi {otherName}</label>
          <textarea
            ref={field}
            id="tin-nhan"
            name="body"
            rows={1}
            defaultValue={form.draft}
            maxLength={MAX_LENGTH}
            disabled={closed}
            onInput={resize}
            onKeyDown={onKeyDown}
            placeholder="Nhắn tin..."
            enterKeyHint="send"
            autoComplete="off"
            className="block max-h-[8.25rem] min-h-11 w-full min-w-0 resize-none rounded-2xl border border-line bg-surface px-4 py-2.5 text-[15px] text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={sending || closed}
            aria-label="Gửi tin"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent shadow-sm transition hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <PaperPlaneRightIcon size={20} weight="fill" aria-hidden />
          </button>
        </form>
        {length > MAX_LENGTH - 100 && (
          <p className="tabular mt-1 text-right text-xs text-muted">{length}/{MAX_LENGTH}</p>
        )}
      </div>
    </div>
  );
}
