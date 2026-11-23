import { defineConfig, devices } from '@playwright/test';

// Kiểm thử đầu cuối (PLAN: tiêu chí "Xong khi" của từng mốc). Chạy: pnpm test:e2e
// Tự dựng database exchangethings_e2e (migrations + dữ liệu mẫu), sinh ảnh minh họa, build bản production
// rồi chạy trên cổng 3100 với AUTH_MODE=dev. Cần Postgres ở localhost như pnpm test.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const adminUrl = new URL(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres');
adminUrl.pathname = '/exchangethings_e2e';
export const E2E_DATABASE_URL = adminUrl.toString();
const STORAGE_DIR = '.data/e2e-storage';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  // SPEC mục 15: chuẩn ở màn di động, đúng ở 1440px.
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: [
      'node scripts/db-reset.mjs --db exchangethings_e2e',
      'node scripts/generate-seed-media.mjs',
      'pnpm exec next build',
      `pnpm exec next start --port ${PORT}`,
    ].join(' && '),
    url: `http://localhost:${PORT}/dang-nhap`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_MODE: 'dev',
      // Chỉ dùng cho kiểm thử trên máy: chế độ đăng nhập thử tự từ chối khi database không ở localhost.
      DEV_AUTH_SECRET: 'e2e-only-secret-not-used-anywhere-else-000000',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: STORAGE_DIR,
      APP_URL: `http://localhost:${PORT}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
