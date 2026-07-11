import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const assetUrl = new URL('../public/assets/3d/avatar-leporid.gltf', import.meta.url);
const manifestUrl = new URL('../public/assets/3d/manifest.json', import.meta.url);

test('bundled avatar manifest resolves an animated repo-owned glTF', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const avatar = manifest.assets['avatar.leporid'];
  assert.equal(manifest.schema_version, 1);
  assert.equal(avatar.path, 'avatar-leporid.gltf');
  assert.deepEqual(avatar.clips, ['Idle', 'Walk']);
  assert.equal(manifest.assets['prop.generic'].path, 'prop-generic.gltf');
  assert.equal(manifest.assets['prop.lantern'].path, 'prop-lantern.gltf');

  const gltfText = await readFile(assetUrl, 'utf8');
  const gltf = JSON.parse(gltfText);
  assert.equal(gltf.asset.version, '2.0');
  assert.deepEqual(gltf.animations.map(animation => animation.name), ['Idle', 'Walk']);
  const tail = gltf.nodes.find(node => node.name === 'Tail');
  assert.ok(tail.translation[2] < 0, 'avatar tail belongs behind the bunny');
  assert.match(gltf.buffers[0].uri, /^data:application\/octet-stream;base64,/);
  assert.doesNotMatch(gltfText, /https?:\/\//);
  assert.ok((await stat(fileURLToPath(assetUrl))).size < 500_000);
});
