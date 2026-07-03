import { normalizeBase, parseJsonResponse } from './api';
import { roomEntities, WORLD_3D_CONSTANTS, type LayoutRoom, type RoomRenderEntity, type WorldLayout } from './adapter.mjs';

const ROOM_SIZE = WORLD_3D_CONSTANTS.ROOM_WORLD_SIZE;
const CLIENT_ID_KEY = 'bunnyland.3d.clientId';
const CLAIM_KEY_PREFIX = 'bunnyland.3d.claim';
const FOG_KEY_PREFIX = 'bunnyland.3d.fog';

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

export interface CharacterSummary {
  id: string;
  name: string;
  kind: string;
  suspended: boolean;
}

export interface ControlClaim {
  characterId: string;
  controllerId: string;
  generation: number;
  claimId: string;
  claimSecret: string;
}

export interface ActionView {
  command_type?: string;
  tool_name?: string;
  title?: string;
  lane?: string;
  available?: boolean;
  unavailable_reason?: string;
  cost?: { action?: number; focus?: number };
  arguments?: ActionArgument[];
}

export interface ActionArgument {
  key: string;
  title?: string;
  kind?: string;
  required?: boolean;
  target_group?: string;
}

export interface TargetOption {
  value: string;
  label: string;
  kind: string;
  icon: string;
}

export interface CharacterProjection {
  characterId: string;
  characterName: string;
  worldEpoch: number;
  room: {
    id: string;
    title: string;
    biome: string;
    exits: { id: string; direction: string; label: string; locked: boolean }[];
    entities: unknown[];
  };
  points: Record<string, number>;
  controller: { controller_id?: string; generation?: number } | null;
  targetGroups: Record<string, TargetOption[]>;
  actions: ActionView[];
}

export interface QueuedProjection {
  characterId: string;
  worldEpoch: number;
  nextTickAtUnix: number | null;
  commands: QueuedCommand[];
}

export interface QueuedCommand {
  command_id?: string;
  command_type?: string;
  lane?: string;
  payload?: Record<string, unknown>;
  cost?: { action?: number; focus?: number };
}

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

export function persistentClientId(): string {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const next = globalThis.crypto?.randomUUID?.() || `3d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, next);
    return next;
  } catch (_err) {
    return `3d-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export function storedClaim(base: string, characterId: string): ControlClaim | null {
  try {
    const raw = localStorage.getItem(claimKey(base, characterId));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.controllerId || !data.claimId || !data.claimSecret) return null;
    return {
      characterId,
      controllerId: String(data.controllerId),
      generation: Number(data.generation || 0),
      claimId: String(data.claimId),
      claimSecret: String(data.claimSecret),
    };
  } catch (_err) {
    return null;
  }
}

export function storeClaim(base: string, control: ControlClaim): void {
  try {
    localStorage.setItem(claimKey(base, control.characterId), JSON.stringify(control));
  } catch (_err) {
    // Best-effort continuity only.
  }
}

export function claimHeaders(control: ControlClaim | null): Record<string, string> {
  return control?.claimSecret ? { 'X-Bunnyland-Claim-Secret': control.claimSecret } : {};
}

export async function requestJson(base: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return parseJsonResponse(await fetch(`${normalizeBase(base)}${path}`, { ...init, headers }));
}

export async function fetchCharacters(base: string): Promise<CharacterSummary[]> {
  const data = await requestJson(base, '/world/characters') as { characters?: unknown[] };
  return (data.characters || []).map(character => {
    const item = character as Record<string, unknown>;
    return {
      id: String(item.character_id || ''),
      name: String(item.name || item.character_id || ''),
      kind: String(item.kind || 'character'),
      suspended: Boolean(item.suspended),
    };
  }).filter(character => character.id);
}

export async function claimCharacter(base: string, characterId: string): Promise<ControlClaim> {
  const stored = storedClaim(base, characterId);
  const data = await requestJson(base, '/world/controllers/web/claim', {
    method: 'POST',
    headers: claimHeaders(stored),
    body: JSON.stringify({
      character_id: characterId,
      client_id: persistentClientId(),
      claim_id: stored?.claimId || undefined,
      fallback_controller: 'suspend',
      timeout_seconds: 1800,
      label: '3d-player',
    }),
  }) as Record<string, unknown>;
  const control = {
    characterId: String(data.character_id || characterId),
    controllerId: String(data.controller_id || ''),
    generation: Number(data.controller_generation || data.generation || 0),
    claimId: String(data.claim_id || ''),
    claimSecret: String(data.claim_secret || ''),
  };
  storeClaim(base, control);
  return control;
}

export async function fetchProjection(base: string, characterId: string, control: ControlClaim): Promise<CharacterProjection> {
  const query = control.claimId ? `?claim_id=${encodeURIComponent(control.claimId)}` : '';
  return parseProjection(await requestJson(base, `/world/character/${encodeURIComponent(characterId)}${query}`, {
    headers: claimHeaders(control),
  }));
}

export async function fetchQueue(base: string, characterId: string, control: ControlClaim): Promise<QueuedProjection> {
  const query = control.claimId ? `?claim_id=${encodeURIComponent(control.claimId)}` : '';
  const data = await requestJson(base, `/world/character/${encodeURIComponent(characterId)}/commands${query}`, {
    headers: claimHeaders(control),
  }) as Record<string, unknown>;
  return {
    characterId: String(data.character_id || ''),
    worldEpoch: Number(data.world_epoch || 0),
    nextTickAtUnix: data.next_tick_at_unix == null ? null : Number(data.next_tick_at_unix),
    commands: Array.isArray(data.commands) ? data.commands as QueuedCommand[] : [],
  };
}

export async function submitAction(base: string, projection: CharacterProjection, control: ControlClaim, action: ActionView, payload: Record<string, unknown>): Promise<unknown> {
  return requestJson(base, '/world/commands', {
    method: 'POST',
    headers: claimHeaders(control),
    body: JSON.stringify({
      character_id: projection.characterId,
      controller_id: control.controllerId,
      controller_generation: control.generation,
      claim_id: control.claimId || undefined,
      command_type: actionCommandType(action),
      payload,
      cost: actionCost(action),
      lane: actionLane(action),
      on_insufficient_points: 'queue',
    }),
  });
}

export async function cancelCommand(base: string, characterId: string, commandId: string, control: ControlClaim): Promise<unknown> {
  const params = new URLSearchParams({
    controller_id: control.controllerId,
    controller_generation: String(control.generation),
  });
  if (control.claimId) params.set('claim_id', control.claimId);
  return requestJson(base, `/world/character/${encodeURIComponent(characterId)}/commands/${encodeURIComponent(commandId)}?${params}`, {
    method: 'DELETE',
    headers: claimHeaders(control),
  });
}

export function parseProjection(data: unknown): CharacterProjection {
  const raw = data as Record<string, unknown>;
  const room = (raw.room || {}) as Record<string, unknown>;
  const targetGroups: Record<string, TargetOption[]> = {};
  for (const [key, values] of Object.entries((raw.target_groups || {}) as Record<string, unknown[]>)) {
    targetGroups[key] = (values || []).map(value => {
      const item = value as Record<string, unknown>;
      return {
        value: String(item.id || ''),
        label: String(item.label || item.id || ''),
        kind: String(item.kind || key),
        icon: targetIcon(String(item.kind || key)),
      };
    }).filter(item => item.value);
  }
  return {
    characterId: String(raw.character_id || ''),
    characterName: String(raw.character_name || raw.character_id || ''),
    worldEpoch: Number(raw.world_epoch || 0),
    room: {
      id: String(room.id || ''),
      title: String(room.title || room.id || ''),
      biome: String(room.biome || 'unknown'),
      exits: ((room.exits || []) as unknown[]).map(exit => {
        const item = exit as Record<string, unknown>;
        return {
          id: String(item.id || ''),
          direction: String(item.direction || ''),
          label: String(item.label || item.id || ''),
          locked: Boolean(item.locked),
        };
      }).filter(exit => exit.id),
      entities: Array.isArray(room.entities) ? room.entities : [],
    },
    points: raw.points as Record<string, number> || {},
    controller: raw.controller as CharacterProjection['controller'] || null,
    targetGroups,
    actions: Array.isArray(raw.actions) ? raw.actions as ActionView[] : [],
  };
}

export function loadFog(base: string, characterId: string): FogState {
  try {
    const raw = localStorage.getItem(fogKey(base, characterId));
    if (!raw) return { rooms: [] };
    const data = JSON.parse(raw);
    return { rooms: Array.isArray(data.rooms) ? data.rooms : [] };
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

export function filterActions(actions: ActionView[], query: string): ActionView[] {
  const q = query.trim().toLowerCase();
  const filtered = q ? actions.filter(action => [
    actionTitle(action),
    actionTool(action),
    actionCommandType(action),
    actionUnavailableReason(action),
  ].join(' ').toLowerCase().includes(q)) : actions;
  return filtered.map((action, index) => ({ action, index })).sort((a, b) => {
    const availability = Number(!actionAvailable(a.action)) - Number(!actionAvailable(b.action));
    return availability || a.index - b.index;
  }).map(item => item.action);
}

export function actionTitle(action: ActionView): string {
  return String(action.title || action.tool_name || action.command_type || 'Action');
}

export function actionTool(action: ActionView): string {
  return String(action.tool_name || action.command_type || 'action');
}

export function actionCommandType(action: ActionView): string {
  return String(action.command_type || actionTool(action));
}

export function actionLane(action: ActionView): string {
  return String(action.lane || 'world');
}

export function actionAvailable(action: ActionView): boolean {
  return action.available !== false;
}

export function actionUnavailableReason(action: ActionView): string {
  return actionAvailable(action) ? '' : String(action.unavailable_reason || 'Unavailable right now');
}

export function actionCost(action: ActionView): { action: number; focus: number } {
  const cost = action.cost || {};
  return { action: Number(cost.action || 0), focus: Number(cost.focus || 0) };
}

export function actionFields(action: ActionView, projection: CharacterProjection): { key: string; label: string; kind: string; required: boolean; candidates: TargetOption[] | null }[] {
  return (action.arguments || []).filter(arg => arg.key && (arg.required || arg.target_group)).map(arg => ({
    key: arg.key,
    label: arg.title || arg.key,
    kind: arg.kind || 'string',
    required: Boolean(arg.required),
    candidates: arg.target_group ? projection.targetGroups[arg.target_group] || [] : null,
  }));
}

export function queuedCountdownSeconds(queue: QueuedProjection | null): number | null {
  if (queue?.nextTickAtUnix == null) return null;
  return Math.max(0, Math.round(queue.nextTickAtUnix - Date.now() / 1000));
}

export function queuedCommandLabel(command: QueuedCommand, actions: ActionView[]): string {
  const action = actions.find(item => actionCommandType(item) === command.command_type);
  const name = action ? actionTitle(action) : String(command.command_type || 'command').replaceAll('-', ' ');
  const cost = actionCost(command as ActionView);
  const costText = cost.action || cost.focus ? `${cost.action ? `${cost.action} AP` : ''}${cost.action && cost.focus ? ' + ' : ''}${cost.focus ? `${cost.focus} FP` : ''}` : 'free';
  const details = Object.entries(command.payload || {}).map(([key, value]) => `${key}: ${String(value)}`).join(', ');
  return [name, command.lane ? `[${command.lane}]` : '', costText, details].filter(Boolean).join(' - ');
}

function claimKey(base: string, characterId: string): string {
  return `${CLAIM_KEY_PREFIX}.${normalizeBase(base)}.${characterId}`;
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

function targetIcon(kind: string): string {
  if (kind === 'exit') return '>';
  if (kind === 'character') return '@';
  if (kind === 'item') return '*';
  return '+';
}
