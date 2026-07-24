#!/usr/bin/env node
/** Generate the deterministic, repo-owned low-poly glTF bundle used by the player. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'public/assets/3d');
mkdirSync(output, { recursive: true });

const chunks = [];
const bufferViews = [];
const accessors = [];
let byteLength = 0;

function align4() {
  const padding = (4 - (byteLength % 4)) % 4;
  if (!padding) return;
  chunks.push(Buffer.alloc(padding));
  byteLength += padding;
}

function accessor(values, componentType, type, itemSize, options = {}) {
  align4();
  const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
  const bytes = Buffer.from(array.buffer);
  const view = bufferViews.length;
  bufferViews.push({
    buffer: 0,
    byteOffset: byteLength,
    byteLength: bytes.length,
    ...(options.target ? { target: options.target } : {}),
  });
  chunks.push(bytes);
  byteLength += bytes.length;
  const index = accessors.length;
  accessors.push({
    bufferView: view,
    componentType,
    count: values.length / itemSize,
    type,
    ...(options.min ? { min: options.min } : {}),
    ...(options.max ? { max: options.max } : {}),
  });
  return index;
}

function geometryAccessors({ positions, normals, indices }) {
  const xs = positions.filter((_value, index) => index % 3 === 0);
  const ys = positions.filter((_value, index) => index % 3 === 1);
  const zs = positions.filter((_value, index) => index % 3 === 2);
  return {
    position: accessor(positions, 5126, 'VEC3', 3, {
      target: 34962,
      min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
      max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
    }),
    normal: accessor(normals, 5126, 'VEC3', 3, { target: 34962 }),
    indices: accessor(indices, 5123, 'SCALAR', 1, { target: 34963 }),
  };
}

function lowPolySphere(segments = 10, rings = 6) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = Math.PI * ring / rings;
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = Math.PI * 2 * segment / segments;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x * 0.5, y * 0.5, z * 0.5);
      normals.push(x, y, z);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      indices.push(a, d, c, a, c, b);
    }
  }
  return geometryAccessors({ positions, normals, indices });
}

function taperedCylinder(topRadius = 0.35, bottomRadius = 0.5, height = 1, segments = 8) {
  const positions = [];
  const normals = [];
  const indices = [];
  const slope = bottomRadius - topRadius;
  for (let layer = 0; layer < 2; layer += 1) {
    const radius = layer ? topRadius : bottomRadius;
    const y = layer ? height / 2 : -height / 2;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = Math.PI * 2 * segment / segments;
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      const length = Math.hypot(nx, slope, nz);
      positions.push(nx * radius, y, nz * radius);
      normals.push(nx / length, slope / length, nz / length);
    }
  }
  const bottomCenter = positions.length / 3;
  positions.push(0, -height / 2, 0);
  normals.push(0, -1, 0);
  const topCenter = positions.length / 3;
  positions.push(0, height / 2, 0);
  normals.push(0, 1, 0);
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(segment, segments + segment, segments + next, segment, segments + next, next);
    indices.push(bottomCenter, next, segment);
    indices.push(topCenter, segments + segment, segments + next);
  }
  return geometryAccessors({ positions, normals, indices });
}

function capsuleLike(segments = 10, rings = 8) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = Math.PI * ring / rings;
    const sphereY = Math.cos(phi);
    const offsetY = sphereY > 0 ? 0.24 : sphereY < 0 ? -0.24 : 0;
    for (let segment = 0; segment < segments; segment += 1) {
      const theta = Math.PI * 2 * segment / segments;
      const x = Math.sin(phi) * Math.cos(theta);
      const z = Math.sin(phi) * Math.sin(theta);
      positions.push(x * 0.5, sphereY * 0.5 + offsetY, z * 0.5);
      normals.push(x, sphereY, z);
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      const a = ring * segments + segment;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + segment;
      indices.push(a, d, c, a, c, b);
    }
  }
  return geometryAccessors({ positions, normals, indices });
}

function beveledBox() {
  const positions = [];
  const normals = [];
  const indices = [];
  const corners = [-1, 1];
  const normalFor = (x, y, z) => {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  };
  for (const y of corners) {
    for (const z of corners) {
      for (const x of corners) {
        positions.push(x * 0.44, y * 0.44, z * 0.44);
        normals.push(...normalFor(x, y, z));
      }
    }
  }
  indices.push(
    0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5,
    0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6,
    0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3,
  );
  return geometryAccessors({ positions, normals, indices });
}

const geometries = {
  sphere: lowPolySphere(),
  cylinder: taperedCylinder(0.5, 0.5, 1, 10),
  cone: taperedCylinder(0.08, 0.5, 1, 9),
  capsule: capsuleLike(),
  beveledBox: beveledBox(),
};

const materials = [
  { name: 'Fur', pbrMetallicRoughness: { baseColorFactor: [0.537, 0.706, 0.98, 1], metallicFactor: 0, roughnessFactor: 0.82 } },
  { name: 'Belly', pbrMetallicRoughness: { baseColorFactor: [0.84, 0.9, 1, 1], metallicFactor: 0, roughnessFactor: 0.86 } },
  { name: 'InnerEar', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.58, 0.68, 1], metallicFactor: 0, roughnessFactor: 0.8 } },
  { name: 'Face', pbrMetallicRoughness: { baseColorFactor: [0.12, 0.15, 0.2, 1], metallicFactor: 0, roughnessFactor: 0.65 } },
  { name: 'ScoutAccent', pbrMetallicRoughness: { baseColorFactor: [0.88, 0.34, 0.22, 1], metallicFactor: 0, roughnessFactor: 0.76 } },
  { name: 'ScoutLeather', pbrMetallicRoughness: { baseColorFactor: [0.35, 0.2, 0.11, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
  { name: 'GardenerAccent', pbrMetallicRoughness: { baseColorFactor: [0.92, 0.8, 0.45, 1], metallicFactor: 0, roughnessFactor: 0.88 } },
  { name: 'GardenerCloth', pbrMetallicRoughness: { baseColorFactor: [0.36, 0.6, 0.38, 1], metallicFactor: 0, roughnessFactor: 0.9 } },
];

function primitive(geometry, material) {
  return {
    attributes: { POSITION: geometry.position, NORMAL: geometry.normal },
    indices: geometry.indices,
    material,
  };
}

const meshes = [];
function addMesh(name, geometry, material) {
  const index = meshes.length;
  meshes.push({ name, primitives: [primitive(geometry, material)] });
  return index;
}

const avatarMeshes = {
  furSphere: addMesh('FurSphere', geometries.sphere, 0),
  furCapsule: addMesh('FurCapsule', geometries.capsule, 0),
  belly: addMesh('BellyPatch', geometries.sphere, 1),
  innerEar: addMesh('InnerEar', geometries.capsule, 2),
  face: addMesh('FaceDetail', geometries.sphere, 3),
  scoutCloth: addMesh('ScoutCloth', geometries.cone, 4),
  scoutBag: addMesh('ScoutBag', geometries.beveledBox, 5),
  gardenHat: addMesh('GardenHat', geometries.cylinder, 6),
  gardenCloth: addMesh('GardenCloth', geometries.beveledBox, 7),
};

const nodes = [];
function node(value) {
  nodes.push({
    ...value,
    ...(value.name ? { extras: { bunnyland_node_name: value.name } } : {}),
  });
  return nodes.length - 1;
}

const avatarRoot = node({ name: 'Avatar', children: [] });
const body = node({ name: 'Body', mesh: avatarMeshes.furCapsule, translation: [0, 0.8, 0], scale: [0.68, 0.78, 0.54] });
const belly = node({ name: 'Belly', mesh: avatarMeshes.belly, translation: [0, 0.84, 0.25], scale: [0.46, 0.72, 0.12] });
const head = node({ name: 'Head', mesh: avatarMeshes.furSphere, translation: [0, 1.48, 0.02], scale: [1.08, 0.98, 1] });
const earL = node({ name: 'Ear.L', mesh: avatarMeshes.furCapsule, translation: [-0.18, 1.98, -0.01], rotation: [0, 0, 0.087, 0.996], scale: [0.25, 0.65, 0.22] });
const earR = node({ name: 'Ear.R', mesh: avatarMeshes.furCapsule, translation: [0.18, 1.98, -0.01], rotation: [0, 0, -0.087, 0.996], scale: [0.25, 0.65, 0.22] });
const innerL = node({ name: 'InnerEar.L', mesh: avatarMeshes.innerEar, translation: [-0.18, 1.99, 0.11], rotation: [0, 0, 0.087, 0.996], scale: [0.11, 0.53, 0.06] });
const innerR = node({ name: 'InnerEar.R', mesh: avatarMeshes.innerEar, translation: [0.18, 1.99, 0.11], rotation: [0, 0, -0.087, 0.996], scale: [0.11, 0.53, 0.06] });
const legL = node({ name: 'Leg.L', mesh: avatarMeshes.furCapsule, translation: [-0.22, 0.28, 0], scale: [0.34, 0.42, 0.38] });
const legR = node({ name: 'Leg.R', mesh: avatarMeshes.furCapsule, translation: [0.22, 0.28, 0], scale: [0.34, 0.42, 0.38] });
const armL = node({ name: 'Arm.L', mesh: avatarMeshes.furCapsule, translation: [-0.43, 0.92, 0.05], rotation: [0, 0, 0.174, 0.985], scale: [0.24, 0.5, 0.25] });
const armR = node({ name: 'Arm.R', mesh: avatarMeshes.furCapsule, translation: [0.43, 0.92, 0.05], rotation: [0, 0, -0.174, 0.985], scale: [0.24, 0.5, 0.25] });
const tail = node({ name: 'Tail', mesh: avatarMeshes.furSphere, translation: [0, 0.72, -0.37], scale: [0.5, 0.5, 0.5] });
const eyeL = node({ name: 'Eye.L', mesh: avatarMeshes.face, translation: [-0.13, 1.56, 0.48], scale: [0.13, 0.17, 0.08] });
const eyeR = node({ name: 'Eye.R', mesh: avatarMeshes.face, translation: [0.13, 1.56, 0.48], scale: [0.13, 0.17, 0.08] });
const nose = node({ name: 'Nose', mesh: avatarMeshes.face, translation: [0, 1.43, 0.52], scale: [0.1, 0.08, 0.07] });
const scout = node({ name: 'Variant.scout', children: [] });
const scarf = node({ name: 'Scout.Neckerchief', mesh: avatarMeshes.scoutCloth, translation: [0, 1.2, 0.12], rotation: [0.707, 0, 0, 0.707], scale: [0.42, 0.42, 0.2] });
const satchel = node({ name: 'Scout.Satchel', mesh: avatarMeshes.scoutBag, translation: [0.42, 0.68, -0.02], rotation: [0, 0, -0.174, 0.985], scale: [0.42, 0.48, 0.2] });
const gardener = node({ name: 'Variant.gardener', children: [] });
const apron = node({ name: 'Gardener.Apron', mesh: avatarMeshes.gardenCloth, translation: [0, 0.78, 0.3], scale: [0.72, 0.82, 0.12] });
const brim = node({ name: 'Gardener.Hat.Brim', mesh: avatarMeshes.gardenHat, translation: [0, 1.82, 0], scale: [1.45, 0.08, 1.45] });
const crown = node({ name: 'Gardener.Hat.Crown', mesh: avatarMeshes.gardenHat, translation: [0, 1.99, 0], scale: [0.66, 0.34, 0.66] });
nodes[avatarRoot].children = [body, belly, head, earL, earR, innerL, innerR, legL, legR, armL, armR, tail, eyeL, eyeR, nose, scout, gardener];
nodes[scout].children = [scarf, satchel];
nodes[gardener].children = [apron, brim, crown];

function quatX(angle) {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}
function quatZ(angle) {
  return [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
}

const idleTimes = accessor([0, 1, 2], 5126, 'SCALAR', 1, { min: [0], max: [2] });
const idleBodyScale = accessor([0.68,0.78,0.54, 0.69,0.81,0.55, 0.68,0.78,0.54], 5126, 'VEC3', 3);
const idleHeadRotation = accessor([0, 0.035, 0].flatMap(quatZ), 5126, 'VEC4', 4);
const idleEarL = accessor([0.174, 0.11, 0.174].flatMap(quatZ), 5126, 'VEC4', 4);
const idleEarR = accessor([-0.174, -0.11, -0.174].flatMap(quatZ), 5126, 'VEC4', 4);
const walkTimes = accessor([0, 0.25, 0.5, 0.75, 1], 5126, 'SCALAR', 1, { min: [0], max: [1] });
const walkBounce = accessor([0,0.8,0, 0,0.86,0, 0,0.8,0, 0,0.86,0, 0,0.8,0], 5126, 'VEC3', 3);
const swingA = accessor([0.52,-0.52,0.52,-0.52,0.52].flatMap(quatX), 5126, 'VEC4', 4);
const swingB = accessor([-0.52,0.52,-0.52,0.52,-0.52].flatMap(quatX), 5126, 'VEC4', 4);
const walkHead = accessor([0.06,-0.04,0.06,-0.04,0.06].flatMap(quatX), 5126, 'VEC4', 4);

const binary = Buffer.concat(chunks);
const common = {
  asset: { version: '2.0', generator: 'Bunnyland 3D repo asset generator' },
  buffers: [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }],
  bufferViews,
  accessors,
};

const avatar = {
  ...common,
  scene: 0,
  scenes: [{ nodes: [avatarRoot] }],
  nodes,
  meshes,
  materials,
  animations: [
    {
      name: 'Idle',
      samplers: [
        { input: idleTimes, output: idleBodyScale, interpolation: 'LINEAR' },
        { input: idleTimes, output: idleHeadRotation, interpolation: 'LINEAR' },
        { input: idleTimes, output: idleEarL, interpolation: 'LINEAR' },
        { input: idleTimes, output: idleEarR, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: body, path: 'scale' } },
        { sampler: 1, target: { node: head, path: 'rotation' } },
        { sampler: 2, target: { node: earL, path: 'rotation' } },
        { sampler: 3, target: { node: earR, path: 'rotation' } },
      ],
    },
    {
      name: 'Walk',
      samplers: [
        { input: walkTimes, output: walkBounce, interpolation: 'LINEAR' },
        { input: walkTimes, output: swingA, interpolation: 'LINEAR' },
        { input: walkTimes, output: swingB, interpolation: 'LINEAR' },
        { input: walkTimes, output: walkHead, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: body, path: 'translation' } },
        { sampler: 1, target: { node: legL, path: 'rotation' } },
        { sampler: 2, target: { node: legR, path: 'rotation' } },
        { sampler: 2, target: { node: armL, path: 'rotation' } },
        { sampler: 1, target: { node: armR, path: 'rotation' } },
        { sampler: 3, target: { node: head, path: 'rotation' } },
      ],
    },
  ],
};

function propGltf(name, propNodes, propMeshes, propMaterials) {
  return {
    ...common,
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: propNodes,
    meshes: propMeshes,
    materials: propMaterials,
    extras: { asset_name: name },
  };
}

function propMesh(name, geometry, material) {
  return { name, primitives: [primitive(geometry, material)] };
}

const wood = { name: 'CrateWood', pbrMetallicRoughness: { baseColorFactor: [0.53, 0.34, 0.16, 1], metallicFactor: 0, roughnessFactor: 0.9 } };
const trim = { name: 'CrateTrim', pbrMetallicRoughness: { baseColorFactor: [0.24, 0.17, 0.11, 1], metallicFactor: 0.05, roughnessFactor: 0.78 } };
const genericProp = propGltf(
  'prop.generic',
  [
    { name: 'GenericProp', children: [1, 2, 3, 4, 5, 6] },
    { name: 'Crate.Body', mesh: 0, translation: [0, 0.4, 0], scale: [0.78, 0.7, 0.68] },
    { name: 'Crate.Top', mesh: 1, translation: [0, 0.79, 0], scale: [0.88, 0.12, 0.78] },
    { name: 'Crate.Band.L', mesh: 1, translation: [-0.31, 0.4, 0.35], scale: [0.09, 0.72, 0.07] },
    { name: 'Crate.Band.R', mesh: 1, translation: [0.31, 0.4, 0.35], scale: [0.09, 0.72, 0.07] },
    { name: 'Crate.Foot.L', mesh: 1, translation: [-0.25, 0.06, 0], scale: [0.2, 0.12, 0.58] },
    { name: 'Crate.Foot.R', mesh: 1, translation: [0.25, 0.06, 0], scale: [0.2, 0.12, 0.58] },
  ],
  [propMesh('CrateBodyMesh', geometries.beveledBox, 0), propMesh('CrateTrimMesh', geometries.beveledBox, 1)],
  [wood, trim],
);

const lanternProp = propGltf(
  'prop.lantern',
  [
    { name: 'Lantern', children: [1, 2, 3, 4, 5, 6, 7] },
    { name: 'Lantern.Base', mesh: 0, translation: [0, 0.08, 0], scale: [0.62, 0.13, 0.62] },
    { name: 'Lantern.Cap', mesh: 1, translation: [0, 0.78, 0], scale: [0.68, 0.18, 0.68] },
    { name: 'Lantern.Post.L', mesh: 0, translation: [-0.27, 0.43, 0], scale: [0.08, 0.65, 0.08] },
    { name: 'Lantern.Post.R', mesh: 0, translation: [0.27, 0.43, 0], scale: [0.08, 0.65, 0.08] },
    { name: 'Lantern.Handle.L', mesh: 0, translation: [-0.18, 0.99, 0], rotation: [0, 0, -0.24, 0.971], scale: [0.06, 0.48, 0.06] },
    { name: 'Lantern.Handle.R', mesh: 0, translation: [0.18, 0.99, 0], rotation: [0, 0, 0.24, 0.971], scale: [0.06, 0.48, 0.06] },
    { name: 'LanternGlow', mesh: 2, translation: [0, 0.45, 0], scale: [0.5, 0.58, 0.5] },
  ],
  [
    propMesh('LanternFrameMesh', geometries.beveledBox, 0),
    propMesh('LanternCapMesh', geometries.cone, 0),
    propMesh('LanternGlowMesh', geometries.capsule, 1),
  ],
  [
    { name: 'LanternFrame', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.23, 0.25, 1], metallicFactor: 0.38, roughnessFactor: 0.58 } },
    {
      name: 'LanternGlow',
      emissiveFactor: [1, 0.55, 0.12],
      extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2.2 } },
      pbrMetallicRoughness: { baseColorFactor: [1, 0.72, 0.25, 1], metallicFactor: 0, roughnessFactor: 0.34 },
    },
  ],
);
lanternProp.extensionsUsed = ['KHR_materials_emissive_strength'];

writeFileSync(resolve(output, 'avatar-leporid.gltf'), `${JSON.stringify(avatar, null, 2)}\n`);
writeFileSync(resolve(output, 'prop-generic.gltf'), `${JSON.stringify(genericProp, null, 2)}\n`);
writeFileSync(resolve(output, 'prop-lantern.gltf'), `${JSON.stringify(lanternProp, null, 2)}\n`);
writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify({
  schema_version: 1,
  assets: {
    'avatar.leporid': { path: 'avatar-leporid.gltf', clips: ['Idle', 'Walk'], variants: ['default', 'scout', 'gardener'] },
    'prop.generic': { path: 'prop-generic.gltf' },
    'prop.lantern': { path: 'prop-lantern.gltf' },
  },
}, null, 2)}\n`);
