import Link from 'next/link';
import { Suspense } from 'react';
import { ArrowsLeftRightIcon } from '@phosphor-icons/react/ssr';
import { getViewer } from '@/server/session';
import { DesktopNav, DesktopNavView } from './nav';
import { ThemeToggle } from './theme-toggle';
import { LinkButton } from './ui';

export function Logo() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2 font-bold tracking-tight text-ink" aria-label="Exchangethings.vn, về trang chủ">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent">
        <ArrowsLeftRightIcon size={18} weight="bold" aria-hidden />
      </span>
      <span className="truncate text-[17px]">
        Exchangethings<span className="text-muted">.vn</span>
      </span>
    </Link>
  );
}

// Phần đọc phiên đăng nhập nằm trong <Suspense>: khung header tĩnh hiện ngay, nút tài khoản tới sau.
async function AccountSlot() {
  const viewer = await getViewer();
  if (!viewer) return <LinkButton href="/dang-nhap" size="sm">Đăng nhập</LinkButton>;
  const initial = viewer.displayName.trim().charAt(0).toUpperCase() || '?';
  return (
    <Link
      href="/ho-so"
      className="inline-flex size-9 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-ink ring-1 ring-accent/20 transition hover:brightness-95"
      aria-label={`Hồ sơ của ${viewer.displayName}`}
      title={viewer.displayName}
    >
      {initial}
    </Link>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 md:px-6">
        <Logo />
        <Suspense fallback={<DesktopNavView pathname={null} />}>
          <DesktopNav />
        </Suspense>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Suspense fallback={<div className="size-9 rounded-full bg-surface-2" aria-hidden />}>
            <AccountSlot />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
