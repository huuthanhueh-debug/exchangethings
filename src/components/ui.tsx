import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

// Thành phần giao diện dùng chung (Server Component được). Một hệ hình khối:
// nút và chip bo tròn hẳn, thẻ 16px (rounded-2xl), ô nhập 12px (rounded-xl).

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 shadow-sm',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-accent-ink hover:bg-accent-soft',
  danger: 'bg-surface text-bad border border-line hover:bg-bad-soft',
};
const SIZE: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cx(
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full font-semibold transition',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    VARIANT[variant], SIZE[size], extra,
  );
}

export function Button({ variant, size, className, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({ variant, size, className, ...props }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('rounded-2xl border border-line bg-surface shadow-card', className)} {...props} />;
}

export const inputClass = cx(
  'block w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink',
  'placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30',
  'aria-[invalid=true]:border-bad disabled:opacity-60',
);

export function Field({ label, htmlFor, hint, error, required, children }: {
  label: string; htmlFor?: string; hint?: ReactNode; error?: string[]; required?: boolean; children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-bad" aria-hidden> *</span>}
      </label>
      {children}
      {error?.length ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="text-sm text-bad" role="alert">{error[0]}</p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-2xl bg-surface-2', className)} aria-hidden />;
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Notice({ tone = 'accent', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const border: Record<Tone, string> = {
    neutral: 'border-line', accent: 'border-accent/30', ok: 'border-ok/30', warn: 'border-warn/30', bad: 'border-bad/30',
  };
  return (
    <div className={cx('rounded-2xl border px-4 py-3 text-[15px]', TONE[tone], border[tone])} role={tone === 'bad' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cx(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
    </div>
  );
}
