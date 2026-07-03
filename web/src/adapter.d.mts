export interface WorldLayout {
  epoch: number;
  roomCount: number;
  characterCount: number;
  width: number;
  height: number;
  rooms: LayoutRoom[];
}

export interface LayoutRoom {
  id: string;
  title: string;
  biome: string;
  indoor: boolean;
  private: boolean;
  occupantCount: number;
  itemCount: number;
  gridX: number;
  gridY: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  render3d?: Render3D;
  bounds3d?: unknown;
  fogged?: boolean;
  exits: { id: string; direction: string; label: string; locked: boolean }[];
}

export interface Render3D {
  shape?: "box" | "sphere" | "capsule" | "billboard";
  color?: string;
  emissive?: string;
  opacity?: number;
  label?: string;
  visible?: boolean;
}

export interface RoomRenderEntity {
  id: string;
  name: string;
  kind: string;
  isCharacter: boolean;
  localX: number;
  localY: number;
  localZ: number;
  layer: number;
  render3d?: Render3D;
  collider3d?: unknown;
}

export function snapshot3d(snapshot: unknown): Map<string, unknown>;
export function layoutOverview(overview: unknown, snapshot?: Map<string, unknown> | null): WorldLayout;
export function roomEntities(roomProjection: unknown, snapshot?: Map<string, unknown> | null): RoomRenderEntity[];
export function roomSummary(layout: WorldLayout, roomId: string): LayoutRoom | null;
export const WORLD_3D_CONSTANTS: { ROOM_WORLD_SIZE: number };
