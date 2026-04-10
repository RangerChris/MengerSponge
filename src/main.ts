import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { calcPorosity, generateMengerSponge } from './sponge';
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

let instancedMesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null = null;
let edgesMesh: THREE.InstancedMesh<THREE.EdgesGeometry, THREE.LineBasicMaterial> | null = null;
const dummy = new THREE.Object3D();

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
  showLoading(true);

  // Let the loading overlay paint before heavy geometry generation.
  window.setTimeout(() => {
    if (instancedMesh) {
      scene.remove(instancedMesh);
      instancedMesh.geometry.dispose();
      instancedMesh.material.dispose();
      instancedMesh = null;
    }

    if (edgesMesh) {
      scene.remove(edgesMesh);
      edgesMesh.geometry.dispose();
      edgesMesh.material.dispose();
      edgesMesh = null;
    }

    const { positions, count, gridSize } = generateMengerSponge(cfg.level);

    const cubeSize = 3 / gridSize;
    const gap = cubeSize * 0.02;
    const boxSize = cubeSize - gap;

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

    instancedMesh = new THREE.InstancedMesh(geometry, material, count);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    for (let i = 0; i < count; i += 1) {
      const base = i * 3;
      dummy.position.set(
        positions[base] * cubeSize,
        positions[base + 1] * cubeSize,
        positions[base + 2] * cubeSize,
      );
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(instancedMesh);

    if (cfg.showEdges && !cfg.wireframe && cfg.level <= 3) {
      const edgeGeometry = new THREE.EdgesGeometry(geometry);
      const edgeMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(cfg.edgeColor),
        transparent: true,
        opacity: 0.35,
      });

      edgesMesh = new THREE.InstancedMesh(edgeGeometry, edgeMaterial, count);

      for (let i = 0; i < count; i += 1) {
        instancedMesh.getMatrixAt(i, dummy.matrix);
        edgesMesh.setMatrixAt(i, dummy.matrix);
      }

      edgesMesh.instanceMatrix.needsUpdate = true;
      scene.add(edgesMesh);
    }

    statCubes.textContent = count.toLocaleString();
    statGrid.textContent = `${gridSize}^3`;
    statPorosity.textContent = `${(calcPorosity(cfg.level) * 100).toFixed(1)}%`;

    const half = 1.6;
    camera.position.set(half * 3.2, half * 2.2, half * 4.5);
    controls.target.set(0, 0, 0);
    controls.update();

    showLoading(false);
  }, 20);
}

function showLoading(show: boolean): void {
  loadingOverlay.classList.toggle('hidden', !show);
}

function applyLiveSettings(cfg: Settings): void {
  scene.background = new THREE.Color(cfg.bgColor);
  controls.autoRotate = cfg.autoRotate;
  controls.autoRotateSpeed = cfg.rotationSpeed * 2;

  if (instancedMesh) {
    const material = instancedMesh.material;
    material.color.set(cfg.spongeColor);
    material.wireframe = cfg.wireframe;
    material.transparent = cfg.opacity < 1;
    material.opacity = cfg.opacity;
    material.flatShading = cfg.flatShading;
    material.needsUpdate = true;
  }

  if (edgesMesh) {
    edgesMesh.material.color.set(cfg.edgeColor);
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

bindSlider('level', 'level', (raw) => Number.parseInt(raw, 10), (value) => Math.round(value).toString());
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

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

animate();
applyLiveSettings(settings);
buildSponge(settings);
