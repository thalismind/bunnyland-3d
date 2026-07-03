export function normalizeBase(url: string): string {
  return String(url || '').trim().replace(/\/$/, '');
}

export function serverFromUrl(): string {
  return new URLSearchParams(location.search).get('server') || '';
}

export function setServerInUrl(base: string): void {
  const url = new URL(location.href);
  const normalized = normalizeBase(base);
  if (normalized) url.searchParams.set('server', normalized);
  else url.searchParams.delete('server');
  history.replaceState(null, '', url);
}

export async function parseJsonResponse(res: Response): Promise<unknown> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'detail' in data ? String(data.detail) : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data;
}

export async function sendJson(base: string, path: string): Promise<unknown> {
  return parseJsonResponse(await fetch(`${normalizeBase(base)}${path}`));
}

export interface AdminAuth {
  authorization: string;
  secret: string;
}

function adminHeaders(auth: AdminAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth.authorization) headers.Authorization = auth.authorization;
  if (auth.secret) headers['X-Bunnyland-Admin-Secret'] = auth.secret;
  return headers;
}

export async function sendAdmin(base: string, path: string, auth: AdminAuth): Promise<unknown> {
  const url = `${normalizeBase(base)}${path}`;
  let res = await fetch(url, { headers: adminHeaders(auth) });
  if (res.status === 403 && !auth.secret) {
    const secret = window.prompt('Admin secret');
    if (secret) {
      auth.secret = secret;
      res = await fetch(url, { headers: adminHeaders(auth) });
    }
  }
  if (res.status === 401) {
    const username = window.prompt('Admin username');
    const password = username ? window.prompt('Admin password') : null;
    if (username && password != null) {
      auth.authorization = `Basic ${btoa(`${username}:${password}`)}`;
      res = await fetch(url, { headers: adminHeaders(auth) });
    }
  }
  return parseJsonResponse(res);
}
