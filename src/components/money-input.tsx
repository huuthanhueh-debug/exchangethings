'use client';

import { useState } from 'react';
import { formatNumber, parseVnd } from '@/lib/format';
import { inputClass } from './ui';

/** Ô nhập tiền VND: gõ số tự nhiên, tự thêm dấu chấm ngăn cách hàng nghìn. */
export function MoneyInput({ id, name, defaultValue, placeholder, invalid, describedBy, disabled }: {
  id: string; name: string; defaultValue?: string; placeholder?: string; invalid?: boolean; describedBy?: string; disabled?: boolean;
}) {
  const [value, setValue] = useState(() => {
    const n = parseVnd(defaultValue);
    return n === null ? '' : formatNumber(n);
  });
  return (
    <div className="relative">
      <input id={id} name={name} value={value} inputMode="numeric" autoComplete="off" placeholder={placeholder} disabled={disabled}
        onChange={(e) => {
          const n = parseVnd(e.target.value);
          setValue(n === null ? '' : formatNumber(n));
        }}
        className={`${inputClass} tabular pr-9`} aria-invalid={invalid} aria-describedby={describedBy} />
      <span className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-semibold text-muted" aria-hidden>₫</span>
    </div>
  );
}
