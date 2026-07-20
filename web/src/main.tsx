import '@bunnyland/ui-web/assets/bunnyland-ui.css';
import './canvas-loading.css';
import { serverFromUrl } from '@bunnyland/ui-web/api';
import { AuthGate, AuthProvider, ThemeSelect } from '@bunnyland/ui-web/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CanvasLoading } from './canvas-loading';

type RendererState = { kind: 'loading' | 'ready'; error: '' } | { kind: 'error'; error: string };

function AdminShell() {
  const [renderer, setRenderer] = useState<RendererState>({ kind: 'loading', error: '' });
  useEffect(() => {
    let active = true;
    void import('./admin-controller').then(() => {
      if (active) setRenderer({ kind: 'ready', error: '' });
    }).catch((loadError: unknown) => {
      if (active) setRenderer({
        kind: 'error',
        error: loadError instanceof Error ? loadError.message : String(loadError),
      });
    });
    return () => { active = false; };
  }, []);
  return <>
    <div id="toolbar">
      <strong>Bunnyland 3D Admin</strong>
      <label for="api-url">Server</label>
      <input id="api-url" defaultValue="/api/v1/" spellcheck={false} />
      <button id="btn-load" type="button">Load</button>
      <button id="btn-refresh" type="button">Refresh</button>
      <button id="btn-mode" type="button">2D</button>
      <button id="btn-camera" type="button">Auto Camera</button>
      <button id="btn-capture" type="button">📷 Download</button>
      <label for="theme-select">Theme</label>
      <span id="theme-select-root"><ThemeSelect id="theme-select" aria-label="Theme" /></span>
      <span id="epoch"></span>
      <span id="status">{renderer.kind === 'loading' ? 'Loading renderer…' : renderer.kind === 'error' ? 'Load failed' : 'Ready'}</span>
    </div>
    <main id="main">
      <section id="viewer" aria-busy={renderer.kind === 'loading'}>
        {renderer.kind !== 'ready' && <CanvasLoading error={renderer.error} />}
      </section>
      <aside id="side">
        <section class="panel">
          <h2 id="selected-title">No room selected</h2>
          <div id="selected-meta" class="muted"></div>
          <div id="selected-entities" class="muted">Load an overview.</div>
        </section>
        <section class="panel control-grid">
          <h2>Outdoor graphics</h2>
          <div>
            <button id="btn-preview-decoration" type="button">Preview</button>
            <button id="btn-apply-decoration" type="button">Apply</button>
            <button id="btn-reroll-decoration" type="button">Reroll</button>
          </div>
          <button id="btn-apply-outdoors" type="button">Apply to all outdoor rooms</button>
          <label><input id="room-has-roof" type="checkbox" /> Room has a roof</label>
          <label>Texture target
            <select id="texture-scope"><option value="room">This room</option><option value="biome">Biome default</option></select>
          </label>
          <label>Ground texture <input id="texture-albedo" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          <label>Normal map <input id="texture-normal" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          <label>Skybox <input id="texture-skybox" type="file" accept="image/png,image/jpeg,image/webp" /></label>
          <div id="decoration-result" class="muted">Select a room to manage its graphics.</div>
        </section>
        <section class="panel">
          <h2>Rooms</h2>
          <div id="room-list" class="muted">No overview loaded.</div>
        </section>
      </aside>
    </main>
  </>;
}

const root = document.getElementById('app');
if (root) render(<AuthProvider base={serverFromUrl() || '/api/v1'}><AuthGate scopes={['world:admin']}><AdminShell /></AuthGate></AuthProvider>, root);
