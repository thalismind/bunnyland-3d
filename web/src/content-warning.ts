import { sendJson } from '@bunnyland/ui-web/api';

const IGNORED_CONTENT_FLAGS_KEY = 'bunnyland.contentFlags.ignore';
const WORLD_INTRO_PREFERENCES_KEY = 'bunnyland.worldIntro.preferences';
const CONTENT_FLAG_PATTERN = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)*$/;

export interface PublicWorldResource {
  contentFlags: string[];
  description: string;
  title: string;
  worldEpoch: number;
  worldId: string;
}

export type WorldIntroSkip = 'none' | 'world' | 'all';

interface WorldIntroPreferences {
  skipAll: boolean;
  worlds: string[];
}

export function normalizeContentFlags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim())
    .filter(value => value.length <= 64 && CONTENT_FLAG_PATTERN.test(value)))]
    .sort((left, right) => left.localeCompare(right));
}

export async function fetchPublicWorld(base: string): Promise<PublicWorldResource> {
  const resource = await sendJson(base, '/public/world');
  if (
    !resource
    || typeof resource !== 'object'
    || !('world_id' in resource)
    || typeof resource.world_id !== 'string'
    || !('world_epoch' in resource)
    || typeof resource.world_epoch !== 'number'
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
  return {
    contentFlags: normalizeContentFlags(resource.content_flags),
    description: resource.description,
    title: resource.title,
    worldEpoch: resource.world_epoch,
    worldId: resource.world_id,
  };
}

export async function fetchContentFlags(base: string): Promise<string[]> {
  return (await fetchPublicWorld(base)).contentFlags;
}

export function hasWorldIntroduction(world: PublicWorldResource): boolean {
  return Boolean(world.title.trim() || world.description.trim());
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

function worldIntroScope(base: string, worldId: string): string {
  return `${base.replace(/\/+$/, '')}\n${worldId}`;
}

function worldIntroPreferences(): WorldIntroPreferences {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(WORLD_INTRO_PREFERENCES_KEY) || '{}',
    );
    if (!value || typeof value !== 'object') return { skipAll: false, worlds: [] };
    const skipAll = 'skipAll' in value && value.skipAll === true;
    const worlds = 'worlds' in value && Array.isArray(value.worlds)
      ? [...new Set(value.worlds.filter((scope): scope is string => (
          typeof scope === 'string' && scope.length <= 2048
        )))]
      : [];
    return { skipAll, worlds };
  } catch {
    return { skipAll: false, worlds: [] };
  }
}

export function shouldSkipWorldIntro(base: string, worldId: string): boolean {
  const preferences = worldIntroPreferences();
  return preferences.skipAll || preferences.worlds.includes(worldIntroScope(base, worldId));
}

export function rememberWorldIntroSkip(
  base: string,
  worldId: string,
  skip: WorldIntroSkip,
): void {
  if (skip === 'none') return;
  try {
    const preferences = worldIntroPreferences();
    if (skip === 'all') preferences.skipAll = true;
    if (skip === 'world') {
      preferences.worlds = [
        ...new Set([...preferences.worlds, worldIntroScope(base, worldId)]),
      ];
    }
    localStorage.setItem(WORLD_INTRO_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are best-effort; continuing still applies to this session.
  }
}
