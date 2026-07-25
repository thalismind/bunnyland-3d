import * as THREE from 'three';

type BoundarySide = 'north' | 'south' | 'west' | 'east';
type BoundaryStyle = 'hedge' | 'fence';

type BoundaryBounds = {
  ground: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

interface BoundaryPlacement {
  position: [number, number, number];
  scale: [number, number, number];
  rotationY: number;
}

const MAX_BOUNDARY_INSTANCES = 2048;

export function buildOutdoorBoundary(
  requestedStyle: BoundaryStyle | 'auto' | 'none',
  biome: string,
  exitSides: string[],
  boundaryColor: string | undefined,
  roomColor: number,
  bounds: BoundaryBounds,
  random: () => number,
): THREE.InstancedMesh | null {
  const style = requestedStyle === 'auto'
    ? ['forest', 'garden', 'marsh', 'meadow'].includes(biome) ? 'hedge' : 'fence'
    : requestedStyle;
  if (style === 'none') return null;
  const counts = new Map<BoundarySide, number>();
  const boundarySide = (value: string): BoundarySide => {
    if (value === 'north' || value === 'east' || value === 'south') return value;
    return 'west';
  };
  for (const value of exitSides) {
    const side = boundarySide(value);
    counts.set(side, (counts.get(side) || 0) + 1);
  }
  const openings = (side: BoundarySide): number[] => {
    const count = counts.get(side) || 0;
    const horizontal = side === 'north' || side === 'south';
    const min = horizontal ? bounds.minX : bounds.minZ;
    const max = horizontal ? bounds.maxX : bounds.maxZ;
    return Array.from({ length: count }, (_value, index) => (
      THREE.MathUtils.lerp(min + 1.2, max - 1.2, (index + 1) / (count + 1))
    ));
  };
  const segments = (
    side: BoundarySide,
    min: number,
    max: number,
  ): Array<[number, number]> => {
    const result: Array<[number, number]> = [];
    let cursor = min;
    for (const center of openings(side)) {
      const start = Math.max(min, center - 1.15);
      const end = Math.min(max, center + 1.15);
      if (start - cursor > 0.18) result.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (max - cursor > 0.18) result.push([cursor, max]);
    return result;
  };
  const placements: BoundaryPlacement[] = [];
  const addPlacement = (placement: BoundaryPlacement): void => {
    if (placements.length < MAX_BOUNDARY_INSTANCES) placements.push(placement);
  };
  const placeHedge = (
    side: BoundarySide,
    fixed: number,
    min: number,
    max: number,
    horizontal: boolean,
  ): void => {
    for (const [start, end] of segments(side, min, max)) {
      const count = Math.max(1, Math.ceil((end - start) / 0.76));
      for (
        let index = 0;
        index < count && placements.length < MAX_BOUNDARY_INSTANCES;
        index += 1
      ) {
        const axis = start + (index + 0.5) * (end - start) / count;
        addPlacement({
          position: horizontal
            ? [axis, bounds.ground + 0.38, fixed]
            : [fixed, bounds.ground + 0.38, axis],
          scale: horizontal ? [0.86, 0.68, 0.62] : [0.62, 0.68, 0.86],
          rotationY: horizontal ? 0 : Math.PI / 2,
        });
      }
    }
  };
  const placeFence = (
    side: BoundarySide,
    fixed: number,
    min: number,
    max: number,
    horizontal: boolean,
  ): void => {
    for (const [start, end] of segments(side, min, max)) {
      const length = end - start;
      const center = (start + end) / 2;
      for (const height of [0.42, 0.78]) {
        addPlacement({
          position: horizontal
            ? [center, bounds.ground + height, fixed]
            : [fixed, bounds.ground + height, center],
          scale: horizontal ? [length, 0.09, 0.1] : [0.1, 0.09, length],
          rotationY: 0,
        });
      }
      const postCount = Math.max(2, Math.ceil(length / 1.35) + 1);
      for (
        let index = 0;
        index < postCount && placements.length < MAX_BOUNDARY_INSTANCES;
        index += 1
      ) {
        const axis = start + index * length / (postCount - 1);
        addPlacement({
          position: horizontal
            ? [axis, bounds.ground + 0.5, fixed]
            : [fixed, bounds.ground + 0.5, axis],
          scale: [0.13, 1, 0.13],
          rotationY: 0,
        });
      }
    }
  };
  const placeSide = style === 'hedge' ? placeHedge : placeFence;
  placeSide('north', bounds.minZ, bounds.minX, bounds.maxX, true);
  placeSide('south', bounds.maxZ, bounds.minX, bounds.maxX, true);
  placeSide('west', bounds.minX, bounds.minZ, bounds.maxZ, false);
  placeSide('east', bounds.maxX, bounds.minZ, bounds.maxZ, false);
  if (!placements.length) return null;

  const geometry = style === 'hedge'
    ? new THREE.DodecahedronGeometry(0.5, 0)
    : new THREE.BoxGeometry(1, 1, 1);
  const fallbackColor = style === 'hedge'
    ? new THREE.Color(roomColor).multiplyScalar(0.72).getHex()
    : 0x74563a;
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: style === 'hedge' ? 0.91 : 0.86,
  });
  const boundary = new THREE.InstancedMesh(geometry, material, placements.length);
  boundary.name = 'outdoor-boundary';
  boundary.userData.boundaryStyle = style;
  boundary.userData.boundaryOpeningCount = exitSides.length;
  boundary.castShadow = true;
  boundary.receiveShadow = true;
  const baseColor = new THREE.Color(boundaryColor || fallbackColor);
  const transform = new THREE.Object3D();
  placements.forEach((placement, index) => {
    transform.position.set(...placement.position);
    transform.rotation.set(
      0,
      placement.rotationY
        + (style === 'hedge' ? (random() - 0.5) * 0.16 : 0),
      0,
    );
    transform.scale.set(...placement.scale);
    transform.updateMatrix();
    boundary.setMatrixAt(index, transform.matrix);
    boundary.setColorAt(
      index,
      baseColor.clone().multiplyScalar(0.92 + random() * 0.16),
    );
  });
  boundary.instanceMatrix.needsUpdate = true;
  if (boundary.instanceColor) boundary.instanceColor.needsUpdate = true;
  return boundary;
}
