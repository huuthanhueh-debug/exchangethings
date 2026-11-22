'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CompassIcon, PackageIcon, PlusCircleIcon, UserCircleIcon } from '@phosphor-icons/react/ssr';
import { cx } from './ui';

// Điều hướng chính. M1 chỉ đặt các mục đã chạy được; Quẹt và Khớp vào ở M2 (wireframe M0).
const LINKS = [
  { href: '/', label: 'Khám phá', Icon: CompassIcon },
  { href: '/dang-mon', label: 'Đăng món', Icon: PlusCircleIcon },
  { href: '/mon-cua-toi', label: 'Món của tôi', Icon: PackageIcon },
  { href: '/ho-so', label: 'Tôi', Icon: UserCircleIcon },
] as const;

function isActive(href: string, pathname: string | null) {
  if (!pathname) return false;
  if (href === '/') return pathname === '/' || pathname.startsWith('/mon/');
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Thanh dưới trên di động. Khi chưa biết đường dẫn (khung tĩnh) thì hiện không đánh dấu mục nào. */
export function BottomNavView({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Điều hướng chính" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {LINKS.map(({ href, label, Icon }) => {
          const active = isActive(href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cx('flex flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-semibold transition-colors',
                  active ? 'text-accent-ink' : 'text-muted hover:text-ink')}
              >
                <Icon size={24} weight={active ? 'fill' : 'regular'} aria-hidden />
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
  return <BottomNavView pathname={usePathname()} />;
}

export function DesktopNavView({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Điều hướng chính" className="hidden items-center gap-1 md:flex">
      {LINKS.slice(0, 3).map(({ href, label }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cx('rounded-full px-3.5 py-2 text-sm font-semibold transition-colors',
              active ? 'bg-accent-soft text-accent-ink' : 'text-ink-2 hover:bg-surface-2 hover:text-ink')}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DesktopNav() {
  return <DesktopNavView pathname={usePathname()} />;
}
