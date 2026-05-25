import { expect, test, type Page } from '@playwright/test';

async function loginUi(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.locator('input').nth(0).fill(username);
  await page.locator('input').nth(1).fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

test.describe('UI security regression: users page', () => {
  test('superadmin can open settings/users page and users table remains stable with safe schema', async ({ page }) => {
    await loginUi(page, 'admin', '123');

    const usersResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && response.url().includes('/api/v1/users/')
    ));

    await page.goto('/settings');

    const usersResponse = await usersResponsePromise;
    expect(usersResponse.status()).toBe(200);

    const users = await usersResponse.json();
    expect(Array.isArray(users)).toBeTruthy();
    expect(users.length, 'Expected at least one user in UI users payload').toBeGreaterThan(0);

    const requiredFields = [
      'id',
      'ad_login',
      'full_name',
      'is_active',
      'role_id',
      'direction_id',
      'role',
      'direction',
    ];

    for (const user of users) {
      expect('hashed_password' in user, `Unsafe field leaked in UI payload row: ${JSON.stringify(user)}`).toBeFalsy();
      for (const field of requiredFields) {
        expect(
          Object.prototype.hasOwnProperty.call(user, field),
          `Missing expected field "${field}" in UI payload row: ${JSON.stringify(user)}`,
        ).toBeTruthy();
      }
    }

    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('.ant-table').first()).toBeVisible();
  });
});
