'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { buttonClass } from './ui';

/** Nút gửi form, tự khóa và đổi chữ khi đang gửi. */
export function SubmitButton({ children, pendingText, variant = 'primary', size = 'md', className, name, value, disabled }: {
  children: ReactNode; pendingText?: string; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg';
  className?: string; name?: string; value?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} aria-busy={pending}
      className={buttonClass(variant, size, className)}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
