export interface MengerSpongeData {
  positions: Float32Array;
  count: number;
  gridSize: number;
}

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
  const gridSize = Math.pow(3, level);
  const maxCubes = Math.pow(20, level);
  const positions = new Float32Array(maxCubes * 3);
  let count = 0;

  const offset = (gridSize - 1) / 2;

  for (let x = 0; x < gridSize; x += 1) {
    for (let y = 0; y < gridSize; y += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        if (isSolid(x, y, z, level)) {
          const base = count * 3;
          positions[base] = x - offset;
          positions[base + 1] = y - offset;
          positions[base + 2] = z - offset;
          count += 1;
        }
      }
    }
  }

  return {
    positions: positions.subarray(0, count * 3),
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
