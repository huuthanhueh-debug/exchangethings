import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' chỉ cho phép import dưới điều kiện react-server; trong test thì là module rỗng.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/db/global-setup.ts'],
    // Test cơ sở dữ liệu dùng chung một database; chạy tuần tự để không giẫm lên nhau.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
