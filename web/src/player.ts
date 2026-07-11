import '@bunnyland/ui-web/assets/bunnyland-ui.css';
import { mediaUrl as sharedMediaUrl, normalizeBase, serverFromUrl, setServerInUrl } from '@bunnyland/ui-web/api';
import { bindThemeSelect } from '@bunnyland/ui-web/theme';
import { escapeHtml } from '@bunnyland/ui-web/widgets';
import { mergeGalleryItems, renderGalleryItems, type GalleryItem } from '@bunnyland/ui-web/player-widgets';
import { PlayerScene, type PlayerSceneExit } from './player-scene';
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
  cancelCommand,
  characterSheetHref,
  claimCharacter,
  createPlayerLiveUpdates,
  drainNarratedEvents,
  fetchCharacters,
  fetch3dCapabilities,
  fetch3dAssetManifest,
  fetch3dRoomScene,
  fetchProjection,
  fetchQueue,
  fetchCharacterRecentEvents,
  filterActions,
  iconPreference,
  imageCompletions,
  imageRequestMessage,
  inventoryEntries,
  latestImageCompletion,
  latestImageFailure,
  queuedCommandLabel,
  queuedCountdownSeconds,
  releaseClaim,
  releaseController,
  requestSceneImage,
  setIconPreference,
  submitAction,
  updateControllerFallback,
  updateFog,
  type ActionView,
  type ActivityLine,
  type CharacterProjection,
  type CharacterSummary,
  type ClaimOptions,
  type ControlClaim,
  type FogState,
  type QueuedProjection,
  type PlayerLiveUpdates,
} from './play';

const ACTIVITY_LIMIT = 24;

const viewer = document.getElementById('viewer') as HTMLElement;
const apiInput = document.getElementById('api-url') as HTMLInputElement;
const connectButton = document.getElementById('btn-connect') as HTMLButtonElement;
const refreshButton = document.getElementById('btn-refresh') as HTMLButtonElement;
const characterSelect = document.getElementById('character-select') as HTMLSelectElement;
const claimButton = document.getElementById('btn-claim') as HTMLButtonElement;
const requestImageButton = document.getElementById('btn-request-image') as HTMLButtonElement;
const openSheetButton = document.getElementById('btn-open-sheet') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLElement;
const portraitFrameEl = document.getElementById('portrait-frame') as HTMLElement;
const characterNameEl = document.getElementById('character-name') as HTMLElement;
const characterInfoEl = document.getElementById('character-info') as HTMLElement;
const characterStatsEl = document.getElementById('character-stats') as HTMLElement;
const characterPillsEl = document.getElementById('character-pills') as HTMLElement;
const roomTitleEl = document.getElementById('room-title') as HTMLElement;
const roomMetaEl = document.getElementById('room-meta') as HTMLElement;
const membersEl = document.getElementById('members') as HTMLElement;
const exitsEl = document.getElementById('exits') as HTMLElement;
const inventoryEl = document.getElementById('inventory') as HTMLElement;
const targetLabelEl = document.getElementById('target-label') as HTMLElement;
const clearTargetButton = document.getElementById('btn-clear-target') as HTMLButtonElement;
const showActionIconsEl = document.getElementById('show-action-icons') as HTMLInputElement;
const actionFilterEl = document.getElementById('action-filter') as HTMLInputElement;
const actionFilterClearButton = document.getElementById('action-filter-clear') as HTMLButtonElement;
const actionsEl = document.getElementById('actions') as HTMLElement;
const queueEl = document.getElementById('queue') as HTMLElement;
const activityEl = document.getElementById('activity') as HTMLElement;
const photoGalleryEl = document.getElementById('photo-gallery') as HTMLElement;
const photoLightbox = document.getElementById('photo-lightbox') as HTMLElement;
const photoLightboxTitle = document.getElementById('photo-lightbox-title') as HTMLElement;
const photoLightboxMeta = document.getElementById('photo-lightbox-meta') as HTMLElement;
const photoLightboxImg = document.getElementById('photo-lightbox-img') as HTMLImageElement;
const lightboxDownloadButton = document.getElementById('btn-lightbox-download') as HTMLButtonElement;
const lightboxCloseButton = document.getElementById('btn-lightbox-close') as HTMLButtonElement;
const captureButton = document.getElementById('btn-capture') as HTMLButtonElement;
const exitPromptEl = document.getElementById('exit-prompt') as HTMLElement;
const exitPromptTextEl = document.getElementById('exit-prompt-text') as HTMLElement;
const exitPromptButton = document.getElementById('btn-exit-prompt') as HTMLButtonElement;
const rememberedMapEl = document.getElementById('remembered-map') as HTMLElement;
const hudButton = document.getElementById('btn-hud') as HTMLButtonElement;
const sideEl = document.getElementById('side') as HTMLElement;
const hudCharacterEl = document.getElementById('hud-character') as HTMLElement;
const hudRoomEl = document.getElementById('hud-room') as HTMLElement;
const hudPointsEl = document.getElementById('hud-points') as HTMLElement;
const sceneSummaryEl = document.getElementById('scene-summary') as HTMLElement;
const emptyStateEl = document.getElementById('empty-state') as HTMLElement;
const emptyStateTitleEl = document.getElementById('empty-state-title') as HTMLElement;
const emptyStateDetailEl = document.getElementById('empty-state-detail') as HTMLElement;
const controlHintEl = document.getElementById('control-hint') as HTMLElement;
const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
const claimDialog = document.getElementById('claim-dialog') as HTMLDialogElement;
const claimFallbackEl = document.getElementById('claim-fallback') as HTMLSelectElement;
const claimFallbackControllerEl = document.getElementById('claim-fallback-controller') as HTMLInputElement;
const claimTimeoutEl = document.getElementById('claim-timeout') as HTMLInputElement;
const dialogClaimButton = document.getElementById('btn-dialog-claim') as HTMLButtonElement;
const dialogSaveFallbackButton = document.getElementById('btn-dialog-save-fallback') as HTMLButtonElement;
const dialogIdleButton = document.getElementById('btn-dialog-idle') as HTMLButtonElement;
const dialogReleaseButton = document.getElementById('btn-dialog-release') as HTMLButtonElement;

let baseUrl = '';
let characters: CharacterSummary[] = [];
let playerId = '';
let control: ControlClaim | null = null;
let projection: CharacterProjection | null = null;
let queue: QueuedProjection | null = null;
let selectedTargetId = '';
let showActionIcons = iconPreference(true);
let activityLines: ActivityLine[] = [];
let seenEventIds = new Set<string>();
let eventsPrimed = false;
let eventImageUrl = '';
let eventImageFailureEpoch = -1;
let submittingAction = '';
let galleryItems: GalleryItem[] = [];
let activeGalleryId = '';
let nearbyExit: PlayerSceneExit | null = null;
let connectionReady = false;
let liveUpdates: PlayerLiveUpdates | null = null;
let liveState = 'fallback';
let liveToken = 0;
let lobbyTimer: ReturnType<typeof setInterval> | null = null;

const scene = new PlayerScene(
  viewer,
  entityId => {
    selectTarget(entityId);
  },
  exit => {
    nearbyExit = exit;
    renderExitPrompt();
  },
);

function status(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = cls;
}

async function connect(rawBase: string): Promise<void> {
  stopPlayerUpdates();
  stopLobbyPolling();
  baseUrl = normalizeBase(rawBase);
  if (!baseUrl) return;
  apiInput.value = baseUrl;
  connectionReady = false;
  status('loading characters...');
  try {
    await fetch3dCapabilities(baseUrl);
    try {
      scene.configureServerAssets(await fetch3dAssetManifest(baseUrl));
    } catch (error) {
      console.warn('Bunnyland 3D server assets unavailable; using bundled models:', error);
      scene.configureServerAssets(null);
    }
    characters = await fetchCharacters(baseUrl);
    connectionReady = true;
    renderCharacters();
    setServerInUrl(baseUrl);
    status(`loaded ${characters.length} characters`, 'ok');
    startLobbyPolling();
  } catch (err) {
    connectionReady = false;
    characters = [];
    renderCharacters();
    status(`connect failed: ${(err as Error).message}`, 'err');
  }
  render();
}

async function selectCharacter(characterId: string): Promise<void> {
  stopPlayerUpdates();
  if (!baseUrl) return;
  if (!characterId) {
    playerId = '';
    control = null;
    projection = null;
    queue = null;
    startLobbyPolling();
    render();
    return;
  }
  stopLobbyPolling();
  playerId = characterId;
  selectedTargetId = '';
  activityLines = [];
  seenEventIds = new Set<string>();
  eventsPrimed = false;
  status('claiming...');
  try {
    control = await claimCharacter(baseUrl, characterId, claimOptionsFromForm());
    startPlayerUpdates();
  } catch (err) {
    status(`claim failed: ${(err as Error).message}`, 'err');
  }
  render();
}

async function refresh(): Promise<void> {
  if (!baseUrl || !playerId || !control) return;
  try {
    projection = await fetchProjection(baseUrl, playerId, control);
    if (projection.controller?.generation != null) control.generation = Number(projection.controller.generation || control.generation);
    queue = await fetchQueue(baseUrl, playerId, control);
    const fog = updateFog(baseUrl, projection);
    renderRememberedMap(fog);
    const roomScene = await fetch3dRoomScene(baseUrl, projection.room.id);
    await scene.loadRoom(roomScene, playerId);
    if (selectedTargetId) scene.selectEntity(selectedTargetId);
    await refreshActivity();
    render();
    if (liveState === 'live') status('Live', 'ok');
  } catch (err) {
    status(`refresh failed: ${(err as Error).message}`, 'err');
  }
}

async function refreshActivity(): Promise<void> {
  if (!baseUrl || !projection) return;
  try {
    const messages = await fetchCharacterRecentEvents(baseUrl, playerId, control);
    const drained = drainNarratedEvents(messages, {
      seenIds: seenEventIds,
      playerId,
      roomOf,
      nameFor,
    });
    seenEventIds = drained.seenIds;
    for (const image of imageCompletions(messages, baseUrl, 'event')) {
      addGalleryItem({
        id: `scene:${image.epoch}:${image.url}`,
        src: image.url,
        title: `Scene image${image.epoch ? ` @ ${image.epoch}` : ''}`,
        detail: 'server scene image',
        filename: `bunnyland-scene-${image.epoch || Date.now()}.png`,
        createdAt: image.epoch || Date.now(),
      }, false);
    }
    const latest = latestImageCompletion(messages, baseUrl, 'event');
    if (latest && latest.url !== eventImageUrl) {
      eventImageUrl = latest.url;
      if (eventsPrimed) pushActivity({ text: `📸 scene image ready: ${latest.url}`, kind: 'system' });
    }
    const failure = latestImageFailure(messages, 'event');
    if (failure && failure.epoch !== eventImageFailureEpoch) {
      eventImageFailureEpoch = failure.epoch;
      if (eventsPrimed) pushActivity({ text: `⚠️ image request failed: ${failure.reason}`, kind: 'rejection' });
    }
    if (eventsPrimed) pushActivity(...drained.lines);
    eventsPrimed = true;
  } catch (_err) {
    // Activity is opportunistic; stale event state should not block play.
  }
}

function stopLobbyPolling(): void {
  if (lobbyTimer != null) clearInterval(lobbyTimer);
  lobbyTimer = null;
}

function startLobbyPolling(): void {
  stopLobbyPolling();
  if (!baseUrl || playerId) return;
  lobbyTimer = setInterval(async () => {
    try {
      characters = await fetchCharacters(baseUrl);
      renderCharacters();
    } catch (_err) {
      // The lobby remains usable with its last successful character list.
    }
  }, 2000);
}

function stopPlayerUpdates(): void {
  liveToken += 1;
  liveUpdates?.close();
  liveUpdates = null;
}

function startPlayerUpdates(): void {
  stopPlayerUpdates();
  stopLobbyPolling();
  if (!baseUrl || !playerId || !control) return;
  const token = ++liveToken;
  liveUpdates = createPlayerLiveUpdates({
    base: baseUrl,
    characterId: playerId,
    control,
    refresh,
    onState: state => {
      if (token !== liveToken) return;
      liveState = state;
      if (state === 'live') status('Live', 'ok');
      else if (state !== 'closed') status('Reconnecting · polling', 'err');
    },
  });
}

function renderCharacters(): void {
  characterSelect.innerHTML = '<option value="">Choose...</option>' + characters.map(character => `
    <option value="${escapeHtml(character.id)}"${character.id === playerId ? ' selected' : ''}>
      ${escapeHtml(character.name)}${character.suspended ? ' (suspended)' : ''}
    </option>
  `).join('');
}

function render(): void {
  showActionIconsEl.checked = showActionIcons;
  claimButton.disabled = !playerId;
  claimButton.textContent = !playerId || !control ? 'Claim' : control.active === false ? 'Resume' : 'Idle';
  requestImageButton.disabled = !playerId;
  openSheetButton.disabled = !playerId;
  if (!projection) {
    emptyStateTitleEl.textContent = connectionReady ? 'Pick a character to start' : 'Connect to a server';
    emptyStateDetailEl.textContent = connectionReady
      ? 'Choose a character from the toolbar and claim control.'
      : 'Enter a Bunnyland API URL above, then choose a character.';
    emptyStateEl.classList.remove('hidden');
    sceneSummaryEl.classList.add('hidden');
    controlHintEl.classList.add('hidden');
    hudCharacterEl.textContent = 'No character selected';
    hudRoomEl.textContent = 'Connect to a Bunnyland 3D v2 server to begin.';
    hudPointsEl.textContent = '';
    renderCharacterPanel();
    roomTitleEl.textContent = 'No character selected';
    roomMetaEl.textContent = 'Connect and choose a character.';
    membersEl.textContent = 'No visible entities.';
    exitsEl.textContent = 'No visible exits.';
    inventoryEl.textContent = 'No inventory loaded.';
    actionsEl.textContent = 'No actions loaded.';
    queueEl.textContent = 'No queued actions.';
    renderSelection();
    renderGallery();
    renderActivity();
    return;
  }
  const points = projection.points || {};
  emptyStateEl.classList.add('hidden');
  sceneSummaryEl.classList.remove('hidden');
  controlHintEl.classList.remove('hidden');
  hudCharacterEl.textContent = projection.characterName;
  hudRoomEl.textContent = projection.room.title;
  hudPointsEl.textContent = `AP ${points.action ?? 0}/${points.action_max ?? 0} · FP ${points.focus ?? 0}/${points.focus_max ?? 0}`;
  renderCharacterPanel();
  roomTitleEl.textContent = projection.room.title;
  roomMetaEl.textContent = [
    projection.characterName,
    `${projection.room.exits.length} exits`,
    `${points.action ?? 0}/${points.action_max ?? 0} AP`,
    `${points.focus ?? 0}/${points.focus_max ?? 0} FP`,
  ].join(' / ');
  renderRoom();
  renderSelection();
  renderActions();
  renderQueue();
  renderGallery();
  renderActivity();
}

function renderExitPrompt(): void {
  if (!nearbyExit) {
    exitPromptEl.classList.add('hidden');
    return;
  }
  const label = nearbyExit.label || nearbyExit.direction || nearbyExit.id;
  exitPromptTextEl.textContent = nearbyExit.locked ? `${label} is locked` : `Travel to ${label}?`;
  exitPromptButton.textContent = nearbyExit.locked ? 'Locked' : 'E · Travel';
  exitPromptButton.disabled = nearbyExit.locked;
  exitPromptEl.classList.remove('hidden');
}

async function confirmNearbyExit(): Promise<void> {
  if (!nearbyExit || nearbyExit.locked) return;
  const exitId = nearbyExit.id;
  nearbyExit = null;
  renderExitPrompt();
  await moveThroughExit(exitId);
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element?.closest('input, select, textarea, button, dialog, [contenteditable="true"]'));
}

function renderRememberedMap(fog: FogState): void {
  if (!rememberedMapEl) return;
  const minX = Math.min(...fog.rooms.map(room => room.gridX), 0);
  const minY = Math.min(...fog.rooms.map(room => room.gridY), 0);
  const maxX = Math.max(...fog.rooms.map(room => room.gridX), 0);
  const maxY = Math.max(...fog.rooms.map(room => room.gridY), 0);
  rememberedMapEl.style.gridTemplateColumns = `repeat(${Math.max(1, maxX - minX + 1)}, minmax(0, 1fr))`;
  rememberedMapEl.innerHTML = fog.rooms.map(room => {
    const current = room.id === projection?.room.id;
    return `<div class="map-room ${current ? 'current' : ''}" style="grid-column:${room.gridX - minX + 1};grid-row:${room.gridY - minY + 1}" title="${escapeHtml(room.title)}">${escapeHtml(current ? '●' : '○')}<span>${escapeHtml(room.title)}</span></div>`;
  }).join('');
}

function renderRoom(): void {
  if (!projection) return;
  membersEl.innerHTML = projection.room.entities.length
    ? projection.room.entities.map(entity => {
      const item = entity as Record<string, unknown>;
      const id = String(item.id || '');
      const name = String(item.name || item.label || id);
      const kind = String(item.kind || (item.is_character ? 'character' : 'other'));
      return `
        <button class="option-row ${id === selectedTargetId ? 'selected' : ''}" type="button" data-target-id="${escapeHtml(id)}">
          <span class="row-main"><span>${iconHtml(targetIcon(kind))}${escapeHtml(name)}${id === playerId ? ' (you)' : ''}</span><span>${escapeHtml(kind)}</span></span>
        </button>
      `;
    }).join('')
    : '<div class="muted">No visible entities.</div>';

  exitsEl.innerHTML = projection.room.exits.length
    ? projection.room.exits.map(exit => `
      <button class="option-row" type="button" data-exit-id="${escapeHtml(exit.id)}">
        <span class="row-main"><span>${iconHtml('🚪')}${escapeHtml(exit.direction || exit.label || exit.id)}</span><span>${exit.locked ? 'locked' : ''}</span></span>
        <span class="row-detail">${escapeHtml(exit.label || exit.id)}</span>
      </button>
    `).join('')
    : '<div class="muted">No visible exits.</div>';

  const inventory = inventoryEntries(projection);
  inventoryEl.innerHTML = inventory.length
    ? inventory.map(item => `
      <button class="option-row ${item.value === selectedTargetId ? 'selected' : ''}" type="button" data-target-id="${escapeHtml(item.value)}">
        <span class="row-main"><span>${iconHtml(item.icon)}${escapeHtml(item.label)}</span><span>${escapeHtml(item.kind)}</span></span>
      </button>
    `).join('')
    : '<div class="muted">Nothing carried.</div>';
}

function renderSelection(): void {
  const label = selectedTargetId ? nameFor(selectedTargetId) || selectedTargetId : 'none';
  targetLabelEl.textContent = `Target: ${label}`;
  clearTargetButton.disabled = !selectedTargetId;
}

function renderActions(): void {
  if (!projection) return;
  actionFilterClearButton.disabled = !actionFilterEl.value;
  const filtered = filterActions(projection.actions, actionFilterEl.value);
  const sections = ['world', 'focus'].map(lane => {
    const rows = filtered
      .map((action, index) => ({ action, index }))
      .filter(item => actionLane(item.action) === lane)
      .map(item => actionRow(item.action, item.index))
      .join('');
    const count = filtered.filter(action => actionLane(action) === lane).length;
    return `<div class="section-title">${lane === 'focus' ? 'Focus actions' : 'Room actions'} (${count})</div>${rows || '<div class="muted">No matching actions.</div>'}`;
  });
  actionsEl.innerHTML = sections.join('');
}

function actionRow(action: ActionView, index: number): string {
  const cost = actionCost(action);
  const available = actionAvailable(action);
  const reason = actionUnavailableReason(action);
  const costText = cost.action || cost.focus
    ? [cost.action ? `<span class="cost ap">${cost.action} AP</span>` : '', cost.focus ? `<span class="cost fp">${cost.focus} FP</span>` : ''].filter(Boolean).join(' ')
    : '<span class="cost free">free</span>';
  const target = actionArguments(action).some(arg => arg.target_group) ? '<span class="cost free">target</span>' : '';
  const commandType = actionCommandType(action);
  const submitting = submittingAction === commandType;
  return `
    <button class="action-row ${available ? '' : 'unavailable'} ${submitting ? 'submitting' : ''}" type="button" data-action="${escapeHtml(commandType)}" data-action-index="${index}"${submitting ? ' disabled' : ''}>
      <span class="row-main"><span>${iconHtml(actionIcon(action))}${escapeHtml(actionTitle(action))}</span><span>${costText}</span></span>
      <span class="row-detail">${target}${target ? ' ' : ''}${escapeHtml(submitting ? 'submitting...' : reason || commandType)}</span>
    </button>
  `;
}

function renderCharacterPanel(): void {
  const name = projection?.characterName || '';
  const sheet = projection?.sheet || {};
  characterNameEl.textContent = name || 'No character selected';
  characterInfoEl.textContent = projection
    ? [sheetText(sheet, 'species'), sheetText(sheet, 'kind'), projection.room.title].filter(Boolean).join(' / ') || projection.characterId
    : 'Connect and choose a character.';
  portraitFrameEl.innerHTML = portraitHtml();
  characterStatsEl.innerHTML = projection
    ? [
      statChip('HP', hpText(projection)),
      statChip('AP', pointText(projection.points, 'action', 'action_max')),
      statChip('FP', pointText(projection.points, 'focus', 'focus_max')),
    ].join('')
    : '';
  const extras = extraPills(projection);
  characterPillsEl.innerHTML = extras.map(item => `<span class="pill">${escapeHtml(item)}</span>`).join('');
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

function renderActivity(): void {
  activityEl.innerHTML = activityLines.length
    ? activityLines.map(line => `<div class="activity-row kind-${escapeHtml(line.kind)}">${iconHtml(line.icon || '')}${escapeHtml(line.text)}</div>`).join('')
    : '<div class="muted">No recent activity.</div>';
}

function renderGallery(): void {
  photoGalleryEl.innerHTML = galleryItems.length ? renderGalleryItems(galleryItems) : '<div class="muted">No photos yet.</div>';
}

async function doAction(action: ActionView): Promise<void> {
  if (!projection || !control) return;
  const fields = actionFields(action, projection);
  const payload = fields.length ? await actionForm(action, fields) : {};
  if (payload == null) return;
  try {
    submittingAction = actionCommandType(action);
    renderActions();
    const result = await submitAction(baseUrl, projection, control, action, payload) as { queued?: boolean; reason?: string };
    if (result?.queued === false) pushActivity({ text: result.reason || 'Command rejected.', kind: 'rejection' });
    await refresh();
  } catch (err) {
    status(`submit failed: ${(err as Error).message}`, 'err');
  } finally {
    submittingAction = '';
    renderActions();
  }
}

async function moveThroughExit(exitId: string): Promise<void> {
  if (!projection || !control || !exitId) return;
  const action = projection.actions.find(item => actionArguments(item).some(arg => arg.target_group === 'exits'));
  const exitArg = action ? actionArguments(action).find(arg => arg.target_group === 'exits') : null;
  if (!action || !exitArg) {
    pushActivity({ text: 'No move action is available for that exit.', kind: 'rejection' });
    renderActivity();
    return;
  }
  await doActionWithPayload(action, { [exitArg.key]: exitId });
}

async function doActionWithPayload(action: ActionView, payload: Record<string, unknown>): Promise<void> {
  if (!projection || !control) return;
  try {
    submittingAction = actionCommandType(action);
    renderActions();
    const result = await submitAction(baseUrl, projection, control, action, payload) as { queued?: boolean; reason?: string };
    if (result?.queued === false) pushActivity({ text: result.reason || 'Command rejected.', kind: 'rejection' });
    await refresh();
  } catch (err) {
    status(`submit failed: ${(err as Error).message}`, 'err');
  } finally {
    submittingAction = '';
    renderActions();
  }
}

async function cancelQueued(commandId: string): Promise<void> {
  if (!projection || !control || !commandId) return;
  try {
    const result = await cancelCommand(baseUrl, projection.characterId, commandId, control) as { cancelled?: boolean; reason?: string };
    if (!result?.cancelled) pushActivity({ text: result?.reason || 'Could not cancel queued command.', kind: 'rejection' });
    await refresh();
  } catch (err) {
    status(`cancel failed: ${(err as Error).message}`, 'err');
  }
}

async function requestImage(): Promise<void> {
  if (!baseUrl || !playerId) {
    pushActivity({ text: 'Select a character before requesting an image.', kind: 'system' });
    renderActivity();
    return;
  }
  try {
    const result = await requestSceneImage(baseUrl, playerId, control);
    pushActivity({ text: imageRequestMessage(result), kind: 'system' });
    const data = result as Record<string, unknown>;
    if (typeof data.url === 'string') {
      addGalleryItem({
        id: `scene:immediate:${data.url}`,
        src: mediaUrl(data.url),
        title: 'Scene image',
        detail: 'server scene image',
        filename: `bunnyland-scene-${Date.now()}.png`,
        createdAt: Date.now(),
      }, true);
    }
    await refresh();
  } catch (err) {
    pushActivity({ text: `📷 ${(err as Error).message}`, kind: 'rejection' });
    renderActivity();
  }
}

function openSheet(): void {
  if (!baseUrl || !playerId) {
    pushActivity({ text: 'Select a character before opening a sheet.', kind: 'system' });
    renderActivity();
    return;
  }
  let characterId = playerId;
  if (selectedTargetId && selectedTargetId !== playerId) {
    const selected = projection?.room.entities.find(entity => String((entity as Record<string, unknown>).id || '') === selectedTargetId) as Record<string, unknown> | undefined;
    if (selected && (selected.is_character || selected.kind === 'character')) characterId = selectedTargetId;
  }
  const href = characterSheetHref(baseUrl, characterId);
  const opened = window.open(href, '_blank', 'noopener');
  pushActivity({ text: opened ? `Opened sheet: ${href}` : `Sheet URL: ${href}`, kind: 'system' });
  renderActivity();
}

async function claimOrResume(): Promise<void> {
  if (!baseUrl || !playerId) return;
  try {
    control = await claimCharacter(baseUrl, playerId, claimOptionsFromForm());
    startPlayerUpdates();
    claimDialog.close();
  } catch (err) {
    status(`claim failed: ${(err as Error).message}`, 'err');
  }
}

async function saveFallback(): Promise<void> {
  if (!baseUrl || !playerId || !control) return;
  try {
    await updateControllerFallback(baseUrl, playerId, control, claimOptionsFromForm());
    pushActivity({ text: 'Idle fallback saved.', kind: 'system' });
    renderActivity();
  } catch (err) {
    status(`fallback failed: ${(err as Error).message}`, 'err');
  }
}

async function idleController(): Promise<void> {
  if (!baseUrl || !playerId || !control) return;
  try {
    control = await releaseController(baseUrl, playerId, control, claimOptionsFromForm());
    pushActivity({ text: 'Character returned to idle controller.', kind: 'system' });
    await refresh();
    claimDialog.close();
  } catch (err) {
    status(`idle failed: ${(err as Error).message}`, 'err');
  }
}

async function releasePlayerClaim(): Promise<void> {
  if (!baseUrl || !playerId || !control) return;
  try {
    await releaseClaim(baseUrl, playerId, control);
    stopPlayerUpdates();
    control = null;
    projection = null;
    queue = null;
    selectedTargetId = '';
    startLobbyPolling();
    pushActivity({ text: 'Claim released.', kind: 'system' });
    claimDialog.close();
    render();
  } catch (err) {
    status(`release failed: ${(err as Error).message}`, 'err');
  }
}

function actionForm(action: ActionView, fields: ReturnType<typeof actionFields>): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    scene.setEnabled(false);
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
      scene.setEnabled(true);
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
        if (value) {
          if (field.kind === 'number') payload[field.key] = Number(value);
          else if (field.kind === 'boolean') payload[field.key] = value === 'true';
          else payload[field.key] = value;
        }
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
      return `<option value="${escapeHtml(candidate.value)}"${selected}>${escapeHtml(candidate.icon)} ${escapeHtml(candidate.label)}</option>`;
    })];
    return `<label class="form-field"><span>${label}</span><select data-field="${index}">${options.join('')}</select></label>`;
  }
  if (field.kind === 'boolean') {
    return `<label class="form-field"><span>${label}</span><select data-field="${index}"><option value="">Choose...</option><option value="true">yes</option><option value="false">no</option></select></label>`;
  }
  return `<label class="form-field"><span>${label}</span><input data-field="${index}" type="${field.kind === 'number' ? 'number' : 'text'}"></label>`;
}

function selectTarget(entityId: string): void {
  selectedTargetId = entityId || '';
  if (selectedTargetId) scene.selectEntity(selectedTargetId);
  else scene.clearSelection();
  render();
}

function clearTarget(): void {
  selectTarget('');
}

function claimOptionsFromForm(): ClaimOptions {
  const fallbackChoice = claimFallbackEl.value || 'suspend';
  const fallbackController = fallbackChoice === 'controller'
    ? claimFallbackControllerEl.value.trim() || 'suspend'
    : fallbackChoice;
  const minutes = Math.min(60, Math.max(5, Number(claimTimeoutEl.value || 30)));
  return { fallbackController, timeoutSeconds: Math.round(minutes * 60) };
}

function roomOf(entityId: string): string | null {
  if (!projection) return null;
  if (entityId === playerId) return projection.room.id;
  if (projection.room.entities.some(entity => String((entity as Record<string, unknown>).id || '') === entityId)) return projection.room.id;
  return null;
}

function nameFor(entityId: string): string | null {
  if (!projection) return characters.find(character => character.id === entityId)?.name || null;
  if (entityId === playerId) return projection.characterName;
  return allTargets(projection).find(item => item.value === entityId)?.label
    || characters.find(character => character.id === entityId)?.name
    || null;
}

function portraitHtml(): string {
  if (!projection) return `<div class="portrait-placeholder">?</div>`;
  const url = typeof projection.portrait?.url === 'string' ? mediaUrl(projection.portrait.url) : '';
  if (url) return `<img src="${escapeHtml(url)}" alt="${escapeHtml(projection.characterName)} portrait">`;
  return `<div class="portrait-placeholder">${escapeHtml(initials(projection.characterName))}</div>`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length ? parts.map(part => part[0]).join('') : '?').slice(0, 2).toUpperCase();
}

function mediaUrl(url: string): string {
  return sharedMediaUrl(baseUrl, url);
}

function statChip(label: string, value: string): string {
  return `<div class="stat-chip"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`;
}

function pointText(points: Record<string, number>, currentKey: string, maxKey: string): string {
  return `${formatPoints(points[currentKey] ?? 0)} / ${formatPoints(points[maxKey] ?? 0)}`;
}

function hpText(data: CharacterProjection): string {
  const points = data.points || {};
  const current = firstNumber(points, ['health', 'hp', 'hit_points']);
  const maximum = firstNumber(points, ['health_max', 'hp_max', 'hit_points_max', 'max_health']);
  if (current != null || maximum != null) return `${formatPoints(current ?? 0)} / ${formatPoints(maximum ?? 0)}`;
  const metric = metricByLabels(data.sheet?.vitals, ['health', 'hp', 'hit points']);
  return metricText(metric);
}

function firstNumber(values: Record<string, number>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(values[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function metricByLabels(rows: unknown, labels: string[]): Record<string, unknown> | null {
  const wanted = new Set(labels.map(label => label.toLowerCase()));
  return (Array.isArray(rows) ? rows : []).find(row => wanted.has(String((row as Record<string, unknown>).label || '').toLowerCase())) as Record<string, unknown> | undefined || null;
}

function metricText(metric: Record<string, unknown> | null): string {
  if (!metric) return '-';
  if (metric.text != null) return String(metric.text);
  if (metric.value != null && metric.max != null) return `${formatPoints(Number(metric.value))} / ${formatPoints(Number(metric.max))}`;
  if (metric.value != null) return String(metric.value);
  return '-';
}

function sheetText(sheet: Record<string, unknown>, key: string): string {
  return typeof sheet[key] === 'string' ? String(sheet[key]) : '';
}

function extraPills(data: CharacterProjection | null): string[] {
  if (!data) return [];
  const sheet = data.sheet || {};
  const status = Array.isArray(sheet.status) ? sheet.status.map(String) : [];
  const vitals = compactMetrics(sheet.vitals, ['health', 'hp', 'hit points', 'initiative']).slice(0, 2);
  const needs = compactMetrics(sheet.needs, []).slice(0, 2);
  const affect = compactMetrics(sheet.affect, []).slice(0, 1);
  return [...status, ...vitals, ...needs, ...affect].slice(0, 7);
}

function compactMetrics(rows: unknown, skipLabels: string[]): string[] {
  const skip = new Set(skipLabels.map(label => label.toLowerCase()));
  return (Array.isArray(rows) ? rows : [])
    .map(row => row as Record<string, unknown>)
    .filter(row => !skip.has(String(row.label || '').toLowerCase()))
    .map(row => [row.label, row.text ?? row.value].filter(value => value != null && value !== '').join(' '))
    .filter(Boolean)
    .map(String);
}

function formatPoints(value: unknown): string {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function pushActivity(...lines: ActivityLine[]): void {
  if (!lines.length) return;
  activityLines.push(...lines);
  activityLines = activityLines.slice(-ACTIVITY_LIMIT);
}

function captureImage(): string {
  return scene.capturePng();
}

function captureToGallery(): void {
  const createdAt = Date.now();
  addGalleryItem({
    id: `capture:${createdAt}`,
    src: captureImage(),
    title: 'Canvas capture',
    detail: 'local 3D canvas capture',
    filename: `bunnyland-3d-player-${new Date(createdAt).toISOString().replace(/[:.]/g, '-')}.png`,
    createdAt,
  }, true);
  pushActivity({ text: 'Canvas capture added to photos.', kind: 'system' });
  render();
}

function addGalleryItem(item: GalleryItem, open: boolean): void {
  const existing = galleryItems.find(entry => entry.id === item.id || entry.src === item.src);
  galleryItems = mergeGalleryItems(galleryItems, item);
  if (open) openGalleryItem(existing?.id || item.id);
  else renderGallery();
}

function openGalleryItem(id: string): void {
  const item = galleryItems.find(entry => entry.id === id);
  if (!item) return;
  activeGalleryId = id;
  photoLightboxTitle.textContent = item.title;
  photoLightboxMeta.textContent = item.detail;
  photoLightboxImg.src = item.src;
  photoLightboxImg.alt = item.title;
  photoLightbox.classList.remove('hidden');
  scene.setEnabled(false);
}

function closeLightbox(): void {
  activeGalleryId = '';
  photoLightbox.classList.add('hidden');
  photoLightboxImg.removeAttribute('src');
  scene.setEnabled(true);
}

function downloadActivePhoto(): void {
  const item = galleryItems.find(entry => entry.id === activeGalleryId);
  if (!item) return;
  const link = document.createElement('a');
  link.href = item.src;
  link.download = item.filename;
  link.click();
}

function targetIcon(kind: string): string {
  if (kind === 'exit') return '🚪';
  if (kind === 'character') return '🐰';
  if (kind === 'item') return '✦';
  if (kind === 'container') return '📦';
  return '⬡';
}

function iconHtml(icon: string): string {
  return showActionIcons && icon ? `<span class="row-icon">${escapeHtml(icon)}</span>` : '';
}

connectButton.addEventListener('click', () => { void connect(apiInput.value); });
refreshButton.addEventListener('click', () => { void refresh(); });
characterSelect.addEventListener('change', () => { void selectCharacter(characterSelect.value); });
claimButton.addEventListener('click', () => {
  if (!playerId) return;
  dialogClaimButton.textContent = control?.active === false ? 'Resume' : 'Claim';
  scene.setEnabled(false);
  claimDialog.showModal();
});
claimDialog.addEventListener('close', () => scene.setEnabled(true));
requestImageButton.addEventListener('click', () => { void requestImage(); });
openSheetButton.addEventListener('click', openSheet);
clearTargetButton.addEventListener('click', clearTarget);
showActionIconsEl.addEventListener('change', () => {
  showActionIcons = showActionIconsEl.checked;
  setIconPreference(showActionIcons);
  render();
});
actionFilterEl.addEventListener('input', renderActions);
actionFilterClearButton.addEventListener('click', () => {
  actionFilterEl.value = '';
  renderActions();
  actionFilterEl.focus();
});
membersEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-target-id]');
  if (row?.dataset.targetId) selectTarget(row.dataset.targetId);
});
inventoryEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-target-id]');
  if (row?.dataset.targetId) selectTarget(row.dataset.targetId);
});
exitsEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-exit-id]');
  if (row?.dataset.exitId) void moveThroughExit(row.dataset.exitId);
});
actionsEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-action-index]');
  const action = row ? filterActions(projection?.actions || [], actionFilterEl.value)[Number(row.dataset.actionIndex)] : null;
  if (action) void doAction(action);
});
queueEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-command-id]');
  if (row?.dataset.commandId) void cancelQueued(row.dataset.commandId);
});
dialogClaimButton.addEventListener('click', () => { void claimOrResume(); });
dialogSaveFallbackButton.addEventListener('click', () => { void saveFallback(); });
dialogIdleButton.addEventListener('click', () => { void idleController(); });
dialogReleaseButton.addEventListener('click', () => { void releasePlayerClaim(); });
photoGalleryEl.addEventListener('click', event => {
  const row = (event.target as HTMLElement).closest<HTMLElement>('[data-gallery-id]');
  if (row?.dataset.galleryId) openGalleryItem(row.dataset.galleryId);
});
photoLightbox.addEventListener('click', event => {
  if (event.target === photoLightbox) closeLightbox();
});
lightboxCloseButton.addEventListener('click', closeLightbox);
lightboxDownloadButton.addEventListener('click', downloadActivePhoto);
captureButton.addEventListener('click', captureToGallery);
hudButton.addEventListener('click', () => {
  const closed = sideEl.classList.toggle('closed');
  hudButton.setAttribute('aria-expanded', String(!closed));
  if (!closed) sideEl.focus();
});
exitPromptButton.addEventListener('click', () => { void confirmNearbyExit(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !photoLightbox.classList.contains('hidden')) closeLightbox();
  if (event.code === 'KeyE' && nearbyExit && !isTypingTarget(event.target)) {
    event.preventDefault();
    void confirmNearbyExit();
  }
});
bindThemeSelect(themeSelect);
window.addEventListener('beforeunload', () => {
  stopPlayerUpdates();
  stopLobbyPolling();
});

const server = serverFromUrl();
if (server) void connect(server);
render();

declare global {
  interface Window {
    __world3dPlayer?: {
      ready: boolean;
      connect: (base: string) => Promise<void>;
      selectCharacter: (characterId: string) => Promise<void>;
      refresh: () => Promise<void>;
      selectTarget: (entityId: string) => void;
      exitScreenPoint: (exitId: string, sourceRoomId?: string) => ReturnType<PlayerScene['exitScreenPoint']>;
      entityScreenPoint: (entityId: string) => ReturnType<PlayerScene['entityScreenPoint']>;
      exitStates: () => ReturnType<PlayerScene['exitStates']>;
      cameraState: () => ReturnType<PlayerScene['cameraState']>;
      visualState: () => ReturnType<PlayerScene['visualState']>;
      avatarState: () => ReturnType<PlayerScene['cameraState']>['avatar'];
      capture: () => string;
    };
  }
}

window.__world3dPlayer = {
  ready: true,
  connect,
  selectCharacter,
  refresh,
  selectTarget,
  exitScreenPoint: exitId => scene.exitScreenPoint(exitId),
  entityScreenPoint: entityId => scene.entityScreenPoint(entityId),
  exitStates: () => scene.exitStates(),
  cameraState: () => scene.cameraState(),
  visualState: () => scene.visualState(),
  avatarState: () => scene.cameraState().avatar,
  capture: captureImage,
};
