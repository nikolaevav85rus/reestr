import { expect, test, type Page } from '@playwright/test';

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input').nth(0).fill(username);
  await page.locator('input').nth(1).fill(process.env.TEST_PASSWORD ?? '1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('.ant-table')).toBeVisible();
}

test('notifications archive page is reachable and renders its controls', async ({ page }) => {
  await loginUi(page, 'feo1');

  // Sider menu exposes the archive
  await expect(page.getByRole('link', { name: 'Уведомления' })).toBeVisible();

  await page.goto('/notifications');
  await page.waitForURL('**/notifications', { timeout: 10_000 });

  // Heading + key controls render (data-independent)
  await expect(page.getByText('Мои уведомления').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: /Отметить все прочитанными/ })).toBeVisible();
  await expect(page.getByText('Только непрочитанные')).toBeVisible();
});
