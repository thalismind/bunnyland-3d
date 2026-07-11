import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { ServerAssetManifest, ServerModelAsset } from './play';

export interface Vector3View {
  x: number;
  y: number;
  z: number;
}

export interface Transform3DView {
  position?: Partial<Vector3View>;
  rotation?: Partial<Vector3View>;
  scale?: Partial<Vector3View>;
}

export interface Render3DView {
  shape?: string;
  color?: string;
  emissive?: string;
  opacity?: number;
  label?: string;
  visible?: boolean;
  asset_key?: string;
  variant_key?: string;
}

export interface Collider3DView {
  shape?: string;
  size?: Partial<Vector3View>;
  radius?: number;
  solid?: boolean;
  static?: boolean;
  trigger?: boolean;
}

export interface PlayerSceneEntity {
  id: string;
  name: string;
  kind: string;
  is_character: boolean;
  transform3d?: Transform3DView;
  render3d?: Render3DView;
  collider3d?: Collider3DView;
}

export interface Environment3DView {
  sky_color?: string;
  fog_color?: string;
  fog_density?: number;
  ambient_color?: string;
  ambient_intensity?: number;
  sun_color?: string;
  sun_intensity?: number;
  has_roof?: boolean;
  surface_recipe?: string;
  albedo_url?: string;
  normal_url?: string;
  skybox_url?: string;
  texture_scale?: number;
}

export interface PlayerSceneDecoration {
  id: string;
  transform3d?: Transform3DView;
  prop_group3d?: {
    recipe_key: string;
    asset_key: string;
    color: string;
    instances: Array<{ id: string; position: Vector3View; rotation_y: number; scale: number }>;
  };
  light3d?: {
    kind: 'point' | 'spot' | 'directional';
    color: string;
    intensity: number;
    range: number;
    decay: number;
    cone: number;
    cast_shadow: boolean;
  };
  particle_emitter3d?: {
    preset: 'pollen' | 'fireflies' | 'spores' | 'dust' | 'mist';
    seed: number;
    count: number;
    bounds: Vector3View;
    color: string;
    size: number;
    speed: number;
    opacity: number;
  };
}

export interface PlayerSceneExit {
  id: string;
  direction: string;
  label: string;
  locked: boolean;
}

export interface PlayerRoomScene {
  ok: boolean;
  schema_version: number;
  world_epoch: number;
  room: {
    id: string;
    title: string;
    biome: string;
    indoor: boolean;
    bounds3d?: {
      origin?: Partial<Vector3View>;
      size?: Partial<Vector3View>;
    } | null;
    render3d?: Render3DView | null;
    environment3d?: Environment3DView | null;
  };
  exits: PlayerSceneExit[];
  entities: PlayerSceneEntity[];
  decorations?: PlayerSceneDecoration[];
}

interface Bounds2D {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  ground: number;
  height: number;
}

interface Obstacle2D {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

interface TrackedEntity {
  entity: PlayerSceneEntity;
  root: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
}

interface TrackedExit {
  exit: PlayerSceneExit;
  root: THREE.Group;
  position: THREE.Vector3;
}

interface AssetManifest {
  schema_version: number;
  assets: Record<string, AssetDescriptor>;
}

interface AssetDescriptor {
  path?: string;
  url?: string;
  digest?: string;
  clips?: string[] | Record<string, string>;
  variants?: string[];
  transform?: ServerModelAsset['transform'];
  default_color?: string;
  instanced?: boolean;
}

interface LoadedAsset {
  gltf: GLTF;
  descriptor: AssetDescriptor;
}

export interface PlayerCameraState {
  target: { x: number; y: number; z: number };
  radius: number;
  moving: boolean;
  actualRadius: number;
  avatar: { x: number; y: number; z: number };
}

const DEFAULT_ROOM_SIZE = 16;
const PLAYER_SPEED = 3.4;
const EXIT_RANGE = 1.65;
const PLAYER_RADIUS = 0.36;
const MAX_FRAME_DELTA = 0.05;
const MAX_PROP_INSTANCES = 2000;
const MAX_PARTICLES = 1500;
const MAX_LOCAL_LIGHTS = 8;
const MAX_SHADOW_LIGHTS = 2;

const BIOME_PALETTES: Record<string, { ground: number; fog: number; accent: number }> = {
  cave: { ground: 0x4c4037, fog: 0x171514, accent: 0xc69568 },
  forest: { ground: 0x426344, fog: 0x17251a, accent: 0x91c46c },
  garden: { ground: 0x5b7d4d, fog: 0x20311e, accent: 0xf1b0c7 },
  marsh: { ground: 0x406c61, fog: 0x142825, accent: 0x72c7b7 },
  meadow: { ground: 0x668a4d, fog: 0x1b2d1a, accent: 0xf0d36d },
  station: { ground: 0x45546e, fog: 0x151b27, accent: 0x7eb5e8 },
  unknown: { ground: 0x576070, fog: 0x181c24, accent: 0xaab5c8 },
  desert: { ground: 0xb78d55, fog: 0x8f684b, accent: 0xe1b875 },
  wasteland: { ground: 0x756a4c, fog: 0x514d43, accent: 0xa18c65 },
};

function finite(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function color(value: string | undefined, fallback: number): number {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? Number.parseInt(value.slice(1), 16) : fallback;
}

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomFrom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function activeControl(): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active) return false;
  return active.matches('input, select, textarea, button, [contenteditable="true"]')
    || Boolean(active.closest('dialog, [role="dialog"]'));
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse(child => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export class PlayerScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.08, 180);
  private readonly world = new THREE.Group();
  private readonly environment = new THREE.Group();
  private readonly entityGroup = new THREE.Group();
  private readonly exitGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly loader = new GLTFLoader();
  private readonly assetCache = new Map<string, Promise<LoadedAsset>>();
  private readonly textureLoader = new THREE.TextureLoader();
  private assetManifest: Promise<AssetManifest> | null = null;
  private serverAssets: ServerAssetManifest | null = null;
  private readonly entities = new Map<string, TrackedEntity>();
  private readonly exits: TrackedExit[] = [];
  private readonly obstacles: Obstacle2D[] = [];
  private readonly cameraOccluders: THREE.Object3D[] = [];
  private readonly keys = new Set<string>();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredCamera = new THREE.Vector3();
  private readonly movement = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private roomId = '';
  private playerId = '';
  private bounds: Bounds2D = { minX: 0, maxX: 16, minZ: 0, maxZ: 16, ground: 0, height: 4 };
  private avatarPosition = new THREE.Vector3(8, 0, 8);
  private cameraYaw = Math.PI;
  private cameraPitch = 0.38;
  private cameraRadius = 5.4;
  private dragging = false;
  private dragged = false;
  private pointerStart = new THREE.Vector2();
  private selectedEntityId = '';
  private lastPick: { x: number; y: number; ids: string[]; index: number; at: number } | null = null;
  private nearbyExitId = '';
  private lastFrame = performance.now();
  private loadGeneration = 0;
  private enabled = true;
  private particleTime = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelectEntity: (entityId: string) => void,
    private readonly onNearbyExit: (exit: PlayerSceneExit | null) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Third-person Bunnyland room view');
    this.scene.add(this.world);
    this.world.add(this.environment, this.entityGroup, this.exitGroup);
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('resize', this.resize);
    this.resize();
    this.animate();
  }

  configureServerAssets(manifest: ServerAssetManifest | null): void {
    this.serverAssets = manifest;
    this.assetManifest = null;
    this.assetCache.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  async loadRoom(data: PlayerRoomScene, playerId: string): Promise<void> {
    const generation = ++this.loadGeneration;
    const sameRoom = data.room.id === this.roomId;
    this.roomId = data.room.id;
    this.playerId = playerId;
    this.bounds = this.readBounds(data);
    this.clearRoom();
    this.applyEnvironment(data);
    this.addDecorations(data.decorations || []);
    this.addExits(data.exits, data.room.indoor);
    for (const entity of data.entities) this.addEntity(entity, generation);

    if (!sameRoom || !this.positionValid(this.avatarPosition, playerId)) {
      const anchor = data.entities.find(entity => entity.id === playerId)?.transform3d?.position;
      this.avatarPosition.set(
        finite(anchor?.x, (this.bounds.minX + this.bounds.maxX) / 2),
        this.bounds.ground,
        finite(anchor?.z, (this.bounds.minZ + this.bounds.maxZ) / 2),
      );
      this.clampAvatar();
    }
    const avatar = this.entities.get(playerId);
    if (avatar) avatar.root.position.copy(this.avatarPosition);
    this.cameraTarget.set(this.avatarPosition.x, this.avatarPosition.y + 1.15, this.avatarPosition.z);
    this.applySelection();
    if (generation !== this.loadGeneration) return;
  }

  selectEntity(entityId: string): boolean {
    if (!this.entities.has(entityId)) return false;
    this.selectedEntityId = entityId;
    this.applySelection();
    return true;
  }

  clearSelection(): void {
    this.selectedEntityId = '';
    this.applySelection();
  }

  nearbyExit(): PlayerSceneExit | null {
    return this.exits.find(item => item.exit.id === this.nearbyExitId)?.exit || null;
  }

  cameraState(): PlayerCameraState {
    return {
      target: { x: this.cameraTarget.x, y: this.cameraTarget.y, z: this.cameraTarget.z },
      radius: this.cameraRadius,
      moving: this.movement.lengthSq() > 0,
      actualRadius: this.camera.position.distanceTo(this.cameraTarget),
      avatar: { x: this.avatarPosition.x, y: this.avatarPosition.y, z: this.avatarPosition.z },
    };
  }

  exitScreenPoint(exitId: string): { x: number; y: number } | null {
    const tracked = this.exits.find(item => item.exit.id === exitId);
    if (!tracked) return null;
    const projected = tracked.position.clone().project(this.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (-projected.y + 1) * rect.height / 2,
    };
  }

  entityScreenPoint(entityId: string): { x: number; y: number } | null {
    const tracked = this.entities.get(entityId);
    if (!tracked) return null;
    const projected = tracked.root.position.clone().add(new THREE.Vector3(0, tracked.entity.is_character ? 1 : 0.4, 0)).project(this.camera);
    if (projected.z < -1 || projected.z > 1) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (-projected.y + 1) * rect.height / 2,
    };
  }

  exitStates(): Array<{ id: string; side: string; rotationY: number; x: number; z: number }> {
    return this.exits.map(tracked => ({
      id: tracked.exit.id,
      side: this.cardinal(tracked.exit.direction),
      rotationY: tracked.root.rotation.y,
      x: tracked.root.position.x,
      z: tracked.root.position.z,
    }));
  }

  capturePng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  visualState(): { propInstances: number; modelPropInstances: number; particles: number; localLights: number; skybox: boolean } {
    let propInstances = 0;
    let modelPropInstances = 0;
    let particles = 0;
    let localLights = 0;
    let skybox = false;
    this.environment.traverse(object => {
      if (object.userData.decorationProps) propInstances += (object as THREE.InstancedMesh).count;
      if (object.userData.modelDecoration) modelPropInstances += (object as THREE.InstancedMesh).count;
      if (object.userData.particleEmitter) particles += (object as THREE.Points).geometry.getAttribute('position').count;
      if (object.userData.localLight) localLights += 1;
      if (object.userData.skybox) skybox = true;
    });
    return { propInstances, modelPropInstances, particles, localLights, skybox };
  }

  private readBounds(data: PlayerRoomScene): Bounds2D {
    const origin = data.room.bounds3d?.origin || {};
    const size = data.room.bounds3d?.size || {};
    const minX = finite(origin.x, 0);
    const minZ = finite(origin.z, 0);
    return {
      minX,
      maxX: minX + Math.max(4, finite(size.x, DEFAULT_ROOM_SIZE)),
      minZ,
      maxZ: minZ + Math.max(4, finite(size.z, DEFAULT_ROOM_SIZE)),
      ground: finite(origin.y, 0),
      height: Math.max(2.5, finite(size.y, data.room.indoor ? 4 : 8)),
    };
  }

  private clearRoom(): void {
    disposeObject(this.environment);
    disposeObject(this.entityGroup);
    disposeObject(this.exitGroup);
    this.environment.clear();
    this.entityGroup.clear();
    this.exitGroup.clear();
    this.entities.clear();
    this.exits.length = 0;
    this.obstacles.length = 0;
    this.cameraOccluders.length = 0;
    this.nearbyExitId = '';
    this.lastPick = null;
    this.onNearbyExit(null);
  }

  private applyEnvironment(data: PlayerRoomScene): void {
    const palette = BIOME_PALETTES[data.room.biome] || BIOME_PALETTES.unknown;
    const environment = data.room.environment3d;
    const roomColor = color(data.room.render3d?.color, palette.ground);
    const fogColor = color(environment?.fog_color, palette.fog);
    const hasRoof = environment?.has_roof ?? data.room.indoor;
    this.scene.background = new THREE.Color(color(environment?.sky_color, fogColor));
    this.scene.fog = new THREE.FogExp2(fogColor, finite(environment?.fog_density, data.room.indoor ? 0.032 : 0.018));

    const width = this.bounds.maxX - this.bounds.minX;
    const depth = this.bounds.maxZ - this.bounds.minZ;
    const centerX = (this.bounds.minX + this.bounds.maxX) / 2;
    const centerZ = (this.bounds.minZ + this.bounds.maxZ) / 2;
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: roomColor,
      roughness: 0.93,
      metalness: data.room.biome === 'station' ? 0.22 : 0,
      map: this.proceduralSurface(environment?.surface_recipe || data.room.biome, roomColor, finite(environment?.texture_scale, 4)),
    });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth, 1, 1),
      floorMaterial,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centerX, this.bounds.ground, centerZ);
    floor.receiveShadow = true;
    this.environment.add(floor);

    this.loadMaterialTexture(environment?.albedo_url, true, texture => {
      if (floor.parent) {
        floorMaterial.map?.dispose();
        floorMaterial.map = texture;
        floorMaterial.color.set(0xffffff);
        floorMaterial.needsUpdate = true;
      } else texture.dispose();
    }, finite(environment?.texture_scale, 4));
    this.loadMaterialTexture(environment?.normal_url, false, texture => {
      if (floor.parent) {
        floorMaterial.normalMap = texture;
        floorMaterial.normalScale.set(0.65, 0.65);
        floorMaterial.needsUpdate = true;
      } else texture.dispose();
    }, finite(environment?.texture_scale, 4));

    if (!hasRoof) this.addSkybox(environment, color(environment?.sky_color, fogColor));

    const hemisphere = new THREE.HemisphereLight(
      color(environment?.ambient_color, 0xcfe8ff),
      data.room.indoor ? 0x342c26 : 0x31512f,
      finite(environment?.ambient_intensity, data.room.indoor ? 1.35 : 1.65),
    );
    this.environment.add(hemisphere);
    const sun = new THREE.DirectionalLight(
      color(environment?.sun_color, data.room.indoor ? 0xffe4c2 : 0xfff1d2),
      finite(environment?.sun_intensity, data.room.indoor ? 1.55 : 2.2),
    );
    sun.position.set(centerX - 5, this.bounds.ground + 10, centerZ + 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    this.environment.add(sun);

    if (hasRoof) this.addIndoorWalls(data.exits, roomColor);
  }

  private proceduralSurface(recipe: string, baseColor: number, repeat: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = `#${baseColor.toString(16).padStart(6, '0')}`;
    context.fillRect(0, 0, 128, 128);
    const random = randomFrom(hash(`surface:${recipe}`));
    const marks = recipe === 'desert' ? 90 : recipe === 'marsh' ? 180 : 240;
    for (let index = 0; index < marks; index += 1) {
      const lightness = random() > 0.5 ? 1.16 : 0.78;
      const tint = new THREE.Color(baseColor).multiplyScalar(lightness);
      context.fillStyle = `#${tint.getHexString()}`;
      context.globalAlpha = 0.12 + random() * 0.2;
      const size = recipe === 'desert' ? 1 + random() * 7 : 1 + random() * 3;
      context.beginPath();
      context.arc(random() * 128, random() * 128, size, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    return texture;
  }

  private loadMaterialTexture(url: string | undefined, srgb: boolean, apply: (texture: THREE.Texture) => void, repeat = 1): void {
    if (!url) return;
    const resolved = new URL(url, window.location.origin);
    if (!/^https?:$/.test(resolved.protocol) || !/\/media\/[a-z0-9]+\/[a-z0-9]+\.(png|jpg|webp)$/.test(resolved.pathname)) return;
    this.textureLoader.load(resolved.href, texture => {
      texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      apply(texture);
    }, undefined, error => console.warn(`Bunnyland 3D texture fallback for ${url}:`, error));
  }

  private addSkybox(environment: Environment3DView | null | undefined, skyColor: number): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: this.proceduralSkybox(skyColor),
      side: THREE.BackSide,
      fog: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(80, 32, 18), material);
    sky.userData.skybox = true;
    sky.position.set(
      (this.bounds.minX + this.bounds.maxX) / 2,
      this.bounds.ground,
      (this.bounds.minZ + this.bounds.maxZ) / 2,
    );
    this.environment.add(sky);
    this.loadMaterialTexture(environment?.skybox_url, true, texture => {
      if (sky.parent) {
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.repeat.set(1, 1);
        material.map = texture;
        material.color.set(0xffffff);
        material.needsUpdate = true;
      } else texture.dispose();
    });
  }

  private proceduralSkybox(skyColor: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d')!;
    const zenith = new THREE.Color(skyColor).multiplyScalar(0.7);
    const horizon = new THREE.Color(skyColor).lerp(new THREE.Color(0xffe2b8), 0.32);
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, `#${zenith.getHexString()}`);
    gradient.addColorStop(0.72, `#${new THREE.Color(skyColor).getHexString()}`);
    gradient.addColorStop(1, `#${horizon.getHexString()}`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 256);
    context.fillStyle = 'rgba(255, 245, 218, 0.76)';
    context.beginPath();
    context.arc(392, 72, 18, 0, Math.PI * 2);
    context.fill();
    const random = randomFrom(hash(`sky:${skyColor}`));
    context.fillStyle = 'rgba(255, 255, 255, 0.12)';
    for (let index = 0; index < 18; index += 1) {
      context.beginPath();
      context.ellipse(random() * 512, 115 + random() * 70, 18 + random() * 38, 3 + random() * 7, 0, 0, Math.PI * 2);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private addIndoorWalls(exits: PlayerSceneExit[], roomColor: number): void {
    const wallColor = new THREE.Color(roomColor).multiplyScalar(0.64).getHex();
    const material = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.88 });
    const thickness = 0.24;
    const height = Math.min(this.bounds.height, 3.6);
    const counts = new Map<string, number>();
    for (const exit of exits) {
      const side = this.cardinal(exit.direction);
      counts.set(side, (counts.get(side) || 0) + 1);
    }
    const wall = (x: number, z: number, w: number, d: number): void => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), material.clone());
      mesh.position.set(x, this.bounds.ground + height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.environment.add(mesh);
      this.cameraOccluders.push(mesh);
    };
    const segments = (min: number, max: number, openings: number[]): Array<[number, number]> => {
      const result: Array<[number, number]> = [];
      let cursor = min;
      for (const center of openings) {
        const start = Math.max(min, center - 1.1);
        const end = Math.min(max, center + 1.1);
        if (start - cursor > 0.05) result.push([cursor, start]);
        cursor = Math.max(cursor, end);
      }
      if (max - cursor > 0.05) result.push([cursor, max]);
      return result;
    };
    const horizontal = (side: string, z: number): void => {
      for (const [start, end] of segments(
        this.bounds.minX,
        this.bounds.maxX,
        this.exitAxisPositions(side, counts.get(side) || 0),
      )) wall((start + end) / 2, z, end - start, thickness);
    };
    const vertical = (side: string, x: number): void => {
      for (const [start, end] of segments(
        this.bounds.minZ,
        this.bounds.maxZ,
        this.exitAxisPositions(side, counts.get(side) || 0),
      )) wall(x, (start + end) / 2, thickness, end - start);
    };
    horizontal('north', this.bounds.minZ);
    horizontal('south', this.bounds.maxZ);
    vertical('west', this.bounds.minX);
    vertical('east', this.bounds.maxX);
  }

  private addDecorations(decorations: PlayerSceneDecoration[]): void {
    let instances = 0;
    let particles = 0;
    let lights = 0;
    let shadowLights = 0;
    for (const decoration of decorations) {
      if (decoration.prop_group3d && instances < MAX_PROP_INSTANCES) {
        const available = MAX_PROP_INSTANCES - instances;
        const group = decoration.prop_group3d;
        const source = group.instances.slice(0, available);
        instances += source.length;
        const geometry = this.propGeometry(group.asset_key);
        const material = new THREE.MeshStandardMaterial({
          color: color(group.color, 0x7ca85c), roughness: 0.88, vertexColors: false,
        });
        const mesh = new THREE.InstancedMesh(geometry, material, source.length);
        const dummy = new THREE.Object3D();
        source.forEach((instance, index) => {
          dummy.position.set(instance.position.x, this.bounds.ground + this.propHeight(group.asset_key, instance.scale), instance.position.z);
          dummy.rotation.set(0, instance.rotation_y, 0);
          dummy.scale.setScalar(instance.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.decorationProps = true;
        mesh.userData.modelDecoration = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const root = new THREE.Group();
        root.add(mesh);
        this.environment.add(root);
        void this.replaceDecorationWithAsset(root, group, source, this.loadGeneration);
      }
      if (decoration.light3d && lights < MAX_LOCAL_LIGHTS) {
        const view = decoration.light3d;
        const position = decoration.transform3d?.position || {};
        const shouldShadow = view.cast_shadow && shadowLights < MAX_SHADOW_LIGHTS;
        let light: THREE.Light;
        if (view.kind === 'spot') {
          const spot = new THREE.SpotLight(color(view.color, 0xffd38a), view.intensity, view.range, view.cone, 0.3, view.decay);
          spot.castShadow = shouldShadow;
          light = spot;
        } else if (view.kind === 'directional') {
          const directional = new THREE.DirectionalLight(color(view.color, 0xffd38a), view.intensity);
          directional.castShadow = shouldShadow;
          light = directional;
        } else {
          const point = new THREE.PointLight(color(view.color, 0xffd38a), view.intensity, view.range, view.decay);
          point.castShadow = shouldShadow;
          light = point;
        }
        light.position.set(finite(position.x, 8), finite(position.y, 2.4), finite(position.z, 8));
        light.userData.localLight = true;
        this.environment.add(light);
        lights += 1;
        if (shouldShadow) shadowLights += 1;
      }
      if (decoration.particle_emitter3d && particles < MAX_PARTICLES) {
        const emitter = decoration.particle_emitter3d;
        const count = Math.min(emitter.count, MAX_PARTICLES - particles);
        particles += count;
        this.addParticleEmitter(emitter, count, decoration.transform3d?.position);
      }
    }
  }

  private propGeometry(assetKey: string): THREE.BufferGeometry {
    if (assetKey.endsWith('rock')) return new THREE.DodecahedronGeometry(0.46, 0);
    if (assetKey.endsWith('flower')) return new THREE.SphereGeometry(0.2, 7, 5);
    if (assetKey.endsWith('hedge') || assetKey.endsWith('scrap')) return new THREE.BoxGeometry(0.8, 0.8, 0.55);
    if (assetKey.endsWith('reed')) return new THREE.CylinderGeometry(0.055, 0.08, 1.5, 5);
    if (assetKey.endsWith('cactus')) return new THREE.CapsuleGeometry(0.18, 0.9, 3, 6);
    if (assetKey.endsWith('tree')) return new THREE.ConeGeometry(0.72, 2.6, 7);
    if (assetKey.endsWith('fern')) return new THREE.ConeGeometry(0.48, 0.65, 6);
    if (assetKey.endsWith('scrub')) return new THREE.TetrahedronGeometry(0.48, 1);
    return new THREE.ConeGeometry(0.16, 0.72, 5);
  }

  private propHeight(assetKey: string, scale: number): number {
    if (assetKey.endsWith('tree')) return 1.3 * scale;
    if (assetKey.endsWith('reed')) return 0.75 * scale;
    if (assetKey.endsWith('cactus')) return 0.63 * scale;
    if (assetKey.endsWith('grass')) return 0.36 * scale;
    return 0.32 * scale;
  }

  private addParticleEmitter(
    emitter: NonNullable<PlayerSceneDecoration['particle_emitter3d']>,
    count: number,
    position: Partial<Vector3View> | undefined,
  ): void {
    const random = randomFrom(emitter.seed);
    const values = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = finite(position?.x, 8) + (random() - 0.5) * emitter.bounds.x;
      values[index * 3 + 1] = this.bounds.ground + random() * emitter.bounds.y;
      values[index * 3 + 2] = finite(position?.z, 8) + (random() - 0.5) * emitter.bounds.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
    const material = new THREE.PointsMaterial({
      color: color(emitter.color, 0xf6e9a6),
      size: emitter.size,
      transparent: true,
      opacity: emitter.opacity,
      depthWrite: false,
      blending: emitter.preset === 'fireflies' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.userData.particleEmitter = { ...emitter, baseY: this.bounds.ground };
    this.environment.add(points);
  }

  private addExits(exits: PlayerSceneExit[], indoor: boolean): void {
    const counts = new Map<string, number>();
    for (const exit of exits) counts.set(this.cardinal(exit.direction), (counts.get(this.cardinal(exit.direction)) || 0) + 1);
    const indexes = new Map<string, number>();
    for (const exit of exits) {
      const side = this.cardinal(exit.direction);
      const index = indexes.get(side) || 0;
      indexes.set(side, index + 1);
      const position = this.exitPosition(side, index, counts.get(side) || 1, indoor);
      const root = new THREE.Group();
      root.position.copy(position);
      if (side === 'east' || side === 'west') root.rotation.y = Math.PI / 2;
      root.userData.exitId = exit.id;
      const frameMaterial = new THREE.MeshStandardMaterial({
        color: exit.locked ? 0x9c5d5d : 0x79d2c0,
        emissive: exit.locked ? 0x3b1212 : 0x174c43,
        emissiveIntensity: 0.55,
      });
      const postGeometry = new THREE.BoxGeometry(0.14, indoor ? 1.8 : 1.25, 0.14);
      const left = new THREE.Mesh(postGeometry, frameMaterial);
      const right = new THREE.Mesh(postGeometry, frameMaterial.clone());
      left.position.set(-0.72, indoor ? 0.9 : 0.625, 0);
      right.position.set(0.72, indoor ? 0.9 : 0.625, 0);
      root.add(left, right);
      root.traverse(child => { child.userData.exitId = exit.id; });
      this.exitGroup.add(root);
      this.exits.push({ exit, root, position: position.clone().add(new THREE.Vector3(0, 0.9, 0)) });
    }
  }

  private cardinal(direction: string): string {
    const value = direction.trim().toLowerCase();
    if (value.startsWith('n')) return 'north';
    if (value.startsWith('s')) return 'south';
    if (value.startsWith('e')) return 'east';
    if (value.startsWith('w')) return 'west';
    return ['north', 'east', 'south', 'west'][hash(direction) % 4];
  }

  private exitAxisPositions(side: string, count: number): number[] {
    const horizontal = side === 'north' || side === 'south';
    const min = horizontal ? this.bounds.minX : this.bounds.minZ;
    const max = horizontal ? this.bounds.maxX : this.bounds.maxZ;
    return Array.from({ length: count }, (_value, index) => (
      THREE.MathUtils.lerp(min + 1.2, max - 1.2, (index + 1) / (count + 1))
    ));
  }

  private exitPosition(side: string, index: number, count: number, indoor: boolean): THREE.Vector3 {
    const axis = this.exitAxisPositions(side, count)[index];
    const inset = indoor ? 0 : 0.25;
    if (side === 'north') return new THREE.Vector3(axis, this.bounds.ground, this.bounds.minZ + inset);
    if (side === 'south') return new THREE.Vector3(axis, this.bounds.ground, this.bounds.maxZ - inset);
    if (side === 'west') return new THREE.Vector3(this.bounds.minX + inset, this.bounds.ground, axis);
    return new THREE.Vector3(this.bounds.maxX - inset, this.bounds.ground, axis);
  }

  private addEntity(entity: PlayerSceneEntity, generation: number): void {
    if (entity.render3d?.visible === false) return;
    const root = new THREE.Group();
    const position = entity.transform3d?.position || {};
    root.position.set(finite(position.x, 8), this.bounds.ground, finite(position.z, 8));
    root.rotation.y = finite(entity.transform3d?.rotation?.y, 0);
    root.scale.set(
      finite(entity.transform3d?.scale?.x, 1),
      finite(entity.transform3d?.scale?.y, 1),
      finite(entity.transform3d?.scale?.z, 1),
    );
    root.userData.entityId = entity.id;
    const placeholder = entity.is_character ? this.proceduralAvatar(entity) : this.proceduralProp(entity);
    root.add(placeholder, this.pickVolume(entity));
    root.traverse(child => { child.userData.entityId = entity.id; });
    this.entityGroup.add(root);
    const tracked: TrackedEntity = { entity, root, mixer: null, idle: null, walk: null };
    this.entities.set(entity.id, tracked);
    this.addObstacle(entity);
    const assetKey = entity.render3d?.asset_key || (entity.is_character ? 'avatar.leporid' : '');
    if (assetKey) void this.replaceWithAsset(tracked, assetKey, generation);
  }

  private proceduralAvatar(entity: PlayerSceneEntity): THREE.Group {
    const group = new THREE.Group();
    const tint = color(entity.render3d?.color, 0x89b4fa);
    const material = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.78 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.65, 4, 8), material);
    body.position.y = 0.65;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), material.clone());
    head.position.y = 1.35;
    const earGeometry = new THREE.CapsuleGeometry(0.075, 0.38, 3, 6);
    const leftEar = new THREE.Mesh(earGeometry, material.clone());
    const rightEar = new THREE.Mesh(earGeometry, material.clone());
    leftEar.position.set(-0.13, 1.78, 0);
    rightEar.position.set(0.13, 1.78, 0);
    leftEar.rotation.z = 0.08;
    rightEar.rotation.z = -0.08;
    group.add(body, head, leftEar, rightEar);
    group.traverse(child => { if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).castShadow = true; });
    return group;
  }

  private proceduralProp(entity: PlayerSceneEntity): THREE.Object3D {
    const tint = color(entity.render3d?.color, 0xa6e3a1);
    const material = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.78 });
    let geometry: THREE.BufferGeometry;
    if (entity.render3d?.shape === 'sphere') geometry = new THREE.SphereGeometry(0.32, 12, 8);
    else geometry = new THREE.BoxGeometry(0.58, 0.58, 0.58);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = 0.3;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private pickVolume(entity: PlayerSceneEntity): THREE.Mesh {
    const collider = entity.collider3d;
    const width = Math.max(0.8, collider?.shape === 'box' ? finite(collider.size?.x, 0.8) : finite(collider?.radius, 0.4) * 2);
    const depth = Math.max(0.8, collider?.shape === 'box' ? finite(collider.size?.z, 0.8) : finite(collider?.radius, 0.4) * 2);
    const height = Math.max(entity.is_character ? 2 : 0.8, finite(collider?.size?.y, entity.is_character ? 2 : 0.8));
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    material.colorWrite = false;
    const volume = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    volume.name = 'pick-volume';
    volume.position.y = height / 2;
    volume.userData.entityId = entity.id;
    return volume;
  }

  private async replaceWithAsset(tracked: TrackedEntity, assetKey: string, generation: number): Promise<void> {
    try {
      const { gltf, descriptor } = await this.loadAsset(assetKey);
      if (generation !== this.loadGeneration || this.entities.get(tracked.entity.id) !== tracked) return;
      const pickVolume = tracked.root.getObjectByName('pick-volume');
      for (const child of [...tracked.root.children]) {
        if (child === pickVolume) continue;
        tracked.root.remove(child);
        disposeObject(child);
      }
      const model = cloneSkeleton(gltf.scene);
      this.applyAssetTransform(model, descriptor);
      model.traverse(child => {
        child.userData.entityId = tracked.entity.id;
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          // SkeletonUtils clones the node graph but intentionally shares render resources.
          // Give each room instance ownership so clearing a room cannot dispose the cache.
          mesh.geometry = mesh.geometry.clone();
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(material => material.clone())
            : mesh.material.clone();
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const source of materials) {
            const standard = source as THREE.MeshStandardMaterial;
            if (standard.color && tracked.entity.render3d?.color) standard.color.set(tracked.entity.render3d.color);
          }
        }
      });
      tracked.root.add(model);
      tracked.mixer = new THREE.AnimationMixer(model);
      const aliases = Array.isArray(descriptor.clips) ? {} : descriptor.clips || {};
      const idleClip = THREE.AnimationClip.findByName(gltf.animations, aliases.idle || 'Idle');
      const walkClip = THREE.AnimationClip.findByName(gltf.animations, aliases.walk || 'Walk');
      tracked.idle = idleClip ? tracked.mixer.clipAction(idleClip) : null;
      tracked.walk = walkClip ? tracked.mixer.clipAction(walkClip) : null;
      tracked.idle?.play();
    } catch (error) {
      console.warn(`Bunnyland 3D asset fallback for ${assetKey}:`, error);
    }
  }

  private loadAsset(assetKey: string): Promise<LoadedAsset> {
    const descriptor = this.serverAssets?.assets[assetKey];
    const cacheKey = `${assetKey}:${descriptor?.digest || 'bundled'}`;
    let pending = this.assetCache.get(cacheKey);
    if (!pending) {
      pending = this.loadAssetManifest().then(manifest => {
        const asset = manifest.assets[assetKey];
        if (!asset) throw new Error(`unknown asset key ${assetKey}`);
        if (asset.url) {
          const url = new URL(asset.url, document.baseURI);
          if (!url.pathname.endsWith('.glb')) throw new Error(`invalid server asset URL for ${assetKey}`);
          return this.loader.loadAsync(url.href).then(gltf => ({ gltf, descriptor: asset }));
        }
        const path = asset.path || '';
        if (!/^[a-z0-9][a-z0-9._-]*\.gltf$/.test(path)) throw new Error(`unknown bundled asset key ${assetKey}`);
        return this.loader.loadAsync(new URL(`assets/3d/${path}`, document.baseURI).href)
          .then(gltf => ({ gltf, descriptor: asset }));
      });
      this.assetCache.set(cacheKey, pending);
    }
    return pending;
  }

  private loadAssetManifest(): Promise<AssetManifest> {
    if (!this.assetManifest) {
      this.assetManifest = fetch(new URL('assets/3d/manifest.json', document.baseURI))
        .then(async response => {
          if (!response.ok) throw new Error(`asset manifest returned ${response.status}`);
          const manifest = await response.json() as AssetManifest;
          if (manifest.schema_version !== 1 || !manifest.assets) throw new Error('unsupported asset manifest');
          if (this.serverAssets) {
            for (const [key, asset] of Object.entries(this.serverAssets.assets)) {
              if (!(key in manifest.assets)) manifest.assets[key] = asset;
            }
          }
          return manifest;
        });
    }
    return this.assetManifest;
  }

  private applyAssetTransform(object: THREE.Object3D, descriptor: AssetDescriptor): void {
    const transform = descriptor.transform;
    if (!transform) return;
    object.scale.setScalar(finite(transform.scale, 1));
    object.rotation.set(
      finite(transform.rotation?.[0], 0),
      finite(transform.rotation?.[1], 0),
      finite(transform.rotation?.[2], 0),
    );
    object.position.set(
      finite(transform.translation?.[0], 0),
      finite(transform.translation?.[1], 0),
      finite(transform.translation?.[2], 0),
    );
  }

  private async replaceDecorationWithAsset(
    root: THREE.Group,
    group: NonNullable<PlayerSceneDecoration['prop_group3d']>,
    source: NonNullable<PlayerSceneDecoration['prop_group3d']>['instances'],
    generation: number,
  ): Promise<void> {
    try {
      const { gltf, descriptor } = await this.loadAsset(group.asset_key);
      if (!descriptor.instanced || generation !== this.loadGeneration || !root.parent) return;
      const model = cloneSkeleton(gltf.scene);
      this.applyAssetTransform(model, descriptor);
      model.updateMatrixWorld(true);
      const replacements: THREE.InstancedMesh[] = [];
      model.traverse(child => {
        const primitive = child as THREE.Mesh;
        if (!primitive.isMesh || (primitive as THREE.SkinnedMesh).isSkinnedMesh) return;
        const material = Array.isArray(primitive.material)
          ? primitive.material.map(value => value.clone())
          : primitive.material.clone();
        const materials = Array.isArray(material) ? material : [material];
        for (const value of materials) {
          const standard = value as THREE.MeshStandardMaterial;
          if (standard.color && group.color) standard.color.set(group.color);
        }
        const mesh = new THREE.InstancedMesh(primitive.geometry.clone(), material, source.length);
        const instance = new THREE.Object3D();
        source.forEach((view, index) => {
          instance.position.set(
            view.position.x,
            this.bounds.ground + finite(view.position.y, 0),
            view.position.z,
          );
          instance.rotation.set(0, view.rotation_y, 0);
          instance.scale.setScalar(view.scale);
          instance.updateMatrix();
          mesh.setMatrixAt(index, instance.matrix.clone().multiply(primitive.matrixWorld));
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.userData.decorationProps = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        replacements.push(mesh);
      });
      if (!replacements.length || generation !== this.loadGeneration || !root.parent) return;
      for (const child of [...root.children]) {
        root.remove(child);
        disposeObject(child);
      }
      root.add(...replacements);
    } catch (error) {
      console.warn(`Bunnyland 3D decoration asset fallback for ${group.asset_key}:`, error);
    }
  }

  private addObstacle(entity: PlayerSceneEntity): void {
    const collider = entity.collider3d;
    if (!collider || collider.solid === false || collider.trigger || entity.id === this.playerId) return;
    const position = entity.transform3d?.position || {};
    const scale = entity.transform3d?.scale || {};
    const x = finite(position.x, 0);
    const z = finite(position.z, 0);
    const radius = collider.shape === 'sphere' || collider.shape === 'capsule'
      ? Math.max(0.05, finite(collider.radius, 0.5) * finite(scale.x, 1))
      : Math.max(0.05, finite(collider.size?.x, 1) * finite(scale.x, 1) / 2);
    const depth = collider.shape === 'box'
      ? Math.max(0.05, finite(collider.size?.z, 1) * finite(scale.z, 1) / 2)
      : Math.max(0.05, finite(collider.radius, 0.5) * finite(scale.z, 1));
    this.obstacles.push({ id: entity.id, minX: x - radius, maxX: x + radius, minZ: z - depth, maxZ: z + depth });
  }

  private positionValid(position: THREE.Vector3, playerId: string): boolean {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return false;
    if (position.x < this.bounds.minX || position.x > this.bounds.maxX || position.z < this.bounds.minZ || position.z > this.bounds.maxZ) return false;
    return !this.collides(position.x, position.z, playerId);
  }

  private collides(x: number, z: number, playerId: string): boolean {
    return this.obstacles.some(obstacle => obstacle.id !== playerId
      && x + PLAYER_RADIUS > obstacle.minX
      && x - PLAYER_RADIUS < obstacle.maxX
      && z + PLAYER_RADIUS > obstacle.minZ
      && z - PLAYER_RADIUS < obstacle.maxZ);
  }

  private clampAvatar(): void {
    this.avatarPosition.x = THREE.MathUtils.clamp(this.avatarPosition.x, this.bounds.minX + PLAYER_RADIUS, this.bounds.maxX - PLAYER_RADIUS);
    this.avatarPosition.z = THREE.MathUtils.clamp(this.avatarPosition.z, this.bounds.minZ + PLAYER_RADIUS, this.bounds.maxZ - PLAYER_RADIUS);
    this.avatarPosition.y = this.bounds.ground;
  }

  private moveAvatar(delta: number): void {
    this.movement.set(0, 0, 0);
    if (!this.enabled || activeControl()) return;
    const forwardAmount = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const rightAmount = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    if (!forwardAmount && !rightAmount) return;
    this.forward.set(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    this.right.set(Math.cos(this.cameraYaw), 0, -Math.sin(this.cameraYaw));
    this.movement.addScaledVector(this.forward, forwardAmount).addScaledVector(this.right, rightAmount).normalize();
    const distance = PLAYER_SPEED * delta;
    const nextX = this.avatarPosition.x + this.movement.x * distance;
    if (!this.collides(nextX, this.avatarPosition.z, this.playerId)) this.avatarPosition.x = nextX;
    const nextZ = this.avatarPosition.z + this.movement.z * distance;
    if (!this.collides(this.avatarPosition.x, nextZ, this.playerId)) this.avatarPosition.z = nextZ;
    this.clampAvatar();
    const avatar = this.entities.get(this.playerId);
    if (avatar) {
      avatar.root.position.copy(this.avatarPosition);
      avatar.root.rotation.y = Math.atan2(this.movement.x, this.movement.z);
    }
  }

  private updateAnimation(delta: number): void {
    for (const [id, tracked] of this.entities) {
      tracked.mixer?.update(delta);
      if (id !== this.playerId || !tracked.idle || !tracked.walk) continue;
      const walking = this.movement.lengthSq() > 0;
      if (walking && !tracked.walk.isRunning()) {
        tracked.idle.fadeOut(0.16);
        tracked.walk.reset().fadeIn(0.16).play();
      } else if (!walking && !tracked.idle.isRunning()) {
        tracked.walk.fadeOut(0.18);
        tracked.idle.reset().fadeIn(0.18).play();
      }
    }
  }

  private updateParticles(delta: number): void {
    this.particleTime += delta;
    this.environment.traverse(object => {
      if (!(object instanceof THREE.Points) || !object.userData.particleEmitter) return;
      const emitter = object.userData.particleEmitter as NonNullable<PlayerSceneDecoration['particle_emitter3d']> & { baseY: number };
      const attribute = object.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let index = 0; index < attribute.count; index += 1) {
        const phase = index * 1.618 + emitter.seed * 0.0001;
        let y = attribute.getY(index) + delta * emitter.speed * (emitter.preset === 'dust' ? 0.18 : 0.55);
        if (y > emitter.baseY + emitter.bounds.y) y = emitter.baseY;
        attribute.setY(index, y);
        attribute.setX(index, attribute.getX(index) + Math.sin(this.particleTime + phase) * delta * emitter.speed * 0.08);
        attribute.setZ(index, attribute.getZ(index) + Math.cos(this.particleTime * 0.8 + phase) * delta * emitter.speed * 0.08);
      }
      attribute.needsUpdate = true;
      const material = object.material as THREE.PointsMaterial;
      if (emitter.preset === 'fireflies') material.opacity = emitter.opacity * (0.6 + 0.4 * Math.sin(this.particleTime * 2.4));
    });
  }

  private updateNearbyExit(): void {
    let nearest: TrackedExit | null = null;
    let nearestDistance = EXIT_RANGE;
    for (const tracked of this.exits) {
      const distance = tracked.position.distanceTo(this.avatarPosition.clone().setY(tracked.position.y));
      if (distance < nearestDistance) {
        nearest = tracked;
        nearestDistance = distance;
      }
    }
    const next = nearest?.exit.id || '';
    if (next === this.nearbyExitId) return;
    this.nearbyExitId = next;
    this.onNearbyExit(nearest?.exit || null);
  }

  private applySelection(): void {
    for (const [id, tracked] of this.entities) {
      const old = tracked.root.getObjectByName('selection-ring');
      if (old) {
        tracked.root.remove(old);
        disposeObject(old);
      }
      if (id !== this.selectedEntityId) continue;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.42, 0.53, 28),
        new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
      );
      ring.name = 'selection-ring';
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      tracked.root.add(ring);
    }
  }

  private updateCamera(delta: number): void {
    this.cameraTarget.set(this.avatarPosition.x, this.bounds.ground + 1.15, this.avatarPosition.z);
    const horizontal = Math.cos(this.cameraPitch) * this.cameraRadius;
    this.desiredCamera.set(
      this.cameraTarget.x + Math.sin(this.cameraYaw) * horizontal,
      this.cameraTarget.y + Math.sin(this.cameraPitch) * this.cameraRadius,
      this.cameraTarget.z + Math.cos(this.cameraYaw) * horizontal,
    );
    const direction = this.desiredCamera.clone().sub(this.cameraTarget);
    const distance = direction.length();
    direction.normalize();
    this.raycaster.set(this.cameraTarget, direction);
    this.raycaster.far = distance;
    const hits = this.raycaster.intersectObjects(this.cameraOccluders, true);
    if (hits[0] && hits[0].distance > 0.35) {
      this.desiredCamera.copy(this.cameraTarget).addScaledVector(direction, Math.max(0.4, hits[0].distance - 0.18));
    }
    const alpha = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 13);
    this.camera.position.lerp(this.desiredCamera, alpha);
    this.camera.lookAt(this.cameraTarget);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const delta = Math.min(MAX_FRAME_DELTA, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.moveAvatar(delta);
    this.updateAnimation(delta);
    this.updateParticles(delta);
    this.updateNearbyExit();
    this.updateCamera(delta);
    this.renderer.render(this.scene, this.camera);
  };

  private resize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code.startsWith('Arrow') && !activeControl()) event.preventDefault();
    this.keys.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 2) return;
    this.dragging = true;
    this.dragged = false;
    this.pointerStart.set(event.clientX, event.clientY);
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = event.clientX - this.pointerStart.x;
    const dy = event.clientY - this.pointerStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.dragged = true;
    this.pointerStart.set(event.clientX, event.clientY);
    this.cameraYaw -= dx * 0.0065;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.0045, 0.12, 0.82);
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.dragging = false;
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || event.target !== this.renderer.domElement) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.far = Infinity;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ids = [...new Set(
      this.raycaster.intersectObjects(this.entityGroup.children, true)
        .map(hit => this.parentData(hit.object, 'entityId'))
        .filter(Boolean),
    )];
    const ordered = [...ids.filter(id => id !== this.playerId), ...ids.filter(id => id === this.playerId)];
    const now = performance.now();
    const samePick = this.lastPick
      && now - this.lastPick.at < 1600
      && Math.hypot(event.clientX - this.lastPick.x, event.clientY - this.lastPick.y) < 8
      && ordered.join('\n') === this.lastPick.ids.join('\n');
    const index = ordered.length ? (samePick ? (this.lastPick!.index + 1) % ordered.length : 0) : -1;
    const entityId = index >= 0 ? ordered[index] : '';
    if (entityId) {
      this.lastPick = { x: event.clientX, y: event.clientY, ids: ordered, index, at: now };
      this.selectEntity(entityId);
      this.onSelectEntity(entityId);
    } else {
      this.lastPick = null;
      this.clearSelection();
      this.onSelectEntity('');
    }
  };

  private parentData(object: THREE.Object3D | undefined, key: string): string {
    let current = object;
    while (current) {
      const value = current.userData[key];
      if (typeof value === 'string') return value;
      current = current.parent || undefined;
    }
    return '';
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.cameraRadius = THREE.MathUtils.clamp(this.cameraRadius + Math.sign(event.deltaY) * 0.45, 2.7, 8.5);
  };
}
