import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { E2E_DATABASE_URL } from '../../playwright.config';

/** Đưa database e2e về đúng dữ liệu mẫu (seed chạy lại cho cùng kết quả), để mỗi file test bắt đầu như nhau. */
export async function resetData(): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(readFileSync(join(process.cwd(), 'supabase/seed.sql'), 'utf8'));
  } finally {
    await client.end();
  }
}

/** Mở một trình duyệt riêng và đăng nhập bằng người dùng mẫu (AUTH_MODE=dev), rồi vào thẳng `next`. */
export async function signIn(browser: Browser, name: string, next = '/quet'): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/dang-nhap?next=${encodeURIComponent(next)}`);
  await page.getByRole('button', { name: new RegExp(`^${name[0]}\\s*${name}`) }).click();
  // So đúng đường dẫn: URL trang đăng nhập cũng chứa chuỗi "next=/quet".
  await page.waitForURL((url) => url.pathname + url.search === next);
  return page;
}

/** Thẻ đang nằm trên cùng của chồng thẻ. */
export const topCard = (page: Page) => page.locator('article[aria-label]').first();

/** Chờ thẻ trên cùng đổi sang món khác, trả về nhãn của thẻ mới. */
export async function nextCardAfter(page: Page, previous: string): Promise<string> {
  await expect(topCard(page)).not.toHaveAttribute('aria-label', previous);
  return (await topCard(page).getAttribute('aria-label')) ?? '';
}

/** Mục "Khớp" (kèm chấm báo) trên thanh điều hướng đang hiện: thanh dưới ở di động, thanh trên ở máy tính. */
export const matchBadge = (page: Page) =>
  page.getByRole('navigation', { name: 'Điều hướng chính' }).filter({ visible: true }).getByRole('link', { name: /Khớp/ });

/** Các dòng trong danh sách khớp (không tính các mục của thanh điều hướng). */
export const matchRows = (page: Page) => page.getByRole('main').getByRole('listitem');
