import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const assetUrl = new URL('../public/assets/3d/avatar-leporid.gltf', import.meta.url);
const binaryUrl = new URL('../public/assets/3d/bunnyland-3d.bin', import.meta.url);
const manifestUrl = new URL('../public/assets/3d/manifest.json', import.meta.url);
const generatorUrl = new URL('../scripts/generate-3d-assets.mjs', import.meta.url);
const execFileAsync = promisify(execFile);
const assetBinary = await readFile(binaryUrl);

function accessorValues(gltf, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const bytes = assetBinary;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const length = accessor.count * components[accessor.type];
  if (accessor.componentType === 5123) {
    return new Uint16Array(bytes.buffer, bytes.byteOffset + offset, length);
  }
  return new Float32Array(bytes.buffer, bytes.byteOffset + offset, length);
}

function triangleAlignment(positions, normals, indices, offset) {
  const [a, b, c] = [indices[offset], indices[offset + 1], indices[offset + 2]];
  const ab = [
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  ];
  const ac = [
    positions[c * 3] - positions[a * 3],
    positions[c * 3 + 1] - positions[a * 3 + 1],
    positions[c * 3 + 2] - positions[a * 3 + 2],
  ];
  const face = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const normal = [
    normals[a * 3] + normals[b * 3] + normals[c * 3],
    normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1],
    normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2],
  ];
  return face[0] * normal[0] + face[1] * normal[1] + face[2] * normal[2];
}

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
  const ear = gltf.nodes.find(node => node.name === 'Ear.L');
  const innerEar = gltf.nodes.find(node => node.name === 'InnerEar.L');
  assert.ok(
    innerEar.translation[2] + innerEar.scale[2] * 0.5
      < ear.translation[2] + ear.scale[2] * 0.5,
    'inner ear stays recessed behind the outer ear surface',
  );
  const arm = gltf.nodes.find(node => node.name === 'Arm.L');
  assert.ok(Math.abs(arm.rotation[2]) > 0.5, 'resting arms point outward instead of upright');
  assert.ok(Math.abs(arm.rotation[0]) > 0.1, 'resting arms also reach slightly forward');
  const head = gltf.nodes.find(node => node.name === 'Head');
  const headChildren = new Set(head.children.map(index => gltf.nodes[index].name));
  for (const name of ['Head.Shape', 'Ear.L', 'Ear.R', 'Eye.L', 'Eye.R', 'Nose']) {
    assert.ok(headChildren.has(name), `head focus pivot owns ${name}`);
  }
  const body = gltf.nodes.find(node => node.name === 'Body');
  assert.equal(gltf.meshes[body.mesh].name, 'FurSphere', 'body uses a chunky faceted silhouette');
  const furSphere = gltf.meshes.find(mesh => mesh.name === 'FurSphere');
  const furPositions = accessorValues(gltf, furSphere.primitives[0].attributes.POSITION);
  assert.ok(furPositions.length / 3 <= 48, 'avatar sphere remains deliberately low-poly');
  const walk = gltf.animations.find(animation => animation.name === 'Walk');
  const armChannel = walk.channels.find(channel => gltf.nodes[channel.target.node].name === 'Arm.L');
  const armRotations = accessorValues(gltf, walk.samplers[armChannel.sampler].output);
  for (let index = 2; index < armRotations.length; index += 4) {
    assert.ok(Math.abs(armRotations[index]) > 0.5, 'walking arm preserves its outward angle');
  }
  for (let index = 4; index < armRotations.length; index += 4) {
    const dot = armRotations[index - 4] * armRotations[index]
      + armRotations[index - 3] * armRotations[index + 1]
      + armRotations[index - 2] * armRotations[index + 2]
      + armRotations[index - 1] * armRotations[index + 3];
    assert.ok(dot > 0.98, 'walking arm keyframes stay in one close quaternion hemisphere');
  }
  assert.equal(gltf.buffers[0].uri, 'bunnyland-3d.bin');
  assert.doesNotMatch(gltfText, /https?:\/\//);
  assert.doesNotMatch(gltfText, /data:/);
  assert.equal((await stat(binaryUrl)).size, gltf.buffers[0].byteLength);
  assert.ok((await stat(fileURLToPath(assetUrl))).size < 500_000);
});

test('bundled mesh faces use outward counter-clockwise winding', async () => {
  const gltf = JSON.parse(await readFile(assetUrl, 'utf8'));
  for (const mesh of gltf.meshes) {
    const primitive = mesh.primitives[0];
    const positions = accessorValues(gltf, primitive.attributes.POSITION);
    const normals = accessorValues(gltf, primitive.attributes.NORMAL);
    const indices = accessorValues(gltf, primitive.indices);
    let outward = 0;
    for (let index = 0; index < indices.length; index += 3) {
      const alignment = triangleAlignment(positions, normals, indices, index);
      if (Math.abs(alignment) > 1e-7) {
        assert.ok(alignment > 0, `${mesh.name} triangle ${index / 3} faces inward`);
        outward += 1;
      }
    }
    assert.ok(outward > 0, `${mesh.name} has no non-degenerate outward faces`);
  }
});

test('bundled art generation is deterministic and props keep their visual parts', async () => {
  const paths = [
    assetUrl,
    new URL('../public/assets/3d/prop-generic.gltf', import.meta.url),
    new URL('../public/assets/3d/prop-lantern.gltf', import.meta.url),
    manifestUrl,
  ];
  const before = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  const binaryBefore = await readFile(binaryUrl);
  await execFileAsync(process.execPath, [fileURLToPath(generatorUrl)]);
  const after = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  assert.deepEqual(after, before);
  assert.deepEqual(await readFile(binaryUrl), binaryBefore);

  const crate = JSON.parse(after[1]);
  const lantern = JSON.parse(after[2]);
  assert.equal(crate.buffers[0].uri, 'bunnyland-3d.bin');
  assert.equal(lantern.buffers[0].uri, 'bunnyland-3d.bin');
  assert.ok(crate.nodes.some(node => node.name === 'Crate.Top'));
  assert.ok(crate.nodes.filter(node => node.name?.startsWith('Crate.Band.')).length === 2);
  assert.ok(lantern.nodes.some(node => node.name === 'Lantern.Cap'));
  assert.ok(lantern.nodes.some(node => node.name === 'LanternGlow'));
  assert.ok(lantern.nodes.filter(node => node.name?.startsWith('Lantern.Handle.')).length === 2);
});
