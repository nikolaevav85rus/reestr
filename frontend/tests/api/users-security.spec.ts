import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { API_BASE_URL, authHeaders, loginApi, USERS, type AuthSession } from '../helpers/api';

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

async function getWithRetry(
  api: APIRequestContext,
  path: string,
  headers?: Record<string, string>,
) {
  return await withRequestRetry(() => api.get(`${API_BASE_URL}${path}`, {
    headers,
  }));
}

async function loginWithCredentials(
  api: APIRequestContext,
  username: string,
  password: string,
): Promise<AuthSession> {
  const response = await withRequestRetry(() => api.post(`${API_BASE_URL}/auth/login`, {
    form: { username, password },
  }));
  expect(response.ok(), `login failed for ${username}: ${await response.text()}`).toBeTruthy();
  const data = await response.json();
  return {
    token: data.access_token,
    user: data.user,
    permissions: data.permissions ?? [],
  };
}

test.describe('API security regression: GET /users/', () => {
  let api: APIRequestContext;
  let initiator: AuthSession;
  let superadmin: AuthSession;

  test.beforeAll(async () => {
    api = await request.newContext();
    initiator = await loginApi(api, USERS.initiator);
    superadmin = await loginWithCredentials(api, 'admin', '123');
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('GET /users/ without token returns 401', async () => {
    const response = await getWithRetry(api, '/users/');
    expect(response.status()).toBe(401);
  });

  test('GET /users/ for user without user_view returns 403', async () => {
    expect(initiator.permissions).not.toContain('user_view');
    const response = await getWithRetry(api, '/users/', authHeaders(initiator));
    expect(response.status()).toBe(403);
  });

  test('GET /users/ for superadmin returns 200 and safe response schema', async () => {
    expect(!!superadmin.user.is_superadmin).toBeTruthy();

    const response = await getWithRetry(api, '/users/', authHeaders(superadmin));
    expect(response.status()).toBe(200);

    const rows = await response.json();
    expect(Array.isArray(rows)).toBeTruthy();
    expect(rows.length, 'Expected at least one user in /users/ response').toBeGreaterThan(0);

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

    for (const row of rows) {
      expect('hashed_password' in row, `Unsafe field leaked in row: ${JSON.stringify(row)}`).toBeFalsy();
      for (const field of requiredFields) {
        expect(
          Object.prototype.hasOwnProperty.call(row, field),
          `Missing expected field "${field}" in row: ${JSON.stringify(row)}`,
        ).toBeTruthy();
      }
    }
  });
});
