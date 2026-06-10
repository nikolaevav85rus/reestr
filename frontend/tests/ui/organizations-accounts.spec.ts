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

async function openAccountsModalFromFirstOrganization(page: Page) {
  const organizationsTable = page.locator('.ant-tabs-tabpane-active .ant-table').first();
  const firstRow = organizationsTable.locator('tbody tr:not(.ant-table-measure-row):not(.ant-table-placeholder)').first();
  await expect(firstRow).toBeVisible({ timeout: 15_000 });
  const organizationName = (await firstRow.locator('td').first().innerText()).trim();
  await firstRow.getByRole('button', { name: 'Расчетные счета' }).click();

  const accountsModal = page.locator('.ant-modal').filter({ hasText: 'Расчетные счета:' }).first();
  await expect(accountsModal).toBeVisible();

  return { organizationName, accountsModal };
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

  // Confirm the click registered by asserting the option is marked selected.
  // This auto-retries and does not depend on the dropdown's close animation.
  await expect(option).toHaveClass(/ant-select-item-option-selected/, { timeout: 10_000 });

  // Nudge the dropdown closed (in case it lingers) and wait for it to go away.
  // We tolerate the close animation lagging: the dropdown is considered "done"
  // once it is either detached or carries the hidden class.
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () =>
        page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').count(),
      { timeout: 15_000 },
    )
    .toBe(0);
}

async function assertDeleteOperationDocumented(api: APIRequestContext) {
  const backendBaseUrl = API_BASE_URL.replace(/\/api\/v1$/, '');
  const openapiResponse = await api.get(`${backendBaseUrl}/openapi.json`);
  expect(openapiResponse.ok(), 'Failed to fetch /openapi.json while checking DELETE contract').toBeTruthy();
  const openapi = await openapiResponse.json();
  expect(
    openapi?.paths?.['/api/v1/balances/accounts/{account_id}']?.delete,
    'DELETE /api/v1/balances/accounts/{account_id} is missing in /openapi.json',
  ).toBeTruthy();
}

async function assertDeleteRuntimeNotStale(api: APIRequestContext, status: number) {
  if (status !== 405) return;
  await assertDeleteOperationDocumented(api);
  throw new Error(
    'DELETE /api/v1/balances/accounts/{account_id} returned 405 while endpoint exists in /openapi.json. Backend runtime is likely stale and must be restarted.',
  );
}

test.describe('UI regression: organization bank accounts management', () => {
  let api: APIRequestContext;
  let admin: AuthSession;
  let cashier: AuthSession;
  let feo: AuthSession;
  let initiator: AuthSession;
  let accountant: AuthSession;
  let director: AuthSession;
  let manageWithoutDeleteUsername: string | undefined;
  let deleteCapableUsername: string | undefined;
  let noBalanceViewUsername: string | undefined;
  let viewOnlyBalanceUser: { username: string; session: AuthSession } | undefined;

  test.beforeAll(async () => {
    api = await request.newContext();
    admin = await loginApi(api, USERS.admin);
    cashier = await loginApi(api, USERS.cashier);
    feo = await loginApi(api, USERS.feo);
    initiator = await loginApi(api, USERS.initiator);
    accountant = await loginApi(api, USERS.accountant);
    director = await loginApi(api, USERS.director);

    const noViewCandidates = [
      { username: USERS.initiator, session: initiator },
      { username: USERS.accountant, session: accountant },
      { username: USERS.director, session: director },
    ];
    noBalanceViewUsername = noViewCandidates.find((candidate) => (
      !candidate.session.permissions.includes('account_balance_view')
    ))?.username;
    viewOnlyBalanceUser = [
      { username: USERS.feo, session: feo },
      { username: USERS.director, session: director },
      { username: USERS.accountant, session: accountant },
      { username: USERS.initiator, session: initiator },
      { username: USERS.cashier, session: cashier },
      { username: USERS.admin, session: admin },
    ].find((candidate) => (
      candidate.session.permissions.includes('account_balance_view')
      && !candidate.session.permissions.includes('account_balance_manage')
      && !candidate.session.user.is_superadmin
    ));

    const manageCandidates = [
      { username: USERS.cashier, session: cashier },
      { username: USERS.admin, session: admin },
      { username: USERS.accountant, session: accountant },
      { username: USERS.director, session: director },
      { username: USERS.initiator, session: initiator },
    ];
    manageWithoutDeleteUsername = manageCandidates.find((candidate) => (
      candidate.session.permissions.includes('account_balance_manage')
      && !candidate.session.permissions.includes('dict_delete')
      && !candidate.session.user.is_superadmin
    ))?.username;

    const deleteCandidates = [
      { username: USERS.admin, session: admin },
      { username: USERS.cashier, session: cashier },
      { username: USERS.accountant, session: accountant },
      { username: USERS.director, session: director },
      { username: USERS.feo, session: feo },
      { username: USERS.initiator, session: initiator },
    ];
    deleteCapableUsername = deleteCandidates.find((candidate) => (
      candidate.session.permissions.includes('dict_delete') || !!candidate.session.user.is_superadmin
    ))?.username;
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('cashier can open organization accounts, create and edit account, deactivate it', async ({ page }) => {
    test.setTimeout(120_000);
    expect(cashier.permissions).toContain('account_balance_view');
    expect(cashier.permissions).toContain('account_balance_manage');

    const m = marker('REG-P0-ORG-ACC');
    const bankName = `ORG BANK ${m}`;
    const updatedBankName = `ORG BANK EDIT ${m}`;
    const accountNumber = `ORG-ACC-${m}`;

    await loginUi(page, USERS.cashier);
    await page.goto('/organizations');

    const { accountsModal } = await openAccountsModalFromFirstOrganization(page);
    await expect(accountsModal.getByRole('button', { name: 'Добавить счет' })).toBeVisible();
    await accountsModal.getByRole('button', { name: 'Добавить счет' }).click();

    const createModal = page.locator('.ant-modal').filter({ hasText: 'Новый расчетный счет' }).first();
    await expect(createModal).toBeVisible();
    await createModal.locator('input#bank_name').fill(bankName);
    await createModal.locator('input#account_number').fill(accountNumber);
    await createModal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(createModal).toBeHidden();

    const createdRow = accountsModal.locator('tr').filter({ hasText: accountNumber }).first();
    await expect(createdRow).toBeVisible({ timeout: 15_000 });
    await expect(createdRow.getByText(bankName, { exact: false })).toBeVisible();

    await createdRow.getByRole('button', { name: 'Изменить' }).click();
    const editModal = page.locator('.ant-modal').filter({ hasText: 'Изменить расчетный счет' }).first();
    await expect(editModal).toBeVisible();
    await editModal.locator('input#bank_name').fill(updatedBankName);
    const activeSwitch = editModal.locator('button[role="switch"]').first();
    if ((await activeSwitch.getAttribute('aria-checked')) === 'true') {
      await activeSwitch.click();
    }
    await editModal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(editModal).toBeHidden();

    const updatedRow = accountsModal.locator('tr').filter({ hasText: accountNumber }).first();
    await expect(updatedRow.getByText(updatedBankName, { exact: false })).toBeVisible();
    await expect(updatedRow.getByText('Неактивный')).toBeVisible();
  });

  test('view-only user can view organization accounts but cannot add or edit', async ({ page }) => {
    test.skip(
      !viewOnlyBalanceUser,
      'No user with account_balance_view and without account_balance_manage in current environment.',
    );
    expect(viewOnlyBalanceUser!.session.permissions).toContain('account_balance_view');
    expect(viewOnlyBalanceUser!.session.permissions).not.toContain('account_balance_manage');

    await loginUi(page, viewOnlyBalanceUser!.username);
    await page.goto('/organizations');

    const { accountsModal } = await openAccountsModalFromFirstOrganization(page);
    await expect(accountsModal.getByRole('button', { name: 'Добавить счет' })).toHaveCount(0);
    await expect(accountsModal.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
  });

  test('user with account_balance_manage but without dict_delete cannot see delete action', async ({ page }) => {
    expect(manageWithoutDeleteUsername, 'No user with account_balance_manage and without dict_delete in current environment').toBeTruthy();

    await loginUi(page, manageWithoutDeleteUsername!);
    await page.goto('/organizations');

    const { accountsModal } = await openAccountsModalFromFirstOrganization(page);
    await expect(accountsModal.getByRole('button', { name: /Удалить/i })).toHaveCount(0);
  });

  test('user without account_balance_view does not see organization accounts action', async ({ page }) => {
    expect(noBalanceViewUsername, 'No user without account_balance_view in current environment').toBeTruthy();

    await loginUi(page, noBalanceViewUsername!);
    await page.goto('/organizations');

    const organizationsTable = page.locator('.ant-table').first();
    await expect(organizationsTable).toBeVisible({ timeout: 15_000 });
    await expect(organizationsTable.getByRole('button', { name: 'Расчетные счета' })).toHaveCount(0);
  });

  test('user with dict_delete or superadmin sees delete action in organization accounts modal', async ({ page }) => {
    expect(deleteCapableUsername, 'No user with dict_delete or superadmin in current environment').toBeTruthy();

    const sessionsByUsername: Record<string, AuthSession> = {
      [USERS.admin]: admin,
      [USERS.cashier]: cashier,
      [USERS.feo]: feo,
      [USERS.initiator]: initiator,
      [USERS.accountant]: accountant,
      [USERS.director]: director,
    };
    const deleteSession = sessionsByUsername[deleteCapableUsername!];
    const m = marker('REG-P0-ORG-DEL-VIS');

    await loginUi(page, deleteCapableUsername!);
    await page.goto('/organizations');

    const { organizationName, accountsModal } = await openAccountsModalFromFirstOrganization(page);
    const organizations = await getJson<any[]>(api, deleteSession, '/dict/organizations');
    const organization = organizations.find(org => org.name === organizationName) ?? organizations[0];
    expect(organization?.id).toBeTruthy();

    const accountNumber = `ORG-DEL-VIS-${m}`;
    await postJson<any>(api, deleteSession, '/balances/accounts', {
      organization_id: organization.id,
      bank_name: `ORG DEL VIS ${m}`,
      account_number: accountNumber,
      is_active: true,
    });

    await accountsModal.locator('button.ant-modal-close').click();
    await expect(accountsModal).toBeHidden();
    const reopened = await openAccountsModalFromFirstOrganization(page);
    const row = reopened.accountsModal.locator('tr').filter({ hasText: accountNumber }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByRole('button', { name: /Удалить/i })).toBeVisible();
  });

  test('account without balances is deleted from organization accounts modal', async ({ page }) => {
    test.setTimeout(120_000);
    expect(deleteCapableUsername, 'No user with dict_delete or superadmin in current environment').toBeTruthy();

    const sessionsByUsername: Record<string, AuthSession> = {
      [USERS.admin]: admin,
      [USERS.cashier]: cashier,
      [USERS.feo]: feo,
      [USERS.initiator]: initiator,
      [USERS.accountant]: accountant,
      [USERS.director]: director,
    };
    const deleteSession = sessionsByUsername[deleteCapableUsername!];
    const m = marker('REG-P0-ORG-DEL-FREE');

    await loginUi(page, deleteCapableUsername!);
    await page.goto('/organizations');
    const { organizationName, accountsModal } = await openAccountsModalFromFirstOrganization(page);

    const organizations = await getJson<any[]>(api, deleteSession, '/dict/organizations');
    const organization = organizations.find(org => org.name === organizationName) ?? organizations[0];
    expect(organization?.id).toBeTruthy();

    const freeAccountNumber = `ORG-DEL-FREE-${m}`;
    const freeAccount = await postJson<any>(api, deleteSession, '/balances/accounts', {
      organization_id: organization.id,
      bank_name: `ORG DEL FREE ${m}`,
      account_number: freeAccountNumber,
      is_active: true,
    });

    await accountsModal.locator('button.ant-modal-close').click();
    await expect(accountsModal).toBeHidden();

    const reopened = await openAccountsModalFromFirstOrganization(page);
    const reloadedModal = reopened.accountsModal;
    const freeRow = reloadedModal.locator('tr').filter({ hasText: freeAccountNumber }).first();
    await expect(freeRow).toBeVisible({ timeout: 15_000 });

    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes(`/balances/accounts/${freeAccount.id}`)
    ));

    await freeRow.getByRole('button', { name: /Удалить/i }).click();
    const confirm = page.locator('.ant-popconfirm:visible');
    await expect(confirm).toBeVisible();
    await confirm.locator('.ant-popconfirm-buttons .ant-btn-dangerous').click();

    const deleteResponse = await deleteResponsePromise;
    await assertDeleteRuntimeNotStale(api, deleteResponse.status());
    expect(deleteResponse.status()).toBe(200);

    await reloadedModal.locator('button.ant-modal-close').click();
    await expect(reloadedModal).toBeHidden();

    const reopenedAfterDelete = await openAccountsModalFromFirstOrganization(page);
    const modalAfterDelete = reopenedAfterDelete.accountsModal;
    await expect(modalAfterDelete.locator('tr').filter({ hasText: freeAccountNumber })).toHaveCount(0);
  });

  test('account with balances is not deleted and shows backend text with disable hint', async ({ page }) => {
    test.setTimeout(120_000);
    expect(deleteCapableUsername, 'No user with dict_delete or superadmin in current environment').toBeTruthy();

    const sessionsByUsername: Record<string, AuthSession> = {
      [USERS.admin]: admin,
      [USERS.cashier]: cashier,
      [USERS.feo]: feo,
      [USERS.initiator]: initiator,
      [USERS.accountant]: accountant,
      [USERS.director]: director,
    };
    const deleteSession = sessionsByUsername[deleteCapableUsername!];
    const m = marker('REG-P0-ORG-DEL-BUSY');

    await loginUi(page, deleteCapableUsername!);
    await page.goto('/organizations');
    const { organizationName, accountsModal } = await openAccountsModalFromFirstOrganization(page);

    const organizations = await getJson<any[]>(api, deleteSession, '/dict/organizations');
    const organization = organizations.find(org => org.name === organizationName) ?? organizations[0];
    expect(organization?.id).toBeTruthy();

    const busyAccountNumber = `ORG-DEL-BUSY-${m}`;
    const busyAccount = await postJson<any>(api, deleteSession, '/balances/accounts', {
      organization_id: organization.id,
      bank_name: `ORG DEL BUSY ${m}`,
      account_number: busyAccountNumber,
      is_active: true,
    });
    await postJson<any>(api, deleteSession, '/balances/daily', {
      balance_date: new Date().toISOString().slice(0, 10),
      organization_id: organization.id,
      bank_account_id: busyAccount.id,
      amount: 321.45,
    });

    await accountsModal.locator('button.ant-modal-close').click();
    await expect(accountsModal).toBeHidden();

    const reopened = await openAccountsModalFromFirstOrganization(page);
    const reloadedModal = reopened.accountsModal;
    const busyRow = reloadedModal.locator('tr').filter({ hasText: busyAccountNumber }).first();
    await expect(busyRow).toBeVisible({ timeout: 15_000 });

    const deleteResponsePromise = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && response.url().includes(`/balances/accounts/${busyAccount.id}`)
    ));

    await busyRow.getByRole('button', { name: /Удалить/i }).click();
    const confirm = page.locator('.ant-popconfirm:visible');
    await expect(confirm).toBeVisible();
    await confirm.locator('.ant-popconfirm-buttons .ant-btn-dangerous').click();

    const deleteResponse = await deleteResponsePromise;
    await assertDeleteRuntimeNotStale(api, deleteResponse.status());
    expect(deleteResponse.status()).toBe(400);

    await expect(busyRow).toBeVisible({ timeout: 15_000 });
    const messageContent = page.locator('.ant-message .ant-message-notice-content');
    await expect(messageContent.filter({ hasText: 'Нельзя удалить расчетный счет: по нему есть остатки. Отключите счет.' }).first()).toBeVisible();
    await expect(messageContent.filter({ hasText: 'Подсказка: отключите счет' }).first()).toBeVisible();
  });

  test('account created in organizations is available in cashier daily balance form', async ({ page }) => {
    test.setTimeout(120_000);
    const m = marker('REG-P0-ORG-LINK');
    const bankName = `ORG LINK BANK ${m}`;
    const accountNumber = `ORG-LINK-ACC-${m}`;

    await loginUi(page, USERS.cashier);
    await page.goto('/organizations');
    const { organizationName, accountsModal } = await openAccountsModalFromFirstOrganization(page);

    await accountsModal.getByRole('button', { name: 'Добавить счет' }).click();
    const createModal = page.locator('.ant-modal').filter({ hasText: 'Новый расчетный счет' }).first();
    await expect(createModal).toBeVisible();
    await createModal.locator('input#bank_name').fill(bankName);
    await createModal.locator('input#account_number').fill(accountNumber);
    await createModal.locator('.ant-modal-footer .ant-btn-primary').click();
    await expect(createModal).toBeHidden();
    await expect(accountsModal.locator('tr').filter({ hasText: accountNumber }).first()).toBeVisible({ timeout: 15_000 });
    await accountsModal.locator('button.ant-modal-close').click();
    await expect(accountsModal).toBeHidden();

    await page.goto('/cashier');
    const panel = page.locator('.ant-card').filter({ hasText: 'Остатки по счетам' }).first();
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Внести остатки' }).click();

    const balanceModal = page.locator('.ant-modal:visible').filter({ hasText: 'Внести остатки' }).first();
    await expect(balanceModal).toBeVisible();
    await selectAntdOption(page, balanceModal.locator('.ant-select').first(), organizationName, organizationName);
    const accountDropdown = await openAntdSelectDropdown(page, balanceModal.getByRole('combobox').nth(1));
    await searchAntdSelectDropdown(page, accountDropdown, m);
    await expect(accountDropdown.locator('.ant-select-item-option').filter({ hasText: accountNumber }).first()).toBeVisible({ timeout: 15_000 });
  });
});
