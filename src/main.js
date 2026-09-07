import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  computeSkyState, computePlanetPath, computePositionCircle, computeDirection, computeZodiacBand,
  PLANETS, PATH_WINDOW_DAYS,
} from './astro.js';
import {
  buildSkyGroup, buildPlanetPath, buildPositionCircle, buildDirectionGroup, buildZodiacBand,
  DIRECTION_COLORS, SPHERE_RADIUS,
} from './scene.js';

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

// Primary-direction playback state.
let direction = null;
let directionYears = 0;
let isPlaying = false;
let playYearsPerSecond = 10;
let directionMarker = null; // { markerMesh, markerMaterial, label }

function resize() {
  const { clientWidth, clientHeight } = canvas.parentElement;
  renderer.setSize(clientWidth, clientHeight, false);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

function stopPlaying() {
  isPlaying = false;
  playBtn.textContent = '▶';
}

function updateReadout() {
  if (!direction) {
    readout.textContent = '—';
    directionPanel.classList.remove('hit');
    return;
  }
  const hit = directionYears >= direction.arcYears;
  directionPanel.classList.toggle('hit', hit);
  readout.textContent = hit
    ? `Reached — ${direction.arcYears.toFixed(1)} yrs${direction.swapped ? ' (converse)' : ''}`
    : `${directionYears.toFixed(1)} / ${direction.arcYears.toFixed(1)} yrs${direction.swapped ? ' (converse)' : ''}`;
}

function setDirectionYears(t) {
  if (!direction) return;
  directionYears = Math.max(0, Math.min(t, direction.arcYears));
  if (directionMarker) {
    directionMarker.markerMesh.position.set(...direction.directedXYZ(directionYears));
    directionMarker.label.position.copy(directionMarker.markerMesh.position).multiplyScalar(1.12);
    const hit = directionYears >= direction.arcYears;
    directionMarker.markerMaterial.color.set(hit ? DIRECTION_COLORS.hit : DIRECTION_COLORS.active);
    if (hit) stopPlaying();
  }
  slider.value = String(directionYears);
  updateReadout();
}

function rebuild() {
  const date = new Date(dateInput.value || Date.now());
  const latitude = parseFloat(latInput.value);
  const longitude = parseFloat(lonInput.value);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return;

  stopPlaying();

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

  const zodiacBand = computeZodiacBand(date, state.observer, SPHERE_RADIUS);
  skyGroup.add(buildZodiacBand(zodiacBand));

  const significatorKey = pathSelect.value;
  if (significatorKey) {
    const body = BODY_BY_KEY[significatorKey];
    const windowDays = PATH_WINDOW_DAYS[significatorKey] ?? 200;
    const path = computePlanetPath(body, date, state.observer, windowDays, SPHERE_RADIUS);
    skyGroup.add(buildPlanetPath(path, significatorKey));

    const focusPlanet = state.planets.find(p => p.key === significatorKey);
    const posCircle = computePositionCircle(focusPlanet.ra, date, state.observer, SPHERE_RADIUS);
    skyGroup.add(buildPositionCircle(posCircle, significatorKey));
  }

  const promissorKey = promissorSelect.value;
  direction = null;
  directionMarker = null;
  directionYears = 0;
  if (significatorKey && promissorKey && significatorKey !== promissorKey) {
    direction = computeDirection(
      { key: promissorKey, body: BODY_BY_KEY[promissorKey] },
      { key: significatorKey, body: BODY_BY_KEY[significatorKey] },
      date, state.observer, SPHERE_RADIUS,
    );
    const { group, markerMesh, markerMaterial, label } = buildDirectionGroup(direction, direction.movingKey, direction.fixedKey);
    skyGroup.add(group);
    directionMarker = { markerMesh, markerMaterial, label };
    slider.max = String(direction.arcYears);
    playYearsPerSecond = Math.max(1, direction.arcYears / 8);
  } else {
    slider.max = '1';
  }
  slider.value = '0';
  updateReadout();

  scene.add(skyGroup);
}

let lastFrameTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrameTime) / 1000, 0.25); // clamp to avoid a huge jump after a tab was backgrounded
  lastFrameTime = now;
  if (isPlaying && direction) {
    setDirectionYears(directionYears + dt * playYearsPerSecond);
  }
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

// ── Direction transport panel ────────────────────────────────────────────

const directionPanel = document.getElementById('direction-panel');
const promissorSelect = document.getElementById('promissor-select');
const playBtn = document.getElementById('dir-play');
const resetBtn = document.getElementById('dir-reset');
const endBtn = document.getElementById('dir-end');
const stepBackBtn = document.getElementById('dir-step-back');
const stepFwdBtn = document.getElementById('dir-step-fwd');
const stepSizeSelect = document.getElementById('dir-step-size');
const slider = document.getElementById('dir-slider');
const readout = document.getElementById('direction-readout');

promissorSelect.addEventListener('change', rebuild);

playBtn.addEventListener('click', () => {
  if (!direction) return;
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? '⏸' : '▶';
  if (isPlaying && directionYears >= direction.arcYears) setDirectionYears(0);
});

resetBtn.addEventListener('click', () => { stopPlaying(); setDirectionYears(0); });
endBtn.addEventListener('click', () => { stopPlaying(); if (direction) setDirectionYears(direction.arcYears); });
stepBackBtn.addEventListener('click', () => { stopPlaying(); setDirectionYears(directionYears - parseFloat(stepSizeSelect.value)); });
stepFwdBtn.addEventListener('click', () => { stopPlaying(); setDirectionYears(directionYears + parseFloat(stepSizeSelect.value)); });
slider.addEventListener('input', () => { stopPlaying(); setDirectionYears(parseFloat(slider.value)); });

resize();
rebuild();
animate();
