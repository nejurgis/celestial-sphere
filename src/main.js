import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeSkyState, computePlanetPath, computePositionCircle, PLANETS, PATH_WINDOW_DAYS } from './astro.js';
import { buildSkyGroup, buildPlanetPath, buildPositionCircle, SPHERE_RADIUS } from './scene.js';

const BODY_BY_KEY = Object.fromEntries(PLANETS.map(p => [p.key, p.body]));

// ── Renderer / scene / camera ────────────────────────────────────────────

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(SPHERE_RADIUS * 1.6, SPHERE_RADIUS * 1.1, SPHERE_RADIUS * 1.9);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = SPHERE_RADIUS * 1.2;
controls.maxDistance = SPHERE_RADIUS * 6;

scene.add(new THREE.AmbientLight(0xffffff, 1));

let skyGroup = null;

function resize() {
  const { clientWidth, clientHeight } = canvas.parentElement;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function rebuild() {
  const date = new Date(dateInput.value || Date.now());
  const latitude = parseFloat(latInput.value);
  const longitude = parseFloat(lonInput.value);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return;

  if (skyGroup) {
    scene.remove(skyGroup);
    skyGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (obj.material.map) obj.material.map.dispose();
        obj.material.dispose();
      }
    });
  }

  const state = computeSkyState(date, latitude, longitude, SPHERE_RADIUS);
  skyGroup = buildSkyGroup(state);

  const pathKey = pathSelect.value;
  if (pathKey) {
    const body = BODY_BY_KEY[pathKey];
    const windowDays = PATH_WINDOW_DAYS[pathKey] ?? 200;
    const path = computePlanetPath(body, date, state.observer, windowDays, SPHERE_RADIUS);
    skyGroup.add(buildPlanetPath(path, pathKey));

    const focusPlanet = state.planets.find(p => p.key === pathKey);
    const posCircle = computePositionCircle(focusPlanet.ra, date, state.observer, SPHERE_RADIUS);
    skyGroup.add(buildPositionCircle(posCircle, pathKey));
  }

  scene.add(skyGroup);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

// ── Controls panel ───────────────────────────────────────────────────────

const dateInput = document.getElementById('date-input');
const latInput = document.getElementById('lat-input');
const lonInput = document.getElementById('lon-input');
const nowBtn = document.getElementById('now-btn');
const pathSelect = document.getElementById('path-select');

function toLocalDatetimeValue(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

dateInput.value = toLocalDatetimeValue(new Date());
latInput.value = '54.68';   // Vilnius
lonInput.value = '25.28';

nowBtn.addEventListener('click', () => {
  dateInput.value = toLocalDatetimeValue(new Date());
  rebuild();
});
[dateInput, latInput, lonInput, pathSelect].forEach(el => el.addEventListener('change', rebuild));

resize();
rebuild();
animate();
