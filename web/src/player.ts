import { normalizeBase, serverFromUrl, setServerInUrl } from './api';
import { BunnylandScene, type ViewMode } from './scene';
import {
  actionAvailable,
  actionCommandType,
  actionCost,
  actionFields,
  actionLane,
  actionTitle,
  actionUnavailableReason,
  cancelCommand,
  claimCharacter,
  fetchCharacters,
  fetchProjection,
  fetchQueue,
  filterActions,
  playerSceneView,
  queuedCommandLabel,
  queuedCountdownSeconds,
  submitAction,
  updateFog,
  type ActionView,
  type CharacterProjection,
  type CharacterSummary,
  type ControlClaim,
  type QueuedProjection,
} from './play';

const viewer = document.getElementById('viewer') as HTMLElement;
const apiInput = document.getElementById('api-url') as HTMLInputElement;
const connectButton = document.getElementById('btn-connect') as HTMLButtonElement;
const refreshButton = document.getElementById('btn-refresh') as HTMLButtonElement;
const characterSelect = document.getElementById('character-select') as HTMLSelectElement;
const statusEl = document.getElementById('status') as HTMLElement;
const roomTitleEl = document.getElementById('room-title') as HTMLElement;
const roomMetaEl = document.getElementById('room-meta') as HTMLElement;
const actionFilterEl = document.getElementById('action-filter') as HTMLInputElement;
const actionsEl = document.getElementById('actions') as HTMLElement;
const queueEl = document.getElementById('queue') as HTMLElement;
const modeButton = document.getElementById('btn-mode') as HTMLButtonElement;
const cameraButton = document.getElementById('btn-camera') as HTMLButtonElement;
const captureButton = document.getElementById('btn-capture') as HTMLButtonElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;

let baseUrl = '';
let characters: CharacterSummary[] = [];
let playerId = '';
let control: ControlClaim | null = null;
let projection: CharacterProjection | null = null;
let queue: QueuedProjection | null = null;
let selectedTargetId = '';
let viewMode: ViewMode = '3d';
let manualCamera = false;

const scene = new BunnylandScene(
  viewer,
  roomId => {
    if (projection?.room.id !== roomId) status(`Remembered room: ${roomId}`, 'ok');
  },
  entityId => {
    selectedTargetId = entityId;
  },
);

function status(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = cls;
}

async function connect(rawBase: string): Promise<void> {
  baseUrl = normalizeBase(rawBase);
  if (!baseUrl) return;
  apiInput.value = baseUrl;
  status('loading characters...');
  try {
    characters = await fetchCharacters(baseUrl);
    renderCharacters();
    setServerInUrl(baseUrl);
    status(`loaded ${characters.length} characters`, 'ok');
  } catch (err) {
    status(`connect failed: ${(err as Error).message}`, 'err');
  }
}

async function selectCharacter(characterId: string): Promise<void> {
  if (!baseUrl || !characterId) return;
  playerId = characterId;
  selectedTargetId = '';
  status('claiming...');
  try {
    control = await claimCharacter(baseUrl, characterId);
    await refresh();
    status(`playing ${projection?.characterName || characterId}`, 'ok');
  } catch (err) {
    status(`claim failed: ${(err as Error).message}`, 'err');
  }
}

async function refresh(): Promise<void> {
  if (!baseUrl || !playerId || !control) return;
  try {
    projection = await fetchProjection(baseUrl, playerId, control);
    queue = await fetchQueue(baseUrl, playerId, control);
    const fog = updateFog(baseUrl, projection);
    const view = playerSceneView(fog, projection);
    scene.loadPlayerRoom(view.layout, projection.room.id, view.entities);
    render();
  } catch (err) {
    status(`refresh failed: ${(err as Error).message}`, 'err');
  }
}

function renderCharacters(): void {
  characterSelect.innerHTML = '<option value="">Choose...</option>' + characters.map(character => `
    <option value="${escapeHtml(character.id)}"${character.id === playerId ? ' selected' : ''}>
      ${escapeHtml(character.name)}${character.suspended ? ' (suspended)' : ''}
    </option>
  `).join('');
}

function render(): void {
  if (!projection) {
    roomTitleEl.textContent = 'No character selected';
    roomMetaEl.textContent = 'Connect and choose a character.';
    actionsEl.textContent = 'No actions loaded.';
    queueEl.textContent = 'No queued actions.';
    return;
  }
  const points = projection.points || {};
  roomTitleEl.textContent = projection.room.title;
  roomMetaEl.textContent = [
    projection.characterName,
    `${projection.room.exits.length} exits`,
    `${points.action ?? 0}/${points.action_max ?? 0} AP`,
    `${points.focus ?? 0}/${points.focus_max ?? 0} FP`,
  ].join(' / ');
  renderActions();
  renderQueue();
}

function renderActions(): void {
  if (!projection) return;
  const filtered = filterActions(projection.actions, actionFilterEl.value);
  const sections = ['world', 'focus'].map(lane => {
    const rows = filtered.filter(action => actionLane(action) === lane).map(action => actionRow(action)).join('');
    return `<div class="section-title">${lane === 'focus' ? 'Focus actions' : 'Room actions'}</div>${rows || '<div class="muted">No matching actions.</div>'}`;
  });
  actionsEl.innerHTML = sections.join('');
}

function actionRow(action: ActionView): string {
  const cost = actionCost(action);
  const available = actionAvailable(action);
  const reason = actionUnavailableReason(action);
  const costText = cost.action || cost.focus
    ? [cost.action ? `${cost.action} AP` : '', cost.focus ? `${cost.focus} FP` : ''].filter(Boolean).join(' + ')
    : 'free';
  return `
    <button class="action-row ${available ? '' : 'unavailable'}" type="button" data-action="${escapeHtml(actionCommandType(action))}">
      <span class="row-main"><span>${escapeHtml(actionTitle(action))}</span><span>${escapeHtml(costText)}</span></span>
      <span class="row-detail">${escapeHtml(reason || actionCommandType(action))}</span>
    </button>
  `;
}

function renderQueue(): void {
  if (!projection || !queue) return;
  const countdown = queuedCountdownSeconds(queue);
  const title = `Queued actions${countdown == null ? '' : ` / next tick in ${countdown}s`}`;
  queueEl.innerHTML = `<div class="section-title">${escapeHtml(title)}</div>` + (
    queue.commands.length
      ? queue.commands.map(command => `
        <button class="queue-row" type="button" data-command-id="${escapeHtml(command.command_id || '')}">
          <span class="row-main"><span>${escapeHtml(queuedCommandLabel(command, projection?.actions || []))}</span><span>cancel</span></span>
        </button>
      `).join('')
      : '<div class="muted">No queued actions.</div>'
  );
}

async function doAction(action: ActionView): Promise<void> {
  if (!projection || !control) return;
  const fields = actionFields(action, projection);
  const payload = fields.length ? await actionForm(action, fields) : {};
  if (payload == null) return;
  try {
    const result = await submitAction(baseUrl, projection, control, action, payload) as { queued?: boolean; reason?: string };
    if (result?.queued === false) status(result.reason || 'Command rejected.', 'err');
    await refresh();
  } catch (err) {
    status(`submit failed: ${(err as Error).message}`, 'err');
  }
}

async function cancelQueued(commandId: string): Promise<void> {
  if (!projection || !control || !commandId) return;
  try {
    const result = await cancelCommand(baseUrl, projection.characterId, commandId, control) as { cancelled?: boolean; reason?: string };
    if (!result?.cancelled) status(result?.reason || 'Could not cancel queued command.', 'err');
    await refresh();
  } catch (err) {
    status(`cancel failed: ${(err as Error).message}`, 'err');
  }
}

function actionForm(action: ActionView, fields: ReturnType<typeof actionFields>): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.id = 'action-form-backdrop';
    backdrop.innerHTML = `
      <div class="action-form-card">
        <h2>${escapeHtml(actionTitle(action))}</h2>
        <div class="form-body">
          ${fields.map((field, index) => fieldHtml(field, index)).join('')}
          <div class="form-error"></div>
        </div>
        <div class="form-actions">
          <button type="button" data-form-cancel>Cancel</button>
          <button type="button" data-form-submit>Submit</button>
        </div>
      </div>
    `;
    const close = (value: Record<string, unknown> | null): void => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };
    const submit = (): void => {
      const payload: Record<string, unknown> = {};
      for (const [index, field] of fields.entries()) {
        const input = backdrop.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${index}"]`);
        const value = input?.value.trim() || '';
        if (field.required && !value) {
          const error = backdrop.querySelector('.form-error') as HTMLElement;
          error.textContent = `${field.label} is required.`;
          return;
        }
        if (value) payload[field.key] = field.kind === 'number' ? Number(value) : value;
      }
      close(payload);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') submit();
    };
    backdrop.addEventListener('click', event => { if (event.target === backdrop) close(null); });
    backdrop.querySelector('[data-form-cancel]')?.addEventListener('click', () => close(null));
    backdrop.querySelector('[data-form-submit]')?.addEventListener('click', submit);
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    backdrop.querySelector<HTMLInputElement | HTMLSelectElement>('[data-field]')?.focus();
  });
}

function fieldHtml(field: ReturnType<typeof actionFields>[number], index: number): string {
  const label = `${escapeHtml(field.label)}${field.required ? ' *' : ''}`;
  if (field.candidates) {
    const options = ['<option value="">Choose...</option>', ...field.candidates.map(candidate => {
      const selected = candidate.value === selectedTargetId ? ' selected' : '';
      return `<option value="${escapeHtml(candidate.value)}"${selected}>${escapeHtml(candidate.label)}</option>`;
    })];
    return `<label class="form-field"><span>${label}</span><select data-field="${index}">${options.join('')}</select></label>`;
  }
  if (field.kind === 'boolean') {
    return `<label class="form-field"><span>${label}</span><select data-field="${index}"><option value="">Choose...</option><option value="true">yes</option><option value="false">no</option></select></label>`;
  }
  return `<label class="form-field"><span>${label}</span><input data-field="${index}" type="${field.kind === 'number' ? 'number' : 'text'}"></label>`;
}

function captureImage(): string {
  return scene.capturePng();
}

function downloadCapture(): void {
  const link = document.createElement('a');
  link.href = captureImage();
  link.download = `bunnyland-3d-player-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
  link.click();
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

connectButton.addEventListener('click', () => { void connect(apiInput.value); });
refreshButton.addEventListener('click', () => { void refresh(); });
characterSelect.addEventListener('change', () => { void selectCharacter(characterSelect.value); });
actionFilterEl.addEventListener('input', renderActions);
actionsEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  const action = projection?.actions.find(item => actionCommandType(item) === row?.dataset.action);
  if (action) void doAction(action);
});
queueEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-command-id]');
  if (row?.dataset.commandId) void cancelQueued(row.dataset.commandId);
});
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
    __world3dPlayer?: {
      ready: boolean;
      connect: (base: string) => Promise<void>;
      selectCharacter: (characterId: string) => Promise<void>;
      refresh: () => Promise<void>;
      cameraState: () => ReturnType<BunnylandScene['cameraState']>;
      capture: () => string;
    };
  }
}

window.__world3dPlayer = {
  ready: true,
  connect,
  selectCharacter,
  refresh,
  cameraState: () => scene.cameraState(),
  capture: captureImage,
};
