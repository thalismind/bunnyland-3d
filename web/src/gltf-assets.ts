import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Object3D } from 'three';

const loader = new GLTFLoader();

export function loadGltf(url: string): Promise<GLTF> {
  return loader.loadAsync(url);
}

export function cloneGltfScene(scene: Object3D): Object3D {
  return clone(scene);
}
