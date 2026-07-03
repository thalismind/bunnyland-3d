import * as THREE from 'three';

import type { LayoutRoom, RoomRenderEntity, WorldLayout } from './adapter.mjs';
import { WORLD_3D_CONSTANTS } from './adapter.mjs';

export type ViewMode = '2d' | '3d';

const ROOM_SIZE = WORLD_3D_CONSTANTS.ROOM_WORLD_SIZE;
const ROOM_TILE_SIZE = 6.0;
const ROOM_FOCUS_MS = 520;

const BIOME_COLORS: Record<string, number> = {
  cave: 0x746354,
  garden: 0x6fa85c,
  marsh: 0x4b8979,
  meadow: 0x7ca85c,
  station: 0x4f6f9f,
  unknown: 0x6d7788,
};

const ENTITY_COLORS: Record<string, number> = {
  character: 0x89b4fa,
  item: 0xf9e2af,
  object: 0xa6e3a1,
  other: 0xcdd6f4,
};

interface TrackedRoom {
  room: LayoutRoom;
  mesh: THREE.Mesh;
  label: THREE.Sprite;
}

interface TrackedEntity {
  entity: RoomRenderEntity;
  mesh: THREE.Mesh;
}

interface TrackedExit {
  exitId: string;
  sourceRoomId: string;
  marker: THREE.Sprite;
}

interface CameraTransition {
  from: THREE.Vector3;
  to: THREE.Vector3;
  startMs: number;
  durationMs: number;
}

export interface CameraState {
  target: { x: number; y: number; z: number };
  radius: number;
  moving: boolean;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export class BunnylandScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  private readonly roomGroup = new THREE.Group();
  private readonly linkGroup = new THREE.Group();
  private readonly exitGroup = new THREE.Group();
  private readonly entityGroup = new THREE.Group();
  private readonly selectionGroup = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly rooms = new Map<string, TrackedRoom>();
  private readonly entities = new Map<string, TrackedEntity>();
  private readonly exits: TrackedExit[] = [];
  private mode: ViewMode = '3d';
  private manualCamera = false;
  private selectedRoomId = '';
  private selectedEntityId = '';
  private center = new THREE.Vector3();
  private cameraTarget = new THREE.Vector3();
  private cameraTransition: CameraTransition | null = null;
  private layout: WorldLayout | null = null;
  private cameraTheta = Math.PI * 0.25;
  private cameraPhi = 0.85;
  private cameraRadius = 24;
  private orthoHalf = 8;
  private pointerDown: { x: number; y: number; button: number; moved: boolean } | null = null;
  private lastFrameTime = performance.now();

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelectRoom: (roomId: string) => void,
    private readonly onSelectEntity: (entityId: string) => void,
    private readonly onSelectExit: (exitId: string, sourceRoomId: string) => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x0b110d);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.58));
    const sun = new THREE.DirectionalLight(0xffffff, 0.82);
    sun.position.set(0.4, 1, 0.25);
    this.scene.add(sun);
    this.scene.add(this.linkGroup, this.exitGroup, this.roomGroup, this.entityGroup, this.selectionGroup);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.animate();
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    this.resize();
  }

  setManualCamera(enabled: boolean): void {
    this.manualCamera = enabled;
  }

  capturePng(): string {
    this.updateCameraTransition(performance.now());
    this.applyCamera();
    const canvas = document.createElement('canvas');
    const width = Math.max(1, this.renderer.domElement.width);
    const height = Math.max(1, this.renderer.domElement.height);
    const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.render(this.scene, this.activeCamera());
    renderer.getContext().finish();
    const dataUrl = canvas.toDataURL('image/png');
    renderer.dispose();
    return dataUrl;
  }

  loadLayout(layout: WorldLayout, resetCamera = true): void {
    this.layout = layout;
    this.rooms.clear();
    this.entities.clear();
    this.exits.length = 0;
    this.roomGroup.clear();
    this.linkGroup.clear();
    this.exitGroup.clear();
    this.entityGroup.clear();
    this.selectionGroup.clear();
    if (resetCamera) {
      this.center.set((layout.width * ROOM_SIZE) / 2, 0, (layout.height * ROOM_SIZE) / 2);
      this.cameraTarget.copy(this.center);
      this.cameraTransition = null;
      this.cameraRadius = Math.max(16, Math.max(layout.width, layout.height) * ROOM_SIZE * 0.78);
    }
    this.addLinks(layout);
    for (const room of layout.rooms) this.addRoom(room);
    if (!this.selectedRoomId && layout.rooms[0]) this.selectRoom(layout.rooms[0].id, false, false);
    this.updateSelection();
    this.resize();
  }

  loadRoomEntities(roomId: string, entities: RoomRenderEntity[]): void {
    this.selectedRoomId = roomId;
    this.selectedEntityId = '';
    this.entities.clear();
    this.entityGroup.clear();
    this.selectionGroup.clear();
    const room = this.layout?.rooms.find(item => item.id === roomId);
    if (!room) return;
    for (const entity of entities) this.addEntity(room, entity);
    this.updateSelection();
  }

  loadPlayerRoom(layout: WorldLayout, roomId: string, entities: RoomRenderEntity[]): void {
    const resetCamera = this.layout === null;
    this.loadLayout(layout, resetCamera);
    this.selectRoom(roomId, false, true);
    this.loadRoomEntities(roomId, entities);
  }

  selectRoom(roomId: string, notify = true, animate = true): void {
    if (!this.rooms.has(roomId)) return;
    this.selectedRoomId = roomId;
    this.focusRoom(roomId, animate);
    this.updateSelection();
    if (notify) this.onSelectRoom(roomId);
  }

  selectEntity(entityId: string, notify = true): boolean {
    if (!this.entities.has(entityId)) return false;
    this.selectedEntityId = entityId;
    this.updateEntitySelection();
    if (notify) this.onSelectEntity(entityId);
    return true;
  }

  cameraState(): CameraState {
    this.updateCameraTransition(performance.now());
    return {
      target: {
        x: this.cameraTarget.x,
        y: this.cameraTarget.y,
        z: this.cameraTarget.z,
      },
      radius: this.cameraRadius,
      moving: this.cameraTransition !== null,
    };
  }

  exitScreenPoint(exitId: string, sourceRoomId = ''): ScreenPoint | null {
    this.updateCameraTransition(performance.now());
    this.applyCamera();
    const tracked = this.exits.find(item =>
      item.exitId === exitId && (!sourceRoomId || item.sourceRoomId === sourceRoomId),
    );
    if (!tracked) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const projected = tracked.marker.position.clone().project(this.activeCamera());
    if (projected.z < -1 || projected.z > 1) return null;
    return {
      x: rect.left + (projected.x + 1) * rect.width / 2,
      y: rect.top + (-projected.y + 1) * rect.height / 2,
    };
  }

  private addLinks(layout: WorldLayout): void {
    const byId = new Map(layout.rooms.map(room => [room.id, room]));
    const points: THREE.Vector3[] = [];
    const seen = new Set<string>();
    for (const room of layout.rooms) {
      for (const exit of room.exits) {
        const target = byId.get(exit.id);
        if (!target) continue;
        const key = [room.id, target.id].sort().join('->');
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(new THREE.Vector3(room.worldX, 0.08, room.worldZ));
        points.push(new THREE.Vector3(target.worldX, 0.08, target.worldZ));
      }
      for (const exit of room.exits) {
        const target = byId.get(exit.id);
        if (!target) continue;
        this.addExitMarker(room, target, exit);
      }
    }
    if (points.length) {
      this.linkGroup.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xa6e3a1, transparent: true, opacity: 0.58 }),
        ),
      );
    }
  }

  private addExitMarker(room: LayoutRoom, target: LayoutRoom, exit: LayoutRoom['exits'][number]): void {
    const start = new THREE.Vector3(room.worldX, room.worldY + 0.95, room.worldZ);
    const end = new THREE.Vector3(target.worldX, target.worldY + 0.95, target.worldZ);
    const position = start.clone().lerp(end, 0.34);
    const direction = exit.direction || 'exit';
    const label = this.createLabel(`> ${direction}`, exit.label || target.title);
    label.position.copy(position);
    label.scale.set(2.2, 0.82, 1);
    label.userData.exitId = exit.id;
    label.userData.sourceRoomId = room.id;
    this.exitGroup.add(label);
    this.exits.push({ exitId: exit.id, sourceRoomId: room.id, marker: label });
  }

  private addRoom(room: LayoutRoom): void {
    const color = this.colorFor(room.render3d?.color, BIOME_COLORS[room.biome] ?? BIOME_COLORS.unknown);
    const fogged = Boolean(room.fogged);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(ROOM_TILE_SIZE, 0.35, ROOM_TILE_SIZE),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: fogged ? 0.01 : 0.04,
        opacity: fogged ? 0.34 : 1,
        roughness: 0.78,
        transparent: fogged,
      }),
    );
    mesh.position.set(room.worldX, room.worldY + 0.18, room.worldZ);
    mesh.userData.roomId = room.id;
    this.roomGroup.add(mesh);
    const detail = fogged ? 'remembered' : `${room.occupantCount} chars / ${room.itemCount} items`;
    const label = this.createLabel(room.title, detail);
    label.position.set(room.worldX, room.worldY + 0.7, room.worldZ);
    (label.material as THREE.SpriteMaterial).opacity = fogged ? 0.52 : 0.76;
    this.roomGroup.add(label);
    this.rooms.set(room.id, { room, mesh, label });
  }

  private addEntity(room: LayoutRoom, entity: RoomRenderEntity): void {
    const color = this.colorFor(
      entity.render3d?.color,
      ENTITY_COLORS[entity.isCharacter ? 'character' : entity.kind] ?? ENTITY_COLORS.other,
    );
    const shape = entity.render3d?.shape || (entity.isCharacter ? 'sphere' : 'box');
    const geometry = shape === 'sphere'
      ? new THREE.SphereGeometry(0.22, 16, 12)
      : new THREE.BoxGeometry(0.32, 0.32, 0.32);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.16 }),
    );
    mesh.position.set(room.worldX + entity.localX, room.worldY + entity.localY + 0.75, room.worldZ + entity.localZ);
    mesh.userData.entityId = entity.id;
    this.entityGroup.add(mesh);
    this.entities.set(entity.id, { entity, mesh });
  }

  private createLabel(title: string, detail: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(17, 25, 18, 0.84)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(166, 227, 161, 0.58)';
      ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
      ctx.fillStyle = '#f2f5df';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(title.slice(0, 24), canvas.width / 2, 34);
      ctx.fillStyle = '#aeb8a4';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(detail, canvas.width / 2, 66);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
    sprite.scale.set(2.6, 0.98, 1);
    return sprite;
  }

  private updateSelection(): void {
    for (const [roomId, tracked] of this.rooms) {
      const selected = roomId === this.selectedRoomId;
      tracked.mesh.scale.y = selected ? 1.85 : 1;
      const material = tracked.mesh.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = selected ? 0.22 : tracked.room.fogged ? 0.01 : 0.04;
      (tracked.label.material as THREE.SpriteMaterial).opacity = selected ? 1 : tracked.room.fogged ? 0.52 : 0.76;
    }
    this.updateExitSelection();
    this.updateEntitySelection();
  }

  private updateExitSelection(): void {
    for (const tracked of this.exits) {
      const selectedSource = tracked.sourceRoomId === this.selectedRoomId;
      const material = tracked.marker.material as THREE.SpriteMaterial;
      material.opacity = selectedSource ? 0.94 : 0.28;
      tracked.marker.scale.set(selectedSource ? 2.35 : 1.85, selectedSource ? 0.88 : 0.7, 1);
    }
  }

  private updateEntitySelection(): void {
    this.selectionGroup.clear();
    const tracked = this.entities.get(this.selectedEntityId);
    if (!tracked) return;

    const outline = new THREE.BoxHelper(tracked.mesh, 0xf2cd5c);
    this.selectionGroup.add(outline);

    const label = this.createLabel(tracked.entity.name, tracked.entity.kind);
    label.position.copy(tracked.mesh.position);
    label.position.y += 0.7;
    label.scale.set(2.1, 0.78, 1);
    this.selectionGroup.add(label);
  }

  private focusRoom(roomId: string, animate: boolean): void {
    const tracked = this.rooms.get(roomId);
    if (!tracked) return;
    const target = new THREE.Vector3(tracked.room.worldX, tracked.room.worldY, tracked.room.worldZ);
    if (!animate || this.cameraTarget.distanceToSquared(target) < 0.0001) {
      this.cameraTransition = null;
      this.cameraTarget.copy(target);
      return;
    }
    this.cameraTransition = {
      from: this.cameraTarget.clone(),
      to: target,
      startMs: performance.now(),
      durationMs: ROOM_FOCUS_MS,
    };
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.updateCameraTransition(now);
    if (this.mode === '3d' && !this.manualCamera) this.cameraTheta += dt * 0.08;
    this.applyCamera();
    this.renderer.render(this.scene, this.activeCamera());
  };

  private activeCamera(): THREE.Camera {
    return this.mode === '3d' ? this.perspective : this.ortho;
  }

  private applyCamera(): void {
    if (this.mode === '2d') {
      this.ortho.position.set(this.cameraTarget.x, 120, this.cameraTarget.z);
      this.ortho.up.set(0, 0, -1);
      this.ortho.lookAt(this.cameraTarget);
      return;
    }
    const x = this.cameraTarget.x + Math.cos(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraRadius;
    const y = Math.max(5, Math.sin(this.cameraPhi) * this.cameraRadius);
    const z = this.cameraTarget.z + Math.sin(this.cameraTheta) * Math.cos(this.cameraPhi) * this.cameraRadius;
    this.perspective.position.set(x, y, z);
    this.perspective.lookAt(this.cameraTarget);
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    this.orthoHalf = Math.max(3, Math.min(this.orthoHalf, 80));
    this.ortho.left = -this.orthoHalf * (width / height);
    this.ortho.right = this.orthoHalf * (width / height);
    this.ortho.top = this.orthoHalf;
    this.ortho.bottom = -this.orthoHalf;
    this.ortho.updateProjectionMatrix();
  }

  private pick(event: PointerEvent, meshes: THREE.Object3D[], key: string): string {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.mode === '3d' ? this.perspective : this.ortho);
    const hits = this.raycaster.intersectObjects(meshes);
    const value = hits[0]?.object.userData[key];
    return typeof value === 'string' ? value : '';
  }

  private pickEntity(event: PointerEvent): string {
    return this.pick(event, [...this.entities.values()].map(item => item.mesh), 'entityId');
  }

  private pickExit(event: PointerEvent): { exitId: string; sourceRoomId: string } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.mode === '3d' ? this.perspective : this.ortho);
    const hits = this.raycaster.intersectObjects(this.exits.map(item => item.marker));
    const data = hits[0]?.object.userData || {};
    return typeof data.exitId === 'string' && typeof data.sourceRoomId === 'string'
      ? { exitId: data.exitId, sourceRoomId: data.sourceRoomId }
      : null;
  }

  private pickRoom(event: PointerEvent): string {
    return this.pick(event, [...this.rooms.values()].map(item => item.mesh), 'roomId');
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button, moved: false };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointerDown) return;
    const dx = event.clientX - this.pointerDown.x;
    const dy = event.clientY - this.pointerDown.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) this.pointerDown.moved = true;
    this.pointerDown.x = event.clientX;
    this.pointerDown.y = event.clientY;
    if (!this.manualCamera) return;
    this.cameraTransition = null;
    const orbit = this.mode === '3d' && (this.pointerDown.button === 2 || event.altKey);
    if (!orbit) {
      this.panCamera(dx, dy);
      return;
    }
    this.cameraTheta += dx * 0.008;
    this.cameraPhi = THREE.MathUtils.clamp(this.cameraPhi - dy * 0.006, 0.25, 1.25);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const click = this.pointerDown && !this.pointerDown.moved;
    this.pointerDown = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    if (!click) return;
    const entityId = this.pickEntity(event);
    if (entityId && this.selectEntity(entityId)) return;
    const exit = this.pickExit(event);
    if (exit) {
      this.onSelectExit(exit.exitId, exit.sourceRoomId);
      return;
    }
    const roomId = this.pickRoom(event);
    if (roomId) this.selectRoom(roomId);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.manualCamera) this.cameraTransition = null;
    if (this.mode === '2d') {
      this.orthoHalf = THREE.MathUtils.clamp(this.orthoHalf + Math.sign(event.deltaY) * 1.2, 3, 80);
      this.resize();
      return;
    }
    this.cameraRadius = THREE.MathUtils.clamp(this.cameraRadius + Math.sign(event.deltaY) * 1.2, 4, 160);
    this.resize();
  };

  private panCamera(dx: number, dy: number): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (this.mode === '2d') {
      const scale = (this.orthoHalf * 2) / Math.max(1, rect.height);
      this.cameraTarget.x += dx * scale;
      this.cameraTarget.z -= dy * scale;
      return;
    }
    const forward = new THREE.Vector3().subVectors(this.cameraTarget, this.perspective.position);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const scale = this.cameraRadius / Math.max(240, rect.height) * 1.8;
    this.cameraTarget.addScaledVector(right, dx * scale);
    this.cameraTarget.addScaledVector(forward, dy * scale);
  }

  private colorFor(value: string | undefined, fallback: number): number {
    if (!value || !/^#[0-9a-fA-F]{6}$/.test(value)) return fallback;
    return Number.parseInt(value.slice(1), 16);
  }

  private updateCameraTransition(now: number): void {
    if (!this.cameraTransition) return;
    const progress = THREE.MathUtils.clamp(
      (now - this.cameraTransition.startMs) / this.cameraTransition.durationMs,
      0,
      1,
    );
    const eased = 1 - Math.pow(1 - progress, 3);
    this.cameraTarget.lerpVectors(this.cameraTransition.from, this.cameraTransition.to, eased);
    if (progress >= 1) {
      this.cameraTarget.copy(this.cameraTransition.to);
      this.cameraTransition = null;
    }
  }
}
