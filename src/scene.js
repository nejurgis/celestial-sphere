// ── scene.js ──────────────────────────────────────────────────────────────
// Builds the 3D celestial-sphere group from a computed sky state (astro.js).
// Local zenith = +Y, horizon = XZ plane, North = +Z, East = +X.

import * as THREE from 'three';
import { makeTextSprite } from './labels.js';
import { formatEclipticDegree } from './astro.js';

const RADIUS = 5;

const PLANET_COLOR = 0xd23b3b;
const EQUATOR_COLOR = 0x2f6fb0;
const ECLIPTIC_COLOR = 0x2f9e44;
const HORIZON_COLOR = 0xffffff;
const POLE_COLOR = 0x888888;
const MERIDIAN_AXIS_COLOR = 0xd4a017;   // MC / IC
const HORIZON_AXIS_COLOR = 0x0e8a94;    // ASC / DSC
const PATH_COLOR = 0xa8321e;
const POSITION_CIRCLE_COLOR = 0x8b5cf6;
const DIRECTION_COLOR = 0xe08a1e;
const DIRECTION_HIT_COLOR = 0x22c55e;
const ELEMENT_COLORS = { fire: 0xd9633b, earth: 0x7c9a52, air: 0xe0bd4a, water: 0x4a90b8 };
const ASPECT_PLANE_COLOR = 0xd4c419; // yellow, matching the source material's own color choice

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

// THREE.Line's linewidth is ignored on most platforms (a long-standing WebGL
// limitation) — a real, camera-consistent thick line needs actual 3D tube
// geometry instead.
function tubeFromPoints(points, color, opts = {}) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    true,
  );
  const geom = new THREE.TubeGeometry(curve, points.length * 2, opts.radius ?? 0.025, 8, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1 });
  return new THREE.Mesh(geom, mat);
}

// innerPts/outerPts: [{ ra, dec, xyz }] — ra/dec kept on the geometry
// even though only xyz is drawn, so the ribbon can be reprojected in place
// (same technique as the ecliptic line) during direction playback.
function buildRibbon(innerPts, outerPts, color, opacity = 0.5) {
  const n = innerPts.length;
  const positions = [];
  for (let i = 0; i < n; i++) {
    positions.push(...innerPts[i].xyz, ...outerPts[i].xyz);
  }
  const indices = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
    indices.push(a, b, c, b, d, c);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  return new THREE.Mesh(geom, mat);
}

// band controls the ribbon AND its glyph together (glyph is meaningless
// without the band it sits on); names is the sign-name text, independent.
//
// Returns { group, segments } — segments = [{ ribbonMesh, innerPts, outerPts,
// glyphSprite, midRa, midDec, nameSprite? }], letting the whole band be
// reprojected in place (same technique as planets/ecliptic) so it stays
// visually glued to the planets during direction playback instead of
// looking detached from them (the band is ecliptic content, same as the
// planets — only the horizon-fixed natal imprint lines, position circle
// and aspect plane, are meant to stay behind as the sky turns).
export function buildZodiacBand(segments, { band = true, names = true } = {}) {
  const group = new THREE.Group();
  const rotatableSegments = [];
  for (const seg of segments) {
    const [x, y, z] = seg.midXYZ;
    const len = Math.hypot(x, y, z) || 1;
    const dir = [x / len, y / len, z / len];
    const entry = { midRa: seg.midRa, midDec: seg.midDec, innerPts: seg.inner, outerPts: seg.outer };

    if (band) {
      const color = ELEMENT_COLORS[seg.element];
      const ribbonMesh = buildRibbon(seg.inner, seg.outer, color, 0.5);
      group.add(ribbonMesh);
      entry.ribbonMesh = ribbonMesh;

      // ︎ (text-presentation variation selector) stops canvas fillText from
      // falling back to Apple Color Emoji for these codepoints — the same
      // U+2648-2653 range Radio-Venus uses directly with no special handling,
      // since normal DOM text doesn't hit that fallback.
      const glyph = makeTextSprite(`${seg.glyph}︎`, { color: '#2a2a2a', size: 64, weight: '700', scale: 0.55 });
      glyph.position.set(dir[0] * (RADIUS * 1.01), dir[1] * (RADIUS * 1.01), dir[2] * (RADIUS * 1.01));
      group.add(glyph);
      entry.glyphSprite = glyph;
    }

    if (names) {
      const nameLabel = makeTextSprite(seg.name, { color: '#3a3a3a', size: 24, weight: '600', scale: 0.16 });
      nameLabel.position.set(dir[0] * (RADIUS * 1.16), dir[1] * (RADIUS * 1.16) - 0.15, dir[2] * (RADIUS * 1.16));
      group.add(nameLabel);
      entry.nameSprite = nameLabel;
    }
    rotatableSegments.push(entry);
  }
  return { group, segments: rotatableSegments };
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

// Returns { group, line, labels } — line's geometry position buffer and
// each label's sprite can be updated in place (during direction playback,
// e.g.) without rebuilding anything.
function buildGreatCircle(points, color, { labelEvery = 30, labelColor = '#555' } = {}) {
  const group = new THREE.Group();
  const line = lineFromPoints(points.map(p => p.xyz), color, { opacity: 0.85 });
  group.add(line);

  const labels = [];
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
    labels.push({ deg: p.deg, ra: p.ra, dec: p.dec, sprite });
  }
  return { group, line, labels, points };
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

// Returns { group, markers } — markers = [{ key, mesh, label }], each
// repositionable in place during direction playback.
function buildPlanets(planets, showDegrees) {
  const group = new THREE.Group();
  const geom = new THREE.SphereGeometry(0.09, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: PLANET_COLOR });
  const markers = [];

  for (const p of planets) {
    const [x, y, z] = p.xyz;
    const marker = new THREE.Mesh(geom, mat);
    marker.position.set(x, y, z);
    group.add(marker);

    const text = showDegrees ? `${p.key} ${formatEclipticDegree(p.elon)}` : p.key;
    const label = makeTextSprite(text, { color: '#b02a2a', size: 34, weight: '700', scale: 0.24 });
    const len = Math.hypot(x, y, z) || 1;
    label.position.set((x / len) * 1.12 * len, (y / len) * 1.12 * len + 0.22, (z / len) * 1.12 * len);
    group.add(label);

    markers.push({ key: p.key, ra: p.ra, dec: p.dec, mesh: marker, label });
  }
  return { group, markers };
}

function buildAngleMarker(point, label, color, hexColor, showDegrees) {
  const group = new THREE.Group();
  const geom = new THREE.SphereGeometry(0.08, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color });
  const marker = new THREE.Mesh(geom, mat);
  marker.position.set(...point.xyz);
  group.add(marker);

  const labelText = showDegrees ? `${label} ${formatEclipticDegree(point.deg)}` : label;
  const text = makeTextSprite(labelText, { color: hexColor, size: 32, weight: '700', scale: 0.22 });
  text.position.set(point.xyz[0] * 1.1, point.xyz[1] * 1.1 + 0.2, point.xyz[2] * 1.1);
  group.add(text);
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
  group.add(tubeFromPoints(result.points, POSITION_CIRCLE_COLOR, { opacity: 0.6, radius: 0.03 }));

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

// Morinus's plane of aspects — a great circle through the planet, inclined
// to the ecliptic by its current-swing maximum latitude.
export function buildAspectPlane(result, planetKey) {
  const group = new THREE.Group();
  group.add(tubeFromPoints(result.points, ASPECT_PLANE_COLOR, { opacity: 0.65, radius: 0.035 }));

  const label = makeTextSprite(`${planetKey} aspect plane (${result.inclinationDeg.toFixed(1)}°)`, {
    color: '#a89419', size: 24, scale: 0.17,
  });
  // Place the label near the planet's own point on the circle, not the peak —
  // the circle is symmetric so there's no single obvious "far" point to avoid.
  const idx = Math.round(result.points.length * 0.08);
  const p = result.points[idx];
  label.position.set(p[0] * 1.08, p[1] * 1.08 + 0.15, p[2] * 1.08);
  group.add(label);

  return group;
}

// Returns { group, markerMesh, markerMaterial, label } — main.js repositions
// markerMesh and swaps markerMaterial.color every animation frame without
// touching the rest of the scene.
export function buildDirectionGroup(direction, movingLabel, fixedLabel) {
  const group = new THREE.Group();

  group.add(lineFromPoints(direction.sweepPoints, DIRECTION_COLOR, { dashed: true, opacity: 0.7 }));

  const markerMaterial = new THREE.MeshBasicMaterial({ color: DIRECTION_COLOR });
  const markerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), markerMaterial);
  markerMesh.position.set(...direction.directedXYZ(0));
  group.add(markerMesh);

  const label = makeTextSprite(`${movingLabel} → ${fixedLabel}`, { color: '#e08a1e', size: 28, weight: '700', scale: 0.2 });
  label.position.copy(markerMesh.position).multiplyScalar(1.12);
  group.add(label);

  return { group, markerMesh, markerMaterial, label };
}

export const DIRECTION_COLORS = { active: DIRECTION_COLOR, hit: DIRECTION_HIT_COLOR };

// sphere/horizon/pole are always drawn — not user-toggleable, they're the
// basic frame everything else is read against.
export const DEFAULT_LAYERS = {
  equator: true, ecliptic: true, planets: true,
  zodiacBand: true, zodiacNames: true, angles: true, degrees: false,
};

// Returns { group, rotatables }. rotatables holds direct refs to the
// planet markers and the ecliptic line/labels — during direction playback
// these are repositioned in place (natal RA/Dec held fixed, reprojected
// through a later sidereal moment) to visibly turn the whole natal sky, the
// way the source material describes primary motion rather than a single
// marker creeping across an otherwise-static backdrop.
export function buildSkyGroup(state, layers = DEFAULT_LAYERS) {
  const group = new THREE.Group();
  group.add(buildSphere());
  group.add(buildHorizonDisc());
  group.add(buildPoleAxis(state.poleXYZ));

  const rotatables = { planetMarkers: [], eclipticLine: null, eclipticLabels: [], eclipticPoints: [] };

  if (layers.equator) group.add(buildGreatCircle(state.equatorPoints, EQUATOR_COLOR, { labelColor: '#2f6fb0' }).group);
  if (layers.ecliptic) {
    const ecl = buildGreatCircle(state.eclipticPoints, ECLIPTIC_COLOR, { labelColor: '#2f9e44' });
    group.add(ecl.group);
    rotatables.eclipticLine = ecl.line;
    rotatables.eclipticLabels = ecl.labels;
    rotatables.eclipticPoints = ecl.points;
  }
  if (layers.planets) {
    const pl = buildPlanets(state.planets, layers.degrees);
    group.add(pl.group);
    rotatables.planetMarkers = pl.markers;
  }
  if (layers.angles) {
    group.add(buildAngleMarker(state.mc, 'MC', MERIDIAN_AXIS_COLOR, '#a8790f', layers.degrees));
    group.add(buildAngleMarker(state.ic, 'IC', MERIDIAN_AXIS_COLOR, '#a8790f', layers.degrees));
    if (state.asc) group.add(buildAngleMarker(state.asc, 'ASC', HORIZON_AXIS_COLOR, '#0e8a94', layers.degrees));
    if (state.dsc) group.add(buildAngleMarker(state.dsc, 'DSC', HORIZON_AXIS_COLOR, '#0e8a94', layers.degrees));
  }
  return { group, rotatables };
}

export const SPHERE_RADIUS = RADIUS;
