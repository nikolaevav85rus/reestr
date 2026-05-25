import { expect, test, type Page } from '@playwright/test';
import { TEST_PASSWORD, USERS } from '../helpers/api';

async function openLogin(page: Page) {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Войти в систему' })).toBeVisible();
}

async function submitLogin(page: Page, username: string, password: string) {
  await page.getByPlaceholder('Логин (AD)').fill(username);
  await page.getByPlaceholder('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти в систему' }).click();
}

async function expectLoginErrorVisible(page: Page, text: string | RegExp) {
  const alert = page.locator('.ant-alert-error').first();
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(text);
  await page.waitForTimeout(1500);
  await expect(alert).toBeVisible();
}

test.describe('UI regression: login UX', () => {
  test('successful login still works', async ({ page }) => {
    await openLogin(page);
    await submitLogin(page, USERS.admin, TEST_PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  });

  test('invalid password keeps visible error and no redirect', async ({ page }) => {
    await openLogin(page);
    await submitLogin(page, USERS.feo, 'wrong-password');
    await expect(page).toHaveURL(/\/login$/);
    await expectLoginErrorVisible(page, /Неверный логин или пароль/i);
    await expect(page.getByPlaceholder('Логин (AD)')).toHaveValue(USERS.feo);
  });

  test('retry after error shows loading and logs in on valid password', async ({ page }) => {
    await openLogin(page);
    await submitLogin(page, USERS.feo, 'wrong-password');
    await expectLoginErrorVisible(page, /Неверный логин или пароль/i);

    await page.getByPlaceholder('Пароль').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Войти в систему' }).click();
    await expect(page.getByRole('button', { name: 'Войти в систему' })).toHaveClass(/ant-btn-loading/);
    await page.waitForURL('**/dashboard', { timeout: 20_000 });
  });

  test('unknown user shows stable human-readable error', async ({ page }) => {
    await openLogin(page);
    await submitLogin(page, `missing-${Date.now()}`, 'wrong-password');
    await expect(page).toHaveURL(/\/login$/);
    await expectLoginErrorVisible(page, /Неверный логин или пароль/i);
  });

  test('422 detail array is rendered as readable message', async ({ page }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: [
            { loc: ['body', 'username'], msg: 'Некорректный формат логина' },
            { loc: ['body', 'password'], msg: 'Пароль слишком короткий' },
          ],
        }),
      });
    });

    await openLogin(page);
    await submitLogin(page, USERS.feo, TEST_PASSWORD);
    await expect(page).toHaveURL(/\/login$/);
    await expectLoginErrorVisible(page, /Некорректный формат логина; Пароль слишком короткий/i);
  });

  test('logout then failed login does not restore previous username', async ({ page }) => {
    await openLogin(page);
    await submitLogin(page, USERS.director, TEST_PASSWORD);
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    const logoutButton = page.getByRole('button', { name: /Выйти/i });
    await expect(logoutButton).toBeVisible();
    await logoutButton.click();
    await page.waitForURL('**/login', { timeout: 20_000 });

    await submitLogin(page, USERS.feo, 'wrong-password');
    await expect(page).toHaveURL(/\/login$/);
    await expectLoginErrorVisible(page, /Неверный логин или пароль/i);
    await expect(page.getByPlaceholder('Логин (AD)')).toHaveValue(USERS.feo);
  });
});
