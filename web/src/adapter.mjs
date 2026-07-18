const ROOM_WORLD_SIZE = 12;
const ROOM_ENTITY_SCALE = 0.028;
const ROOM_COORDINATE_SIZE = 100;

const DIRECTION_VECTORS = new Map([
  ['north', [0, -1]], ['n', [0, -1]],
  ['south', [0, 1]], ['s', [0, 1]],
  ['east', [1, 0]], ['e', [1, 0]],
  ['west', [-1, 0]], ['w', [-1, 0]],
  ['northeast', [1, -1]], ['ne', [1, -1]],
  ['northwest', [-1, -1]], ['nw', [-1, -1]],
  ['southeast', [1, 1]], ['se', [1, 1]],
  ['southwest', [-1, 1]], ['sw', [-1, 1]],
]);

function sortById(items) {
  return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function component(entity, name) {
  return entity?.components?.[name] || null;
}

function snapshotEntity3d(entity) {
  const transform = component(entity, 'Transform3DComponent');
  const render = component(entity, 'Render3DComponent');
  const collider = component(entity, 'Collider3DComponent');
  const bounds = component(entity, 'RoomBounds3DComponent');
  return {
    transform3d: transform || undefined,
    render3d: render || undefined,
    collider3d: collider || undefined,
    bounds3d: bounds || undefined,
  };
}

export function snapshot3d(snapshot) {
  const entities = new Map();
  for (const entity of snapshot?.entities || []) {
    const view = snapshotEntity3d(entity);
    if (view.transform3d || view.render3d || view.collider3d || view.bounds3d) {
      entities.set(entity.id, view);
    }
  }
  return entities;
}

function withSnapshot3d(entity, snapshot) {
  const view = snapshot?.get(entity?.id) || {};
  return {
    ...entity,
    transform3d: entity?.transform3d || view.transform3d,
    render3d: entity?.render3d || view.render3d,
    collider3d: entity?.collider3d || view.collider3d,
    bounds3d: entity?.bounds3d || view.bounds3d,
  };
}

function directionVector(direction, fallbackIndex) {
  const key = String(direction || '').trim().toLowerCase();
  if (DIRECTION_VECTORS.has(key)) return DIRECTION_VECTORS.get(key);
  const angle = fallbackIndex * Math.PI * (3 - Math.sqrt(5));
  return [Math.round(Math.cos(angle)), Math.round(Math.sin(angle))];
}

function coordKey(x, y) {
  return `${x},${y}`;
}

function nearestFree(occupied, desiredX, desiredY) {
  if (!occupied.has(coordKey(desiredX, desiredY))) return [desiredX, desiredY];
  for (let radius = 1; radius < 80; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = desiredX + dx;
        const y = desiredY + dy;
        if (!occupied.has(coordKey(x, y))) return [x, y];
      }
    }
  }
  return [desiredX, desiredY];
}

function normalizeLayout(rooms) {
  const minX = Math.min(...rooms.map(room => room.gridX), 0);
  const minY = Math.min(...rooms.map(room => room.gridY), 0);
  const shifted = rooms.map(room => ({ ...room, gridX: room.gridX - minX + 1, gridY: room.gridY - minY + 1 }));
  const width = Math.max(...shifted.map(room => room.gridX), 1) + 2;
  const height = Math.max(...shifted.map(room => room.gridY), 1) + 2;
  return { width, height, rooms: shifted };
}

export function layoutOverview(overview, snapshot = null) {
  const byId = new Map(sortById(overview?.rooms || []).map(room => [room.id, withSnapshot3d(room, snapshot)]));
  const positions = new Map();
  const occupied = new Set();
  const queue = [];

  function place(roomId, x, y) {
    if (positions.has(roomId)) return;
    positions.set(roomId, { x, y });
    occupied.add(coordKey(x, y));
    queue.push(roomId);
  }

  const first = sortById(byId.values())[0];
  if (first) place(first.id, 0, 0);
  while (queue.length) {
    const roomId = queue.shift();
    const room = byId.get(roomId);
    const from = positions.get(roomId);
    if (!room || !from) continue;
    for (const [index, exit] of (room.exits || []).entries()) {
      if (!byId.has(exit.id) || positions.has(exit.id)) continue;
      const [dx, dy] = directionVector(exit.direction, index);
      const [x, y] = nearestFree(occupied, from.x + dx, from.y + dy);
      place(exit.id, x, y);
    }
  }
  for (const room of sortById(byId.values())) {
    if (positions.has(room.id)) continue;
    const [x, y] = nearestFree(occupied, positions.size % 8, Math.floor(positions.size / 8));
    place(room.id, x, y);
  }

  const rooms = sortById(byId.values()).map(room => {
    const position = positions.get(room.id) || { x: 0, y: 0 };
    const transform = room.transform3d || {};
    const render = room.render3d || {};
    const bounds = room.bounds3d || {};
    return {
      id: room.id,
      title: room.title || render.label || room.id,
      biome: room.biome || 'unknown',
      indoor: Boolean(room.indoor),
      private: Boolean(room.private),
      occupantCount: Number(room.occupant_count || 0),
      itemCount: Number(room.item_count || 0),
      gridX: position.x,
      gridY: position.y,
      worldX: Number(transform.position?.x ?? position.x * ROOM_WORLD_SIZE),
      worldY: Number(transform.position?.y ?? 0),
      worldZ: Number(transform.position?.z ?? position.y * ROOM_WORLD_SIZE),
      hasTransform3d: Boolean(transform.position),
      render3d: render,
      bounds3d: bounds,
      exits: (room.exits || []).map(exit => ({
        id: exit.id,
        direction: exit.direction || '',
        label: exit.label || exit.id,
        locked: Boolean(exit.locked),
      })),
    };
  });

  const normalized = normalizeLayout(rooms);
  return {
    epoch: Number(overview?.world_epoch || 0),
    roomCount: Number(overview?.room_count || rooms.length),
    characterCount: Number(overview?.character_count || 0),
    width: normalized.width,
    height: normalized.height,
    rooms: normalized.rooms.map(room => ({
      ...room,
      worldX: room.hasTransform3d ? room.worldX : room.gridX * ROOM_WORLD_SIZE,
      worldZ: room.hasTransform3d ? room.worldZ : room.gridY * ROOM_WORLD_SIZE,
    })),
  };
}

export function roomEntities(roomProjection, snapshot = null) {
  const room = roomProjection?.room || {};
  const entities = roomProjection?.entities || room.entities || [];
  return entities.map((rawEntity, index) => {
    const entity = withSnapshot3d(rawEntity, snapshot);
    const transform = entity.transform3d || {};
    const render = entity.render3d || {};
    const position = entity.sprite?.position || {};
    const localX = transform.position ? Number(transform.position.x || 0) : (Number(position.x ?? ROOM_COORDINATE_SIZE / 2) - ROOM_COORDINATE_SIZE / 2) * ROOM_ENTITY_SCALE;
    const localY = transform.position ? Number(transform.position.y || 0) : 0;
    const localZ = transform.position ? Number(transform.position.z || 0) : (Number(position.y ?? ROOM_COORDINATE_SIZE / 2) - ROOM_COORDINATE_SIZE / 2) * ROOM_ENTITY_SCALE;
    return {
      id: entity.id,
      name: entity.name || render.label || entity.id,
      kind: entity.kind || 'other',
      isCharacter: Boolean(entity.is_character),
      localX,
      localY,
      localZ,
      layer: Number(entity.sprite?.layer || index),
      render3d: render,
      collider3d: entity.collider3d || null,
    };
  }).sort((a, b) => a.layer - b.layer || a.name.localeCompare(b.name));
}

export function roomSummary(layout, roomId) {
  return layout?.rooms?.find(room => room.id === roomId) || null;
}

export const WORLD_3D_CONSTANTS = { ROOM_WORLD_SIZE };
