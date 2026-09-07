import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  computeSkyState, computePlanetPath, computePositionCircle, computeDirection, computeZodiacBand,
  computeAspectPlane, computeAspectPoint, siderealRotatedDate, horizonOf, altAzToXYZ,
  NAIBOD_DEG_PER_YEAR, PLANETS, PATH_WINDOW_DAYS,
} from './astro.js';
import {
  buildSkyGroup, buildPlanetPath, buildPositionCircle, buildDirectionGroup, buildZodiacBand,
  buildAspectPlane, DIRECTION_COLORS, SPHERE_RADIUS,
} from './scene.js';

const BODY_BY_KEY = Object.fromEntries(PLANETS.map(p => [p.key, p.body]));
const ANGLE_KEYS = ['ASC', 'DSC', 'MC', 'IC'];
const ASPECT_GLYPHS = { 0: '☌', 60: '⚹', 90: '□', 120: '△', 180: '☍' };

// Resolves a dropdown key to a direction-capable point: a real planet
// ({key, body}) or one of the four angles ({key, ra, dec}, pulled from the
// already-computed sky state — angles aren't astronomy-engine bodies).
function resolveDirectionPoint(key, state) {
  if (BODY_BY_KEY[key]) return { key, body: BODY_BY_KEY[key] };
  const angle = { ASC: state.asc, DSC: state.dsc, MC: state.mc, IC: state.ic }[key];
  return angle ? { key, ra: angle.ra, dec: angle.dec } : null;
}

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
let rotatables = { planetMarkers: [], eclipticLine: null, eclipticLabels: [], eclipticPoints: [] };
let natalDate = null;
let natalObserver = null;

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

const legendRows = document.querySelectorAll('#legend [data-layer]');

function updateLegend(layers, significatorKey, promissorKey) {
  const significatorIsBody = !!(significatorKey && BODY_BY_KEY[significatorKey]);
  const visible = {
    ...layers,
    path: significatorIsBody,
    positionCircle: !!significatorKey,
    aspectPlane: layers.aspectPlane && significatorIsBody,
    direction: !!(significatorKey && promissorKey && significatorKey !== promissorKey),
  };
  legendRows.forEach(row => { row.hidden = !visible[row.dataset.layer]; });
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
    ? `Directional arc reached — ${direction.arcYears.toFixed(1)} yrs${direction.swapped ? ' (converse)' : ''}`
    : `Directional arc: ${directionYears.toFixed(1)} / ${direction.arcYears.toFixed(1)} yrs${direction.swapped ? ' (converse)' : ''}`;
}

// Reprojects the natal sky (planets + ecliptic) through a later sidereal
// moment — same natal RA/Dec throughout, only the horizon-viewing time
// changes — so the whole sky visibly turns during playback, matching how
// the source material describes primary motion (the entire celestial
// sphere rotating, not one marker creeping across a static backdrop).
// Position circle, aspect plane, angles, zodiac band and horizon/pole stay
// as drawn at t=0 — this is the natal "imprint," fixed relative to the
// horizon by definition (see the position-circle comment in astro.js).
function reprojectRotatables(rotationDeg) {
  if (!natalObserver) return;
  const fakeDate = siderealRotatedDate(natalDate, rotationDeg);
  const reposition = (raHours, decDeg) => {
    const { azimuth, altitude } = horizonOf(fakeDate, natalObserver, raHours, decDeg);
    return altAzToXYZ(altitude, azimuth, SPHERE_RADIUS);
  };

  for (const m of rotatables.planetMarkers) {
    const [x, y, z] = reposition(m.ra, m.dec);
    m.mesh.position.set(x, y, z);
    const len = Math.hypot(x, y, z) || 1;
    m.label.position.set((x / len) * 1.12 * len, (y / len) * 1.12 * len + 0.22, (z / len) * 1.12 * len);
  }

  if (rotatables.eclipticLine && rotatables.eclipticPoints.length) {
    const posAttr = rotatables.eclipticLine.geometry.attributes.position;
    rotatables.eclipticPoints.forEach((p, i) => {
      const [x, y, z] = reposition(p.ra, p.dec);
      posAttr.setXYZ(i, x, y, z);
    });
    posAttr.needsUpdate = true;
  }
  for (const l of rotatables.eclipticLabels) {
    const [x, y, z] = reposition(l.ra, l.dec);
    const len = Math.hypot(x, y, z) || 1;
    l.sprite.position.set((x / len) * (SPHERE_RADIUS * 1.03), (y / len) * (SPHERE_RADIUS * 1.03), (z / len) * (SPHERE_RADIUS * 1.03));
  }
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
  reprojectRotatables(directionYears * NAIBOD_DEG_PER_YEAR);
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

  const layers = readLayerCheckboxes();

  natalDate = date;
  const state = computeSkyState(date, latitude, longitude, SPHERE_RADIUS);
  natalObserver = state.observer;
  const built = buildSkyGroup(state, layers);
  skyGroup = built.group;
  rotatables = built.rotatables;

  if (layers.zodiacBand || layers.zodiacNames) {
    const zodiacBand = computeZodiacBand(date, state.observer, SPHERE_RADIUS);
    skyGroup.add(buildZodiacBand(zodiacBand, { band: layers.zodiacBand, names: layers.zodiacNames }));
  }

  const significatorKey = pathSelect.value;
  if (significatorKey) {
    // Real motion path only makes sense for an actual orbiting body — angles
    // (ASC/DSC/MC/IC) aren't astronomy-engine bodies and have no loop of
    // their own, so skip that part for them but still show a position circle.
    if (BODY_BY_KEY[significatorKey]) {
      const body = BODY_BY_KEY[significatorKey];
      const windowDays = PATH_WINDOW_DAYS[significatorKey] ?? 200;
      const path = computePlanetPath(body, date, state.observer, windowDays, SPHERE_RADIUS);
      skyGroup.add(buildPlanetPath(path, significatorKey));

      if (layers.aspectPlane) {
        const aspectPlane = computeAspectPlane(body, date, state.observer, SPHERE_RADIUS);
        skyGroup.add(buildAspectPlane(aspectPlane, significatorKey));
      }
    }

    const significatorPoint = resolveDirectionPoint(significatorKey, state);
    if (significatorPoint) {
      const eq = significatorPoint.body ? state.planets.find(p => p.key === significatorKey) : significatorPoint;
      const posCircle = computePositionCircle(eq.ra, date, state.observer, SPHERE_RADIUS);
      skyGroup.add(buildPositionCircle(posCircle, significatorKey));
    }
  }

  const promissorKey = promissorSelect.value;
  const aspectDeg = parseFloat(aspectSelect.value) * parseFloat(aspectDirectionSelect.value);
  direction = null;
  directionMarker = null;
  directionYears = 0;
  if (significatorKey && promissorKey && significatorKey !== promissorKey) {
    let promissorPoint = resolveDirectionPoint(promissorKey, state);

    // A non-conjunction aspect is cast IN THE PROMISSOR'S ASPECT PLANE, not
    // the ecliptic — that's the whole point of the Morinus construction.
    // Only meaningful for a real body (angles sit at elat=0, so their
    // "aspect plane" would just be the ecliptic itself).
    if (aspectDeg !== 0 && BODY_BY_KEY[promissorKey]) {
      const promissorAspectPlane = computeAspectPlane(BODY_BY_KEY[promissorKey], date, state.observer, SPHERE_RADIUS);
      if (layers.aspectPlane) skyGroup.add(buildAspectPlane(promissorAspectPlane, promissorKey));
      const aspectPoint = computeAspectPoint(promissorAspectPlane, aspectDeg);
      promissorPoint = { key: `${promissorKey} ${ASPECT_GLYPHS[aspectSelect.value]}`, ra: aspectPoint.ra, dec: aspectPoint.dec };
    }

    direction = computeDirection(
      promissorPoint,
      resolveDirectionPoint(significatorKey, state),
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
  updateLegend(layers, significatorKey, promissorKey);

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

const LAYER_IDS = ['equator', 'ecliptic', 'planets', 'zodiacBand', 'zodiacNames', 'angles', 'degrees', 'aspectPlane'];
const layerCheckboxes = Object.fromEntries(LAYER_IDS.map(id => [id, document.getElementById(`layer-${id}`)]));

function readLayerCheckboxes() {
  return Object.fromEntries(LAYER_IDS.map(id => [id, layerCheckboxes[id].checked]));
}

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
[dateInput, latInput, lonInput, pathSelect, ...Object.values(layerCheckboxes)].forEach(el => el.addEventListener('change', rebuild));

// ── Direction transport panel ────────────────────────────────────────────

const directionPanel = document.getElementById('direction-panel');
const promissorSelect = document.getElementById('promissor-select');
const aspectSelect = document.getElementById('aspect-select');
const aspectDirectionSelect = document.getElementById('aspect-direction-select');
const playBtn = document.getElementById('dir-play');
const resetBtn = document.getElementById('dir-reset');
const endBtn = document.getElementById('dir-end');
const stepBackBtn = document.getElementById('dir-step-back');
const stepFwdBtn = document.getElementById('dir-step-fwd');
const stepSizeSelect = document.getElementById('dir-step-size');
const slider = document.getElementById('dir-slider');
const readout = document.getElementById('direction-readout');

[promissorSelect, aspectSelect, aspectDirectionSelect].forEach(el => el.addEventListener('change', rebuild));

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
