'use client';

import { useActionState } from 'react';
import { EnvelopeSimpleIcon } from '@phosphor-icons/react/ssr';
import { SubmitButton } from '@/components/form-bits';
import { Notice, inputClass } from '@/components/ui';
import { emailSignIn, type EmailState } from './actions';

export function EmailForm({ next, disabled }: { next: string; disabled?: boolean }) {
  const [state, action] = useActionState<EmailState, FormData>(emailSignIn, { status: 'idle' });
  if (state.status === 'sent') {
    return (
      <Notice tone="ok" title="Đã gửi link đăng nhập">
        Mở email <strong>{state.email}</strong> và bấm vào link để vào Exchangethings.vn. Link dùng được một lần.
      </Notice>
    );
  }
  return (
    <form action={action} className="space-y-3" noValidate>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email" className="block text-sm font-semibold text-ink">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required placeholder="ban@email.com"
        defaultValue={state.email} disabled={disabled} className={inputClass}
        aria-invalid={state.status === 'error'} aria-describedby={state.status === 'error' ? 'email-error' : undefined} />
      {state.status === 'error' && <p id="email-error" className="text-sm text-bad" role="alert">{state.message}</p>}
      <SubmitButton pendingText="Đang gửi..." className="w-full" disabled={disabled}>
        <EnvelopeSimpleIcon size={18} aria-hidden />
        Gửi link đăng nhập
      </SubmitButton>
    </form>
  );
}
