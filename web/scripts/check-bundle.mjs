#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import { brotliCompressSync } from 'node:zlib';

const assetsUrl = new URL('../dist/assets/', import.meta.url);
const files = await readdir(assetsUrl);
const javascript = files.filter(file => file.endsWith('.js'));

function oneChunk(prefix) {
  const matches = javascript.filter(file => file.startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`expected one ${prefix}*.js chunk, found ${matches.length}`);
  }
  return matches[0];
}

async function sizes(file) {
  const source = await readFile(new URL(file, assetsUrl));
  return { raw: source.length, brotli: brotliCompressSync(source).length };
}

function within(file, size, limit, kind) {
  if (size > limit) {
    throw new Error(`${file} ${kind} size ${size} exceeds budget ${limit}`);
  }
}

const threeFile = oneChunk('three.module-');
const playerFile = oneChunk('player-controller-');
const gltfFile = oneChunk('gltf-assets-');
const three = await sizes(threeFile);
const player = await sizes(playerFile);
const gltf = await sizes(gltfFile);

within(threeFile, three.raw, 580_000, 'raw');
within(threeFile, three.brotli, 120_000, 'Brotli');
within(playerFile, player.brotli, 32_000, 'Brotli');
within(gltfFile, gltf.brotli, 28_000, 'Brotli');
within('player deferred JavaScript', three.brotli + player.brotli + gltf.brotli, 170_000, 'Brotli');

const indexHtml = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
if (indexHtml.includes(threeFile) || indexHtml.includes(gltfFile)) {
  throw new Error('welcome page eagerly references the 3D renderer or model loader');
}

console.log(
  `bundle budgets: three ${three.brotli} B br, player ${player.brotli} B br, glTF ${gltf.brotli} B br`,
);
