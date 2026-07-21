import { sendJson } from '@bunnyland/ui-web/api';

const IGNORED_CONTENT_FLAGS_KEY = 'bunnyland.contentFlags.ignore';
const CONTENT_FLAG_PATTERN = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*$/;

export function normalizeContentFlags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length <= 64 && CONTENT_FLAG_PATTERN.test(value)))]
    .sort((left, right) => left.localeCompare(right));
}

export async function fetchContentFlags(base: string): Promise<string[]> {
  const resource = await sendJson(base, '/public/world');
  if (
    !resource
    || typeof resource !== 'object'
    || !('world_id' in resource)
    || typeof resource.world_id !== 'string'
    || !('world_epoch' in resource)
    || !Number.isInteger(resource.world_epoch)
    || !('title' in resource)
    || typeof resource.title !== 'string'
    || !('description' in resource)
    || typeof resource.description !== 'string'
    || !('content_flags' in resource)
    || !Array.isArray(resource.content_flags)
    || resource.content_flags.some(value => (
      typeof value !== 'string'
      || value.trim().length > 64
      || !CONTENT_FLAG_PATTERN.test(value.trim())
    ))
  ) {
    throw new Error('invalid public world resource');
  }
  return normalizeContentFlags(resource.content_flags);
}

export function ignoredContentFlags(): string[] {
  try { return normalizeContentFlags(JSON.parse(localStorage.getItem(IGNORED_CONTENT_FLAGS_KEY) || '[]'));
  } catch { return []; }
}

export function rememberIgnoredContentFlags(flags: string[]): void {
  try {
    localStorage.setItem(
      IGNORED_CONTENT_FLAGS_KEY,
      JSON.stringify(normalizeContentFlags([...ignoredContentFlags(), ...flags])),
    );
  } catch {
    // Preferences are best-effort; the current-session acceptance still applies.
  }
}
