import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <p className="text-sm font-semibold text-accent-ink">404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Không tìm thấy trang</h1>
      <p className="mt-2 leading-relaxed text-ink-2">Món này có thể đã được gỡ, đã đổi xong, hoặc đường dẫn bị sai.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href="/">Về trang chủ</LinkButton>
        <LinkButton href="/dang-mon" variant="secondary">Đăng món</LinkButton>
      </div>
    </div>
  );
}
