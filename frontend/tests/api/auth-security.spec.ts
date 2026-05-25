import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { API_BASE_URL, authHeaders, type AuthSession } from '../helpers/api';

const DETAIL_IDENTITY = '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043b\u0438\u0447\u043d\u043e\u0441\u0442\u044c';
const DETAIL_BLOCKED = '\u0410\u043a\u043a\u0430\u0443\u043d\u0442 \u0437\u0430\u0431\u043b\u043e\u043a\u0438\u0440\u043e\u0432\u0430\u043d';

type RoleDto = {
  id: string;
  name?: string;
  label?: string;
  is_superadmin?: boolean;
};

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

async function getWithRetry(
  api: APIRequestContext,
  path: string,
  headers?: Record<string, string>,
) {
  return await withRequestRetry(() => api.get(`${API_BASE_URL}${path}`, { headers }));
}

async function postWithRetry(
  api: APIRequestContext,
  path: string,
  data: unknown,
  headers: Record<string, string>,
) {
  return await withRequestRetry(() => api.post(`${API_BASE_URL}${path}`, { data, headers }));
}

async function putWithRetry(
  api: APIRequestContext,
  path: string,
  data: unknown,
  headers: Record<string, string>,
) {
  return await withRequestRetry(() => api.put(`${API_BASE_URL}${path}`, { data, headers }));
}

async function deleteWithRetry(
  api: APIRequestContext,
  path: string,
  headers: Record<string, string>,
) {
  return await withRequestRetry(() => api.delete(`${API_BASE_URL}${path}`, { headers }));
}

test.describe('API security regression: get_current_user is_active check', () => {
  let api: APIRequestContext;
  let admin: AuthSession;
  let tempRole: RoleDto | undefined;

  test.beforeAll(async () => {
    api = await request.newContext();
    admin = await loginWithCredentials(api, 'admin', '123');

    const rolesResponse = await getWithRetry(api, '/dict/roles', authHeaders(admin));
    expect(rolesResponse.status()).toBe(200);
    const roles = (await rolesResponse.json()) as RoleDto[];
    tempRole = roles.find((role) => role.name === 'INITIATOR')
      ?? roles.find((role) => !role.is_superadmin);
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('active user token can access protected endpoint', async () => {
    const response = await getWithRetry(api, '/settings/', authHeaders(admin));
    expect(response.status()).toBe(200);
  });

  test('invalid token gets 401 with unchanged detail', async () => {
    const response = await getWithRetry(api, '/settings/', {
      Authorization: 'Bearer invalid-token',
    });
    expect(response.status()).toBe(401);
    const payload = await response.json();
    expect(payload?.detail).toBe(DETAIL_IDENTITY);
  });

  test('no token gets 401', async () => {
    const response = await getWithRetry(api, '/settings/');
    expect(response.status()).toBe(401);
  });

  test('inactive user token gets 403 account blocked on protected endpoint', async () => {
    test.skip(!tempRole, 'No suitable role found for temporary inactive-user setup.');

    const marker = `REG-INACTIVE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempLogin = `inactive_${marker.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32)}`;
    const tempPassword = `Tmp!${marker.slice(-10)}`;
    let tempUserId: string | undefined;
    let cleanupError: string | undefined;

    try {
      const createResponse = await postWithRetry(api, '/users/', {
        ad_login: tempLogin,
        full_name: `Regression Inactive ${marker}`,
        password: tempPassword,
        role_id: tempRole!.id,
        direction_id: null,
      }, authHeaders(admin));
      expect(createResponse.status()).toBe(200);
      const created = await createResponse.json();
      tempUserId = created.id;
      expect(typeof tempUserId).toBe('string');

      const tempSession = await loginWithCredentials(api, tempLogin, tempPassword);
      expect(tempSession.user?.ad_login).toBe(tempLogin);

      const deactivateResponse = await putWithRetry(
        api,
        `/users/${tempUserId}`,
        { is_active: false },
        authHeaders(admin),
      );
      expect(deactivateResponse.status()).toBe(200);

      const blockedResponse = await getWithRetry(api, '/settings/', authHeaders(tempSession));
      expect(blockedResponse.status()).toBe(403);
      const blockedPayload = await blockedResponse.json();
      expect(blockedPayload?.detail).toBe(DETAIL_BLOCKED);
    } finally {
      if (tempUserId) {
        try {
          await putWithRetry(api, `/users/${tempUserId}`, { is_active: true }, authHeaders(admin));
          const deleteResponse = await deleteWithRetry(api, `/users/${tempUserId}`, authHeaders(admin));
          if (deleteResponse.status() !== 200) {
            cleanupError = `Cleanup delete status=${deleteResponse.status()} body=${await deleteResponse.text()}`;
          }
        } catch (error) {
          cleanupError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    expect(cleanupError, cleanupError ?? 'cleanup_ok').toBeUndefined();
  });
});
