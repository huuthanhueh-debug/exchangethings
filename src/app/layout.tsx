import type { Metadata, Viewport } from 'next';
import { Be_Vietnam_Pro } from 'next/font/google';
import { Suspense } from 'react';
import { BottomNav, BottomNavView } from '@/components/nav';
import { SiteHeader } from '@/components/site-header';
import { THEME_INIT_SCRIPT } from '@/components/theme-toggle';
import './globals.css';

// Be Vietnam Pro hỗ trợ đủ dấu tiếng Việt (SPEC mục 15). Không phải variable font nên phải khai báo weight.
const font = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-be-vietnam-pro',
});

export const metadata: Metadata = {
  title: { default: 'Exchangethings.vn: đổi đồ khi hai bên cùng đồng ý', template: '%s | Exchangethings.vn' },
  description:
    'Đổi điện thoại, thời trang, khóa học, voucher, dịch vụ với người khác trên khắp Việt Nam. Hai bên cùng đồng ý mới đổi; tiền bù được giữ qua trung gian.',
  applicationName: 'Exchangethings.vn',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef2f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1217' },
  ],
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="vi" className={font.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <a
          href="#noi-dung"
          className="sr-only rounded-full bg-accent px-4 py-2 font-semibold text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50"
        >
          Bỏ qua, tới nội dung chính
        </a>
        <SiteHeader />
        <main id="noi-dung" className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-6 md:pb-16 md:pt-8">
          {children}
        </main>
        <Suspense fallback={<BottomNavView pathname={null} />}>
          <BottomNav />
        </Suspense>
      </body>
    </html>
  );
}
