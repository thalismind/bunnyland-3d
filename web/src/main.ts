import { normalizeBase, sendAdmin, sendJson, serverFromUrl, setServerInUrl } from './api';
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
);

function status(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = cls;
}

async function connect(rawBase: string): Promise<void> {
  baseUrl = normalizeBase(rawBase);
  if (!baseUrl) return;
  apiInput.value = baseUrl;
  status('loading...', '');
  try {
    const overview = await sendAdmin(baseUrl, '/world/overview', auth);
    const snapshot = await sendAdmin(baseUrl, '/world/snapshot', auth);
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
    const projection = await sendJson(baseUrl, `/world/room/${encodeURIComponent(roomId)}`);
    const entities = roomEntities(projection, snapshot3dMap);
    selectedEntities = entities;
    scene.loadRoomEntities(roomId, entities);
    renderSelected(entities);
  } catch (err) {
    selectedEntitiesEl.textContent = `Room detail failed: ${(err as Error).message}`;
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

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
window.BunnylandUI?.bindThemeSelect(themeSelect);

const server = serverFromUrl();
if (server) void connect(server);

declare global {
  interface Window {
    BunnylandUI?: {
      bindThemeSelect: (select: HTMLSelectElement | null) => unknown;
      currentTheme: () => string;
    };
    __world3d?: {
      ready: boolean;
      connect: (base: string) => Promise<void>;
      refresh: () => Promise<void>;
      selectRoom: (roomId: string) => Promise<void>;
      setMode: (mode: ViewMode) => void;
      capture: () => string;
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
  cameraState: () => scene.cameraState(),
};
