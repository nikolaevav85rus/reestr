import { expect, test, type Page } from '@playwright/test';

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input').nth(0).fill(username);
  await page.locator('input').nth(1).fill(process.env.TEST_PASSWORD ?? '1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('.ant-table')).toBeVisible();
}

// Smoke only: the OCR control is present in the create form. The live recognition
// path (upload -> evo-ai -> prefill) is verified manually/out-of-band, not here,
// since it makes a ~30s external API call.
test('create form exposes the "Распознать счёт" OCR control', async ({ page }) => {
  await loginUi(page, 'initiator1');
  await page.locator('button:has(.anticon-plus)').first().click();
  await expect(page.locator('.ant-modal')).toBeVisible();
  await expect(page.locator('.ant-modal').getByRole('button', { name: /Распознать счёт/ })).toBeVisible();
});
