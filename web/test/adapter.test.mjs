import assert from 'node:assert/strict';
import test from 'node:test';

import { layoutOverview, roomEntities, snapshot3d } from '../src/adapter.mjs';

test('adapter uses server-provided 3D transform and render data', () => {
  const layout = layoutOverview({
    world_epoch: 9,
    rooms: [
      {
        id: 'room:a',
        title: 'A',
        transform3d: { position: { x: 10, y: 1, z: 12 } },
        render3d: { color: '#ff0000', label: 'Room A' },
        exits: [{ id: 'room:b', direction: 'east' }],
      },
      { id: 'room:b', title: 'B', exits: [{ id: 'room:a', direction: 'west' }] },
    ],
  });

  assert.equal(layout.epoch, 9);
  assert.equal(layout.rooms[0].worldX, 10);
  assert.equal(layout.rooms[0].worldY, 1);
  assert.equal(layout.rooms[0].worldZ, 12);
  assert.equal(layout.rooms[0].render3d.color, '#ff0000');
  assert.equal(layout.rooms[1].gridX, layout.rooms[0].gridX + 1);
});

test('adapter converts room projection entities with transform3d fallback', () => {
  const entities = roomEntities({
    room: {
      entities: [
        {
          id: 'character:1',
          name: 'Bun',
          kind: 'character',
          is_character: true,
          transform3d: { position: { x: 1, y: 2, z: 3 } },
          render3d: { shape: 'sphere', color: '#89b4fa' },
        },
        {
          id: 'item:1',
          name: 'Lantern',
          kind: 'item',
          sprite: { position: { x: 75, y: 25 }, layer: 20 },
        },
      ],
    },
  });

  assert.deepEqual(
    entities.map(entity => [entity.id, entity.localX, entity.localY, entity.localZ]),
    [
      ['character:1', 1, 2, 3],
      ['item:1', 0.7000000000000001, 0, -0.7000000000000001],
    ],
  );
});

test('adapter overlays raw snapshot 3D components onto fixed projections', () => {
  const snapshot = snapshot3d({
    entities: [
      {
        id: 'room:a',
        components: {
          Transform3DComponent: { position: { x: 7, y: 0, z: 9 } },
          Render3DComponent: { color: '#4f6f9f' },
          RoomBounds3DComponent: { size: { x: 16, y: 4, z: 16 } },
        },
      },
      {
        id: 'character:1',
        components: {
          Transform3DComponent: { position: { x: -1, y: 0, z: 2 } },
          Render3DComponent: { shape: 'sphere', color: '#89b4fa' },
          Collider3DComponent: { shape: 'capsule' },
        },
      },
    ],
  });

  const layout = layoutOverview({ rooms: [{ id: 'room:a', title: 'A', exits: [] }] }, snapshot);
  const entities = roomEntities({
    room: {
      entities: [{ id: 'character:1', name: 'Iris', kind: 'character', is_character: true }],
    },
  }, snapshot);

  assert.equal(layout.rooms[0].worldX, 7);
  assert.equal(layout.rooms[0].worldZ, 9);
  assert.equal(layout.rooms[0].render3d.color, '#4f6f9f');
  assert.equal(entities[0].localX, -1);
  assert.equal(entities[0].localZ, 2);
  assert.equal(entities[0].render3d.shape, 'sphere');
  assert.equal(entities[0].collider3d.shape, 'capsule');
});
