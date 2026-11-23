// "Khám" database trỏ bởi DATABASE_URL: kiểm tra đúng những thứ app cần để chạy. Chỉ đọc, không đổi dữ liệu.
// Dùng: pnpm db:doctor   (mã thoát 1 nếu còn mục chưa đạt)
import { doctor, formatReport, loadMigrations, runCli } from './lib/db-tools.mjs';

await runCli(async ({ client, target, tls }) => {
  const results = await doctor(client, loadMigrations(), { tls, loopback: target.isLoopback });
  console.log(formatReport(results));
  if (results.some((r) => r.ok === false)) process.exitCode = 1;
});
