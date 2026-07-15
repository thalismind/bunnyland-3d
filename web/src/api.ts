export {
  assertSameOriginBase,
  mediaUrl,
  normalizeBase,
  parseJsonResponse,
  sendJson,
  serverFromUrl,
  setServerInUrl,
  type AdminAuth,
} from '@bunnyland/ui-web/api';

import {
  assertSameOriginBase,
  adminHeaders,
  login,
  normalizeBase,
  parseJsonResponse,
  type AdminAuth,
} from '@bunnyland/ui-web/api';

async function promptLogin(base: string): Promise<boolean> {
  const username = window.prompt('Bunnyland username');
  if (!username) return false;
  const password = window.prompt('Bunnyland password');
  if (password == null) return false;
  await login(base, username, password);
  return true;
}

export async function sendAdmin(base: string, path: string, auth: AdminAuth): Promise<unknown> {
  return sendAdminRequest(base, path, auth);
}

export async function sendAdminRequest(
  base: string,
  path: string,
  auth: AdminAuth,
  init: RequestInit = {},
): Promise<unknown> {
  const url = `${assertSameOriginBase(base)}${path}`;
  const request = (): Promise<Response> => fetch(url, {
    ...init,
    headers: { ...adminHeaders(auth), ...(init.headers || {}) },
    credentials: 'include',
  });
  let res = await request();
  if (res.status === 401) {
    if (await promptLogin(base)) {
      res = await request();
    }
  }
  return parseJsonResponse(res);
}
