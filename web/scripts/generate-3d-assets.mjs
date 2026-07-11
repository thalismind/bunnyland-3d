#!/usr/bin/env node
/** Generate the small repo-owned glTF bundle used by the v2 player. */

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
  if (padding) {
    chunks.push(Buffer.alloc(padding));
    byteLength += padding;
  }
}

function accessor(values, componentType, type, itemSize, options = {}) {
  align4();
  const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
  const bytes = Buffer.from(array.buffer);
  const view = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(options.target ? { target: options.target } : {}) });
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

const positions = [
  -0.5,-0.5, 0.5, 0.5,-0.5, 0.5, 0.5, 0.5, 0.5,-0.5, 0.5, 0.5,
   0.5,-0.5,-0.5,-0.5,-0.5,-0.5,-0.5, 0.5,-0.5, 0.5, 0.5,-0.5,
  -0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,-0.5,-0.5, 0.5,-0.5,
  -0.5,-0.5,-0.5, 0.5,-0.5,-0.5, 0.5,-0.5, 0.5,-0.5,-0.5, 0.5,
   0.5,-0.5, 0.5, 0.5,-0.5,-0.5, 0.5, 0.5,-0.5, 0.5, 0.5, 0.5,
  -0.5,-0.5,-0.5,-0.5,-0.5, 0.5,-0.5, 0.5, 0.5,-0.5, 0.5,-0.5,
];
const normals = [
  0,0,1, 0,0,1, 0,0,1, 0,0,1, 0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
  0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
  1,0,0, 1,0,0, 1,0,0, 1,0,0, -1,0,0, -1,0,0, -1,0,0, -1,0,0,
];
const indices = [];
for (let face = 0; face < 6; face += 1) {
  const offset = face * 4;
  indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
}
const positionAccessor = accessor(positions, 5126, 'VEC3', 3, { target: 34962, min: [-0.5,-0.5,-0.5], max: [0.5,0.5,0.5] });
const normalAccessor = accessor(normals, 5126, 'VEC3', 3, { target: 34962 });
const indexAccessor = accessor(indices, 5123, 'SCALAR', 1, { target: 34963 });

const nodes = [
  { name: 'Avatar', children: [1,2,3,4,5,6,7,8,9] },
  { name: 'Body', mesh: 0, translation: [0,0.78,0], scale: [0.72,0.9,0.48] },
  { name: 'Head', mesh: 0, translation: [0,1.48,0], scale: [0.58,0.52,0.54] },
  { name: 'Ear.L', mesh: 0, translation: [-0.18,1.98,0], rotation: [0,0,0.087,0.996], scale: [0.14,0.62,0.14] },
  { name: 'Ear.R', mesh: 0, translation: [0.18,1.98,0], rotation: [0,0,-0.087,0.996], scale: [0.14,0.62,0.14] },
  { name: 'Leg.L', mesh: 0, translation: [-0.21,0.26,0], scale: [0.22,0.46,0.27] },
  { name: 'Leg.R', mesh: 0, translation: [0.21,0.26,0], scale: [0.22,0.46,0.27] },
  { name: 'Arm.L', mesh: 0, translation: [-0.46,0.9,0], scale: [0.17,0.55,0.2] },
  { name: 'Arm.R', mesh: 0, translation: [0.46,0.9,0], scale: [0.17,0.55,0.2] },
  { name: 'Tail', mesh: 0, translation: [0,0.76,-0.34], scale: [0.28,0.28,0.28] },
];

function quatX(angle) {
  return [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
}

const idleTimes = accessor([0, 1, 2], 5126, 'SCALAR', 1, { min: [0], max: [2] });
const idleHead = accessor([0,1.48,0, 0,1.52,0, 0,1.48,0], 5126, 'VEC3', 3);
const walkTimes = accessor([0,0.25,0.5,0.75,1], 5126, 'SCALAR', 1, { min: [0], max: [1] });
const swingA = [0.55,-0.55,0.55,-0.55,0.55].flatMap(quatX);
const swingB = [-0.55,0.55,-0.55,0.55,-0.55].flatMap(quatX);
const swingAAccessor = accessor(swingA, 5126, 'VEC4', 4);
const swingBAccessor = accessor(swingB, 5126, 'VEC4', 4);

const binary = Buffer.concat(chunks);
const gltf = {
  asset: { version: '2.0', generator: 'Bunnyland 3D repo asset generator' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes,
  meshes: [{ name: 'LowPolyCube', primitives: [{ attributes: { POSITION: positionAccessor, NORMAL: normalAccessor }, indices: indexAccessor, material: 0 }] }],
  materials: [{ name: 'AvatarTint', pbrMetallicRoughness: { baseColorFactor: [0.537,0.706,0.98,1], metallicFactor: 0, roughnessFactor: 0.78 } }],
  animations: [
    {
      name: 'Idle',
      samplers: [{ input: idleTimes, output: idleHead, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }],
    },
    {
      name: 'Walk',
      samplers: [
        { input: walkTimes, output: swingAAccessor, interpolation: 'LINEAR' },
        { input: walkTimes, output: swingBAccessor, interpolation: 'LINEAR' },
      ],
      channels: [
        { sampler: 0, target: { node: 5, path: 'rotation' } },
        { sampler: 1, target: { node: 6, path: 'rotation' } },
        { sampler: 1, target: { node: 7, path: 'rotation' } },
        { sampler: 0, target: { node: 8, path: 'rotation' } },
      ],
    },
  ],
  buffers: [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }],
  bufferViews,
  accessors,
};

function propGltf(name, nodes, meshes, materials) {
  return {
    asset: { version: '2.0', generator: 'Bunnyland 3D repo asset generator' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_node, index) => index) }],
    nodes,
    meshes,
    materials,
    buffers: [{ byteLength: binary.length, uri: `data:application/octet-stream;base64,${binary.toString('base64')}` }],
    bufferViews,
    accessors,
    extras: { asset_name: name },
  };
}

const cubePrimitive = material => ({
  attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
  indices: indexAccessor,
  material,
});
const genericProp = propGltf(
  'prop.generic',
  [{ name: 'GenericProp', mesh: 0, translation: [0,0.3,0], scale: [0.6,0.6,0.6] }],
  [{ name: 'GenericPropMesh', primitives: [cubePrimitive(0)] }],
  [{ name: 'PropTint', pbrMetallicRoughness: { baseColorFactor: [0.65,0.89,0.63,1], metallicFactor: 0, roughnessFactor: 0.82 } }],
);
const lanternProp = propGltf(
  'prop.lantern',
  [
    { name: 'LanternFrame', mesh: 0, translation: [0,0.28,0], scale: [0.44,0.56,0.44] },
    { name: 'LanternGlow', mesh: 1, translation: [0,0.32,0], scale: [0.28,0.3,0.28] },
  ],
  [
    { name: 'LanternFrameMesh', primitives: [cubePrimitive(0)] },
    { name: 'LanternGlowMesh', primitives: [cubePrimitive(1)] },
  ],
  [
    { name: 'LanternFrame', pbrMetallicRoughness: { baseColorFactor: [0.25,0.28,0.3,1], metallicFactor: 0.3, roughnessFactor: 0.6 } },
    { name: 'LanternGlow', emissiveFactor: [1,0.55,0.12], pbrMetallicRoughness: { baseColorFactor: [1,0.72,0.25,1], metallicFactor: 0, roughnessFactor: 0.4 } },
  ],
);

writeFileSync(resolve(output, 'avatar-leporid.gltf'), `${JSON.stringify(gltf, null, 2)}\n`);
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
