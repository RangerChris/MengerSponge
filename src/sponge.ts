export interface MengerSpongeData {
  positions: Float32Array;
  count: number;
  gridSize: number;
}

const KEEP_OFFSETS: ReadonlyArray<readonly [number, number, number]> = (() => {
  const offsets: Array<[number, number, number]> = [];

  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 3; y += 1) {
      for (let z = 0; z < 3; z += 1) {
        const middleCount = (x === 1 ? 1 : 0) + (y === 1 ? 1 : 0) + (z === 1 ? 1 : 0);

        if (middleCount < 2) {
          offsets.push([x, y, z]);
        }
      }
    }
  }

  return offsets;
})();

export function isSolid(x: number, y: number, z: number, level: number): boolean {
  let currentX = x;
  let currentY = y;
  let currentZ = z;

  for (let i = 0; i < level; i += 1) {
    const lx = currentX % 3;
    const ly = currentY % 3;
    const lz = currentZ % 3;
    const middleCount = (lx === 1 ? 1 : 0) + (ly === 1 ? 1 : 0) + (lz === 1 ? 1 : 0);

    if (middleCount >= 2) {
      return false;
    }

    currentX = Math.floor(currentX / 3);
    currentY = Math.floor(currentY / 3);
    currentZ = Math.floor(currentZ / 3);
  }

  return true;
}

export function generateMengerSponge(level: number): MengerSpongeData {
  if (level === 0) {
    return {
      positions: new Float32Array([0, 0, 0]),
      count: 1,
      gridSize: 1,
    };
  }

  const gridSize = Math.pow(3, level);
  let coordinates = new Uint32Array([0, 0, 0]);
  let count = 1;

  for (let depth = 0; depth < level; depth += 1) {
    const nextCount = count * KEEP_OFFSETS.length;
    const nextCoordinates = new Uint32Array(nextCount * 3);
    let writeIndex = 0;

    for (let i = 0; i < count; i += 1) {
      const sourceBase = i * 3;
      const parentX = coordinates[sourceBase];
      const parentY = coordinates[sourceBase + 1];
      const parentZ = coordinates[sourceBase + 2];

      for (let j = 0; j < KEEP_OFFSETS.length; j += 1) {
        const [childX, childY, childZ] = KEEP_OFFSETS[j];
        nextCoordinates[writeIndex] = parentX * 3 + childX;
        nextCoordinates[writeIndex + 1] = parentY * 3 + childY;
        nextCoordinates[writeIndex + 2] = parentZ * 3 + childZ;
        writeIndex += 3;
      }
    }

    coordinates = nextCoordinates;
    count = nextCount;
  }

  const offset = (gridSize - 1) / 2;
  const positions = new Float32Array(count * 3);

  for (let i = 0; i < count; i += 1) {
    const base = i * 3;
    positions[base] = coordinates[base] - offset;
    positions[base + 1] = coordinates[base + 1] - offset;
    positions[base + 2] = coordinates[base + 2] - offset;
  }

  return {
    positions,
    count,
    gridSize,
  };
}

export function calcPorosity(level: number): number {
  if (level === 0) {
    return 0;
  }

  return 1 - Math.pow(20 / 27, level);
}
