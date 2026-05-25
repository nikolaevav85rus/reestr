import { expect, request, test, type APIRequestContext } from '@playwright/test';
import {
  API_BASE_URL,
  authHeaders,
  getJson,
  loginApi,
  marker,
  USERS,
  type AuthSession,
} from '../helpers/api';

type Organization = {
  id: string;
  name: string;
};

type BankAccount = {
  id: string;
  organization_id: string;
  bank_name: string;
  account_number: string;
  is_active: boolean;
  organization?: Organization;
};

type DailyBalance = {
  id: string;
  balance_date: string;
  organization_id: string;
  bank_account_id: string;
  amount: number;
  organization?: Organization;
  bank_account?: {
    id: string;
    bank_name: string;
    account_number: string;
    is_active: boolean;
  };
};

type RoleSession = {
  username: string;
  session: AuthSession;
};

test.describe('API regression: balances on morning accounts', () => {
  let api: APIRequestContext;
  let admin: AuthSession;
  let cashier: AuthSession;
  let feo: AuthSession;
  let initiator: AuthSession;
  let accountant: AuthSession;
  let director: AuthSession;
  let firstOrganization: Organization;
  let noBalanceViewUser: RoleSession | undefined;
  let viewWithoutManageUser: RoleSession | undefined;
  let createdAccount: BankAccount | undefined;
  let upsertedBalance: DailyBalance | undefined;
  let upsertDate: string;

  test.beforeAll(async () => {
    api = await request.newContext();
    admin = await loginApi(api, USERS.admin);
    cashier = await loginApi(api, USERS.cashier);
    feo = await loginApi(api, USERS.feo);
    initiator = await loginApi(api, USERS.initiator);
    accountant = await loginApi(api, USERS.accountant);
    director = await loginApi(api, USERS.director);

    const organizations = await getJson<Organization[]>(api, admin, '/dict/organizations');
    expect(organizations.length, 'No organizations found in dictionary').toBeGreaterThan(0);
    firstOrganization = organizations[0];

    noBalanceViewUser = [
      { username: USERS.initiator, session: initiator },
      { username: USERS.accountant, session: accountant },
      { username: USERS.director, session: director },
    ].find((candidate) => !candidate.session.permissions.includes('account_balance_view'));
    viewWithoutManageUser = [
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

    upsertDate = new Date().toISOString().slice(0, 10);

    const migrationProbe = await api.get(`${API_BASE_URL}/balances/accounts`, {
      headers: authHeaders(admin),
    });
    expect(migrationProbe.status(), 'Balances endpoint probe failed (migration or route issue)').toBe(200);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('user without account_balance_view gets 403 on GET /balances/accounts', async () => {
    test.skip(!noBalanceViewUser, 'No test user without account_balance_view in current environment.');

    const response = await api.get(`${API_BASE_URL}/balances/accounts`, {
      headers: authHeaders(noBalanceViewUser!.session),
    });
    expect(
      noBalanceViewUser!.session.permissions.includes('account_balance_view'),
      `${noBalanceViewUser!.username} unexpectedly has account_balance_view`,
    ).toBeFalsy();
    expect(response.status()).toBe(403);
  });

  test('user with account_balance_view gets 200 on GET /balances/accounts', async () => {
    expect(feo.permissions).toContain('account_balance_view');

    const response = await api.get(`${API_BASE_URL}/balances/accounts`, {
      headers: authHeaders(feo),
    });
    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload)).toBeTruthy();
  });

  test('user without account_balance_manage gets 403 on POST /balances/accounts', async () => {
    test.skip(
      !viewWithoutManageUser,
      'No test user with account_balance_view and without account_balance_manage in current environment.',
    );
    expect(viewWithoutManageUser!.session.permissions).toContain('account_balance_view');
    expect(viewWithoutManageUser!.session.permissions).not.toContain('account_balance_manage');

    const response = await api.post(`${API_BASE_URL}/balances/accounts`, {
      headers: authHeaders(viewWithoutManageUser!.session),
      data: {
        organization_id: firstOrganization.id,
        bank_name: `BANK-${marker('REG-P0-BAL-NOMANAGE')}`,
        account_number: `ACC-${marker('REG-P0-BAL-NOMANAGE')}`,
        is_active: true,
      },
    });
    expect(response.status()).toBe(403);
  });

  test('cashier can create bank account via POST /balances/accounts', async () => {
    expect(cashier.permissions).toContain('account_balance_view');
    expect(cashier.permissions).toContain('account_balance_manage');

    const accountMarker = marker('REG-P0-BAL-ACC');
    const response = await api.post(`${API_BASE_URL}/balances/accounts`, {
      headers: authHeaders(cashier),
      data: {
        organization_id: firstOrganization.id,
        bank_name: `REG BANK ${accountMarker}`,
        account_number: `REG-ACC-${accountMarker}`,
        is_active: true,
      },
    });

    expect(response.status()).toBe(200);
    createdAccount = await response.json();
    expect(createdAccount?.id).toBeTruthy();
    expect(createdAccount?.organization_id).toBe(firstOrganization.id);
  });

  test('cashier can create daily balance via POST /balances/daily', async () => {
    if (!createdAccount) {
      const fallbackMarker = marker('REG-P0-BAL-ACC-FALLBACK');
      const accountResponse = await api.post(`${API_BASE_URL}/balances/accounts`, {
        headers: authHeaders(cashier),
        data: {
          organization_id: firstOrganization.id,
          bank_name: `REG BANK ${fallbackMarker}`,
          account_number: `REG-ACC-${fallbackMarker}`,
          is_active: true,
        },
      });
      expect(accountResponse.status()).toBe(200);
      createdAccount = await accountResponse.json();
    }

    const response = await api.post(`${API_BASE_URL}/balances/daily`, {
      headers: authHeaders(cashier),
      data: {
        balance_date: upsertDate,
        organization_id: firstOrganization.id,
        bank_account_id: createdAccount!.id,
        amount: 101000.11,
      },
    });
    expect(response.status()).toBe(200);
    const created = await response.json();
    expect(created.bank_account_id).toBe(createdAccount!.id);
    expect(created.balance_date).toBe(upsertDate);
    expect(Number(created.amount)).toBeCloseTo(101000.11, 2);
  });

  test('repeated POST /balances/daily updates amount instead of creating duplicate', async () => {
    test.skip(!createdAccount, 'No created account from prior test.');

    const firstUpsertResponse = await api.post(`${API_BASE_URL}/balances/daily`, {
      headers: authHeaders(cashier),
      data: {
        balance_date: upsertDate,
        organization_id: firstOrganization.id,
        bank_account_id: createdAccount!.id,
        amount: 202000.22,
      },
    });
    expect(firstUpsertResponse.status()).toBe(200);
    const firstUpsert = (await firstUpsertResponse.json()) as DailyBalance;

    const secondUpsertResponse = await api.post(`${API_BASE_URL}/balances/daily`, {
      headers: authHeaders(cashier),
      data: {
        balance_date: upsertDate,
        organization_id: firstOrganization.id,
        bank_account_id: createdAccount!.id,
        amount: 303000.33,
      },
    });
    expect(secondUpsertResponse.status()).toBe(200);
    const secondUpsert = (await secondUpsertResponse.json()) as DailyBalance;
    upsertedBalance = secondUpsert;

    expect(secondUpsert.id).toBe(firstUpsert.id);
    expect(Number(secondUpsert.amount)).toBeCloseTo(303000.33, 2);

    const listResponse = await api.get(
      `${API_BASE_URL}/balances/daily?date_from=${upsertDate}&date_to=${upsertDate}&organization_id=${firstOrganization.id}`,
      { headers: authHeaders(cashier) },
    );
    expect(listResponse.status()).toBe(200);
    const rows = (await listResponse.json()) as DailyBalance[];
    const sameDateSameAccount = rows.filter(
      (item) => item.balance_date === upsertDate && item.bank_account_id === createdAccount!.id,
    );
    expect(sameDateSameAccount.length).toBe(1);
    expect(Number(sameDateSameAccount[0].amount)).toBeCloseTo(303000.33, 2);
  });

  test('GET /balances/daily returns created balance with organization and bank_account', async () => {
    test.skip(!createdAccount, 'No created account from prior test.');

    const response = await api.get(
      `${API_BASE_URL}/balances/daily?date_from=${upsertDate}&date_to=${upsertDate}&organization_id=${firstOrganization.id}`,
      { headers: authHeaders(cashier) },
    );
    expect(response.status()).toBe(200);
    const rows = (await response.json()) as DailyBalance[];

    const target = rows.find((item) =>
      upsertedBalance
        ? item.id === upsertedBalance.id
        : item.balance_date === upsertDate && item.bank_account_id === createdAccount!.id,
    );
    expect(target, 'Expected created/upserted daily balance not found').toBeTruthy();
    expect(target!.organization?.id).toBe(firstOrganization.id);
    expect(target!.organization?.name).toBeTruthy();
    expect(target!.bank_account?.id).toBe(createdAccount!.id);
    expect(target!.bank_account?.account_number).toBe(createdAccount!.account_number);
  });
});
