import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { generateMengerSponge, calcPorosity } from './sponge.js';
import './style.css';

// ─── Scene Setup ──────────────────────────────────────────────────────────────

const canvas = document.getElementById('three-canvas');
const viewport = document.getElementById('viewport');

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
controls.autoRotateSpeed = 1.0;

// Lighting
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

// ─── State ───────────────────────────────────────────────────────────────────

let instancedMesh = null;
let edgesMesh = null;
const dummy = new THREE.Object3D();

// Current settings (defaults match the form)
let settings = {
  level: 2,
  spongeColor: '#1e88e5',
  bgColor: '#0d0d1a',
  edgeColor: '#90caf9',
  opacity: 1.0,
  rotationSpeed: 1.0,
  wireframe: false,
  autoRotate: true,
  showEdges: true,
  flatShading: false,
};

// ─── Sponge Builder ───────────────────────────────────────────────────────────

function buildSponge(cfg) {
  showLoading(true);

  // Use setTimeout so the loading overlay renders before blocking computation
  setTimeout(() => {
    // Remove old meshes
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

    // Cube size: scale so overall sponge always fits in a bounding box of ~3
    const cubeSize = 3 / gridSize;
    const gap = cubeSize * 0.02; // tiny gap between cubes for visual clarity
    const boxSize = cubeSize - gap;

    // Create instanced mesh
    const geo = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
    if (cfg.flatShading) {
      geo.computeVertexNormals();
    }

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(cfg.spongeColor),
      wireframe: cfg.wireframe,
      transparent: cfg.opacity < 1.0,
      opacity: cfg.opacity,
      flatShading: cfg.flatShading,
      roughness: 0.4,
      metalness: 0.1,
    });

    instancedMesh = new THREE.InstancedMesh(geo, mat, count);
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    for (let i = 0; i < count; i++) {
      const base = i * 3;
      dummy.position.set(
        positions[base]     * cubeSize,
        positions[base + 1] * cubeSize,
        positions[base + 2] * cubeSize,
      );
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(instancedMesh);

    // Edge lines (only for lower levels to avoid too many edges)
    if (cfg.showEdges && !cfg.wireframe && cfg.level <= 3) {
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: new THREE.Color(cfg.edgeColor),
        transparent: true,
        opacity: 0.35,
      });
      edgesMesh = new THREE.InstancedMesh(edgeGeo, edgeMat, count);
      for (let i = 0; i < count; i++) {
        instancedMesh.getMatrixAt(i, dummy.matrix);
        edgesMesh.setMatrixAt(i, dummy.matrix);
      }
      edgesMesh.instanceMatrix.needsUpdate = true;
      scene.add(edgesMesh);
    }

    // Update stats
    document.getElementById('stat-cubes').textContent = count.toLocaleString();
    document.getElementById('stat-grid').textContent = `${gridSize}³`;
    const porosity = (calcPorosity(cfg.level) * 100).toFixed(1);
    document.getElementById('stat-porosity').textContent = `${porosity}%`;

    // Fit camera
    const half = 1.6;
    camera.position.set(half * 3.2, half * 2.2, half * 4.5);
    controls.target.set(0, 0, 0);
    controls.update();

    showLoading(false);
  }, 20);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  overlay.classList.toggle('hidden', !show);
}

function applyLiveSettings(cfg) {
  // Background colour
  scene.background = new THREE.Color(cfg.bgColor);

  // Auto-rotate
  controls.autoRotate = cfg.autoRotate;
  controls.autoRotateSpeed = cfg.rotationSpeed * 2;

  // Material / edge updates without rebuilding geometry
  if (instancedMesh) {
    const mat = instancedMesh.material;
    mat.color.set(cfg.spongeColor);
    mat.wireframe = cfg.wireframe;
    mat.transparent = cfg.opacity < 1.0;
    mat.opacity = cfg.opacity;
    mat.flatShading = cfg.flatShading;
    mat.needsUpdate = true;
  }
  if (edgesMesh) {
    edgesMesh.material.color.set(cfg.edgeColor);
  }
}

// ─── Settings Form ────────────────────────────────────────────────────────────

function bindSlider(id, key, fmt) {
  const input = document.getElementById(id);
  const valueEl = document.getElementById(`${id}-value`);
  input.addEventListener('input', () => {
    settings[key] = parseFloat(input.value);
    if (valueEl) valueEl.textContent = fmt ? fmt(settings[key]) : settings[key];
    applyLiveSettings(settings);
  });
}

function bindColor(id, key) {
  const input = document.getElementById(id);
  const label = document.getElementById(`${id}-label`);
  input.addEventListener('input', () => {
    settings[key] = input.value;
    if (label) label.textContent = input.value;
    applyLiveSettings(settings);
  });
}

function bindCheckbox(id, key) {
  const input = document.getElementById(id);
  input.addEventListener('change', () => {
    settings[key] = input.checked;
    applyLiveSettings(settings);
  });
}

bindSlider('level', 'level', v => Math.round(v));
bindSlider('opacity', 'opacity', v => v.toFixed(2));
bindSlider('rotationSpeed', 'rotationSpeed', v => v.toFixed(1));
bindColor('spongeColor', 'spongeColor');
bindColor('bgColor', 'bgColor');
bindColor('edgeColor', 'edgeColor');
bindCheckbox('wireframe', 'wireframe');
bindCheckbox('autoRotate', 'autoRotate');
bindCheckbox('showEdges', 'showEdges');
bindCheckbox('flatShading', 'flatShading');

document.getElementById('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  buildSponge(settings);
});

// ─── Resize ───────────────────────────────────────────────────────────────────

function onResize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
onResize();

// ─── Animation Loop ───────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ─── Initial Render ───────────────────────────────────────────────────────────

applyLiveSettings(settings);
buildSponge(settings);
