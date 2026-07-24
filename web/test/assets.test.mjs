import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const assetUrl = new URL('../public/assets/3d/avatar-leporid.gltf', import.meta.url);
const manifestUrl = new URL('../public/assets/3d/manifest.json', import.meta.url);
const generatorUrl = new URL('../scripts/generate-3d-assets.mjs', import.meta.url);
const execFileAsync = promisify(execFile);

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
  const names = new Set(gltf.nodes.map(node => node.name));
  for (const name of ['Body', 'Head', 'Ear.L', 'Ear.R', 'Arm.L', 'Arm.R', 'Leg.L', 'Leg.R', 'Tail']) {
    assert.ok(names.has(name), `avatar preserves ${name}`);
  }
  assert.ok(names.has('Variant.scout'));
  assert.ok(names.has('Variant.gardener'));
  assert.ok(gltf.materials.some(material => material.name === 'Belly'));
  assert.ok(gltf.materials.some(material => material.name === 'InnerEar'));
  assert.ok(gltf.animations[0].channels.length >= 4, 'idle animates breathing, head, and ears');
  assert.ok(gltf.animations[1].channels.length >= 6, 'walk animates bounce, head, and limbs');
  const tail = gltf.nodes.find(node => node.name === 'Tail');
  assert.ok(tail.translation[2] < 0, 'avatar tail belongs behind the bunny');
  assert.match(gltf.buffers[0].uri, /^data:application\/octet-stream;base64,/);
  assert.doesNotMatch(gltfText, /https?:\/\//);
  assert.ok((await stat(fileURLToPath(assetUrl))).size < 500_000);
});

test('bundled art generation is deterministic and props keep their visual parts', async () => {
  const paths = [
    assetUrl,
    new URL('../public/assets/3d/prop-generic.gltf', import.meta.url),
    new URL('../public/assets/3d/prop-lantern.gltf', import.meta.url),
    manifestUrl,
  ];
  const before = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  await execFileAsync(process.execPath, [fileURLToPath(generatorUrl)]);
  const after = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  assert.deepEqual(after, before);

  const crate = JSON.parse(after[1]);
  const lantern = JSON.parse(after[2]);
  assert.ok(crate.nodes.some(node => node.name === 'Crate.Top'));
  assert.ok(crate.nodes.filter(node => node.name?.startsWith('Crate.Band.')).length === 2);
  assert.ok(lantern.nodes.some(node => node.name === 'Lantern.Cap'));
  assert.ok(lantern.nodes.some(node => node.name === 'LanternGlow'));
  assert.ok(lantern.nodes.filter(node => node.name?.startsWith('Lantern.Handle.')).length === 2);
});
