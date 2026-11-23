import type { NextConfig } from 'next';

// Giới hạn kích thước một lần gửi form đăng món (nhiều ảnh trong một Server Action).
// Trình duyệt thu nhỏ ảnh trước khi gửi (src/components/photo-picker.tsx); server vẫn kiểm từng ảnh ≤ 10 MB.
const UPLOAD_LIMIT = '30mb';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Nút báo trạng thái của Next ở chế độ dev nằm đè lên mục đầu của thanh điều hướng dưới: tắt đi. Lỗi vẫn hiện như thường.
  devIndicators: false,
  experimental: {
    serverActions: { bodySizeLimit: UPLOAD_LIMIT },
    // Proxy đệm body request tới giới hạn này; vượt quá thì body bị cắt. Giữ bằng giới hạn upload.
    proxyClientMaxBodySize: UPLOAD_LIMIT,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
