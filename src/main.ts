import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { calcPorosity } from './sponge';
import './style.css';

interface Settings {
  level: number;
  spongeColor: string;
  bgColor: string;
  edgeColor: string;
  opacity: number;
  rotationSpeed: number;
  wireframe: boolean;
  autoRotate: boolean;
  showEdges: boolean;
  flatShading: boolean;
}

type NumericSettingKey = 'level' | 'opacity' | 'rotationSpeed';
type ColorSettingKey = 'spongeColor' | 'bgColor' | 'edgeColor';
type BooleanSettingKey = 'wireframe' | 'autoRotate' | 'showEdges' | 'flatShading';

const MAX_ITERATION_LEVEL = 5;
const DENSE_RENDER_LEVEL = 5;
const DENSE_CHUNK_GRID_SPAN = 27;
const MAX_INSTANCES_PER_CHUNK = 30000;
const QUALITY_UPSHIFT_FRAME_MS = 16.5;
const QUALITY_DOWNSHIFT_FRAME_MS = 22;
const QUALITY_SAMPLE_WINDOW = 45;

interface BuildResponse {
  requestId: number;
  positions: Float32Array;
  renderCount: number;
  totalCount: number;
  gridSize: number;
  mode: 'full' | 'surface';
  generationMs: number;
}

function mustGetElementById<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`Missing required element: ${id}`);
  }

  return element as T;
}

const canvas = mustGetElementById<HTMLCanvasElement>('three-canvas');
const viewport = mustGetElementById<HTMLElement>('viewport');
const statCubes = mustGetElementById<HTMLElement>('stat-cubes');
const statGrid = mustGetElementById<HTMLElement>('stat-grid');
const statPorosity = mustGetElementById<HTMLElement>('stat-porosity');
const settingsForm = mustGetElementById<HTMLFormElement>('settings-form');
const loadingOverlay = mustGetElementById<HTMLElement>('loading-overlay');
const loadingText = mustGetElementById<HTMLElement>('loading-text');
const generateButton = mustGetElementById<HTMLButtonElement>('generate-btn');
const generateButtonText = mustGetElementById<HTMLElement>('btn-text');
const generateButtonSpinner = mustGetElementById<HTMLElement>('btn-spinner');
const perfHud = document.createElement('div');
perfHud.id = 'perf-hud';
viewport.appendChild(perfHud);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(6, 4, 8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.autoRotate = true;
controls.autoRotateSpeed = 1;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(10, 15, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(1024, 1024);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 100;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0x8899ff, 0.4);
fillLight.position.set(-8, -4, -6);
scene.add(fillLight);

let spongeMeshes: Array<THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>> = [];
let edgeMeshes: Array<THREE.InstancedMesh<THREE.EdgesGeometry, THREE.LineBasicMaterial>> = [];
let spongeGeometry: THREE.BoxGeometry | null = null;
let spongeMaterial: THREE.MeshStandardMaterial | null = null;
let edgeGeometry: THREE.EdgesGeometry | null = null;
let edgeMaterial: THREE.LineBasicMaterial | null = null;
let activeWorker: Worker | null = null;
let activeBuildRequestId = 0;
let denseModeEnabled = false;
let pixelRatioCap = 2;
let frameSampleCount = 0;
let frameSampleTotalMs = 0;
let frameSampleMaxMs = 0;
let hudLastUpdateMs = 0;
let currentRenderMode: BuildResponse['mode'] = 'full';
let currentRenderCount = 0;
let currentTotalCount = 0;
let lastGenerationMs = 0;
let lastMeshMs = 0;
let lastFrameTimeMs = 0;

let settings: Settings = {
  level: 2,
  spongeColor: '#1e88e5',
  bgColor: '#0d0d1a',
  edgeColor: '#90caf9',
  opacity: 1,
  rotationSpeed: 1,
  wireframe: false,
  autoRotate: true,
  showEdges: true,
  flatShading: false,
};

function buildSponge(cfg: Settings): void {
  const requestId = ++activeBuildRequestId;

  if (activeWorker) {
    activeWorker.terminate();
    activeWorker = null;
  }

  setBusyState(true);
  const modeLabel = cfg.level >= DENSE_RENDER_LEVEL ? 'surface optimization' : 'full geometry';
  showLoading(true, `Precomputing level ${cfg.level} sponge (${modeLabel})...`);
  applyDenseRenderMode(cfg.level >= DENSE_RENDER_LEVEL);

  // Yield one frame so the loading overlay appears before build starts.
  window.requestAnimationFrame(() => {
    if (requestId !== activeBuildRequestId) {
      return;
    }

    const worker = new Worker(new URL('./sponge.worker.ts', import.meta.url), { type: 'module' });
    activeWorker = worker;

    worker.onmessage = (event: MessageEvent<BuildResponse>) => {
      const { requestId: completedId, positions, renderCount, totalCount, gridSize, mode, generationMs } =
        event.data;

      if (completedId !== activeBuildRequestId) {
        return;
      }

      const meshStart = performance.now();
      clearMeshes();
      createSpongeMesh(cfg, positions, renderCount, gridSize);
      const meshMs = performance.now() - meshStart;
      currentRenderMode = mode;
      currentRenderCount = renderCount;
      currentTotalCount = totalCount;
      lastGenerationMs = generationMs;
      lastMeshMs = meshMs;
      updatePerfHud(performance.now(), 0);

      statCubes.textContent =
        mode === 'full' ? totalCount.toLocaleString() : `${renderCount.toLocaleString()} / ${totalCount.toLocaleString()}`;
      statGrid.textContent = `${gridSize}^3`;
      statPorosity.textContent = `${(calcPorosity(cfg.level) * 100).toFixed(1)}%`;

      const half = 1.6;
      camera.position.set(half * 3.2, half * 2.2, half * 4.5);
      controls.target.set(0, 0, 0);
      controls.update();

      console.info(
        `[perf] level ${cfg.level} (${mode}): generation ${generationMs.toFixed(1)}ms, mesh build ${meshMs.toFixed(1)}ms, rendered ${renderCount.toLocaleString()} / ${totalCount.toLocaleString()}`,
      );

      setBusyState(false);
      showLoading(false);
      worker.terminate();

      if (activeWorker === worker) {
        activeWorker = null;
      }
    };

    worker.onerror = () => {
      if (requestId !== activeBuildRequestId) {
        return;
      }

      setBusyState(false);
      showLoading(false);
      worker.terminate();

      if (activeWorker === worker) {
        activeWorker = null;
      }
    };

    worker.postMessage({
      level: cfg.level,
      requestId,
    });
  });
}

function createSpongeMesh(cfg: Settings, positions: Float32Array, count: number, gridSize: number): void {
  const cubeSize = 3 / gridSize;
  const gap = cubeSize * 0.02;
  const boxSize = cubeSize - gap;
  const chunkedMode = cfg.level >= DENSE_RENDER_LEVEL;

  const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
  if (cfg.flatShading) {
    geometry.computeVertexNormals();
  }

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cfg.spongeColor),
    wireframe: cfg.wireframe,
    transparent: cfg.opacity < 1,
    opacity: cfg.opacity,
    flatShading: cfg.flatShading,
    roughness: 0.4,
    metalness: 0.1,
  });
  spongeGeometry = geometry;
  spongeMaterial = material;

  if (chunkedMode) {
    createChunkedSpongeMeshes(positions, count, gridSize, cubeSize, geometry, material);
  } else {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    writeTranslationMatrices(mesh.instanceMatrix.array as Float32Array, positions, cubeSize, count);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    spongeMeshes.push(mesh);
  }

  if (cfg.showEdges && !cfg.wireframe && cfg.level <= 3) {
    const currentEdgeGeometry = new THREE.EdgesGeometry(geometry);
    const currentEdgeMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(cfg.edgeColor),
      transparent: true,
      opacity: 0.35,
    });
    edgeGeometry = currentEdgeGeometry;
    edgeMaterial = currentEdgeMaterial;

    for (let i = 0; i < spongeMeshes.length; i += 1) {
      const sourceMesh = spongeMeshes[i];
      const edgeMesh = new THREE.InstancedMesh(currentEdgeGeometry, currentEdgeMaterial, sourceMesh.count);
      edgeMesh.instanceMatrix.array.set(sourceMesh.instanceMatrix.array);
      edgeMesh.instanceMatrix.needsUpdate = true;
      edgeMesh.computeBoundingSphere();
      scene.add(edgeMesh);
      edgeMeshes.push(edgeMesh);
    }
  }
}

function createChunkedSpongeMeshes(
  positions: Float32Array,
  count: number,
  gridSize: number,
  cubeSize: number,
  geometry: THREE.BoxGeometry,
  material: THREE.MeshStandardMaterial,
): void {
  const offset = (gridSize - 1) / 2;
  const chunkMap = new Map<string, number[]>();

  for (let i = 0; i < count; i += 1) {
    const base = i * 3;
    const ix = Math.floor((positions[base] + offset) / DENSE_CHUNK_GRID_SPAN);
    const iy = Math.floor((positions[base + 1] + offset) / DENSE_CHUNK_GRID_SPAN);
    const iz = Math.floor((positions[base + 2] + offset) / DENSE_CHUNK_GRID_SPAN);
    const key = `${ix}|${iy}|${iz}`;
    const chunk = chunkMap.get(key);

    if (chunk) {
      chunk.push(i);
    } else {
      chunkMap.set(key, [i]);
    }
  }

  for (const indices of chunkMap.values()) {
    for (let start = 0; start < indices.length; start += MAX_INSTANCES_PER_CHUNK) {
      const chunkCount = Math.min(MAX_INSTANCES_PER_CHUNK, indices.length - start);
      const mesh = new THREE.InstancedMesh(geometry, material, chunkCount);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      writeTranslationMatricesFromIndices(
        mesh.instanceMatrix.array as Float32Array,
        positions,
        cubeSize,
        indices,
        start,
        chunkCount,
      );
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
      spongeMeshes.push(mesh);
    }
  }
}

function writeTranslationMatrices(
  target: Float32Array,
  positions: Float32Array,
  cubeSize: number,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const positionBase = i * 3;
    const matrixBase = i * 16;

    target[matrixBase] = 1;
    target[matrixBase + 1] = 0;
    target[matrixBase + 2] = 0;
    target[matrixBase + 3] = 0;

    target[matrixBase + 4] = 0;
    target[matrixBase + 5] = 1;
    target[matrixBase + 6] = 0;
    target[matrixBase + 7] = 0;

    target[matrixBase + 8] = 0;
    target[matrixBase + 9] = 0;
    target[matrixBase + 10] = 1;
    target[matrixBase + 11] = 0;

    target[matrixBase + 12] = positions[positionBase] * cubeSize;
    target[matrixBase + 13] = positions[positionBase + 1] * cubeSize;
    target[matrixBase + 14] = positions[positionBase + 2] * cubeSize;
    target[matrixBase + 15] = 1;
  }
}

function writeTranslationMatricesFromIndices(
  target: Float32Array,
  positions: Float32Array,
  cubeSize: number,
  indices: number[],
  startIndex: number,
  count: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const sourceIndex = indices[startIndex + i] * 3;
    const matrixBase = i * 16;

    target[matrixBase] = 1;
    target[matrixBase + 1] = 0;
    target[matrixBase + 2] = 0;
    target[matrixBase + 3] = 0;

    target[matrixBase + 4] = 0;
    target[matrixBase + 5] = 1;
    target[matrixBase + 6] = 0;
    target[matrixBase + 7] = 0;

    target[matrixBase + 8] = 0;
    target[matrixBase + 9] = 0;
    target[matrixBase + 10] = 1;
    target[matrixBase + 11] = 0;

    target[matrixBase + 12] = positions[sourceIndex] * cubeSize;
    target[matrixBase + 13] = positions[sourceIndex + 1] * cubeSize;
    target[matrixBase + 14] = positions[sourceIndex + 2] * cubeSize;
    target[matrixBase + 15] = 1;
  }
}

function clearMeshes(): void {
  for (let i = 0; i < spongeMeshes.length; i += 1) {
    scene.remove(spongeMeshes[i]);
  }
  spongeMeshes = [];

  for (let i = 0; i < edgeMeshes.length; i += 1) {
    scene.remove(edgeMeshes[i]);
  }
  edgeMeshes = [];

  spongeGeometry?.dispose();
  spongeMaterial?.dispose();
  edgeGeometry?.dispose();
  edgeMaterial?.dispose();
  spongeGeometry = null;
  spongeMaterial = null;
  edgeGeometry = null;
  edgeMaterial = null;
}

function setBusyState(isBusy: boolean): void {
  generateButton.disabled = isBusy;
  generateButtonText.textContent = isBusy ? 'Generating...' : 'Generate Sponge';
  generateButtonSpinner.classList.toggle('hidden', !isBusy);
}

function applyPixelRatioCap(cap: number): void {
  pixelRatioCap = cap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
}

function applyDenseRenderMode(isDense: boolean): void {
  denseModeEnabled = isDense;
  applyPixelRatioCap(isDense ? 1 : 2);
  renderer.shadowMap.enabled = !isDense;
  dirLight.castShadow = !isDense;
  fillLight.visible = !isDense;
}

function updateAdaptiveQuality(avgFrameMs: number): void {
  if (!denseModeEnabled) {
    return;
  }

  if (avgFrameMs > QUALITY_DOWNSHIFT_FRAME_MS && pixelRatioCap > 0.75) {
    applyPixelRatioCap(0.75);
  }

  if (avgFrameMs < QUALITY_UPSHIFT_FRAME_MS && pixelRatioCap < 1) {
    applyPixelRatioCap(1);
  }
}

function updatePerfHud(now: number, frameMs: number): void {
  if (frameMs > 0) {
    frameSampleCount += 1;
    frameSampleTotalMs += frameMs;
    frameSampleMaxMs = Math.max(frameSampleMaxMs, frameMs);
  }

  if (frameSampleCount < QUALITY_SAMPLE_WINDOW || now - hudLastUpdateMs < 250) {
    return;
  }

  const avgMs = frameSampleTotalMs / frameSampleCount;
  const fps = avgMs > 0 ? 1000 / avgMs : 0;
  updateAdaptiveQuality(avgMs);

  perfHud.textContent = [
    `fps ${fps.toFixed(1)} | avg ${avgMs.toFixed(1)}ms | max ${frameSampleMaxMs.toFixed(1)}ms`,
    `render ${currentRenderCount.toLocaleString()} / ${currentTotalCount.toLocaleString()} | mode ${currentRenderMode}`,
    `chunks ${spongeMeshes.length} | gen ${lastGenerationMs.toFixed(1)}ms | mesh ${lastMeshMs.toFixed(1)}ms | px ${pixelRatioCap.toFixed(2)}`,
  ].join('\n');

  frameSampleCount = 0;
  frameSampleTotalMs = 0;
  frameSampleMaxMs = 0;
  hudLastUpdateMs = now;
}

function showLoading(show: boolean, message = 'Generating Menger Sponge...'): void {
  if (show) {
    loadingText.textContent = message;
  }

  loadingOverlay.classList.toggle('hidden', !show);
}

function applyLiveSettings(cfg: Settings): void {
  scene.background = new THREE.Color(cfg.bgColor);
  controls.autoRotate = cfg.autoRotate;
  controls.autoRotateSpeed = cfg.rotationSpeed * 2;

  if (spongeMaterial) {
    spongeMaterial.color.set(cfg.spongeColor);
    spongeMaterial.wireframe = cfg.wireframe;
    spongeMaterial.transparent = cfg.opacity < 1;
    spongeMaterial.opacity = cfg.opacity;
    spongeMaterial.flatShading = cfg.flatShading;
    spongeMaterial.needsUpdate = true;
  }

  if (edgeMaterial) {
    edgeMaterial.color.set(cfg.edgeColor);
  }
}

function bindSlider<K extends NumericSettingKey>(
  id: string,
  key: K,
  parse: (raw: string) => Settings[K],
  format?: (value: Settings[K]) => string,
): void {
  const input = mustGetElementById<HTMLInputElement>(id);
  const valueEl = document.getElementById(`${id}-value`);

  input.addEventListener('input', () => {
    const nextValue = parse(input.value);
    settings[key] = nextValue;

    if (valueEl) {
      valueEl.textContent = format ? format(nextValue) : String(nextValue);
    }

    applyLiveSettings(settings);
  });
}

function bindColor<K extends ColorSettingKey>(id: string, key: K): void {
  const input = mustGetElementById<HTMLInputElement>(id);
  const label = document.getElementById(`${id}-label`);

  input.addEventListener('input', () => {
    settings[key] = input.value;

    if (label) {
      label.textContent = input.value;
    }

    applyLiveSettings(settings);
  });
}

function bindCheckbox<K extends BooleanSettingKey>(id: string, key: K): void {
  const input = mustGetElementById<HTMLInputElement>(id);

  input.addEventListener('change', () => {
    settings[key] = input.checked;
    applyLiveSettings(settings);
  });
}

bindSlider(
  'level',
  'level',
  (raw) => Math.max(0, Math.min(MAX_ITERATION_LEVEL, Number.parseInt(raw, 10))),
  (value) => Math.round(value).toString(),
);
bindSlider('opacity', 'opacity', (raw) => Number.parseFloat(raw), (value) => value.toFixed(2));
bindSlider('rotationSpeed', 'rotationSpeed', (raw) => Number.parseFloat(raw), (value) => value.toFixed(1));
bindColor('spongeColor', 'spongeColor');
bindColor('bgColor', 'bgColor');
bindColor('edgeColor', 'edgeColor');
bindCheckbox('wireframe', 'wireframe');
bindCheckbox('autoRotate', 'autoRotate');
bindCheckbox('showEdges', 'showEdges');
bindCheckbox('flatShading', 'flatShading');

settingsForm.addEventListener('submit', (event: SubmitEvent) => {
  event.preventDefault();
  buildSponge(settings);
});

function onResize(): void {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener('resize', onResize);
onResize();

function animate(now = performance.now()): void {
  requestAnimationFrame(animate);
  const frameMs = lastFrameTimeMs > 0 ? now - lastFrameTimeMs : 0;
  lastFrameTimeMs = now;
  updatePerfHud(now, frameMs);
  controls.update();
  renderer.render(scene, camera);
}

animate();
applyLiveSettings(settings);
buildSponge(settings);
