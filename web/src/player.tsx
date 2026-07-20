import '@bunnyland/ui-web/assets/bunnyland-ui.css';
import { serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthGate, AuthProvider, ThemeSelect } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

function PlayerShell() {
  const [error, setError] = useState('');
  useEffect(() => {
    void import('./player-controller').catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
  }, []);
  return <>
    <div id="toolbar">
      <strong>Bunnyland 3D Player</strong>
      <label for="api-url">Server</label>
      <input id="api-url" defaultValue="/api/v1/" spellcheck={false} />
      <button id="btn-connect" type="button">Connect</button>
      <label for="character-select">Character</label>
      <select id="character-select"><option value="">Choose...</option></select>
      <button id="btn-claim" type="button" disabled>Claim</button>
      <button id="btn-request-image" type="button">📷 image</button>
      <button id="btn-refresh" type="button">Refresh</button>
      <button id="btn-capture" type="button">📷 Capture</button>
      <button id="btn-hud" type="button" aria-controls="side" aria-expanded="true">Panels</button>
      <label for="theme-select">Theme</label>
      <span id="theme-select-root"><ThemeSelect id="theme-select" aria-label="Theme" /></span>
      <span id="status">{error ? `Load failed: ${error}` : 'Ready'}</span>
    </div>
    <dialog id="claim-dialog">
      <form method="dialog" class="claim-dialog-form">
        <h3>Claim</h3>
        <label for="claim-fallback">Idle controller</label>
        <select id="claim-fallback">
          <option value="suspend">Suspended</option>
          <option value="llm">LLM</option>
          <option value="controller">Existing controller</option>
        </select>
        <label for="claim-fallback-controller">Idle controller ID</label>
        <input type="text" id="claim-fallback-controller" spellcheck={false} placeholder="entity_..." />
        <label for="claim-timeout">Idle timeout minutes</label>
        <input type="number" id="claim-timeout" min="5" max="60" step="1" defaultValue="30" />
        <div class="claim-actions">
          <button id="btn-dialog-claim" type="button">Claim</button>
          <button id="btn-dialog-save-fallback" type="button">Save Idle</button>
          <button id="btn-dialog-idle" type="button">Idle</button>
          <button id="btn-dialog-release" type="button">Release</button>
          <button type="submit">Close</button>
        </div>
      </form>
    </dialog>
    <main id="main">
      <section id="viewer"></section>
      <div id="empty-state" aria-live="polite">
        <div id="empty-state-title">Connect to a server</div>
        <div id="empty-state-detail">Enter a Bunnyland API URL above, then choose a character.</div>
      </div>
      <div id="scene-summary" class="hidden" aria-live="polite">
        <div id="hud-character">No character selected</div>
        <div id="hud-room">Connect to a v2 server to begin.</div>
        <div id="hud-points"></div>
      </div>
      <div id="control-hint">WASD move · right-drag orbit · wheel zoom · click target</div>
      <div id="exit-prompt" class="hidden" aria-live="polite">
        <span id="exit-prompt-text">Travel?</span>
        <button id="btn-exit-prompt" type="button">E · Travel</button>
      </div>
      <aside id="side">
        <section class="panel">
          <div class="portrait-panel">
            <div id="portrait-frame" class="portrait-frame"></div>
            <div class="character-summary">
              <div class="character-title-row">
                <div id="character-name">No character selected</div>
                <button id="btn-open-sheet" type="button" disabled>▣ Character Profile</button>
              </div>
              <div id="character-info">Connect and choose a character.</div>
              <div id="character-stats" class="stat-grid"></div>
              <div id="character-pills" class="pill-row"></div>
            </div>
          </div>
        </section>
        <section class="panel">
          <h2 id="room-title">No room</h2>
          <div id="room-meta" class="muted">Connect and choose a character.</div>
        </section>
        <section class="panel"><h2>Remembered map</h2><div id="remembered-map" class="muted">No rooms remembered.</div></section>
        <section class="panel">
          <h2>Room</h2>
          <div id="members" class="option-list muted">No visible entities.</div>
          <div class="section-title">Exits</div>
          <div id="exits" class="option-list muted">No visible exits.</div>
          <div class="section-title">Inventory</div>
          <div id="inventory" class="option-list muted">No inventory loaded.</div>
        </section>
        <section class="panel queue-panel"><h2>Pending actions</h2><div id="queue" class="muted">No queued actions.</div></section>
        <section class="panel actions-panel">
          <h2>Actions</h2>
          <div id="target-line"><span id="target-label">Target: none</span><button id="btn-clear-target" type="button" disabled>Clear Target</button></div>
          <div id="action-tools"><label title="Show action and activity icons"><input id="show-action-icons" type="checkbox" defaultChecked /> Icons</label></div>
          <div id="action-filter-row"><input id="action-filter" type="text" placeholder="Search actions" spellcheck={false} /><button id="action-filter-clear" type="button">Clear</button></div>
          <div id="actions" class="muted">No actions loaded.</div>
        </section>
        <section class="panel"><h2>Photos</h2><div id="photo-gallery" class="gallery-grid muted">No photos yet.</div></section>
        <section class="panel"><h2>Activity</h2><div id="activity" class="option-list muted">No recent activity.</div></section>
      </aside>
    </main>
    <div id="photo-lightbox" class="hidden" role="dialog" aria-modal="true" aria-labelledby="photo-lightbox-title">
      <div class="lightbox-bar">
        <div><div id="photo-lightbox-title" class="lightbox-title">Photo</div><div id="photo-lightbox-meta" class="muted"></div></div>
        <button id="btn-lightbox-download" type="button">Download</button>
        <button id="btn-lightbox-close" type="button">Close</button>
      </div>
      <div class="lightbox-body"><img id="photo-lightbox-img" alt="Selected gallery image" /></div>
    </div>
  </>;
}

const root = document.getElementById('app');
if (root) render(<AuthProvider base={serverFromUrl() || '/api/v1'}><AuthGate scopes={['world:play']}><PlayerShell /></AuthGate></AuthProvider>, root);
