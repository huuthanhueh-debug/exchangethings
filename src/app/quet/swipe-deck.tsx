'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsLeftRightIcon, ChatsCircleIcon, HeartIcon, InfoIcon, ShieldCheckIcon, XIcon } from '@phosphor-icons/react/ssr';
import { MediaImage, TypePlaceholder } from '@/components/item-visuals';
import { ATTENTION_EVENT } from '@/components/nav';
import { Badge, LinkButton, Notice, buttonClass, cx } from '@/components/ui';
import { loadDeckAction, swipeAction, type MatchCelebration } from './actions';
import type { CardView } from './card-view';

// Chồng thẻ của màn quẹt (SPEC mục 5.3). Ba cách thao tác tương đương: kéo thẻ, bấm nút, phím mũi tên trái/phải.
// Thẻ rời màn hình ngay (không chờ server); lượt quẹt được ghi ở nền, lỗi thì thẻ quay lại kèm thông báo.

type Direction = 'like' | 'pass';
type Toast = { tone: 'accent' | 'warn' | 'bad'; text: string; href?: string; linkText?: string };
type Drag = { pointer: number; x: number; y: number; dx: number; dy: number; active: boolean };

const SWIPE_OUT_MS = 200;

export function SwipeDeck({ initial, filterParams, pageSize, guestLoginHref }: {
  initial: CardView[];
  filterParams: Record<string, string>;
  pageSize: number;
  /** Có giá trị khi khách chưa đăng nhập đang xem thử: bỏ qua thì lật thẻ tại chỗ, quan tâm thì mời đăng nhập. */
  guestLoginHref?: string;
}) {
  const guest = guestLoginHref !== undefined;
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [exhausted, setExhausted] = useState(guest || initial.length < pageSize);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [celebration, setCelebration] = useState<MatchCelebration | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const topRef = useRef<HTMLDivElement>(null);
  const likeStamp = useRef<HTMLSpanElement>(null);
  const passStamp = useRef<HTMLSpanElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const busy = useRef(false);
  const loading = useRef(false);
  const done = useRef(guest || initial.length < pageSize);
  const seen = useRef<Set<string> | null>(null);
  const decideRef = useRef<(direction: Direction) => void>(() => {});

  const top = cards[0];
  const next = cards[1];

  const loadMore = useCallback(() => {
    if (loading.current || done.current) return;
    loading.current = true;
    void loadDeckAction(filterParams).then((r) => {
      loading.current = false;
      if (!r.ok) return;
      const known = (seen.current ??= new Set(initial.map((c) => c.id)));
      const fresh = r.cards.filter((c) => !known.has(c.id));
      for (const c of fresh) known.add(c.id);
      if (r.cards.length < pageSize || fresh.length === 0) {
        done.current = true;
        setExhausted(true);
      }
      if (fresh.length) setCards((list) => [...list, ...fresh]);
    }, () => { loading.current = false; });
  }, [filterParams, initial, pageSize]);

  // Còn ít thẻ thì lấy lô tiếp theo ở nền.
  useEffect(() => {
    if (cards.length <= 3) loadMore();
  }, [cards.length, loadMore]);

  const commit = useCallback((card: CardView, direction: Direction) => {
    setCards((list) => list.filter((c) => c.id !== card.id));
    setPhotoIndex(0);
    setToast(null);
    setAnnouncement(direction === 'like' ? `Đã quan tâm: ${card.title}` : `Đã bỏ qua: ${card.title}`);
    if (guest) return; // xem thử: không ghi gì lên server
    const putBack = () => setCards((list) => (list.some((c) => c.id === card.id) ? list : [card, ...list]));
    void swipeAction(card.id, direction).then((r) => {
      if (r.ok) {
        if (r.celebration) {
          setCelebration(r.celebration);
          window.dispatchEvent(new Event(ATTENTION_EVENT));
        } else if (r.matched && direction === 'like' && r.matchId) {
          setToast({ tone: 'accent', text: `Bạn và ${card.owner?.name ?? 'người đăng'} đã khớp từ trước.`, href: `/khop/${r.matchId}`, linkText: 'Mở trò chuyện' });
        }
        return;
      }
      if (r.code === 'limit') {
        setLocked(true);
        putBack();
      } else if (r.code === 'auth') {
        putBack();
        setToast({ tone: 'warn', text: r.message, href: '/dang-nhap?next=/quet', linkText: 'Đăng nhập' });
        return;
      } else if (r.code === 'error') {
        putBack();
      }
      setToast({ tone: r.code === 'gone' ? 'accent' : 'warn', text: r.message });
    }, () => {
      putBack();
      setToast({ tone: 'bad', text: 'Mất kết nối, chưa ghi được lượt quẹt. Thử lại nhé.' });
    });
  }, [guest]);

  const resetCard = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.style.transition = 'transform 180ms ease-out';
    el.style.transform = '';
    if (likeStamp.current) likeStamp.current.style.opacity = '0';
    if (passStamp.current) passStamp.current.style.opacity = '0';
  };

  const decide = (direction: Direction, fromDrag?: { dy: number }) => {
    const el = topRef.current;
    if (!top || busy.current || locked || celebration) {
      resetCard(el);
      return;
    }
    if (guestLoginHref !== undefined && direction === 'like') {
      resetCard(el);
      router.push(guestLoginHref);
      return;
    }
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      commit(top, direction);
      return;
    }
    busy.current = true;
    const sign = direction === 'like' ? 1 : -1;
    const stamp = direction === 'like' ? likeStamp.current : passStamp.current;
    if (stamp) stamp.style.opacity = '1';
    el.style.transition = `transform ${SWIPE_OUT_MS}ms ease-out, opacity ${SWIPE_OUT_MS}ms ease-out`;
    el.style.transform = `translate(${sign * el.offsetWidth * 1.3}px, ${fromDrag ? fromDrag.dy * 0.4 : -24}px) rotate(${sign * 16}deg)`;
    el.style.opacity = '0';
    window.setTimeout(() => {
      busy.current = false;
      commit(top, direction);
    }, SWIPE_OUT_MS);
  };

  // Trình nghe phím đăng ký một lần; luôn gọi bản decide mới nhất qua ref.
  useEffect(() => {
    decideRef.current = decide;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], dialog[open], details[open]')) return;
      e.preventDefault();
      decideRef.current(e.key === 'ArrowRight' ? 'like' : 'pass');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Hộp thoại "Khớp rồi!" là modal: đang mở thì phần còn lại của trang bị khóa. Next giữ trang cũ ở trạng thái ẩn
  // khi chuyển trang, nên phải đóng hộp thoại lúc rời màn quẹt, nếu không trang mới sẽ không bấm được gì.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (celebration && dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [celebration]);

  // Kéo thẻ: chỉ bắt đầu khi tay đi ngang rõ ràng, để cuộn dọc trang vẫn tự nhiên (touch-action: pan-y).
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (busy.current || locked || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, active: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = topRef.current;
    if (!d || !el || d.pointer !== e.pointerId) return;
    d.dx = e.clientX - d.x;
    d.dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(d.dx) < 8 || Math.abs(d.dx) < Math.abs(d.dy)) return;
      d.active = true;
      suppressClick.current = true;
      el.setPointerCapture(e.pointerId);
      el.style.transition = 'none';
    }
    el.style.transform = `translate(${d.dx}px, ${d.dy * 0.4}px) rotate(${d.dx / 20}deg)`;
    const strength = Math.min(1, Math.abs(d.dx) / 90);
    if (likeStamp.current) likeStamp.current.style.opacity = d.dx > 0 ? String(strength) : '0';
    if (passStamp.current) passStamp.current.style.opacity = d.dx < 0 ? String(strength) : '0';
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = topRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    if (!d.active || !el) return;
    const threshold = Math.min(130, el.offsetWidth * 0.3);
    if (e.type === 'pointerup' && Math.abs(d.dx) > threshold) decide(d.dx > 0 ? 'like' : 'pass', { dy: d.dy });
    else resetCard(el);
  };
  // Sau một lần kéo, trình duyệt vẫn bắn click: nuốt click đó để không lật ảnh ngoài ý muốn.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const closeCelebration = () => {
    dialogRef.current?.close();
    setCelebration(null);
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>

      {locked && (
        <Notice tone="warn" title="Hết lượt quẹt hôm nay">
          Số lượt quẹt trong 24 giờ có giới hạn. Trong lúc chờ, bạn có thể xem lại các lượt khớp.
        </Notice>
      )}

      {top ? (
        <>
          <div className={cx('relative min-h-[22rem] select-none', guest ? 'h-[min(50dvh,32rem)]' : 'h-[min(56dvh,34rem)]')} aria-label="Chồng thẻ món">
            {next && <CardShell key={next.id} card={next} behind />}
            <CardShell
              key={top.id}
              card={top}
              ref={topRef}
              photoIndex={photoIndex}
              onPhoto={setPhotoIndex}
              likeStamp={likeStamp}
              passStamp={passStamp}
              handlers={{ onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onClickCapture }}
            />
          </div>

          <div className="flex items-start justify-center gap-6">
            <ActionButton label="Bỏ qua" onClick={() => decide('pass')} disabled={locked}>
              <XIcon size={28} weight="bold" aria-hidden />
            </ActionButton>
            <Link href={`/mon/${top.id}`} className="mt-2 flex flex-col items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink">
              <span className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-surface">
                <InfoIcon size={20} aria-hidden />
              </span>
              Chi tiết
            </Link>
            <ActionButton label="Quan tâm" primary onClick={() => decide('like')} disabled={locked}>
              <HeartIcon size={28} weight="fill" aria-hidden />
            </ActionButton>
          </div>
          <p className="hidden text-center text-xs text-muted md:block">Phím ← để bỏ qua, phím → để quan tâm.</p>
        </>
      ) : guestLoginHref !== undefined ? (
        <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <h2 className="text-lg font-bold">Đăng nhập để quẹt tiếp</h2>
          <p className="mx-auto mt-1 max-w-[36ch] text-[15px] leading-relaxed text-ink-2">
            Bạn vừa xem thử vài món mới nhất. Đăng nhập để thấy món hợp với bạn, quan tâm và khớp với người đăng.
          </p>
          <LinkButton href={guestLoginHref} className="mt-5">Đăng nhập</LinkButton>
        </div>
      ) : exhausted ? (
        <EmptyDeck filtered={Object.keys(filterParams).length > 0} />
      ) : (
        <div className="h-[min(56dvh,34rem)] min-h-[22rem] animate-pulse rounded-2xl bg-surface-2" role="status" aria-label="Đang tìm thêm món" />
      )}

      {toast && (
        <Notice tone={toast.tone}>
          {toast.text}{' '}
          {toast.href && <Link href={toast.href} className="font-semibold underline underline-offset-2">{toast.linkText}</Link>}
        </Notice>
      )}

      <dialog
        ref={dialogRef}
        onClose={() => setCelebration(null)}
        aria-labelledby="khop-roi"
        className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-surface p-6 text-ink shadow-card backdrop:bg-black/60"
      >
        {celebration && (
          <div className="match-pop text-center">
            <p className="mx-auto inline-flex size-14 items-center justify-center rounded-full bg-accent text-on-accent">
              <HeartIcon size={30} weight="fill" aria-hidden />
            </p>
            <h2 id="khop-roi" className="mt-3 text-2xl font-bold tracking-tight">Khớp rồi!</h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
              Bạn và {celebration.otherName} đều quan tâm món của nhau. Nhắn tin để bàn chuyện đổi.
            </p>
            <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
              <CelebrationItem label="Món của bạn" item={celebration.myItem} className="match-from-left" />
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                <ArrowsLeftRightIcon size={18} weight="bold" aria-hidden />
              </span>
              <CelebrationItem label={`Món của ${celebration.otherName}`} item={celebration.theirItem} className="match-from-right" />
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <LinkButton href={`/khop/${celebration.matchId}`} size="lg" autoFocus onClick={closeCelebration}>
                <ChatsCircleIcon size={20} weight="bold" aria-hidden /> Nhắn tin
              </LinkButton>
              <button type="button" onClick={closeCelebration} className={buttonClass('ghost', 'md')}>Quẹt tiếp</button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}

function ActionButton({ label, primary, children, ...props }: React.ComponentProps<'button'> & { label: string; primary?: boolean }) {
  return (
    <button type="button" className="group flex flex-col items-center gap-1 text-xs font-semibold text-ink-2 disabled:opacity-50" {...props}>
      <span className={cx(
        'inline-flex size-16 items-center justify-center rounded-full border shadow-card transition group-active:scale-95',
        primary ? 'border-accent bg-accent text-on-accent group-hover:brightness-110' : 'border-line bg-surface text-ink-2 group-hover:text-bad',
      )}>
        {children}
      </span>
      {label}
    </button>
  );
}

type CardHandlers = Pick<React.ComponentProps<'div'>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onClickCapture'>;

function CardShell({ card, behind, ref, photoIndex = 0, onPhoto, likeStamp, passStamp, handlers }: {
  card: CardView;
  behind?: boolean;
  ref?: React.Ref<HTMLDivElement>;
  photoIndex?: number;
  onPhoto?: (index: number) => void;
  likeStamp?: React.Ref<HTMLSpanElement>;
  passStamp?: React.Ref<HTMLSpanElement>;
  handlers?: CardHandlers;
}) {
  const photos = card.photoIds;
  const index = Math.min(photoIndex, Math.max(0, photos.length - 1));
  const wants = card.wants.slice(0, 3);
  return (
    <article
      ref={ref}
      {...handlers}
      aria-hidden={behind || undefined}
      aria-label={behind ? undefined : card.owner ? `${card.title} của ${card.owner.name}` : card.title}
      inert={behind || undefined}
      className={cx(
        'absolute inset-0 flex touch-pan-y flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card',
        behind ? 'translate-y-2 scale-[0.96] opacity-70' : 'cursor-grab transition-transform duration-200 active:cursor-grabbing',
      )}
    >
      <div className="relative min-h-0 flex-1 bg-surface-2">
        {photos.length ? (
          <MediaImage id={photos[index]} thumb={behind} alt={behind ? '' : `${card.title}, ảnh ${index + 1}/${photos.length}`}
            sizes="(min-width: 640px) 384px, 100vw" priority={!behind} className="pointer-events-none" />
        ) : (
          <TypePlaceholder type={card.type} />
        )}
        {!behind && photos.length > 1 && (
          <>
            <div className="absolute inset-x-3 top-2 flex gap-1" aria-hidden>
              {photos.map((id, i) => <span key={id} className={cx('h-1 flex-1 rounded-full', i === index ? 'bg-white' : 'bg-white/45')} />)}
            </div>
            <button type="button" aria-label="Ảnh trước" disabled={index === 0} onClick={() => onPhoto?.(index - 1)}
              className="absolute inset-y-0 left-0 w-2/5 disabled:cursor-default" />
            <button type="button" aria-label="Ảnh sau" disabled={index === photos.length - 1} onClick={() => onPhoto?.(index + 1)}
              className="absolute inset-y-0 right-0 w-2/5 disabled:cursor-default" />
          </>
        )}
        {card.score !== null && (
          <div className="pointer-events-none absolute left-3 top-5 flex gap-1.5">
            <Badge tone="accent" className="shadow-sm">Hợp {card.score}%</Badge>
          </div>
        )}
        {!behind && (
          <>
            <span ref={likeStamp} aria-hidden style={{ opacity: 0 }}
              className="pointer-events-none absolute left-4 top-14 -rotate-12 rounded-xl border-[3px] border-ok bg-surface/90 px-3 py-1 text-lg font-bold uppercase tracking-wide text-ok">
              Quan tâm
            </span>
            <span ref={passStamp} aria-hidden style={{ opacity: 0 }}
              className="pointer-events-none absolute right-4 top-14 rotate-12 rounded-xl border-[3px] border-bad bg-surface/90 px-3 py-1 text-lg font-bold uppercase tracking-wide text-bad">
              Bỏ qua
            </span>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="line-clamp-2 min-w-0 text-lg font-bold leading-snug tracking-tight text-ink">{card.title}</h2>
          <p className="tabular shrink-0 pt-0.5 text-[15px] font-bold text-accent-ink">{card.value}</p>
        </div>
        <p className="truncate text-sm text-ink-2">{card.meta.join(' · ')}</p>
        <p className="flex items-center gap-1.5 text-sm text-ink-2">
          <ShieldCheckIcon size={16} className="shrink-0 text-accent-ink" aria-hidden />
          {card.owner ? (
            <span className="truncate">{card.owner.name} · {card.owner.tier} · <span className="tabular">{card.owner.trustScore}</span> điểm uy tín</span>
          ) : (
            <>
              {/* Chỉ là hình mờ trang trí: tên và điểm uy tín thật không được gửi tới trình duyệt của khách. */}
              <span className="shrink-0 select-none whitespace-nowrap blur-[4px]" aria-hidden>Thành viên</span>
              <span className="truncate text-muted">Đăng nhập để xem người đăng</span>
            </>
          )}
        </p>
        {wants.length > 0 && (
          <div className="flex max-h-[1.375rem] flex-wrap items-center gap-x-1.5 gap-y-2 overflow-hidden">
            <span className="text-xs font-semibold text-muted">Muốn đổi lấy</span>
            {wants.map((w) => <Badge key={w} className="max-w-[10rem]"><span className="truncate">{w}</span></Badge>)}
          </div>
        )}
        {card.reasons.length > 0 && (
          <p className="flex items-start gap-1.5 text-sm font-semibold leading-snug text-ok">
            <HeartIcon size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
            <span className="line-clamp-2">{card.reasons[0]}</span>
          </p>
        )}
        {card.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {card.tags.slice(0, 2).map((t) => <Badge key={t.text} tone={t.tone}>{t.text}</Badge>)}
          </div>
        )}
      </div>
    </article>
  );
}

function CelebrationItem({ label, item, className }: { label: string; item: MatchCelebration['myItem']; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="relative mx-auto aspect-square w-full max-w-[7.5rem] overflow-hidden rounded-2xl border border-line bg-surface-2">
        {item?.coverMediaId
          ? <MediaImage id={item.coverMediaId} thumb alt="" sizes="120px" />
          : <div className="flex size-full items-center justify-center bg-accent-soft text-accent-ink"><ArrowsLeftRightIcon size={28} aria-hidden /></div>}
      </div>
      <p className="mt-2 text-xs font-semibold text-muted">{label}</p>
      <p className="line-clamp-2 text-sm font-semibold text-ink">{item?.title ?? 'Món không còn hiển thị'}</p>
    </div>
  );
}

function EmptyDeck({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
      <p className="mx-auto inline-flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <HeartIcon size={24} aria-hidden />
      </p>
      <h2 className="mt-3 text-lg font-bold">{filtered ? 'Không còn món nào khớp bộ lọc' : 'Bạn đã xem hết món hiện có'}</h2>
      <p className="mx-auto mt-1 max-w-[36ch] text-[15px] leading-relaxed text-ink-2">
        {filtered ? 'Thử nới bộ lọc để thấy thêm món.' : 'Món mới được đăng mỗi ngày. Trong lúc chờ, đăng thêm món để tăng cơ hội khớp.'}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {filtered && <LinkButton href="/quet">Bỏ bộ lọc</LinkButton>}
        <LinkButton href="/dang-mon" variant={filtered ? 'secondary' : 'primary'}>Đăng món</LinkButton>
        <LinkButton href="/khop" variant="secondary">Xem lượt khớp</LinkButton>
      </div>
    </div>
  );
}
