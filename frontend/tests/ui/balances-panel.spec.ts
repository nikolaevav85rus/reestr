import { expect, request, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { API_BASE_URL, getJson, loginApi, marker, postJson, USERS, type AuthSession } from '../helpers/api';

async function loginUi(page: Page, username: string) {
  await page.goto('/login');
  await page.locator('input').nth(0).fill(username);
  await page.locator('input').nth(1).fill(process.env.TEST_PASSWORD ?? '1234');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
  await expect(page.locator('.ant-table')).toBeVisible();
}

async function getUserIdFromStorage(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const raw = localStorage.getItem('treasury-auth-storage');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed?.state?.user?.id ?? null;
    } catch {
      return null;
    }
  });
}

function ruDateToIso(value: string): string {
  const match = value.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (!match) throw new Error(`Unexpected date format: ${value}`);
  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm}-${dd}`;
}

async function openAntdSelectDropdown(page: Page, trigger: Locator): Promise<Locator> {
  const selector = trigger.locator('.ant-select-selector').first();
  const clickable = (await selector.count()) ? selector : trigger;
  await expect(clickable).toBeVisible();
  await clickable.scrollIntoViewIfNeeded();
  await clickable.click();
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await expect(dropdown).toBeVisible();
  return dropdown;
}

async function searchAntdSelectDropdown(page: Page, dropdown: Locator, searchText: string): Promise<void> {
  const searchInput = dropdown.locator('input[role="combobox"]').first();
  if (await searchInput.count()) {
    await searchInput.fill('');
    await searchInput.fill(searchText);
  } else {
    await page.keyboard.type(searchText);
  }
}

async function selectAntdOption(
  page: Page,
  trigger: Locator,
  optionText: string,
  searchText?: string,
): Promise<void> {
  const dropdown = await openAntdSelectDropdown(page, trigger);
  if (searchText) {
    await searchAntdSelectDropdown(page, dropdown, searchText);
  }
  const option = dropdown.locator('.ant-select-item-option').filter({ hasText: optionText }).first();
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
  // Confirm the click registered (auto-retries; не зависит от анимации закрытия).
  await expect(option).toHaveClass(/ant-select-item-option-selected/, { timeout: 10_000 });
  // Подтолкнуть закрытие дропдауна и дождаться исчезновения.
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () => page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').count(),
      { timeout: 15_000 },
    )
    .toBe(0);
}

async function assertDailyCrudOperationsDocumented(api: APIRequestContext) {
  const backendBaseUrl = API_BASE_URL.replace(/\/api\/v1$/, '');
  const openapiResponse = await api.get(`${backendBaseUrl}/openapi.json`);
  expect(openapiResponse.ok(), 'Failed to fetch /openapi.json while checking balances daily CRUD contract').toBeTruthy();
  const openapi = await openapiResponse.json();
  const dailyPath = openapi?.paths?.['/api/v1/balances/daily/{balance_id}'];
  const hasPut = !!dailyPath?.put;
  const hasDelete = !!dailyPath?.delete;
  expect(
    hasPut && hasDelete,
    'backend stale runtime, restart required: /openapi.json must contain put and delete for /api/v1/balances/daily/{balance_id}',
  ).toBeTruthy();
}

async function assertDailyCrudRuntimeNotStale(api: APIRequestContext, status: number, method: 'PUT' | 'DELETE') {
  if (status !== 404 && status !== 405) return;
  await assertDailyCrudOperationsDocumented(api);
  throw new Error(
    `${method} /balances/daily/{balance_id} returned ${status} while /openapi.json documents PUT and DELETE. backend stale runtime, restart required`,
  );
}

async function expandGroupIfCollapsed(panel: Locator, organizationName: string) {
  const groupRow = panel.locator('tr[data-row-key^="group:"]').filter({ hasText: organizationName }).first();
  await expect(groupRow).toBeVisible({ timeout: 15_000 });
  const expanded = await groupRow.getAttribute('aria-expanded');
  if (expanded !== 'true') {
    await groupRow.click();
  }
}

test.describe('UI regression: balances panel', () => {
  let api: APIRequestContext;
  let cashier: AuthSession;
  let feo: AuthSession;
  let initiator: AuthSession;
  let accountant: AuthSession;
  let director: AuthSession;
  let noBalanceViewUsername: string | undefined;
  let viewOnlyBalanceUser: { username: string; session: AuthSession } | undefined;

  test.beforeAll(async () => {
    api = await request.newContext();
    await assertDailyCrudOperationsDocumented(api);
    cashier = await loginApi(api, USERS.cashier);
    feo = await loginApi(api, USERS.feo);
    initiator = await loginApi(api, USERS.initiator);
    accountant = await loginApi(api, USERS.accountant);
    director = await loginApi(api, USERS.director);

    const candidates = [
      { username: USERS.initiator, session: initiator },
      { username: USERS.accountant, session: accountant },
      { username: USERS.director, session: director },
    ];
    noBalanceViewUsername = candidates.find((candidate) => (
      !candidate.session.permissions.includes('account_balance_view')
    ))?.username;
    viewOnlyBalanceUser = [
      { username: USERS.feo, session: feo },
      { username: USERS.director, session: director },
      { username: USERS.accountant, session: accountant },
      { username: USERS.initiator, session: initiator },
      { username: USERS.cashier, session: cashier },
    ].find((candidate) => (
      candidate.session.permissions.includes('account_balance_view')
      && !candidate.session.permissions.includes('account_balance_manage')
      && !candidate.session.user.is_superadmin
    ));
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('cashier sees expanded balances panel and can add/edit/delete daily balance with ₽ format', async ({ page }) => {
    test.setTimeout(120_000);
    expect(cashier.permissions).toContain('account_balance_view');
    expect(cashier.permissions).toContain('account_balance_manage');

    const uiMarker = marker('REG-P0-UI-BAL');
    const bankName = `REG UI BANK ${uiMarker}`;
    const accountNumber = `REG-UI-ACC-${uiMarker}`;
    const editedBankName = `REG UI BANK EDIT ${uiMarker}`;
    const editedAccountNumber = `REG-UI-ACC2-${uiMarker}`;
    const amountPattern = /123[\s\u00A0]456,78\s*₽/;
    const editedAmountPattern = /222[\s\u00A0]222,22\s*₽/;
    const organizations = await getJson<any[]>(api, cashier, '/dict/organizations');
    expect(Array.isArray(organizations) && organizations.length > 0).toBeTruthy();

    await loginUi(page, USERS.cashier);
    await page.goto('/cashier');

    const panel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Остатки по счетам')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Внести остатки' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Расчетные счета' })).toHaveCount(0);
    await expect(panel.locator('.ant-table-wrapper')).toHaveCount(1);
    const panelText = await panel.innerText();
    expect(panelText.includes('????')).toBeFalsy();

    const activeOrgTab = page.locator('.ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn').first();
    let targetOrganization = organizations[0];
    if (await activeOrgTab.count()) {
      const activeOrgTabText = (await activeOrgTab.innerText()).trim();
      const activeOrgName = activeOrgTabText.replace(/\s*\(\d+\)\s*$/, '');
      targetOrganization = organizations.find((org) => org.name === activeOrgName) ?? organizations[0];
    }
    const organizationId = targetOrganization.id as string;
    const organizationName = targetOrganization.name as string;

    await postJson<any>(api, cashier, '/balances/accounts', {
      organization_id: organizationId,
      bank_name: bankName,
      account_number: accountNumber,
      is_active: true,
    });
    const editedAccount = await postJson<any>(api, cashier, '/balances/accounts', {
      organization_id: organizationId,
      bank_name: editedBankName,
      account_number: editedAccountNumber,
      is_active: true,
    });

    await panel.getByRole('button', { name: 'Обновить остатки' }).click();

    await panel.getByRole('button', { name: 'Внести остатки' }).click();
    const balanceModal = page.locator('.ant-modal').filter({ hasText: 'Внести остатки' }).first();
    await expect(balanceModal).toBeVisible();
    await selectAntdOption(page, balanceModal.locator('.ant-select').first(), organizationName, organizationName);
    await selectAntdOption(page, balanceModal.locator('.ant-select').nth(1), accountNumber, uiMarker);
    await balanceModal.locator('input#amount').fill('123456.78');
    await balanceModal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(balanceModal).toBeHidden();

    await expandGroupIfCollapsed(panel, organizationName);
    const createdBalanceRow = panel.locator('tr').filter({ hasText: accountNumber }).first();
    await expect(createdBalanceRow).toBeVisible({ timeout: 15_000 });
    await expect(createdBalanceRow.getByText(accountNumber, { exact: false })).toBeVisible();
    await expect(createdBalanceRow.getByText(amountPattern)).toBeVisible();
    await expect(createdBalanceRow.getByRole('button', { name: 'Редактировать' })).toBeVisible();
    await expect(createdBalanceRow.getByRole('button', { name: 'Удалить' })).toBeVisible();

    const editRequestPromise = page.waitForRequest((request) => (
      request.method() === 'PUT'
      && request.url().includes('/balances/daily/')
    ));
    const editResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'PUT'
      && response.url().includes('/balances/daily/')
    ));
    await createdBalanceRow.getByRole('button', { name: 'Редактировать' }).click();
    const editModal = page.locator('.ant-modal').filter({ hasText: 'Редактировать остаток' }).first();
    await expect(editModal).toBeVisible();
    await selectAntdOption(page, editModal.locator('.ant-select').nth(1), editedAccountNumber, uiMarker);
    await editModal.locator('input#amount').fill('222222.22');
    await editModal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(editModal).toBeHidden();
    const editResponse = await editResponsePromise;
    const editStatus = editResponse.status();
    await assertDailyCrudRuntimeNotStale(api, editStatus, 'PUT');
    expect([200, 204]).toContain(editStatus);
    const editRequest = await editRequestPromise;
    const editPayload = editRequest.postDataJSON() as any;
    expect(editPayload.bank_account_id).toBe(editedAccount.id);
    expect(editPayload.amount).toBe(222222.22);

    const editedBalanceRow = panel.locator('tr').filter({ hasText: editedAccountNumber }).first();
    await expect(editedBalanceRow).toBeVisible({ timeout: 15_000 });
    await expect(editedBalanceRow.getByText(editedAmountPattern)).toBeVisible();

    const deleteRequestPromise = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes('/balances/daily/')
    ));
    await editedBalanceRow.getByRole('button', { name: 'Удалить' }).click();
    const deleteConfirm = page.locator('.ant-popconfirm:visible');
    await expect(deleteConfirm).toBeVisible();
    await deleteConfirm.locator('.ant-popconfirm-buttons .ant-btn-dangerous').click();
    const deleteResponse = await deleteRequestPromise;
    const deleteStatus = deleteResponse.status();
    await assertDailyCrudRuntimeNotStale(api, deleteStatus, 'DELETE');
    expect([200, 204]).toContain(deleteStatus);
    await expect(panel.locator('tr').filter({ hasText: editedAccountNumber })).toHaveCount(0, { timeout: 15_000 });

    const tableCount = await page.locator('.ant-table').count();
    expect(tableCount).toBeGreaterThan(0);
    await expect(page.locator('.ant-table').first()).toBeVisible();
    const tableHeadVisible = await page.locator('.ant-table-thead').first().isVisible().catch(() => false);
    expect(tableHeadVisible).toBeTruthy();
  });

  test('view-only user sees balances panel in read-only mode (no manage buttons)', async ({ page }) => {
    test.skip(
      !viewOnlyBalanceUser,
      'No user with account_balance_view and without account_balance_manage in current environment.',
    );
    expect(viewOnlyBalanceUser!.session.permissions).toContain('account_balance_view');
    expect(viewOnlyBalanceUser!.session.permissions).not.toContain('account_balance_manage');

    await loginUi(page, viewOnlyBalanceUser!.username);
    await page.goto('/cashier');

    const panel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Внести остатки' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Расчетные счета' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Редактировать' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
  });

  test('user without account_balance_view does not see balances panel', async ({ page }) => {
    test.skip(!noBalanceViewUsername, 'No user without account_balance_view in current environment.');

    await loginUi(page, noBalanceViewUsername!);
    await page.goto('/dashboard');
    await expect(page.getByText('Остатки по счетам')).toHaveCount(0);
  });

  test('collapse defaults and persistence are correct on dashboard and cashier', async ({ page }) => {
    await loginUi(page, USERS.cashier);

    const userId = await getUserIdFromStorage(page);
    await page.evaluate((uid) => {
      if (!uid) return;
      localStorage.removeItem(`ui_balances_panel_dashboard_${uid}`);
      localStorage.removeItem(`ui_balances_panel_cashier_${uid}`);
    }, userId);

    await page.goto('/dashboard');
    const dashboardPanel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(dashboardPanel).toBeVisible();
    await expect(dashboardPanel.locator('.ant-table-wrapper')).toHaveCount(0);
    await dashboardPanel.getByRole('button', { name: 'Развернуть' }).click();
    await expect(dashboardPanel.locator('.ant-table-wrapper')).toHaveCount(1);
    await page.reload();
    await expect(dashboardPanel.locator('.ant-table-wrapper')).toHaveCount(1);
    expect(await page.locator('.ant-table').count()).toBeGreaterThan(1);
    await expect(page.locator('.ant-table-thead').first()).toBeVisible();

    await page.goto('/cashier');
    const cashierPanel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(cashierPanel).toBeVisible();
    await expect(cashierPanel.locator('.ant-table-wrapper')).toHaveCount(1);
    await cashierPanel.getByRole('button', { name: 'Свернуть' }).click();
    await expect(cashierPanel.locator('.ant-table-wrapper')).toHaveCount(0);
    await page.reload();
    await expect(cashierPanel.locator('.ant-table-wrapper')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    const pageTables = page.locator('.ant-table');
    const tableCount = await pageTables.count();
    const visibleEmptyStates = await page.locator('.ant-empty:visible').count();
    const noRequestsTextVisible = await page.getByText('Нет заявок по текущим фильтрам').first().isVisible().catch(() => false);
    expect(tableCount > 0 || visibleEmptyStates > 0 || noRequestsTextVisible).toBeTruthy();
    if (tableCount > 0) {
      await expect(pageTables.first()).toBeVisible();
      const tableHeads = page.locator('.ant-table-thead');
      if (await tableHeads.count()) {
        await expect(tableHeads.first()).toBeVisible();
      }
    }
  });

  test('dashboard balances follow organization/date filters and selected day in day mode', async ({ page }) => {
    test.setTimeout(120_000);
    expect(cashier.permissions).toContain('account_balance_view');
    expect(cashier.permissions).toContain('req_view_all');

    const organizations = await getJson<any[]>(api, cashier, '/dict/organizations');
    expect(Array.isArray(organizations) && organizations.length > 0).toBeTruthy();
    const targetOrg = organizations[0];

    await loginUi(page, USERS.cashier);
    const userId = await getUserIdFromStorage(page);
    await page.evaluate((uid) => {
      if (!uid) return;
      localStorage.removeItem(`ui_balances_panel_dashboard_${uid}`);
      localStorage.setItem('ui_registry_day_tabs', 'false');
    }, userId);

    await page.goto('/dashboard');
    const panel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(panel).toBeVisible();

    const filtersCard = page.locator('.ant-card').filter({ has: page.locator('.ant-picker-range') }).first();
    const dateInputs = filtersCard.locator('.ant-picker-range input');
    const rangeFromText = await dateInputs.nth(0).inputValue();
    const rangeToText = await dateInputs.nth(1).inputValue();
    const expectedRangeFrom = ruDateToIso(rangeFromText);
    const expectedRangeTo = ruDateToIso(rangeToText);

    const initialBalanceRequestPromise = page.waitForRequest((request) => (
      request.method() === 'GET' && request.url().includes('/balances/daily')
    ));
    await panel.getByRole('button', { name: 'Развернуть' }).click();
    const initialBalanceRequest = await initialBalanceRequestPromise;
    const initialParams = new URL(initialBalanceRequest.url()).searchParams;
    expect(initialParams.get('date_from')).toBe(expectedRangeFrom);
    expect(initialParams.get('date_to')).toBe(expectedRangeTo);

    const organizationRequestPromise = page.waitForRequest((request) => {
      if (request.method() !== 'GET' || !request.url().includes('/balances/daily')) return false;
      const params = new URL(request.url()).searchParams;
      return params.get('organization_id') === targetOrg.id;
    });
    await selectAntdOption(page, filtersCard.locator('.ant-select').first(), targetOrg.name, targetOrg.name);
    const orgBalanceRequest = await organizationRequestPromise;
    const orgParams = new URL(orgBalanceRequest.url()).searchParams;
    expect(orgParams.get('organization_id')).toBe(targetOrg.id);
    expect(orgParams.get('date_from')).toBe(expectedRangeFrom);
    expect(orgParams.get('date_to')).toBe(expectedRangeTo);

    const singleDayRu = rangeFromText;
    const singleDayIso = ruDateToIso(singleDayRu);
    const singleDayRequestPromise = page.waitForRequest((request) => {
      if (request.method() !== 'GET' || !request.url().includes('/balances/daily')) return false;
      const params = new URL(request.url()).searchParams;
      return params.get('date_from') === singleDayIso && params.get('date_to') === singleDayIso;
    });
    await dateInputs.nth(0).fill(singleDayRu);
    await dateInputs.nth(1).fill(singleDayRu);
    await dateInputs.nth(1).press('Enter');
    await singleDayRequestPromise;

    const restoreRangeRequestPromise = page.waitForRequest((request) => {
      if (request.method() !== 'GET' || !request.url().includes('/balances/daily')) return false;
      const params = new URL(request.url()).searchParams;
      return params.get('date_from') === expectedRangeFrom && params.get('date_to') === expectedRangeTo;
    });
    await dateInputs.nth(0).fill(rangeFromText);
    await dateInputs.nth(1).fill(rangeToText);
    await dateInputs.nth(1).press('Enter');
    await restoreRangeRequestPromise;

    const clearOrganization = filtersCard.locator('.ant-select-clear').first();
    if (await clearOrganization.count()) {
      const clearOrgRequestPromise = page.waitForRequest((request) => {
        if (request.method() !== 'GET' || !request.url().includes('/balances/daily')) return false;
        const params = new URL(request.url()).searchParams;
        return !params.get('organization_id');
      });
      await filtersCard.locator('.ant-select').first().hover();
      await expect(clearOrganization).toBeVisible();
      await clearOrganization.click();
      const clearOrgRequest = await clearOrgRequestPromise;
      const clearOrgParams = new URL(clearOrgRequest.url()).searchParams;
      expect(clearOrgParams.get('organization_id')).toBeNull();
    }

    await page.evaluate(() => {
      localStorage.setItem('ui_registry_day_tabs', 'true');
    });
    await page.reload();
    await expect(panel).toBeVisible();
    const expandAfterReload = panel.getByRole('button', { name: 'Развернуть' });
    if (await expandAfterReload.count()) {
      const dayModeInitialRequestPromise = page.waitForRequest((request) => (
        request.method() === 'GET' && request.url().includes('/balances/daily')
      ));
      await expandAfterReload.click();
      const dayModeInitialRequest = await dayModeInitialRequestPromise;
      const dayModeInitialParams = new URL(dayModeInitialRequest.url()).searchParams;
      expect(dayModeInitialParams.get('date_from')).toBe(dayModeInitialParams.get('date_to'));

      const activeDayTab = page.locator('.ant-tabs-tab.ant-tabs-tab-active').first();
      if (await activeDayTab.count()) {
        const activeDayText = (await activeDayTab.innerText()).trim();
        if (/^\d{2}\.\d{2}\.\d{4}$/.test(activeDayText)) {
          const activeDayIso = ruDateToIso(activeDayText);
          expect(dayModeInitialParams.get('date_from')).toBe(activeDayIso);
          expect(dayModeInitialParams.get('date_to')).toBe(activeDayIso);
        }
      }
    }

    let dayTabs = page.locator('.ant-tabs-tab').filter({ hasText: /\d{2}\.\d{2}\.\d{4}/ });
    let dayTabsCount = await dayTabs.count();
    dayTabs = page.locator('.ant-tabs-tab').filter({ hasText: /\d{2}\.\d{2}\.\d{4}/ });
    dayTabsCount = await dayTabs.count();
    test.skip(dayTabsCount < 2, 'Not enough day tabs in current dataset to verify day switch behavior.');
    const firstDayText = (await dayTabs.nth(0).innerText()).trim();
    const secondDayText = (await dayTabs.nth(1).innerText()).trim();
    expect(secondDayText).not.toBe(firstDayText);
    const secondDayIso = ruDateToIso(secondDayText);

    const daySwitchRequestPromise = page.waitForRequest((request) => {
      if (request.method() !== 'GET' || !request.url().includes('/balances/daily')) return false;
      const params = new URL(request.url()).searchParams;
      return params.get('date_from') === secondDayIso && params.get('date_to') === secondDayIso;
    });
    await dayTabs.nth(1).click();
    const daySwitchRequest = await daySwitchRequestPromise;
    const daySwitchParams = new URL(daySwitchRequest.url()).searchParams;
    expect(daySwitchParams.get('date_from')).toBe(secondDayIso);
    expect(daySwitchParams.get('date_to')).toBe(secondDayIso);
  });

  test('balances are grouped by organization on dashboard and cashier', async ({ page }) => {
    test.setTimeout(120_000);
    expect(cashier.permissions).toContain('account_balance_view');
    expect(cashier.permissions).toContain('account_balance_manage');

    const m = marker('REG-P0-BAL-GROUP');
    const organizations = await getJson<any[]>(api, cashier, '/dict/organizations');
    expect(Array.isArray(organizations) && organizations.length > 0).toBeTruthy();
    const firstOrg = organizations[0];
    const secondOrg = organizations.length > 1 ? organizations[1] : organizations[0];
    const todayIso = new Date().toISOString().slice(0, 10);

    const dashboardAccountOneNumber = `REG-GRP-1-${m}`;
    const dashboardAccountTwoNumber = `REG-GRP-2-${m}`;
    const dashboardAccountOne = await postJson<any>(api, cashier, '/balances/accounts', {
      organization_id: firstOrg.id,
      bank_name: `REG GROUP BANK 1 ${m}`,
      account_number: dashboardAccountOneNumber,
      is_active: true,
    });
    const dashboardAccountTwo = await postJson<any>(api, cashier, '/balances/accounts', {
      organization_id: secondOrg.id,
      bank_name: `REG GROUP BANK 2 ${m}`,
      account_number: dashboardAccountTwoNumber,
      is_active: true,
    });
    await postJson<any>(api, cashier, '/balances/daily', {
      balance_date: todayIso,
      organization_id: firstOrg.id,
      bank_account_id: dashboardAccountOne.id,
      amount: 1000.5,
    });
    await postJson<any>(api, cashier, '/balances/daily', {
      balance_date: todayIso,
      organization_id: secondOrg.id,
      bank_account_id: dashboardAccountTwo.id,
      amount: 2000.75,
    });

    await loginUi(page, USERS.cashier);
    await page.goto('/dashboard');
    const dashboardPanel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(dashboardPanel).toBeVisible();
    const expandDashboard = dashboardPanel.getByRole('button', { name: 'Развернуть' });
    if (await expandDashboard.count()) {
      await expandDashboard.click();
    }
    await dashboardPanel.getByRole('button', { name: 'Обновить остатки' }).click();
    await expect(dashboardPanel.locator('tr[data-row-key^="group:"]').first()).toBeVisible({ timeout: 15_000 });

    const dashboardGroupOne = dashboardPanel.locator('tr[data-row-key^="group:"]').filter({ hasText: firstOrg.name }).first();
    await expect(dashboardGroupOne).toBeVisible({ timeout: 15_000 });
    await expandGroupIfCollapsed(dashboardPanel, firstOrg.name);
    await expect(dashboardPanel.locator('tr').filter({ hasText: dashboardAccountOneNumber }).first()).toBeVisible({ timeout: 15_000 });

    if (secondOrg.id !== firstOrg.id || secondOrg.name !== firstOrg.name) {
      const dashboardGroupTwo = dashboardPanel.locator('tr[data-row-key^="group:"]').filter({ hasText: secondOrg.name }).first();
      await expect(dashboardGroupTwo).toBeVisible({ timeout: 15_000 });
      await expandGroupIfCollapsed(dashboardPanel, secondOrg.name);
      await expect(dashboardPanel.locator('tr').filter({ hasText: dashboardAccountTwoNumber }).first()).toBeVisible({ timeout: 15_000 });
    } else {
      await expect(dashboardPanel.locator('tr').filter({ hasText: dashboardAccountTwoNumber }).first()).toBeVisible({ timeout: 15_000 });
    }

    await page.goto('/cashier');
    const cashierPanel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(cashierPanel).toBeVisible();
    const expandCashier = cashierPanel.getByRole('button', { name: 'Развернуть' });
    if (await expandCashier.count()) {
      await expandCashier.click();
    }

    const activeOrgTab = page.locator('.ant-tabs-tab.ant-tabs-tab-active .ant-tabs-tab-btn').first();
    let cashierOrg = firstOrg;
    if (await activeOrgTab.count()) {
      const activeOrgTabText = (await activeOrgTab.innerText()).trim();
      const cashierOrgName = activeOrgTabText.replace(/\s*\(\d+\)\s*$/, '');
      cashierOrg = organizations.find((org) => org.name === cashierOrgName) ?? firstOrg;
    }

    const cashierAccountNumber = `REG-GRP-CASH-${m}`;
    const cashierAccount = await postJson<any>(api, cashier, '/balances/accounts', {
      organization_id: cashierOrg.id,
      bank_name: `REG GROUP CASH BANK ${m}`,
      account_number: cashierAccountNumber,
      is_active: true,
    });
    await postJson<any>(api, cashier, '/balances/daily', {
      balance_date: todayIso,
      organization_id: cashierOrg.id,
      bank_account_id: cashierAccount.id,
      amount: 3030.3,
    });

    await cashierPanel.getByRole('button', { name: 'Обновить остатки' }).click();
    const cashierGroupRow = cashierPanel.locator('tr[data-row-key^="group:"]').filter({ hasText: cashierOrg.name }).first();
    await expect(cashierGroupRow).toBeVisible({ timeout: 15_000 });
    await expandGroupIfCollapsed(cashierPanel, cashierOrg.name);
    await expect(cashierPanel.locator('tr').filter({ hasText: cashierAccountNumber }).first()).toBeVisible({ timeout: 15_000 });
  });
});
