// ── scene.js ──────────────────────────────────────────────────────────────
// Builds the 3D celestial-sphere group from a computed sky state (astro.js).
// Local zenith = +Y, horizon = XZ plane, North = +Z, East = +X.

import * as THREE from 'three';
import { makeTextSprite } from './labels.js';

const RADIUS = 5;

const PLANET_COLOR = 0xd23b3b;
const EQUATOR_COLOR = 0x2f6fb0;
const ECLIPTIC_COLOR = 0x2f9e44;
const HORIZON_COLOR = 0xffffff;
const POLE_COLOR = 0x888888;
const MC_COLOR = 0x2f9e44;
const PATH_COLOR = 0xa8321e;
const POSITION_CIRCLE_COLOR = 0x8b5cf6;

function lineFromPoints(points, color, opts = {}) {
  const geom = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  );
  const material = opts.dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: opts.opacity ?? 1 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1 });
  const line = new THREE.Line(geom, material);
  if (opts.dashed) line.computeLineDistances();
  return line;
}

function buildSphere() {
  const group = new THREE.Group();

  // Upper hemisphere (sky) — thetaLength 0..PI/2 covers pole (+Y) to equator.
  const upperGeom = new THREE.SphereGeometry(RADIUS, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const upperMat = new THREE.MeshBasicMaterial({
    color: 0x8fd0e8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
  });
  group.add(new THREE.Mesh(upperGeom, upperMat));

  // Lower hemisphere (below horizon — "under their feet") — darker.
  const lowerGeom = new THREE.SphereGeometry(RADIUS, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const lowerMat = new THREE.MeshBasicMaterial({
    color: 0x1c2b3a, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false,
  });
  group.add(new THREE.Mesh(lowerGeom, lowerMat));

  return group;
}

function buildHorizonDisc() {
  const group = new THREE.Group();
  const geom = new THREE.CircleGeometry(RADIUS * 0.995, 96);
  const mat = new THREE.MeshBasicMaterial({
    color: HORIZON_COLOR, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
  });
  const disc = new THREE.Mesh(geom, mat);
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const compass = [
    { label: 'N', az: 0 }, { label: 'E', az: 90 }, { label: 'S', az: 180 }, { label: 'W', az: 270 },
  ];
  for (const { label, az } of compass) {
    const rad = (az * Math.PI) / 180;
    const x = RADIUS * 1.06 * Math.sin(rad);
    const z = RADIUS * 1.06 * Math.cos(rad);
    const sprite = makeTextSprite(label, { color: '#333', size: 44, scale: 0.32 });
    sprite.position.set(x, 0, z);
    group.add(sprite);

    // horizon spoke line, subtle
    group.add(lineFromPoints([[0, 0, 0], [x * 0.94, 0, z * 0.94]], 0x999999, { opacity: 0.35 }));
  }
  return group;
}

function buildGreatCircle(points, color, { labelEvery = 30, labelColor = '#555' } = {}) {
  const group = new THREE.Group();
  group.add(lineFromPoints(points.map(p => p.xyz), color, { opacity: 0.85 }));

  for (const p of points) {
    if (p.deg % labelEvery !== 0) continue;
    const [x, y, z] = p.xyz;
    const len = Math.hypot(x, y, z) || 1;
    const lx = (x / len) * (RADIUS * 1.03);
    const ly = (y / len) * (RADIUS * 1.03);
    const lz = (z / len) * (RADIUS * 1.03);
    const sprite = makeTextSprite(`${p.deg}°`, { color: labelColor, size: 30, scale: 0.2 });
    sprite.position.set(lx, ly, lz);
    group.add(sprite);
  }
  return group;
}

function buildPoleAxis(poleXYZ) {
  const group = new THREE.Group();
  const dir = new THREE.Vector3(...poleXYZ).normalize();
  const far = dir.clone().multiplyScalar(RADIUS * 1.4);
  const nearOpposite = dir.clone().multiplyScalar(-RADIUS * 1.15);
  group.add(lineFromPoints([[nearOpposite.x, nearOpposite.y, nearOpposite.z], [far.x, far.y, far.z]], POLE_COLOR, { dashed: true, opacity: 0.6 }));

  const label = makeTextSprite('P', { color: '#666', size: 34, scale: 0.22 });
  label.position.copy(far).multiplyScalar(1.05);
  group.add(label);
  return group;
}

function buildPlanets(planets) {
  const group = new THREE.Group();
  const geom = new THREE.SphereGeometry(0.09, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: PLANET_COLOR });

  for (const p of planets) {
    const [x, y, z] = p.xyz;
    const marker = new THREE.Mesh(geom, mat);
    marker.position.set(x, y, z);
    group.add(marker);

    const label = makeTextSprite(p.key, { color: '#b02a2a', size: 34, weight: '700', scale: 0.24 });
    const len = Math.hypot(x, y, z) || 1;
    label.position.set((x / len) * 1.12 * len, (y / len) * 1.12 * len + 0.22, (z / len) * 1.12 * len);
    group.add(label);
  }
  return group;
}

function buildMidheaven(mc) {
  const group = new THREE.Group();
  const geom = new THREE.SphereGeometry(0.08, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: MC_COLOR });
  const marker = new THREE.Mesh(geom, mat);
  marker.position.set(...mc.xyz);
  group.add(marker);

  const label = makeTextSprite('MP', { color: '#2f9e44', size: 32, weight: '700', scale: 0.22 });
  label.position.set(mc.xyz[0] * 1.1, mc.xyz[1] * 1.1 + 0.2, mc.xyz[2] * 1.1);
  group.add(label);
  return group;
}

export function buildPlanetPath(pathResult, planetKey) {
  const group = new THREE.Group();
  group.add(lineFromPoints(pathResult.points.map(p => p.xyz), PATH_COLOR, { opacity: 0.75 }));

  // Marks the peak of the loop — the planet's maximum celestial latitude
  // over the sampled window — matching the reference image's dashed
  // max-latitude marker (a single point label here rather than a full
  // small-circle sweep, kept simple for v1).
  const peak = pathResult.maxLat;
  const markerGeom = new THREE.SphereGeometry(0.05, 12, 12);
  const markerMat = new THREE.MeshBasicMaterial({ color: PATH_COLOR });
  const marker = new THREE.Mesh(markerGeom, markerMat);
  marker.position.set(...peak.xyz);
  group.add(marker);

  const label = makeTextSprite(`${planetKey} max lat ${peak.elat.toFixed(1)}°`, {
    color: '#a8321e', size: 26, scale: 0.18,
  });
  label.position.set(peak.xyz[0] * 1.08, peak.xyz[1] * 1.08 + 0.15, peak.xyz[2] * 1.08);
  group.add(label);

  return group;
}

export function buildPositionCircle(result, planetKey) {
  const group = new THREE.Group();
  group.add(lineFromPoints(result.points, POSITION_CIRCLE_COLOR, { opacity: 0.55 }));

  const geom = new THREE.SphereGeometry(0.06, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: POSITION_CIRCLE_COLOR });
  const marker = new THREE.Mesh(geom, mat);
  marker.position.set(...result.mundaneXYZ);
  group.add(marker);

  const label = makeTextSprite(`${planetKey} mundane pos.`, { color: '#8b5cf6', size: 26, scale: 0.18 });
  const [x, y, z] = result.mundaneXYZ;
  label.position.set(x * 1.08, y * 1.08 + 0.15, z * 1.08);
  group.add(label);

  return group;
}

export function buildSkyGroup(state) {
  const group = new THREE.Group();
  group.add(buildSphere());
  group.add(buildHorizonDisc());
  group.add(buildGreatCircle(state.equatorPoints, EQUATOR_COLOR, { labelColor: '#2f6fb0' }));
  group.add(buildGreatCircle(state.eclipticPoints, ECLIPTIC_COLOR, { labelColor: '#2f9e44' }));
  group.add(buildPoleAxis(state.poleXYZ));
  group.add(buildPlanets(state.planets));
  group.add(buildMidheaven(state.mc));
  return group;
}

export const SPHERE_RADIUS = RADIUS;
