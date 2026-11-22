'use client';

import { Button, LinkButton } from '@/components/ui';

// Lỗi không lường trước trong một trang. Ở production, chi tiết lỗi server không gửi xuống trình duyệt.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Có lỗi xảy ra</h1>
      <p className="mt-2 leading-relaxed text-ink-2">Trang chưa tải được. Thử lại sau vài giây; nếu vẫn lỗi, báo cho chúng tôi kèm mã bên dưới.</p>
      {digest && <p className="tabular mt-3 text-xs text-muted">Mã lỗi: {digest}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>Thử lại</Button>
        <LinkButton href="/" variant="secondary">Về trang chủ</LinkButton>
      </div>
    </div>
  );
}
