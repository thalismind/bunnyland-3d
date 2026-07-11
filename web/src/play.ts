import { claimHeaders, mediaUrl, normalizeBase, requestSceneImage, sendJson } from '@bunnyland/ui-web/api';
import {
  actionArguments,
  actionAvailable,
  actionCommandType,
  actionCost,
  actionFields,
  actionIcon,
  actionLane,
  actionTitle,
  actionUnavailableReason,
  allTargets,
  cancelQueuedCommand,
  characterSheetHref,
  claimCharacter as claimSharedCharacter,
  clearClaimControl,
  controlFromResponse,
  createPlayerLiveUpdates,
  drainNarratedEvents,
  fetchCharacterProjection,
  fetchCharacters,
  fetchQueuedCommands,
  fetchCharacterRecentEvents,
  filterActions,
  iconPreference as sharedIconPreference,
  imageCompletions,
  imageRequestMessage,
  inventoryEntries,
  latestImageCompletion,
  latestImageFailure,
  persistentClientId,
  queuedCommandLabel,
  queuedCountdownSeconds,
  setIconPreference as sharedSetIconPreference,
  storeClaimControl,
  submitCommand,
  type ActionView,
  type ActivityLine,
  type CharacterProjection,
  type CharacterSummary,
  type ClaimOptions,
  type ControlClaim,
  type QueuedProjection,
  type PlayerLiveUpdates,
} from '@bunnyland/ui-web/play';
import { roomEntities, WORLD_3D_CONSTANTS, type LayoutRoom, type RoomRenderEntity, type WorldLayout } from './adapter.mjs';
import type { PlayerRoomScene } from './player-scene';

export {
  actionArguments,
  actionAvailable,
  actionCommandType,
  actionCost,
  actionFields,
  actionIcon,
  actionLane,
  actionTitle,
  actionUnavailableReason,
  allTargets,
  characterSheetHref,
  drainNarratedEvents,
  fetchCharacters,
  fetchCharacterRecentEvents,
  filterActions,
  imageCompletions,
  imageRequestMessage,
  inventoryEntries,
  latestImageCompletion,
  latestImageFailure,
  queuedCommandLabel,
  queuedCountdownSeconds,
  createPlayerLiveUpdates,
  requestSceneImage,
  type ActionView,
  type ActivityLine,
  type CharacterProjection,
  type CharacterSummary,
  type ClaimOptions,
  type ControlClaim,
  type QueuedProjection,
  type PlayerLiveUpdates,
};

const ROOM_SIZE = WORLD_3D_CONSTANTS.ROOM_WORLD_SIZE;
const CLIENT_ID_KEY = 'bunnyland.3d.clientId';
const CLAIM_KEY = 'bunnyland.3d';
const FOG_KEY_PREFIX = 'bunnyland.3d.fog';
const ICON_PREF_KEY = 'bunnyland.3d.actionIcons';

const DIRECTION_VECTORS = new Map<string, [number, number]>([
  ['north', [0, -1]], ['n', [0, -1]],
  ['south', [0, 1]], ['s', [0, 1]],
  ['east', [1, 0]], ['e', [1, 0]],
  ['west', [-1, 0]], ['w', [-1, 0]],
  ['northeast', [1, -1]], ['ne', [1, -1]],
  ['northwest', [-1, -1]], ['nw', [-1, -1]],
  ['southeast', [1, 1]], ['se', [1, 1]],
  ['southwest', [-1, 1]], ['sw', [-1, 1]],
]);

export interface FogRoom {
  id: string;
  title: string;
  biome: string;
  gridX: number;
  gridY: number;
  exits: { id: string; direction: string; label: string; locked: boolean }[];
}

export interface FogState {
  rooms: FogRoom[];
}

export interface PlayerSceneView {
  layout: WorldLayout;
  entities: RoomRenderEntity[];
}

export interface ThreeDCapabilities {
  ok: boolean;
  plugin_id: string;
  plugin_version: string;
  scene_schema_version: number;
  asset_schema_version: number;
}

export interface ServerModelAsset {
  url: string;
  digest: string;
  transform: {
    scale: number;
    rotation: [number, number, number];
    translation: [number, number, number];
  };
  clips: Record<string, string>;
  variants: string[];
  default_color: string;
  instanced: boolean;
  license: string;
  attribution: string;
}

export interface ServerAssetManifest {
  schema_version: 2;
  assets: Record<string, ServerModelAsset>;
}

export async function fetch3dCapabilities(base: string): Promise<ThreeDCapabilities> {
  const data = await sendJson(base, '/3d/v2/capabilities') as ThreeDCapabilities;
  if (data.plugin_id !== 'bunnyland.3d' || Number(data.scene_schema_version) !== 3) {
    throw new Error('Bunnyland 3D scene schema v3 is required');
  }
  return data;
}

export async function fetch3dAssetManifest(base: string): Promise<ServerAssetManifest> {
  const data = await sendJson(base, '/3d/v2/assets/manifest') as ServerAssetManifest;
  if (Number(data.schema_version) !== 2 || !data.assets || Array.isArray(data.assets)) {
    throw new Error('Server returned an incompatible Bunnyland 3D asset manifest');
  }
  for (const asset of Object.values(data.assets)) asset.url = mediaUrl(base, asset.url);
  return data;
}

export async function fetch3dRoomScene(base: string, roomId: string): Promise<PlayerRoomScene> {
  const data = await sendJson(base, `/3d/v2/room/${encodeURIComponent(roomId)}`) as PlayerRoomScene;
  if (Number(data.schema_version) !== 3 || data.room?.id !== roomId) {
    throw new Error('Server returned an incompatible Bunnyland 3D room scene');
  }
  const environment = data.room.environment3d;
  if (environment) {
    for (const key of ['albedo_url', 'normal_url', 'skybox_url'] as const) {
      if (environment[key]) environment[key] = mediaUrl(base, environment[key]!);
    }
  }
  return data;
}

export async function claimCharacter(base: string, characterId: string, options: ClaimOptions = {}): Promise<ControlClaim> {
  return claimSharedCharacter(base, characterId, CLAIM_KEY, {
    ...options,
    clientIdKey: CLIENT_ID_KEY,
    clientIdPrefix: '3d',
    label: '3d-player',
  });
}

export async function updateControllerFallback(base: string, characterId: string, control: ControlClaim, options: ClaimOptions): Promise<unknown> {
  return sendJson(base, '/world/controllers/web/fallback', {
    method: 'PATCH',
    headers: claimHeaders(control),
    body: JSON.stringify({
      character_id: characterId,
      client_id: persistentClientId(CLIENT_ID_KEY, '3d'),
      claim_id: control.claimId || undefined,
      fallback_controller: options.fallbackController || 'suspend',
      timeout_seconds: options.timeoutSeconds || 1800,
    }),
  });
}

export async function releaseController(base: string, characterId: string, control: ControlClaim, options: ClaimOptions): Promise<ControlClaim> {
  const data = await sendJson(base, '/world/controllers/web/release-controller', {
    method: 'POST',
    headers: claimHeaders(control),
    body: JSON.stringify({
      character_id: characterId,
      client_id: persistentClientId(CLIENT_ID_KEY, '3d'),
      claim_id: control.claimId || undefined,
      fallback_controller: options.fallbackController || 'suspend',
      timeout_seconds: options.timeoutSeconds || 1800,
    }),
  });
  const next = controlFromResponse(data, characterId, { active: false }) || { ...control, active: false };
  storeClaimControl(CLAIM_KEY, next);
  return next;
}

export async function releaseClaim(base: string, characterId: string, control: ControlClaim): Promise<unknown> {
  const result = await sendJson(base, '/world/controllers/web/release-claim', {
    method: 'POST',
    headers: claimHeaders(control),
    body: JSON.stringify({
      character_id: characterId,
      client_id: persistentClientId(CLIENT_ID_KEY, '3d'),
      claim_id: control.claimId || undefined,
    }),
  });
  clearClaimControl(CLAIM_KEY, characterId);
  return result;
}

export async function fetchProjection(base: string, characterId: string, control: ControlClaim): Promise<CharacterProjection> {
  const projection = await fetchCharacterProjection(base, characterId, control);
  if (!projection) throw new Error(`No projection for ${characterId}`);
  return projection;
}

export async function fetchQueue(base: string, characterId: string, control: ControlClaim): Promise<QueuedProjection> {
  const queue = await fetchQueuedCommands(base, characterId, control);
  if (!queue) throw new Error(`No queue for ${characterId}`);
  return queue;
}

export async function submitAction(base: string, projection: CharacterProjection, control: ControlClaim, action: ActionView, payload: Record<string, unknown>): Promise<unknown> {
  return submitCommand(base, {
    character_id: projection.characterId,
    controller_id: control.controllerId,
    controller_generation: control.generation,
    claim_id: control.claimId || undefined,
    command_type: actionCommandType(action),
    payload,
    cost: actionCost(action),
    lane: actionLane(action),
    on_insufficient_points: 'queue',
  }, control);
}

export const cancelCommand = cancelQueuedCommand;

export function iconPreference(defaultValue = true): boolean {
  return sharedIconPreference(ICON_PREF_KEY, defaultValue);
}

export function setIconPreference(value: boolean): void {
  sharedSetIconPreference(ICON_PREF_KEY, value);
}

export function loadFog(base: string, characterId: string): FogState {
  try {
    const raw = localStorage.getItem(fogKey(base, characterId));
    if (!raw) return { rooms: [] };
    const data = JSON.parse(raw) as { rooms?: unknown[] };
    return { rooms: Array.isArray(data.rooms) ? data.rooms as FogRoom[] : [] };
  } catch (_err) {
    return { rooms: [] };
  }
}

export function updateFog(base: string, projection: CharacterProjection): FogState {
  const state = loadFog(base, projection.characterId);
  const rooms = new Map(state.rooms.map(room => [room.id, room]));
  const current = rooms.get(projection.room.id) || {
    id: projection.room.id,
    title: projection.room.title,
    biome: projection.room.biome,
    gridX: 0,
    gridY: 0,
    exits: [],
  };
  const mergedCurrent: FogRoom = {
    ...current,
    title: projection.room.title,
    biome: projection.room.biome,
    exits: projection.room.exits,
  };
  rooms.set(mergedCurrent.id, mergedCurrent);
  for (const exit of projection.room.exits) {
    if (rooms.has(exit.id)) continue;
    const [dx, dy] = directionVector(exit.direction, rooms.size);
    rooms.set(exit.id, {
      id: exit.id,
      title: exit.label || exit.id,
      biome: 'unknown',
      gridX: mergedCurrent.gridX + dx,
      gridY: mergedCurrent.gridY + dy,
      exits: [{ id: mergedCurrent.id, direction: oppositeDirection(exit.direction), label: mergedCurrent.title, locked: exit.locked }],
    });
  }
  const next = { rooms: [...rooms.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  try {
    localStorage.setItem(fogKey(base, projection.characterId), JSON.stringify(next));
  } catch (_err) {
    // Best-effort map memory only.
  }
  return next;
}

export function playerSceneView(fog: FogState, projection: CharacterProjection): PlayerSceneView {
  const minX = Math.min(...fog.rooms.map(room => room.gridX), 0);
  const minY = Math.min(...fog.rooms.map(room => room.gridY), 0);
  const rooms: LayoutRoom[] = fog.rooms.map(room => {
    const current = room.id === projection.room.id;
    const gridX = room.gridX - minX + 1;
    const gridY = room.gridY - minY + 1;
    return {
      id: room.id,
      title: current ? projection.room.title : room.title,
      biome: current ? projection.room.biome : room.biome,
      indoor: false,
      private: false,
      occupantCount: current ? projection.room.entities.filter(entity => Boolean((entity as Record<string, unknown>).is_character)).length : 0,
      itemCount: current ? projection.room.entities.filter(entity => !Boolean((entity as Record<string, unknown>).is_character)).length : 0,
      gridX,
      gridY,
      worldX: gridX * ROOM_SIZE,
      worldY: 0,
      worldZ: gridY * ROOM_SIZE,
      fogged: !current,
      render3d: current ? {} : { color: '#585b70', opacity: 0.34 },
      exits: room.exits,
    };
  });
  return {
    layout: {
      epoch: projection.worldEpoch,
      roomCount: rooms.length,
      characterCount: 1,
      width: Math.max(...rooms.map(room => room.gridX), 1) + 2,
      height: Math.max(...rooms.map(room => room.gridY), 1) + 2,
      rooms,
    },
    entities: roomEntities({ room: { entities: projection.room.entities } }),
  };
}

function fogKey(base: string, characterId: string): string {
  return `${FOG_KEY_PREFIX}.${normalizeBase(base)}.${characterId}`;
}

function directionVector(direction: string, fallbackIndex: number): [number, number] {
  const normalized = direction.trim().toLowerCase();
  if (DIRECTION_VECTORS.has(normalized)) return DIRECTION_VECTORS.get(normalized) as [number, number];
  const angle = fallbackIndex * Math.PI * (3 - Math.sqrt(5));
  return [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))];
}

function oppositeDirection(direction: string): string {
  const values: Record<string, string> = { north: 'south', n: 'south', south: 'north', s: 'north', east: 'west', e: 'west', west: 'east', w: 'east' };
  return values[direction.trim().toLowerCase()] || '';
}
