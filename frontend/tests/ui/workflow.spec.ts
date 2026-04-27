import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  createDraft,
  loginApi,
  marker,
  patchJson,
  postJson,
  USERS,
  type AuthSession,
} from '../helpers/api';
import { findScenario, loadReferenceData, makeRequestPayload, type ReferenceData, type Scenario } from '../helpers/gate-fixtures';

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input').nth(0).fill(username);
  await page.locator('input').nth(1).fill(process.env.TEST_PASSWORD ?? '1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('.ant-table')).toBeVisible();
}

async function selectFirstOption(page: Page, index: number) {
  await page.locator('.ant-modal .ant-select').nth(index).click();
  await expect(page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last()).toBeVisible();
  await page.keyboard.press('Enter');
}

async function openNewRequestModal(page: Page) {
  await page.locator('button:has(.anticon-plus)').first().click();
  await expect(page.locator('.ant-modal')).toBeVisible();
}

async function assertMarkerVisible(page: Page, testMarker: string) {
  await page.goto('/dashboard');
  await expect(page.getByText(testMarker, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
}

async function submitToPending(api: APIRequestContext, initiator: AuthSession, feo: AuthSession, requestId: string) {
  const submitted = await postJson<any>(api, initiator, `/requests/${requestId}/submit`);
  if (submitted.approval_status === 'PENDING_GATE') {
    return await postJson<any>(api, feo, `/requests/${requestId}/approve_gate`, {
      reason: 'REG-P0 cashier workspace exception',
    });
  }
  return submitted;
}

async function buttonWithIcon(page: Page, iconClass: string) {
  return page.locator('button').filter({ has: page.locator(`.${iconClass}`) }).first();
}

test.describe('UI regression: request workflow', () => {
  let api: APIRequestContext;
  let admin: AuthSession;
  let initiator: AuthSession;
  let feo: AuthSession;
  let cashier: AuthSession;
  let director: AuthSession;
  let referenceData: ReferenceData;
  let allowedScenario: Scenario | undefined;
  let blockedScenario: Scenario | undefined;

  test.beforeAll(async () => {
    api = await request.newContext();
    admin = await loginApi(api, USERS.admin);
    initiator = await loginApi(api, USERS.initiator);
    feo = await loginApi(api, USERS.feo);
    cashier = await loginApi(api, USERS.cashier);
    director = await loginApi(api, USERS.director);
    referenceData = await loadReferenceData(api, admin);
    allowedScenario = findScenario(referenceData, (scenario) => scenario.expectedAllowed);
    blockedScenario = findScenario(referenceData, (scenario) => !scenario.expectedAllowed);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('new request form shows regulation preview after organization, budget item, and date are selected', async ({ page }) => {
    test.skip(!allowedScenario, 'No allowed calendar/dictionary data found for UI preview scenario.');

    await loginUi(page, USERS.initiator);
    await openNewRequestModal(page);

    await selectFirstOption(page, 0);
    await selectFirstOption(page, 1);
    await selectFirstOption(page, 2);
    await page.locator('.ant-modal .ant-picker input').fill(allowedScenario!.date.split('-').reverse().join('.'));
    await page.keyboard.press('Enter');

    await expect(page.locator('.ant-alert')).toBeVisible({ timeout: 15_000 });
  });

  test('role action layer exposes the expected primary workflow actions', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(!allowedScenario, 'No allowed calendar/dictionary data found for UI workflow scenario.');
    test.skip(!blockedScenario, 'No blocked calendar/dictionary data found for UI exception scenario.');

    const draftMarker = marker('REG-P0-UI-DRAFT');
    const draft = await createDraft(api, initiator, makeRequestPayload(allowedScenario!, draftMarker, 6101));

    await loginUi(page, USERS.initiator);
    await assertMarkerVisible(page, draftMarker);
    await expect(await buttonWithIcon(page, 'anticon-send')).toBeVisible();

    const pendingMarker = marker('REG-P0-UI-PENDING');
    const pendingDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario!, pendingMarker, 6102));
    await postJson(api, initiator, `/requests/${pendingDraft.id}/submit`);

    await loginUi(page, USERS.feo);
    await assertMarkerVisible(page, pendingMarker);
    await expect(await buttonWithIcon(page, 'anticon-check')).toBeVisible();

    const gateMarker = marker('REG-P0-UI-GATE');
    const gateDraft = await createDraft(api, initiator, makeRequestPayload(blockedScenario!, gateMarker, 6103));
    await postJson(api, initiator, `/requests/${gateDraft.id}/submit`);
    await assertMarkerVisible(page, gateMarker);
    await expect(await buttonWithIcon(page, 'anticon-check')).toBeVisible();

    const approvedMarker = marker('REG-P0-UI-PAY');
    const approvedDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario!, approvedMarker, 6104));
    await postJson(api, initiator, `/requests/${approvedDraft.id}/submit`);
    await postJson(api, feo, `/requests/${approvedDraft.id}/approve`);

    await loginUi(page, USERS.cashier);
    await assertMarkerVisible(page, approvedMarker);
    await expect(await buttonWithIcon(page, 'anticon-dollar')).toBeVisible();

    const memoMarker = marker('REG-P0-UI-MEMO');
    const memoDraft = await createDraft(api, initiator, makeRequestPayload(allowedScenario!, memoMarker, 6105));
    await postJson(api, initiator, `/requests/${memoDraft.id}/submit`);
    await postJson(api, feo, `/requests/${memoDraft.id}/approve`);
    const memoPending = await createDraft(api, initiator, makeRequestPayload(allowedScenario!, `${memoMarker}-DIRECTOR`, 6106));
    await postJson(api, initiator, `/requests/${memoPending.id}/submit`);
    const memoRequired = await patchJson<any>(api, feo, `/requests/${memoPending.id}/budget`, { is_budgeted: false });
    expect(memoRequired.approval_status).toBe('MEMO_REQUIRED');
    await postJson(api, initiator, `/requests/${memoPending.id}/memo_reason`, {
      reason: `${memoMarker}-DIRECTOR off-budget reason`,
    });

    await loginUi(page, USERS.director);
    await assertMarkerVisible(page, `${memoMarker}-DIRECTOR`);
    await expect(await buttonWithIcon(page, 'anticon-check')).toBeVisible();
  });

  test('visible UI can pay an approved request without force-clicking Popconfirm', async ({ page }) => {
    test.skip(!allowedScenario, 'No allowed calendar/dictionary data found for UI payment scenario.');

    const payMarker = marker('REG-P0-UI-PAYCLICK');
    const draft = await createDraft(api, initiator, makeRequestPayload(allowedScenario!, payMarker, 6201));
    await postJson(api, initiator, `/requests/${draft.id}/submit`);
    await postJson(api, feo, `/requests/${draft.id}/approve`);

    await loginUi(page, USERS.cashier);
    await assertMarkerVisible(page, payMarker);
    await (await buttonWithIcon(page, 'anticon-dollar')).click();
    await page.locator('.ant-popconfirm-buttons button').last().click();

    await expect(page.getByText(payMarker, { exact: false }).first()).toBeVisible();
  });

  test('cashier workspace defaults to today, shows tabs, and exports current view', async ({ page }) => {
    test.skip(!allowedScenario, 'No allowed calendar/dictionary data found for cashier workspace scenario.');

    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const todayRu = today.toLocaleDateString('ru-RU');
    const workspaceMarker = marker('REG-P0-CASHIER');
    const draft = await createDraft(api, initiator, {
      ...makeRequestPayload(allowedScenario!, workspaceMarker, 6301),
      payment_date: todayIso,
    });
    await submitToPending(api, initiator, feo, draft.id);
    await postJson(api, feo, `/requests/${draft.id}/approve`);

    await loginUi(page, USERS.cashier);
    await expect(page.locator('a[href="/cashier"]')).toBeVisible();
    await page.goto('/cashier');
    await expect(page.locator('.ant-picker input').first()).toHaveValue(todayRu);
    await expect(page.getByText(workspaceMarker, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ant-tabs-tab').first()).toBeVisible();
    await expect(await buttonWithIcon(page, 'anticon-download')).toBeVisible();

    await loginUi(page, USERS.feo);
    await expect(page.locator('a[href="/cashier"]')).toBeVisible();
    await page.goto('/cashier');
    await expect(page.getByText(workspaceMarker, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('button').filter({ has: page.locator('.anticon-dollar') })).toHaveCount(0);
  });

  test('cashier workspace supports nested column settings', async ({ page }) => {
    await loginUi(page, USERS.cashier);
    const storage = await page.evaluate(() => localStorage.getItem('treasury-auth-storage'));
    const userId = storage ? JSON.parse(storage).state.user.id : 'default';
    const settings = [
      { key: 'payment_date', visible: true, order: 0, width: 150 },
      { key: 'organization', visible: true, order: 1, width: 150 },
      { key: 'direction', visible: true, order: 2, width: 150 },
      { key: 'counterparty', visible: true, order: 3, width: 170 },
      { key: 'note', visible: true, order: 4, width: 180, pairedWith: 'description' },
      { key: 'description', visible: true, order: 5, width: 220 },
      { key: 'creator', visible: true, order: 6, width: 150 },
      { key: 'budget_item', visible: true, order: 7, width: 170 },
      { key: 'amount', visible: true, order: 8, width: 130 },
      { key: 'payment_status', visible: true, order: 9, width: 120 },
      { key: 'contract_status', visible: true, order: 10, width: 145 },
      { key: 'actions', visible: true, order: 11, width: 110 },
    ];
    await page.evaluate(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      { key: `ui_cashier_cols_${userId}`, value: settings },
    );

    await page.goto('/cashier');
    await expect(page.getByRole('columnheader', { name: /Описание \/ Назначение платежа/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /^Назначение платежа$/ })).toHaveCount(0);
  });

  test('payment registry can show month and day tabs with independent grouping', async ({ page }) => {
    test.skip(!allowedScenario, 'No allowed calendar/dictionary data found for registry day tabs scenario.');

    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const todayRu = today.toLocaleDateString('ru-RU');
    const dayTabsMarker = marker('REG-P0-DAYTABS');
    await createDraft(api, initiator, {
      ...makeRequestPayload(allowedScenario!, dayTabsMarker, 6401),
      payment_date: todayIso,
    });

    await loginUi(page, USERS.feo);
    await expect(page.getByText(dayTabsMarker, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await page.getByRole('switch', { name: 'По дням' }).click();
    const todayTab = page.locator('.ant-tabs-tab').filter({ hasText: todayRu }).first();
    await expect(todayTab).toBeVisible({ timeout: 15_000 });
    await todayTab.click();
    await expect(page.getByText(dayTabsMarker, { exact: false }).first()).toBeVisible();

    await page.getByRole('switch', { name: 'Группировка' }).click();
    await expect(page.locator('.row-group-org').first()).toBeVisible({ timeout: 15_000 });
  });
});
