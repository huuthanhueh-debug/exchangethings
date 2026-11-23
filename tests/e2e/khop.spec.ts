import { expect, test } from '@playwright/test';
import { matchBadge, matchRows, nextCardAfter, resetData, signIn, topCard } from './helpers';

// PLAN M2, tiêu chí "Xong khi": e2e "hai người thích nhau thì khớp" pass.
// Kịch bản 1 của SPEC: An có iPhone 15, Bình có iPhone 18.

test.describe.configure({ mode: 'serial' });
test.beforeAll(resetData);

test('hai người thích nhau thì khớp, nhắn tin được, thông tin liên lạc bị che', async ({ browser, isMobile }) => {
  const consoleErrors: string[] = [];
  const an = await signIn(browser, 'An');
  an.on('pageerror', (e) => consoleErrors.push(`An: ${e.message}`));

  await test.step('An thấy iPhone 18 của Bình đứng đầu với điểm gợi ý trong SPEC mục 8', async () => {
    await expect(topCard(an)).toHaveAttribute('aria-label', 'iPhone 18 256GB của Bình');
    await expect(topCard(an)).toContainText('Hợp 78%');
    await expect(topCard(an)).toContainText('17.000.000 ₫');
    await expect(topCard(an)).toContainText('Bình muốn đúng món "iPhone 15 128GB" của bạn');
  });

  await test.step('An bấm Quan tâm: thẻ sang món khác, chưa khớp vì Bình chưa thích', async () => {
    await an.getByRole('button', { name: 'Quan tâm' }).click();
    await nextCardAfter(an, 'iPhone 18 256GB của Bình');
    await expect(an.getByRole('dialog')).toBeHidden();
  });

  const binh = await signIn(browser, 'Bình');
  binh.on('pageerror', (e) => consoleErrors.push(`Bình: ${e.message}`));

  await test.step('Bình thích iPhone 15 của An bằng phím mũi tên phải: hiện "Khớp rồi!"', async () => {
    await expect(topCard(binh)).toHaveAttribute('aria-label', 'iPhone 15 128GB của An');
    await binh.keyboard.press('ArrowRight');
    const dialog = binh.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Khớp rồi!' })).toBeVisible();
    await expect(dialog).toContainText('Bạn và An đều quan tâm món của nhau');
    await expect(dialog).toContainText('iPhone 18 256GB');
    await expect(dialog).toContainText('iPhone 15 128GB');
    await expect(matchBadge(binh)).toContainText('1');
  });

  await test.step('Bình mở chat từ hộp thoại và gửi tin', async () => {
    await binh.getByRole('dialog').getByRole('link', { name: 'Nhắn tin' }).click();
    await expect(binh).toHaveURL(/\/khop\/[0-9a-f-]{36}$/);
    await expect(binh.getByRole('heading', { name: 'An', exact: true })).toBeVisible();
    await expect(binh.getByText('Hai bạn vừa khớp')).toBeVisible();
    await binh.getByLabel('Tin nhắn gửi An').fill('Chào An, máy mình còn bảo hành 8 tháng nhé');
    await binh.getByRole('button', { name: 'Gửi tin' }).click();
    await expect(binh.getByText('Chào An, máy mình còn bảo hành 8 tháng nhé')).toBeVisible();
    await expect(binh.getByLabel('Tin nhắn gửi An')).toHaveValue('');
  });

  await test.step('tin có số điện thoại và số tài khoản được che trước khi lưu', async () => {
    const field = binh.getByLabel('Tin nhắn gửi An');
    await field.fill('Gọi mình 0905 123 456, ck 19035551234567 nha');
    if (isMobile) {
      // Màn cảm ứng: Enter là xuống dòng, gửi bằng nút.
      await field.press('Enter');
      await expect(field).toHaveValue('Gọi mình 0905 123 456, ck 19035551234567 nha\n');
      await field.press('Backspace');
      await binh.getByRole('button', { name: 'Gửi tin' }).click();
    } else {
      // Bàn phím thật: Shift+Enter xuống dòng, Enter gửi.
      await field.press('Shift+Enter');
      await expect(field).toHaveValue('Gọi mình 0905 123 456, ck 19035551234567 nha\n');
      await field.press('Backspace');
      await field.press('Enter');
    }
    await expect(binh.getByText('Gọi mình [đã ẩn số điện thoại], ck [đã ẩn dãy số] nha')).toBeVisible();
    await expect(binh.getByText('Thông tin liên lạc trong tin này đã được ẩn.')).toBeVisible();
  });

  await test.step('An thấy chấm báo, danh sách khớp có Bình với 2 tin chưa đọc', async () => {
    await an.goto('/khop');
    await expect(matchBadge(an)).toContainText('1');
    const row = matchRows(an).filter({ hasText: 'Bình' });
    await expect(row).toContainText('iPhone 18 256GB ⇄ iPhone 15 128GB');
    await expect(row).toContainText('[đã ẩn số điện thoại]');
    await expect(row).toContainText('2 tin chưa đọc');
    await row.getByRole('link').click();
    await expect(an).toHaveURL(/\/khop\/[0-9a-f-]{36}$/);
  });

  await test.step('An đọc được tin, không thấy số điện thoại gốc ở đâu trong trang', async () => {
    await expect(an.getByText('Chào An, máy mình còn bảo hành 8 tháng nhé')).toBeVisible();
    await expect(an.getByText('Thông tin liên lạc đã được ẩn.')).toBeVisible();
    const html = await an.content();
    expect(html).not.toContain('0905');
    expect(html).not.toContain('19035551234567');
  });

  await test.step('An trả lời; Bình nhận được mà không tải lại trang', async () => {
    await an.getByLabel('Tin nhắn gửi Bình').fill('Ok Bình, mình bù 3.000.000 ₫ được không?');
    await an.getByRole('button', { name: 'Gửi tin' }).click();
    await expect(an.getByText('Ok Bình, mình bù 3.000.000 ₫ được không?')).toBeVisible();
    await expect(binh.getByText('Ok Bình, mình bù 3.000.000 ₫ được không?')).toBeVisible();
  });

  await test.step('đọc xong thì chấm báo của An tắt', async () => {
    await expect(matchBadge(an)).not.toContainText(/\d/);
  });

  await test.step('trang món của Bình giờ có nút nhắn tin thay cho nút quan tâm', async () => {
    await an.goto('/mon/00000000-0000-4000-9000-000000000011');
    await expect(an.getByRole('link', { name: 'Nhắn tin với Bình' })).toBeVisible();
  });

  expect(consoleErrors).toEqual([]);
  await an.context().close();
  await binh.context().close();
});

test('quẹt bằng phím và bằng cách kéo; kéo chưa đủ xa thì thẻ ở lại', async ({ browser }) => {
  const em = await signIn(browser, 'Em');
  const first = (await topCard(em).getAttribute('aria-label')) ?? '';
  expect(first).not.toBe('');

  await em.keyboard.press('ArrowLeft');
  const second = await nextCardAfter(em, first);

  const drag = async (dx: number) => {
    const box = (await topCard(em).boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    await em.mouse.move(x, y);
    await em.mouse.down();
    await em.mouse.move(x + dx / 2, y, { steps: 4 });
    await em.mouse.move(x + dx, y, { steps: 4 });
    await em.mouse.up();
  };
  await drag(-50);
  await em.waitForTimeout(400);
  await expect(topCard(em)).toHaveAttribute('aria-label', second);

  await drag(240);
  const third = await nextCardAfter(em, second);
  expect(third).not.toBe(first);

  await test.step('món đã quẹt không quay lại sau khi tải lại trang', async () => {
    await em.reload();
    await expect(topCard(em)).toHaveAttribute('aria-label', third);
  });
  await test.step('trang món: bấm Quan tâm đổi thành Đã quan tâm', async () => {
    await em.goto('/mon/00000000-0000-4000-9000-000000000023');
    await em.getByRole('button', { name: 'Quan tâm' }).click();
    await expect(em.getByRole('button', { name: 'Đã quan tâm' })).toBeDisabled();
  });
  await em.context().close();
});

test('bộ lọc nằm trên URL; người ngoài không vào được cuộc trò chuyện của người khác', async ({ browser }) => {
  const an = await signIn(browser, 'An', '/quet?dm=cameras');
  await test.step('lọc danh mục máy ảnh: chỉ còn máy ảnh Fujifilm của Bình', async () => {
    await expect(topCard(an)).toHaveAttribute('aria-label', 'Máy ảnh Fujifilm X-T30 của Bình');
    await expect(an.getByText('Đang lọc')).toBeVisible();
    await an.getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(an.getByRole('heading', { name: 'Không còn món nào khớp bộ lọc' })).toBeVisible();
    await an.getByRole('link', { name: 'Bỏ bộ lọc' }).click();
    await expect(an).toHaveURL(/\/quet$/);
    await expect(topCard(an)).toBeVisible();
  });
  await test.step('đổi bộ lọc bằng form: chỉ voucher', async () => {
    await an.getByText('Bộ lọc', { exact: true }).click();
    await an.getByLabel('Loại món').selectOption('voucher');
    await an.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(an).toHaveURL(/\/quet\?loai=voucher$/);
    await expect(topCard(an)).toContainText(/Voucher|Vé/);
  });

  const chatUrl = await test.step('lấy địa chỉ cuộc trò chuyện của An và Bình', async () => {
    await an.goto('/khop');
    await matchRows(an).filter({ hasText: 'Bình' }).getByRole('link').click();
    await expect(an).toHaveURL(/\/khop\/[0-9a-f-]{36}$/);
    return new URL(an.url()).pathname;
  });

  const chi = await signIn(browser, 'Chi', '/khop');
  await test.step('Chi chỉ thấy cuộc trò chuyện của mình với Dũng', async () => {
    await expect(matchRows(chi)).toHaveCount(1);
    await expect(matchRows(chi)).toContainText('Dũng');
  });
  await test.step('Chi mở địa chỉ chat của An và Bình: trang 404, API cũng 404', async () => {
    await chi.goto(chatUrl);
    await expect(chi.getByRole('heading', { name: /Không tìm thấy/ })).toBeVisible();
    await expect(chi.getByText('máy mình còn bảo hành')).toHaveCount(0);
    const api = await chi.request.get(`${chatUrl.replace('/khop/', '/api/matches/')}/messages`);
    expect(api.status()).toBe(404);
  });
  await test.step('khách chưa đăng nhập bị chuyển về trang đăng nhập; API trả 401', async () => {
    const guest = await browser.newContext();
    const page = await guest.newPage();
    await page.goto(chatUrl);
    await expect(page).toHaveURL(/\/dang-nhap\?next=/);
    expect((await page.request.get(`${chatUrl.replace('/khop/', '/api/matches/')}/messages`)).status()).toBe(401);
    await guest.close();
  });
  await an.context().close();
  await chi.context().close();
});

test('khách xem thử thẻ món: không có thông tin người đăng, bấm quan tâm thì mời đăng nhập', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/quet');
  await expect(page.getByText('Bạn đang xem thử')).toBeVisible();
  await expect(topCard(page)).toContainText('Đăng nhập để xem người đăng');
  await expect(topCard(page)).not.toContainText('Hợp');

  await test.step('hạng và điểm uy tín của người đăng không có trong trang; thẻ không ghi "của ai"', async () => {
    // Tên người đăng không kiểm bằng cách dò cả trang được (danh sách tỉnh có "Ninh Bình", "Khánh Hòa"):
    // tests/db/deck.test.ts chứng minh dữ liệu thẻ của khách không chứa người đăng.
    const html = await page.content();
    expect(html).not.toContain('điểm uy tín');
    expect(html).not.toContain('Uy tín cao');
    await expect(topCard(page)).not.toHaveAttribute('aria-label', / của /);
  });
  await test.step('bỏ qua thì lật thẻ tại chỗ; hết 8 thẻ thì mời đăng nhập', async () => {
    const first = (await topCard(page).getAttribute('aria-label')) ?? '';
    await page.getByRole('button', { name: 'Bỏ qua' }).click();
    await nextCardAfter(page, first);
    for (let i = 0; i < 7; i++) {
      const label = (await topCard(page).getAttribute('aria-label')) ?? '';
      await page.keyboard.press('ArrowLeft');
      if (i < 6) await nextCardAfter(page, label);
    }
    await expect(page.getByRole('heading', { name: 'Đăng nhập để quẹt tiếp' })).toBeVisible();
  });
  await test.step('bấm quan tâm thì sang trang đăng nhập, đăng nhập xong quay lại màn quẹt', async () => {
    await page.goto('/quet?dm=phones');
    await page.getByRole('button', { name: 'Quan tâm' }).click();
    await expect(page).toHaveURL(/\/dang-nhap\?next=%2Fquet%3Fdm%3Dphones$/);
    await page.getByRole('button', { name: /^L\s*Linh/ }).click(); // Linh chưa quẹt món nào ở các bài trên
    await expect(page).toHaveURL(/\/quet\?dm=phones$/);
    await expect(topCard(page)).toContainText('điểm uy tín');
    await expect(topCard(page)).toContainText('Hợp');
  });
  await test.step('trang Khớp vẫn cần đăng nhập', async () => {
    const guest = await browser.newContext();
    const other = await guest.newPage();
    await other.goto('/khop');
    await expect(other).toHaveURL(/\/dang-nhap\?next=%2Fkhop$/);
    await guest.close();
  });
  await context.close();
});
