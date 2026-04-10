/**
 * Menger Sponge generation algorithm.
 *
 * A Menger Sponge is a three-dimensional fractal solid. Starting from a solid cube, at each
 * iteration the cube is divided into 27 equal sub-cubes (3×3×3) and the 7
 * sub-cubes that form the central cross on each axis are removed, leaving 20
 * sub-cubes. The process is repeated recursively on each remaining sub-cube.
 *
 * At iteration n:
 *   - Grid size: 3^n × 3^n × 3^n
 *   - Solid cubes: 20^n
 *   - Total fraction remaining: (20/27)^n
 */

/**
 * Returns true if the unit cube at integer grid position (x, y, z) is solid
 * in a Menger Sponge of the given iteration level.
 *
 * Uses base-3 digit inspection: at every hierarchical level a cube is hollow
 * if two or more of its coordinate digits equal 1 (the "middle" position).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} level - Iteration depth (0 = solid cube)
 * @returns {boolean}
 */
export function isSolid(x, y, z, level) {
  for (let i = 0; i < level; i++) {
    const lx = x % 3;
    const ly = y % 3;
    const lz = z % 3;
    const middleCount = (lx === 1 ? 1 : 0) + (ly === 1 ? 1 : 0) + (lz === 1 ? 1 : 0);
    if (middleCount >= 2) return false;
    x = Math.floor(x / 3);
    y = Math.floor(y / 3);
    z = Math.floor(z / 3);
  }
  return true;
}

/**
 * Generate all solid cube positions for a Menger Sponge at the given level.
 *
 * Each returned position is in the integer grid [0, 3^level).
 * Positions are centred at (0, 0, 0) so that the sponge sits at the origin.
 *
 * @param {number} level - Iteration depth (0-4 recommended)
 * @returns {{ positions: Float32Array, count: number, gridSize: number }}
 */
export function generateMengerSponge(level) {
  const gridSize = Math.pow(3, level);
  const maxCubes = Math.pow(20, level); // exact count at each level

  // Pre-allocate: 3 floats (x, y, z) per cube, in world-space centred coords.
  // We over-allocate based on the maximum possible and trim afterwards.
  const positions = new Float32Array(maxCubes * 3);
  let count = 0;

  const offset = (gridSize - 1) / 2; // centre the sponge at origin

  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      for (let z = 0; z < gridSize; z++) {
        if (isSolid(x, y, z, level)) {
          const base = count * 3;
          positions[base]     = x - offset;
          positions[base + 1] = y - offset;
          positions[base + 2] = z - offset;
          count++;
        }
      }
    }
  }

  return { positions: positions.subarray(0, count * 3), count, gridSize };
}

/**
 * Calculate the theoretical porosity of a Menger Sponge.
 * Porosity = fraction of space that is hollow.
 *
 * @param {number} level
 * @returns {number} value in [0, 1]
 */
export function calcPorosity(level) {
  if (level === 0) return 0;
  return 1 - Math.pow(20 / 27, level);
}
