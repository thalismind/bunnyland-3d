import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const playerMarkup = await readFile(new URL('../src/player.tsx', import.meta.url), 'utf8');
const playerPage = await readFile(new URL('../player.html', import.meta.url), 'utf8');
const controller = await readFile(new URL('../src/player-controller.tsx', import.meta.url), 'utf8');
const scene = await readFile(new URL('../src/player-scene.ts', import.meta.url), 'utf8');
const nginx = await readFile(new URL('../nginx.conf', import.meta.url), 'utf8');

test('coarse-pointer movement and zoom controls have accessible names', () => {
  for (const label of ['Move forward', 'Move left', 'Move backward', 'Move right', 'Zoom in', 'Zoom out']) {
    assert.match(playerMarkup, new RegExp(`aria-label="${label}"`));
  }
  assert.match(playerPage, /#touch-controls[\s\S]*display: none/);
  assert.match(playerPage, /@media \(pointer: coarse\)[\s\S]*#touch-controls/);
  assert.match(controller, /setVirtualMovement\(code, true\)/);
  assert.match(controller, /setVirtualMovement\(code, false\)/);
  assert.match(controller, /adjustZoom\(Number\(button\.dataset\.zoom\)\)/);
});

test('the renderer supports touch orbit, pinch zoom, and system appearance preferences', () => {
  assert.match(scene, /touchPointers = new Map<number, THREE\.Vector2>\(\)/);
  assert.match(scene, /pinchDistance/);
  assert.match(scene, /event\.pointerType === 'touch'/);
  assert.match(scene, /this\.cameraYaw/);
  assert.match(scene, /this\.cameraRadius/);
  assert.match(playerPage, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(playerPage, /@media \(forced-colors: active\)/);
});

test('the 3D shell retains a live status region and a non-canvas HUD path', () => {
  assert.match(playerMarkup, /id="player-announcer"[\s\S]*aria-live="polite"/);
  assert.match(playerMarkup, /id="side"[\s\S]*id="panel-room"[\s\S]*id="panel-actions"/);
  assert.match(playerMarkup, /id="viewer"[\s\S]*id="side"/);
});

test('the 3D image compresses text and caches only hashed assets immutably', () => {
  assert.match(nginx, /gzip on;/);
  assert.match(nginx, /\/config\.json "no-store"/);
  assert.match(nginx, /assets\/[\s\S]*max-age=31536000, immutable/);
  assert.match(nginx, /default "no-cache"/);
});
