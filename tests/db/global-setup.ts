// Dựng database test một lần cho cả lượt chạy. Bỏ qua bằng SKIP_DB_TESTS=1 khi máy không có Postgres.
export default async function setup() {
  if (process.env.SKIP_DB_TESTS === '1') return;
  const { resetDatabase } = await import('../../scripts/db-reset.mjs');
  const url: string = await resetDatabase({ dbName: process.env.TEST_DB_NAME ?? 'exchangethings_test', seed: true, quiet: true });
  process.env.TEST_DATABASE_URL = url;
}
