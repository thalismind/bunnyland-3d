import '@bunnyland/ui-web/assets/bunnyland-ui.css';
import { bindThemeSelect } from '@bunnyland/ui-web/theme';
import { escapeHtml } from '@bunnyland/ui-web/widgets';
import { assertSameOriginBase, sendAdmin, sendAdminRequest, sendJson, serverFromUrl, setServerInUrl } from './api';
import { layoutOverview, roomEntities, roomSummary, snapshot3d, type WorldLayout } from './adapter.mjs';
import { BunnylandScene, type ViewMode } from './scene';

const viewer = document.getElementById('viewer') as HTMLElement;
const apiInput = document.getElementById('api-url') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLElement;
const epochEl = document.getElementById('epoch') as HTMLElement;
const roomListEl = document.getElementById('room-list') as HTMLElement;
const selectedTitleEl = document.getElementById('selected-title') as HTMLElement;
const selectedMetaEl = document.getElementById('selected-meta') as HTMLElement;
const selectedEntitiesEl = document.getElementById('selected-entities') as HTMLElement;
const modeButton = document.getElementById('btn-mode') as HTMLButtonElement;
const cameraButton = document.getElementById('btn-camera') as HTMLButtonElement;
const captureButton = document.getElementById('btn-capture') as HTMLButtonElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
const roofInput = document.getElementById('room-has-roof') as HTMLInputElement;
const textureScope = document.getElementById('texture-scope') as HTMLSelectElement;
const decorationResult = document.getElementById('decoration-result') as HTMLElement;

let baseUrl = '';
let auth = { authorization: '', secret: '' };
let layout: WorldLayout | null = null;
let snapshot3dMap: ReturnType<typeof snapshot3d> | null = null;
let selectedRoomId = '';
let selectedEntityId = '';
let selectedEntities: ReturnType<typeof roomEntities> = [];
let viewMode: ViewMode = '3d';
let manualCamera = false;

const scene = new BunnylandScene(
  viewer,
  roomId => { void selectRoom(roomId); },
  entityId => { selectEntity(entityId); },
  exitId => { void selectRoom(exitId); },
);

function status(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = cls;
}

async function connect(rawBase: string): Promise<void> {
  baseUrl = assertSameOriginBase(rawBase);
  if (!baseUrl) return;
  apiInput.value = baseUrl;
  status('loading...', '');
  try {
    const overview = await sendAdmin(baseUrl, '/admin/world/overview', auth);
    const snapshot = await sendAdmin(baseUrl, '/admin/world/snapshot', auth);
    snapshot3dMap = snapshot3d(snapshot);
    layout = layoutOverview(overview, snapshot3dMap);
    selectedRoomId = selectedRoomId || location.hash.slice(1) || layout.rooms[0]?.id || '';
    scene.loadLayout(layout);
    renderRooms();
    setServerInUrl(baseUrl);
    if (selectedRoomId) await selectRoom(selectedRoomId);
    status(`loaded ${layout.roomCount} rooms`, 'ok');
  } catch (err) {
    status(`load failed: ${(err as Error).message}`, 'err');
  }
}

async function refresh(): Promise<void> {
  if (baseUrl) await connect(baseUrl);
}

async function selectRoom(roomId: string): Promise<void> {
  if (!layout || !roomSummary(layout, roomId)) return;
  selectedRoomId = roomId;
  selectedEntityId = '';
  selectedEntities = [];
  scene.selectRoom(roomId, false);
  renderRooms();
  renderSelected(null);
  history.replaceState(null, '', `#${encodeURIComponent(roomId)}`);
  try {
    const projection = await sendJson(baseUrl, `/play/world/room/${encodeURIComponent(roomId)}`);
    const entities = roomEntities(projection, snapshot3dMap);
    selectedEntities = entities;
    scene.loadRoomEntities(roomId, entities);
    renderSelected(entities);
    const playerScene = await sendAdmin(baseUrl, `/play/3d/v2/room/${encodeURIComponent(roomId)}`, auth) as {
      room?: { indoor?: boolean; environment3d?: { has_roof?: boolean } | null };
    };
    roofInput.checked = playerScene.room?.environment3d?.has_roof ?? Boolean(playerScene.room?.indoor);
  } catch (err) {
    selectedEntitiesEl.textContent = `Room detail failed: ${(err as Error).message}`;
  }
}

async function decorationAction(action: 'preview' | 'apply' | 'reroll'): Promise<void> {
  if (!baseUrl || !selectedRoomId) return;
  try {
    const method = action === 'preview' ? 'GET' : 'POST';
    const result = await sendAdminRequest(
      baseUrl,
      `/admin/3d/room/${encodeURIComponent(selectedRoomId)}/decoration/${action}`,
      auth,
      { method },
    );
    decorationResult.textContent = JSON.stringify(result);
    status(`${action} complete`, 'ok');
  } catch (err) {
    status(`${action} failed: ${(err as Error).message}`, 'err');
  }
}

async function setRoomRoof(): Promise<void> {
  if (!baseUrl || !selectedRoomId) return;
  try {
    await sendAdminRequest(baseUrl, `/admin/3d/room/${encodeURIComponent(selectedRoomId)}/roof`, auth, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ has_roof: roofInput.checked }),
    });
    status(roofInput.checked ? 'roof enabled' : 'skybox enabled', 'ok');
  } catch (err) {
    status(`roof update failed: ${(err as Error).message}`, 'err');
  }
}

async function uploadTexture(slot: 'albedo' | 'normal' | 'skybox', file: File): Promise<void> {
  if (!baseUrl || !selectedRoomId || !layout) return;
  const room = roomSummary(layout, selectedRoomId);
  const target = textureScope.value === 'biome' ? room?.biome || '' : selectedRoomId;
  if (!target) return;
  try {
    const result = await sendAdminRequest(
      baseUrl,
      `/admin/3d/texture/${textureScope.value}/${encodeURIComponent(target)}/${slot}`,
      auth,
      { method: 'POST', headers: { 'content-type': file.type }, body: file },
    );
    decorationResult.textContent = JSON.stringify(result);
    status(`${slot} uploaded`, 'ok');
  } catch (err) {
    status(`${slot} upload failed: ${(err as Error).message}`, 'err');
  }
}

function renderRooms(): void {
  if (!layout) return;
  epochEl.textContent = `epoch ${layout.epoch}`;
  roomListEl.innerHTML = layout.rooms.map(room => `
    <button class="room-row ${room.id === selectedRoomId ? 'active' : ''}" type="button" data-room-id="${escapeHtml(room.id)}">
      ${escapeHtml(room.title)}
      <div class="muted">${room.occupantCount} chars / ${room.itemCount} items</div>
    </button>
  `).join('');
}

function renderSelected(entities: ReturnType<typeof roomEntities> | null): void {
  const room = layout ? roomSummary(layout, selectedRoomId) : null;
  if (!room) return;
  selectedTitleEl.textContent = room.title;
  selectedMetaEl.textContent = `${room.biome} / ${room.exits.length} exits`;
  if (entities === null) {
    selectedEntitiesEl.textContent = 'Loading room contents...';
    return;
  }
  selectedEntitiesEl.innerHTML = entities.length
    ? entities.map(entity => `
      <button class="entity-row ${entity.id === selectedEntityId ? 'active' : ''}" type="button" data-entity-id="${escapeHtml(entity.id)}">
        ${escapeHtml(entity.name)}
        <div class="muted">${escapeHtml(entity.kind)}</div>
      </button>
    `).join('')
    : '<span class="muted">No visible room contents.</span>';
}

function selectEntity(entityId: string): void {
  if (!selectedEntities.some(entity => entity.id === entityId)) return;
  selectedEntityId = entityId;
  scene.selectEntity(entityId, false);
  renderSelected(selectedEntities);
}

function captureImage(): string {
  return scene.capturePng();
}

function downloadCapture(): void {
  const dataUrl = captureImage();
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `bunnyland-3d-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  link.click();
  status('capture downloaded', 'ok');
}

roomListEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-room-id]');
  if (row?.dataset.roomId) void selectRoom(row.dataset.roomId);
});
selectedEntitiesEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-entity-id]');
  if (row?.dataset.entityId) selectEntity(row.dataset.entityId);
});
document.getElementById('btn-load')?.addEventListener('click', () => { void connect(apiInput.value); });
document.getElementById('btn-refresh')?.addEventListener('click', () => { void refresh(); });
modeButton.addEventListener('click', () => {
  viewMode = viewMode === '3d' ? '2d' : '3d';
  scene.setMode(viewMode);
  modeButton.textContent = viewMode === '3d' ? '2D' : '3D';
});
cameraButton.addEventListener('click', () => {
  manualCamera = !manualCamera;
  scene.setManualCamera(manualCamera);
  cameraButton.textContent = manualCamera ? 'Manual Camera' : 'Auto Camera';
});
captureButton.addEventListener('click', downloadCapture);
document.getElementById('btn-preview-decoration')?.addEventListener('click', () => { void decorationAction('preview'); });
document.getElementById('btn-apply-decoration')?.addEventListener('click', () => { void decorationAction('apply'); });
document.getElementById('btn-reroll-decoration')?.addEventListener('click', () => { void decorationAction('reroll'); });
document.getElementById('btn-apply-outdoors')?.addEventListener('click', async () => {
  try {
    const result = await sendAdminRequest(baseUrl, '/admin/3d/decoration/apply-outdoors', auth, { method: 'POST' });
    decorationResult.textContent = JSON.stringify(result);
    status('outdoor rooms decorated', 'ok');
  } catch (err) {
    status(`backfill failed: ${(err as Error).message}`, 'err');
  }
});
roofInput.addEventListener('change', () => { void setRoomRoof(); });
for (const slot of ['albedo', 'normal', 'skybox'] as const) {
  const input = document.getElementById(`texture-${slot}`) as HTMLInputElement;
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void uploadTexture(slot, file);
  });
}
bindThemeSelect(themeSelect);

const server = serverFromUrl();
if (server) void connect(server);

declare global {
  interface Window {
    __world3d?: {
      ready: boolean;
      connect: (base: string) => Promise<void>;
      refresh: () => Promise<void>;
      selectRoom: (roomId: string) => Promise<void>;
      setMode: (mode: ViewMode) => void;
      capture: () => string;
      themeState: () => ReturnType<BunnylandScene['themeState']>;
      cameraState: () => ReturnType<BunnylandScene['cameraState']>;
    };
  }
}

window.__world3d = {
  ready: true,
  connect,
  refresh,
  selectRoom,
  setMode: mode => {
    viewMode = mode;
    scene.setMode(mode);
  },
  capture: captureImage,
  themeState: () => scene.themeState(),
  cameraState: () => scene.cameraState(),
};
