'use client';

import { useSyncExternalStore } from 'react';
import { DesktopIcon, MoonIcon, SunIcon } from '@phosphor-icons/react/ssr';

// Chế độ sáng/tối: Theo máy (mặc định) → Sáng → Tối. Lưu trong localStorage; script đầu trang áp trước khi vẽ.
type Mode = 'system' | 'light' | 'dark';
const KEY = 'et-theme';
const listeners = new Set<() => void>();

function read(): Mode {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function write(mode: Mode) {
  try {
    if (mode === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {}
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  listeners.forEach((l) => l());
}

const NEXT: Record<Mode, Mode> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<Mode, string> = { system: 'Giao diện: theo máy', light: 'Giao diện: sáng', dark: 'Giao diện: tối' };

export function ThemeToggle() {
  const mode = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    read,
    () => 'system' as Mode,
  );
  const Icon = mode === 'light' ? SunIcon : mode === 'dark' ? MoonIcon : DesktopIcon;
  return (
    <button
      type="button"
      onClick={() => write(NEXT[mode])}
      className="inline-flex size-9 items-center justify-center rounded-full text-ink-2 transition hover:bg-surface-2 hover:text-ink"
      aria-label={`${LABEL[mode]}. Bấm để đổi.`}
      title={LABEL[mode]}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}

/** Chạy trong <head> trước khi vẽ trang để không nháy màu sai. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
