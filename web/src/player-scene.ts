import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

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
  };
  exits: PlayerSceneExit[];
  entities: PlayerSceneEntity[];
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
  assets: Record<string, { path: string; clips?: string[]; variants?: string[] }>;
}

export interface PlayerCameraState {
  target: { x: number; y: number; z: number };
  radius: number;
  moving: boolean;
  avatar: { x: number; y: number; z: number };
}

const DEFAULT_ROOM_SIZE = 16;
const PLAYER_SPEED = 3.4;
const EXIT_RANGE = 1.65;
const PLAYER_RADIUS = 0.36;
const MAX_FRAME_DELTA = 0.05;

const BIOME_PALETTES: Record<string, { ground: number; fog: number; accent: number }> = {
  cave: { ground: 0x4c4037, fog: 0x171514, accent: 0xc69568 },
  forest: { ground: 0x426344, fog: 0x17251a, accent: 0x91c46c },
  garden: { ground: 0x5b7d4d, fog: 0x20311e, accent: 0xf1b0c7 },
  marsh: { ground: 0x406c61, fog: 0x142825, accent: 0x72c7b7 },
  meadow: { ground: 0x668a4d, fog: 0x1b2d1a, accent: 0xf0d36d },
  station: { ground: 0x45546e, fog: 0x151b27, accent: 0x7eb5e8 },
  unknown: { ground: 0x576070, fog: 0x181c24, accent: 0xaab5c8 },
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
  private readonly assetCache = new Map<string, Promise<GLTF>>();
  private assetManifest: Promise<AssetManifest> | null = null;
  private readonly entities = new Map<string, TrackedEntity>();
  private readonly exits: TrackedExit[] = [];
  private readonly obstacles: Obstacle2D[] = [];
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
    this.nearbyExitId = '';
    this.lastPick = null;
    this.onNearbyExit(null);
  }

  private applyEnvironment(data: PlayerRoomScene): void {
    const palette = BIOME_PALETTES[data.room.biome] || BIOME_PALETTES.unknown;
    const roomColor = color(data.room.render3d?.color, palette.ground);
    this.scene.background = new THREE.Color(palette.fog);
    this.scene.fog = new THREE.FogExp2(palette.fog, data.room.indoor ? 0.032 : 0.018);

    const width = this.bounds.maxX - this.bounds.minX;
    const depth = this.bounds.maxZ - this.bounds.minZ;
    const centerX = (this.bounds.minX + this.bounds.maxX) / 2;
    const centerZ = (this.bounds.minZ + this.bounds.maxZ) / 2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth, 1, 1),
      new THREE.MeshStandardMaterial({ color: roomColor, roughness: 0.93, metalness: data.room.biome === 'station' ? 0.22 : 0 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(centerX, this.bounds.ground, centerZ);
    floor.receiveShadow = true;
    this.environment.add(floor);

    const hemisphere = new THREE.HemisphereLight(0xcfe8ff, data.room.indoor ? 0x342c26 : 0x31512f, data.room.indoor ? 1.35 : 1.65);
    this.environment.add(hemisphere);
    const sun = new THREE.DirectionalLight(data.room.indoor ? 0xffe4c2 : 0xfff1d2, data.room.indoor ? 1.55 : 2.2);
    sun.position.set(centerX - 5, this.bounds.ground + 10, centerZ + 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    this.environment.add(sun);

    if (data.room.indoor) this.addIndoorWalls(data.exits, roomColor);
    this.addDressing(data.room.id, data.room.biome, data.room.indoor, palette.accent);
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

  private addDressing(roomId: string, biome: string, indoor: boolean, accent: number): void {
    const random = randomFrom(hash(`${roomId}:${biome}`));
    const count = indoor ? 8 : 18;
    const material = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.9 });
    const geometry = indoor
      ? new THREE.BoxGeometry(1, 0.8, 1)
      : new THREE.ConeGeometry(0.48, 1.7, 5);
    const props = new THREE.InstancedMesh(geometry, material, count);
    const dummy = new THREE.Object3D();
    for (let index = 0; index < count; index += 1) {
      const alongX = random() > 0.5;
      const edge = random() > 0.5;
      const x = alongX
        ? this.bounds.minX + 0.7 + random() * (this.bounds.maxX - this.bounds.minX - 1.4)
        : edge ? this.bounds.minX + 0.65 : this.bounds.maxX - 0.65;
      const z = alongX
        ? edge ? this.bounds.minZ + 0.65 : this.bounds.maxZ - 0.65
        : this.bounds.minZ + 0.7 + random() * (this.bounds.maxZ - this.bounds.minZ - 1.4);
      const scale = 0.35 + random() * 0.55;
      dummy.position.set(x, this.bounds.ground + (indoor ? scale * 0.4 : scale * 0.85), z);
      dummy.rotation.set(0, random() * Math.PI * 2, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      props.setMatrixAt(index, dummy.matrix);
    }
    props.instanceMatrix.needsUpdate = true;
    props.castShadow = true;
    props.receiveShadow = true;
    this.environment.add(props);
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
      const gltf = await this.loadAsset(assetKey);
      if (generation !== this.loadGeneration || this.entities.get(tracked.entity.id) !== tracked) return;
      const pickVolume = tracked.root.getObjectByName('pick-volume');
      for (const child of [...tracked.root.children]) {
        if (child === pickVolume) continue;
        tracked.root.remove(child);
        disposeObject(child);
      }
      const model = cloneSkeleton(gltf.scene);
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
      const idleClip = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
      const walkClip = THREE.AnimationClip.findByName(gltf.animations, 'Walk');
      tracked.idle = idleClip ? tracked.mixer.clipAction(idleClip) : null;
      tracked.walk = walkClip ? tracked.mixer.clipAction(walkClip) : null;
      tracked.idle?.play();
    } catch (error) {
      console.warn(`Bunnyland 3D asset fallback for ${assetKey}:`, error);
    }
  }

  private loadAsset(assetKey: string): Promise<GLTF> {
    let pending = this.assetCache.get(assetKey);
    if (!pending) {
      pending = this.loadAssetManifest().then(manifest => {
        const path = manifest.assets[assetKey]?.path || '';
        if (!/^[a-z0-9][a-z0-9._-]*\.gltf$/.test(path)) throw new Error(`unknown bundled asset key ${assetKey}`);
        return this.loader.loadAsync(new URL(`assets/3d/${path}`, document.baseURI).href);
      });
      this.assetCache.set(assetKey, pending);
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
          return manifest;
        });
    }
    return this.assetManifest;
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
    const hits = this.raycaster.intersectObjects(this.environment.children, true);
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
