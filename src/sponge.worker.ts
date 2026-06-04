/// <reference lib="webworker" />

import { generateMengerSponge } from './sponge';

interface BuildRequest {
  level: number;
  requestId: number;
}

interface BuildResponse {
  requestId: number;
  positions: Float32Array;
  renderCount: number;
  totalCount: number;
  gridSize: number;
  mode: 'full' | 'surface';
  generationMs: number;
}

const SURFACE_RENDER_LEVEL = 5;

function extractSurfacePositions(positions: Float32Array, gridSize: number): Float32Array {
  const occupancy = new Uint8Array(gridSize * gridSize * gridSize);
  const offset = (gridSize - 1) / 2;

  const flatIndex = (x: number, y: number, z: number): number => (x * gridSize + y) * gridSize + z;

  for (let i = 0; i < positions.length; i += 3) {
    const x = (positions[i] + offset) | 0;
    const y = (positions[i + 1] + offset) | 0;
    const z = (positions[i + 2] + offset) | 0;
    occupancy[flatIndex(x, y, z)] = 1;
  }

  const surfacePositions = new Float32Array(positions.length);
  let writeIndex = 0;

  for (let i = 0; i < positions.length; i += 3) {
    const x = (positions[i] + offset) | 0;
    const y = (positions[i + 1] + offset) | 0;
    const z = (positions[i + 2] + offset) | 0;

    const exposed =
      x === 0 ||
      x === gridSize - 1 ||
      y === 0 ||
      y === gridSize - 1 ||
      z === 0 ||
      z === gridSize - 1 ||
      occupancy[flatIndex(x - 1, y, z)] === 0 ||
      occupancy[flatIndex(x + 1, y, z)] === 0 ||
      occupancy[flatIndex(x, y - 1, z)] === 0 ||
      occupancy[flatIndex(x, y + 1, z)] === 0 ||
      occupancy[flatIndex(x, y, z - 1)] === 0 ||
      occupancy[flatIndex(x, y, z + 1)] === 0;

    if (!exposed) {
      continue;
    }

    surfacePositions[writeIndex] = positions[i];
    surfacePositions[writeIndex + 1] = positions[i + 1];
    surfacePositions[writeIndex + 2] = positions[i + 2];
    writeIndex += 3;
  }

  return surfacePositions.subarray(0, writeIndex);
}

self.onmessage = (event: MessageEvent<BuildRequest>) => {
  const { level, requestId } = event.data;
  const startedAt = performance.now();
  const result = generateMengerSponge(level);
  const useSurfaceMode = level >= SURFACE_RENDER_LEVEL;
  const renderPositions = useSurfaceMode ? extractSurfacePositions(result.positions, result.gridSize) : result.positions;
  const mode: BuildResponse['mode'] = useSurfaceMode ? 'surface' : 'full';
  const renderCount = renderPositions.length / 3;
  const generationMs = performance.now() - startedAt;

  const response: BuildResponse = {
    requestId,
    positions: renderPositions,
    renderCount,
    totalCount: result.count,
    gridSize: result.gridSize,
    mode,
    generationMs,
  };

  self.postMessage(response, [response.positions.buffer]);
};
