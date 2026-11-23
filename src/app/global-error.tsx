'use client';

import './globals.css';

// Lỗi ở layout gốc: tự vẽ <html>, <body> vì layout gốc không chạy được.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="vi">
      <body className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-2xl font-bold">Exchangethings.vn tạm thời gặp sự cố</h1>
          <p className="mt-2 text-ink-2">Chúng tôi đang xử lý. Thử lại sau ít phút.</p>
          <button type="button" onClick={() => retry()} className="mt-6 rounded-full bg-accent px-5 py-2.5 font-semibold text-on-accent">Thử lại</button>
        </div>
      </body>
    </html>
  );
}
