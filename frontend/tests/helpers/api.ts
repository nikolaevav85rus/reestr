import { expect, type APIRequestContext } from '@playwright/test';

export const API_BASE_URL = process.env.API_URL ?? 'http://127.0.0.1:8080/api/v1';
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? '1234';

export const USERS = {
  admin: process.env.TEST_ADMIN_USER ?? 'admin1',
  initiator: process.env.TEST_INITIATOR_USER ?? 'initiator1',
  feo: process.env.TEST_FEO_USER ?? 'feo1',
  cashier: process.env.TEST_CASHIER_USER ?? 'cashier1',
  accountant: process.env.TEST_ACCOUNTANT_USER ?? 'accountant1',
  director: process.env.TEST_DIRECTOR_USER ?? 'director1',
} as const;

export type AuthSession = {
  token: string;
  user: {
    id: string;
    ad_login: string;
    full_name: string;
    is_superadmin?: boolean;
  };
  permissions: string[];
};

export type RequestPayload = {
  amount: number;
  description: string;
  note?: string;
  payment_date: string;
  organization_id: string;
  direction_id: string;
  budget_item_id: string;
  counterparty: string;
};

export async function loginApi(api: APIRequestContext, username: string): Promise<AuthSession> {
  const response = await api.post(`${API_BASE_URL}/auth/login`, {
    form: {
      username,
      password: TEST_PASSWORD,
    },
  });

  expect(response.ok(), `login failed for ${username}: ${await response.text()}`).toBeTruthy();
  const data = await response.json();
  return {
    token: data.access_token,
    user: data.user,
    permissions: data.permissions ?? [],
  };
}

export function authHeaders(session: AuthSession) {
  return { Authorization: `Bearer ${session.token}` };
}

async function withRequestRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/ECONNRESET|ECONNREFUSED|socket hang up/i.test(message) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }

  throw lastError;
}

export async function getJson<T>(api: APIRequestContext, session: AuthSession, path: string): Promise<T> {
  const response = await withRequestRetry(() => api.get(`${API_BASE_URL}${path}`, {
    headers: authHeaders(session),
  }));
  expect(response.ok(), `GET ${path} failed: ${await response.text()}`).toBeTruthy();
  return await response.json();
}

export async function postJson<T>(
  api: APIRequestContext,
  session: AuthSession,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await withRequestRetry(() => api.post(`${API_BASE_URL}${path}`, {
    headers: authHeaders(session),
    data,
  }));
  expect(response.ok(), `POST ${path} failed: ${await response.text()}`).toBeTruthy();
  return await response.json();
}

export async function patchJson<T>(
  api: APIRequestContext,
  session: AuthSession,
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await withRequestRetry(() => api.patch(`${API_BASE_URL}${path}`, {
    headers: authHeaders(session),
    data,
  }));
  expect(response.ok(), `PATCH ${path} failed: ${await response.text()}`).toBeTruthy();
  return await response.json();
}

export async function expectForbidden(
  api: APIRequestContext,
  session: AuthSession,
  method: 'post' | 'patch',
  path: string,
  data?: unknown,
) {
  const response = await withRequestRetry(() => api[method](`${API_BASE_URL}${path}`, {
    headers: authHeaders(session),
    data,
  }));
  expect(response.status(), `${method.toUpperCase()} ${path} should be forbidden`).toBe(403);
}

export function marker(prefix = 'REG-P0') {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

export async function createDraft(
  api: APIRequestContext,
  session: AuthSession,
  payload: RequestPayload,
) {
  return await postJson<any>(api, session, '/requests/', payload);
}
