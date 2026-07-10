export {
  mediaUrl,
  normalizeBase,
  parseJsonResponse,
  sendJson,
  serverFromUrl,
  setServerInUrl,
  type AdminAuth,
} from '@bunnyland/ui-web/api';

import { adminHeaders, normalizeBase, parseJsonResponse, type AdminAuth } from '@bunnyland/ui-web/api';

function promptBasicAuth(): string | null {
  const username = window.prompt('Admin username');
  if (!username) return null;
  const password = window.prompt('Admin password');
  if (password == null) return null;
  return `Basic ${btoa(`${username}:${password}`)}`;
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
  const url = `${normalizeBase(base)}${path}`;
  const request = (): Promise<Response> => fetch(url, {
    ...init,
    headers: { ...adminHeaders(auth), ...(init.headers || {}) },
  });
  let res = await request();
  if (res.status === 403 && !auth.secret) {
    const secret = window.prompt('Admin secret');
    if (secret) {
      auth.secret = secret;
      res = await request();
    }
  }
  if (res.status === 401) {
    const authorization = promptBasicAuth();
    if (authorization) {
      auth.authorization = authorization;
      res = await request();
    }
  }
  return parseJsonResponse(res);
}
