// Chạy các migration còn thiếu trên database trỏ bởi DATABASE_URL. Không cần token Supabase.
// Dùng: pnpm db:migrate            chạy migration còn thiếu
//       pnpm db:migrate --dry-run  chỉ xem sẽ chạy gì
import { loadMigrations, migrate, runCli } from './lib/db-tools.mjs';

const dryRun = process.argv.includes('--dry-run');
await runCli(async ({ client }) => {
  const r = await migrate(client, loadMigrations(), { log: (m) => console.log(`  ${m}`), dryRun });
  if (dryRun) {
    console.log(r.pending.length ? `Sẽ chạy ${r.pending.length} migration: ${r.pending.map((m) => m.file).join(', ')}` : 'Không có migration nào cần chạy.');
  } else {
    console.log(r.ran.length ? `Xong: đã chạy ${r.ran.length} migration.` : 'Không có migration nào cần chạy; database đã mới nhất.');
  }
  if (r.unknown.length) console.log(`Lưu ý: database có migration mà bản code này không có: ${r.unknown.join(', ')}`);
});
