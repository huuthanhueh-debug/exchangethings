'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { SubmitButton } from '@/components/form-bits';
import { PhotoPicker } from '@/components/photo-picker';
import { Notice } from '@/components/ui';
import type { PhotoState } from '../actions';

export function AddPhotosForm({ action, remaining, allowProof }: {
  action: (prev: PhotoState, fd: FormData) => Promise<PhotoState>; remaining: number; allowProof: boolean;
}) {
  const [state, formAction] = useActionState(action, { status: 'idle', seq: 0 } satisfies PhotoState);
  function onSubmit(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const fd = new FormData(form);
    startTransition(() => formAction(fd));
  }
  return (
    <form action={formAction} onSubmit={onSubmit} className="space-y-4" key={state.seq}>
      {state.status === 'saved' && <Notice tone="ok">Đã thêm ảnh.</Notice>}
      {state.status === 'error' && <Notice tone="bad">{state.message}</Notice>}
      {remaining > 0 && <PhotoPicker name="photos" label="Thêm ảnh sản phẩm" max={remaining} />}
      {allowProof && <PhotoPicker name="proof" label="Thêm ảnh chứng từ" max={2} hint="Chỉ bạn và admin xem được." />}
      <SubmitButton variant="secondary" pendingText="Đang tải ảnh...">Tải ảnh lên</SubmitButton>
    </form>
  );
}
