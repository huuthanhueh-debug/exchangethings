'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useSyncExternalStore } from 'react';
import { CardsIcon, ChatsCircleIcon, PackageIcon, PlusCircleIcon, UserCircleIcon } from '@phosphor-icons/react/ssr';
import { cx } from './ui';

// Điều hướng chính theo wireframe M0: Quẹt, Khớp, Đăng món, Món của tôi, Tôi. Trang chủ (Khám phá) mở bằng logo.
// Mục "Giao dịch" trong wireframe vào ở M4.
const LINKS = [
  { href: '/quet', label: 'Quẹt', Icon: CardsIcon },
  { href: '/khop', label: 'Khớp', Icon: ChatsCircleIcon },
  { href: '/dang-mon', label: 'Đăng món', Icon: PlusCircleIcon },
  { href: '/mon-cua-toi', label: 'Món của tôi', Icon: PackageIcon },
  { href: '/ho-so', label: 'Tôi', Icon: UserCircleIcon },
] as const;

function isActive(href: string, pathname: string | null) {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Phát sự kiện này sau khi khớp mới hoặc đọc xong tin để chấm báo cập nhật ngay, không chờ lượt hỏi kế tiếp. */
export const ATTENTION_EVENT = 'et:attention';
const POLL_MS = 30_000;

// Số cuộc trò chuyện cần xem (mới khớp, hoặc có tin chưa đọc). Thanh điều hướng nằm trong layout nên không được
// vẽ lại khi chuyển trang; kho nhỏ này hỏi /api/me/attention khi đổi trang, khi quay lại tab, và mỗi 30 giây.
// Thanh trên và thanh dưới dùng chung một kho nên chỉ có một vòng hỏi. Chưa đăng nhập thì dừng hỏi.
const attention = {
  count: 0,
  listeners: new Set<() => void>(),
  timer: undefined as number | undefined,
  async check() {
    window.clearTimeout(attention.timer);
    if (attention.listeners.size === 0 || document.visibilityState !== 'visible') return;
    let again = true;
    try {
      const r = await fetch('/api/me/attention', { cache: 'no-store' });
      const data: { signedIn?: boolean; count?: number } = r.ok ? await r.json() : {};
      const next = typeof data.count === 'number' ? data.count : 0;
      again = data.signedIn === true || !r.ok;
      if (next !== attention.count) {
        attention.count = next;
        for (const notify of attention.listeners) notify();
      }
    } catch {
      // Mất mạng: giữ số cũ, lượt sau thử lại.
    }
    window.clearTimeout(attention.timer);
    if (again && attention.listeners.size > 0) attention.timer = window.setTimeout(attention.check, POLL_MS);
  },
  subscribe(notify: () => void) {
    const wake = () => void attention.check();
    if (attention.listeners.size === 0) {
      document.addEventListener('visibilitychange', wake);
      window.addEventListener(ATTENTION_EVENT, wake);
      attention.stop = () => {
        window.clearTimeout(attention.timer);
        document.removeEventListener('visibilitychange', wake);
        window.removeEventListener(ATTENTION_EVENT, wake);
      };
    }
    attention.listeners.add(notify);
    return () => {
      attention.listeners.delete(notify);
      if (attention.listeners.size === 0) attention.stop();
    };
  },
  stop: () => {},
};

function useAttentionCount(pathname: string | null): number {
  const count = useSyncExternalStore(attention.subscribe, () => attention.count, () => 0);
  useEffect(() => {
    void attention.check();
  }, [pathname]);
  return count;
}

function CountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cx('tabular inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-bad px-1 text-[10px] font-bold leading-[1.125rem] text-surface', className)}>
      {count > 9 ? '9+' : count}
      <span className="sr-only"> cuộc trò chuyện cần xem</span>
    </span>
  );
}

/** Thanh dưới trên di động. Khi chưa biết đường dẫn (khung tĩnh) thì hiện không đánh dấu mục nào. */
export function BottomNavView({ pathname, attention = 0 }: { pathname: string | null; attention?: number }) {
  return (
    <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {LINKS.map(({ href, label, Icon }) => {
          const active = isActive(href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx('flex flex-col items-center gap-0.5 whitespace-nowrap pb-2 pt-2.5 text-[11px] font-semibold transition-colors',
                  active ? 'text-accent-ink' : 'text-muted hover:text-ink')}
              >
                <span className="relative">
                  <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
                  {href === '/khop' && <CountBadge count={attention} className="absolute -right-2.5 -top-1" />}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  return <BottomNavView pathname={pathname} attention={useAttentionCount(pathname)} />;
}

export function DesktopNavView({ pathname, attention = 0 }: { pathname: string | null; attention?: number }) {
  return (
    <nav aria-label="Điều hướng chính" className="hidden items-center gap-1 md:flex">
      {LINKS.slice(0, 4).map(({ href, label }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx('inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors',
              active ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
          >
            {label}
            {href === '/khop' && <CountBadge count={attention} />}
          </Link>
        );
      })}
    </nav>
  );
}

export function DesktopNav() {
  const pathname = usePathname();
  return <DesktopNavView pathname={pathname} attention={useAttentionCount(pathname)} />;
}
