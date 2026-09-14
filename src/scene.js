// ── scene.js ──────────────────────────────────────────────────────────────
// Builds the 3D celestial-sphere group from a computed sky state (astro.js).
// Local zenith = +Y, horizon = XZ plane, North = +Z, East = +X.

import * as THREE from 'three';
import { makeTextSprite } from './labels.js';
import { formatEclipticDegree, ZODIAC_SIGNS } from './astro.js';
import {
  createSkyDomeMaterial, createStarPointsMaterial, createSunGlowMaterial,
  createScreenLineMaterial, buildScreenLineMesh,
} from './sky-shaders.js';
import { applyStereographicWarp } from './stereographic.js';

// NASA SVS "Deep Star Maps 2020" (public domain) — the diffuse Milky Way
// band ONLY, not individual stars (those are real catalog points now, see
// buildStarField below — a photographic texture was the wrong tool for
// discrete, positionable objects; it's the right one for an inherently
// soft/diffuse glow like this). The small print JPG is plenty here since
// nothing about a blurred band needs HDR precision or bloom. Loaded once
// at module scope and reused across every rebuild.
const milkyWayTexture = new THREE.TextureLoader().load('/milkyway_2020_4k_print.jpg');
milkyWayTexture.colorSpace = THREE.SRGBColorSpace;

// Ground "landscape" — same idea as Stellarium's own landscape system
// (src/modules/landscape.c): a real photo of terrain, alpha-masked so only
// the actual hill/tree silhouette is opaque — everywhere else stays
// transparent and shows the real sky/stars rendered behind it, and at
// night the whole thing is just color-multiplied dark (their
// get_global_brightness() does the same: multiply, don't swap textures),
// which naturally reads as a black silhouette against the stars since the
// sky portion was never opaque to begin with.
//
// Source: user-supplied Poly Haven "Horn-Koppe Spring" HDRI (CC0), tonemapped
// (exposure*0.28, gamma 2.2) and alpha-masked via a per-column horizon
// detection script (not from Stellarium's own assets — those are loaded at
// runtime from their servers as a HiPS survey, not present in their GitHub
// source, so this is a different real photo used the same way their system
// uses one). See public/ground_landscape.png.
//
// GROUND_THETA_START matches the actual altitude the source crop starts at
// (+39.9°, i.e. theta = 90°-39.9° from zenith) — the photo captures some
// real sky above the true horizon (tall trees/hills need that margin), and
// the geometry has to cover the same span the texture does or the two
// misalign.
const groundTexture = new THREE.TextureLoader().load('/ground_landscape.png');
groundTexture.colorSpace = THREE.SRGBColorSpace;
const GROUND_THETA_START = 0.874546; // rad, ~39.9° above the horizon

const RADIUS = 5;

const PLANET_COLOR = 0xd23b3b;
// Distinct color per planet, following classical temperament/elemental
// associations rather than an arbitrary palette: Sun (fire, hot/dry) gold,
// Moon (water, cold/moist) pale blue, Mercury (mutable, "quicksilver")
// silver-grey, Venus (fertile, classically copper/green) green, Mars (fire,
// hot/dry) red, Jupiter (traditionally the most benefic/expansive) orange,
// Saturn (earth, cold/dry) dark slate.
const PLANET_COLORS = {
  Sun: 0xf2a541, Moon: 0x9fd8f0, Mercury: 0xb0b0ba, Venus: 0x5cb85c,
  Mars: 0xd23b3b, Jupiter: 0xe0791e, Saturn: 0x3a3a4a,
};
const PLANET_LABEL_COLORS = {
  Sun: '#c97f12', Moon: '#3f8fae', Mercury: '#6e6e78', Venus: '#2f7d32',
  Mars: '#b02a2a', Jupiter: '#b5590c', Saturn: '#3a3a4a',
};
const EQUATOR_COLOR = 0x2f6fb0;
const AZIMUTHAL_COLOR = 0xb0752f; // warm/amber — distinct from equatorial's blue and ecliptic's green
const CONSTELLATION_COLOR = 0xbcd6ee;
// Deliberately plain 0-1 color, NOT HDR-boosted — a >1.0 color here
// rendered solid black instead of bloom-glowing (root cause not fully
// pinned down: the real star field's Points use plain colors and render
// correctly, so this matches that working approach rather than the
// mesh-based one that didn't).
const CONSTELLATION_DOT_COLOR = new THREE.Color(0xe8f0fa);
const ECLIPTIC_COLOR = 0x2f9e44;
const HORIZON_COLOR = 0xffffff;
const POLE_COLOR = 0x888888;
const MERIDIAN_AXIS_COLOR = 0xd4a017;   // MC / IC
const HORIZON_AXIS_COLOR = 0x0e8a94;    // ASC / DSC
const PATH_COLOR = 0xa8321e;
const POSITION_CIRCLE_COLOR = 0x8b5cf6;
const DIRECTION_COLOR = 0xe08a1e;
const DIRECTION_HIT_COLOR = 0x22c55e;
// air was originally 0xe0bd4a — a much brighter yellow than it looks next
// to the other three at a glance: Rec.709 perceptual luminance (0.2126R +
// 0.7152G + 0.0722B, green weighted ~10x blue) put it at 0.74 versus
// fire/earth/water's 0.48-0.56, so air-sign zodiac band segments (and
// anything else colored by element, e.g. the live ASC marker) read as
// overpowering — not a shader/lighting bug, just an unbalanced flat color.
// This value lands at 0.535, matching the other three.
export const ELEMENT_COLORS = { fire: 0xd9633b, earth: 0x7c9a52, air: 0xa88830, water: 0x4a90b8 };
// Same perceptual-luminance imbalance as ELEMENT_COLORS.air above (0.73 vs
// a balanced ~0.53) — not a lighting bug, flat yellow just reads far
// brighter than other hues at the same nominal saturation.
const ASPECT_PLANE_COLOR = 0x9c9018; // was 0xd4c419

// Same element→color mapping the zodiac band ribbon uses, keyed by
// ecliptic degree instead of a segment object — e.g. Gemini (air) comes
// back 0xe0bd4a, a golden yellow.
export function elementColorForDeg(deg) {
  const norm = ((deg % 360) + 360) % 360;
  const sign = ZODIAC_SIGNS[Math.floor(norm / 30)];
  return ELEMENT_COLORS[sign.element];
}

function lineFromPoints(points, color, opts = {}) {
  const geom = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  );
  const material = opts.dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: opts.opacity ?? 1 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1 });
  applyStereographicWarp(material);
  const line = new THREE.Line(geom, material);
  if (opts.dashed) line.computeLineDistances();
  return line;
}

// THREE.Line's linewidth is ignored on most platforms (a long-standing WebGL
// limitation) — a real, camera-consistent thick line needs actual 3D tube
// geometry instead.
function tubeFromPoints(points, color, opts = {}) {
  const closed = opts.closed ?? true;
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    closed,
  );
  const geom = new THREE.TubeGeometry(curve, points.length * 2, opts.radius ?? 0.025, 8, closed);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 1 });
  if (opts.additive) { mat.blending = THREE.AdditiveBlending; mat.depthWrite = false; }
  applyStereographicWarp(mat);
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
  applyStereographicWarp(mat);
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
    }

    // Glyph is deliberately NOT gated by `band` (unlike before) — with the
    // Stellarium integration, this app's own ribbon fill is routinely
    // hidden/unchecked in favor of Stellarium's native band (see
    // updateStellariumBgVisibility in main.js and addStellariumZodiacBand
    // in stellarium-bridge.js, which can't render the glyph itself — no
    // font coverage for the zodiac Unicode block in Stellarium's bundled
    // NotoSans), so the glyph needs to exist independent of whether the
    // ribbon does.
    {
      // ︎ (text-presentation variation selector) stops canvas fillText from
      // falling back to Apple Color Emoji for these codepoints — the same
      // U+2648-2653 range Radio-Venus uses directly with no special handling,
      // since normal DOM text doesn't hit that fallback.
      // Plain grey, no stroke, semi-transparent — a quiet marker, not a
      // competing focal point against Stellarium's real sky underneath.
      const glyph = makeTextSprite(`${seg.glyph}︎`, { color: '#cfcfcf', size: 64, weight: '700', scale: 0.55, opacity: 0.85 });
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

// A soft round glow, bright center fading to fully transparent — for the
// twilight sun-glow sprite. Real skies brighten near the SUN's own
// direction specifically (Stellarium's Preetham model computes this via
// the Perez luminance function, angle-from-sun dependent), not uniformly
// around the whole horizon the way a plain zenith-to-horizon gradient
// implies; a sprite (always camera-facing) positioned at the sun's actual
// azimuth/altitude each moment is a much simpler way to get that same
// qualitative look without a full per-pixel scattering shader.
function makeGlowTexture(stops = [
  [0, 'rgba(255,210,140,0.9)'],
  [0.4, 'rgba(255,170,110,0.4)'],
  [1, 'rgba(255,150,100,0)'],
]) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [offset, color] of stops) grad.addColorStop(offset, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Pale blue-white halo for constellation-star dots — a canvas sprite
// glow, same technique as the sun's twilight glow, chosen deliberately
// over HDR-color + bloom (which is what produced the mystery solid-black
// dots earlier this session and was reverted). A sprite glow is immune to
// that bloom-pipeline interaction since it never depends on luminance
// exceeding the bloom threshold.
export const starGlowTexture = makeGlowTexture([
  [0, 'rgba(235,242,255,0.55)'],
  [0.5, 'rgba(210,225,255,0.18)'],
  [1, 'rgba(200,220,255,0)'],
]);

// Their planets.c: the sun is rendered as (a) the same point-based
// core+halo dot every star/planet gets — points.glsl, already what
// createSunGlowMaterial ports — PLUS (b) a distinct, larger glare texture
// layered on top: "paint_texture(&painter, planets->halo_tex, ..., color)"
// with "vec4_set(color, 1, 1, 1, fabs(pos[2]))" — opacity is |sin(altitude)|
// of the observed-frame position, their own comment calling it "ad-hoc...
// to be replaced when proper extinction is computed". (b) was missing here;
// this is that second layer, reusing the same warm-glow canvas gradient the
// old (now-removed) twilight-sprite hack used, sized much larger than a
// star's glow and with its opacity driven the same |sin(alt)| way — see
// main.js's setSkyDayNight.
// Dimmer than makeGlowTexture's own default stops (0.9/0.4 center/mid
// opacity) — those were tuned for a much smaller star-glow-style sprite;
// at the sun's larger scale (see buildPlanets) the same stops read as
// too bright, stacking with the point-based glow underneath.
export const sunHaloTexture = makeGlowTexture([
  [0, 'rgba(255,210,140,0.5)'],
  [0.4, 'rgba(255,170,110,0.2)'],
  [1, 'rgba(255,150,100,0)'],
]);

// Day and night sky/ground are built as FOUR permanent meshes (not swapped
// in/out) whose opacity the caller crossfades based on the Sun's real
// altitude — including during day-rotation playback, so a full rotation
// visibly passes through dusk and dawn rather than snapping between two
// states. See main.js's setDayRotationDeg/rebuild for where that happens.
function buildSphere() {
  const group = new THREE.Group();

  // A small radius gap so this never sits EXACTLY on the same surface as
  // real content (zodiac band, equator, ecliptic...) — belt-and-braces, not
  // the main fix (see renderOrder below for that).
  const bgRadius = RADIUS * 0.98;

  // Real fix for "far-side content disappears/gets tinted over depending on
  // camera angle": this shell is transparent with depthWrite:false, so
  // whichever object paints a given pixel LAST wins, regardless of which is
  // actually nearer — normally Three.js's own back-to-front distance sort
  // keeps that sane, but for a giant background shell that sort is
  // unreliable (its "distance" is ambiguous across its own surface), so a
  // ray to a far-side ribbon segment could have this shell's near surface
  // sorted AFTER it, painting the shell's tint right over the ribbon's
  // color. renderOrder forces this to always draw first, so real content
  // always paints on top of it, independent of the distance sort.
  const upperGeom = new THREE.SphereGeometry(bgRadius, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  // Spans from GROUND_THETA_START (some real sky above the horizon, matching
  // the photo's own captured extent) down to nadir — see GROUND_THETA_START's
  // comment above for why this isn't just the lower hemisphere.
  const groundGeom = new THREE.SphereGeometry(bgRadius, 48, 24, 0, Math.PI * 2, GROUND_THETA_START, Math.PI - GROUND_THETA_START);

  // Real photo, alpha-masked — see groundTexture's comment above. Colored
  // white/day by default; setSkyDayNight (main.js) multiplies groundMat's
  // own color toward black for night, same technique as Stellarium's
  // get_global_brightness() — the mask's transparent (sky) pixels are
  // unaffected by that either way, so real stars stay visible through them
  // regardless of time of day.
  //
  // alphaTest (not transparent+opacity blending) is what makes this
  // actually OCCLUDE things physically behind it — the zodiac band, stars,
  // ecliptic line etc. all render as separate transparent objects, which
  // paint in whatever order they're drawn regardless of what's "supposed"
  // to be in front; with alphaTest, opaque terrain pixels render through
  // the normal opaque/depth-tested pass (real Z-buffer occlusion, order
  // doesn't matter) while masked-out sky pixels are fully discarded (no
  // depth write at all), letting real content behind them show through
  // untouched. The mask was tightened to a near-binary edge specifically
  // so this cutover reads as a clean line, not a speckled one.
  const groundMat = new THREE.MeshBasicMaterial({
    map: groundTexture, alphaTest: 0.5, side: THREE.FrontSide,
  });
  applyStereographicWarp(groundMat);
  const groundMesh = new THREE.Mesh(groundGeom, groundMat);
  group.add(groundMesh);

  // The real sky — a physically-based Preetham/Perez analytic dome ported
  // from Stellarium's own atmosphere.glsl (see sky-shaders.js for exactly
  // what's copied verbatim vs. filled in from the paper). Additive-blended,
  // so it needs no day/night opacity crossfade of its own — see that file.
  const skyDomeMat = createSkyDomeMaterial();
  const skyDomeMesh = new THREE.Mesh(upperGeom, skyDomeMat);
  // No explicit order = Three's automatic per-frame distance sort, which
  // flip-flops against the zodiac ribbon (also transparent) as the camera
  // moves — reads as the dome momentarily flashing the ribbon's fire/earth
  // colors. Force deterministic draw-before-ribbon.
  skyDomeMesh.renderOrder = -1;
  group.add(skyDomeMesh);

  // The diffuse Milky Way band — real NASA imagery for the soft glow only;
  // individual stars are the real-catalog Points from buildStarField
  // instead (see that function). Built as a FULL sphere with plain
  // equatorial UVs (u=RA, v=Dec, per the source map's own "centered at 0h
  // RA, RA increases to the left" convention) then rotated by the caller
  // into this moment's alt/az frame — see setEquatorialSphereOrientation. Full
  // sphere (not hemisphere-clipped) because a hemisphere cut in
  // EQUATORIAL space doesn't correspond to one in horizon space after
  // rotation; renderOrder -2 so the opaque ground above always occludes
  // its below-horizon half regardless of the (otherwise unreliable, see
  // the note above) distance-based paint order.
  const milkyWayGeom = new THREE.SphereGeometry(bgRadius * 0.99, 64, 32);
  const milkyWayMat = new THREE.MeshBasicMaterial({
    map: milkyWayTexture, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
  });
  applyStereographicWarp(milkyWayMat);
  const milkyWayMesh = new THREE.Mesh(milkyWayGeom, milkyWayMat);
  milkyWayMesh.renderOrder = -2;
  group.add(milkyWayMesh);

  return { group, groundMat, groundMesh, milkyWayMat, milkyWayMesh, skyDomeMat, skyDomeMesh };
}

// Returns { group, ring, labels } — ring is just the flat disc + spoke
// lines, separate from the N/E/S/W labels, so the caller can hide it in
// center view: seen edge-on from near the sphere's own center, a flat disc
// degenerates into an unwanted grey line across the middle of the screen
// (in outside view it still reads fine as a translucent horizon plane).
// Now that the real ground photo (buildSphere's groundMat) shows an actual
// horizon silhouette, this ring is mostly legacy anyway.
// `labels` (the N/E/S/W sprites) is ALSO hidden in center view, separately
// from `ring` — Stellarium's own real cardinal-point labels (cardinal.c)
// render there instead once its background loads, so this app's own copies
// would just be a duplicate sitting on top of them.
function buildHorizonDisc() {
  const group = new THREE.Group();
  const ring = new THREE.Group();
  const labels = new THREE.Group();
  const geom = new THREE.CircleGeometry(RADIUS * 0.995, 96);
  const mat = new THREE.MeshBasicMaterial({
    color: HORIZON_COLOR, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false,
  });
  applyStereographicWarp(mat);
  const disc = new THREE.Mesh(geom, mat);
  disc.renderOrder = -1;
  disc.rotation.x = -Math.PI / 2;
  ring.add(disc);

  const compass = [
    { label: 'N', az: 0 }, { label: 'E', az: 90 }, { label: 'S', az: 180 }, { label: 'W', az: 270 },
  ];
  for (const { label, az } of compass) {
    const rad = (az * Math.PI) / 180;
    const x = RADIUS * 1.06 * Math.sin(rad);
    const z = RADIUS * 1.06 * Math.cos(rad);
    const sprite = makeTextSprite(label, { color: '#333', size: 44, scale: 0.32 });
    sprite.position.set(x, 0, z);
    labels.add(sprite);

    // horizon spoke line, subtle
    ring.add(lineFromPoints([[0, 0, 0], [x * 0.94, 0, z * 0.94]], 0x999999, { opacity: 0.35 }));
  }
  group.add(ring);
  group.add(labels);
  return { group, ring, labels };
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

// Dec parallels are static (see computeEquatorialGrid's comment for why —
// same invariance the plain celestial equator line relies on); RA
// meridians are returned separately so the caller can reproject them
// during playback, the same way the ecliptic line is.
// Ported from Stellarium's lines.glsl — see sky-shaders.js's header for
// exactly what that means. gridRadius (the existing "Constellation/grid
// line width" slider's world-space tube-radius value) is remapped to a
// screen-pixel width so the old slider keeps doing something sensible for
// this system too, even though the underlying unit changed.
export function buildEquatorialGrid(grid, { radius: gridRadius = 0.014 } = {}) {
  const group = new THREE.Group();
  const labelColor = '#5a85b0';
  const lineWidthPx = gridRadius * 220;
  const gridLineMaterial = createScreenLineMaterial({ color: EQUATOR_COLOR, lineWidth: lineWidthPx, opacity: 0.35 });

  for (const circle of grid.decCircles) {
    group.add(buildScreenLineMesh(circle.points.map(p => p.xyz), gridLineMaterial));
    const label = makeTextSprite(`${circle.dec > 0 ? '+' : ''}${circle.dec}°`, { color: labelColor, size: 24, scale: 0.16 });
    label.position.set(...circle.labelXYZ);
    group.add(label);
  }

  // RA meridians (not the Dec circles above — see computeEquatorialGrid's
  // comment for why those are static) genuinely sweep with time. Grouped
  // separately so playback can rotate just this sub-group rigidly around
  // the natal pole axis (reprojectRotatables in main.js) instead of
  // recomputing points and rebuilding geometry every frame — exact for a
  // meridian (fixed RA by definition), same technique as the star field.
  const meridianGroup = new THREE.Group();
  for (const meridian of grid.raMeridians) {
    const line = buildScreenLineMesh(meridian.points.map(p => p.xyz), gridLineMaterial);
    meridianGroup.add(line);
    const label = makeTextSprite(`${meridian.raHours}h`, { color: labelColor, size: 24, scale: 0.16 });
    label.position.set(...meridian.labelXYZ);
    meridianGroup.add(label);
  }
  group.add(meridianGroup);

  return { group, meridianGroup, gridLineMaterial };
}

// Alt/az grid — fully static (see computeAzimuthalGrid's comment), so
// unlike buildEquatorialGrid there's no separate meridian sub-group for
// playback to reproject: every line here is fixed to the horizon frame
// for good.
export function buildAzimuthalGrid(grid, { radius: gridRadius = 0.014 } = {}) {
  const group = new THREE.Group();
  const labelColor = '#a3763f';
  const lineWidthPx = gridRadius * 220;
  const gridLineMaterial = createScreenLineMaterial({ color: AZIMUTHAL_COLOR, lineWidth: lineWidthPx, opacity: 0.35 });

  for (const circle of grid.altCircles) {
    group.add(buildScreenLineMesh(circle.points.map(p => p.xyz), gridLineMaterial));
    const label = makeTextSprite(`${circle.alt > 0 ? '+' : ''}${circle.alt}°`, { color: labelColor, size: 24, scale: 0.16 });
    label.position.set(...circle.labelXYZ);
    group.add(label);
  }

  for (const meridian of grid.azMeridians) {
    group.add(buildScreenLineMesh(meridian.points.map(p => p.xyz), gridLineMaterial));
    const label = makeTextSprite(`${meridian.az}°`, { color: labelColor, size: 24, scale: 0.16 });
    label.position.set(...meridian.labelXYZ);
    group.add(label);
  }

  return { group, gridLineMaterial };
}

// Fixed stars — like the real catalog star field, playback reprojects this
// whole group with a single rigid quaternion rotation around the natal pole
// axis (see reprojectRotatables in main.js) rather than recomputing each
// point's horizon position and rebuilding geometry every frame: RA/Dec are
// fixed for a star exactly as for a grid meridian, so the same rotation
// that's exact for those is exact here too (lines, dots, AND name labels
// all live in one group, so they all move together automatically).
export function buildConstellations(constellations, { radius = 0.02 } = {}) {
  const group = new THREE.Group();

  for (const c of constellations) {
    for (const strand of c.strands) {
      const line = tubeFromPoints(strand.map(p => p.xyz), CONSTELLATION_COLOR, { opacity: 0.85, closed: false, radius });
      group.add(line);

      strand.forEach(p => {
        const dotMat = new THREE.MeshBasicMaterial({ color: CONSTELLATION_DOT_COLOR });
        applyStereographicWarp(dotMat);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), dotMat);
        dot.position.set(...p.xyz);
        const glowMat = new THREE.SpriteMaterial({
          map: starGlowTexture, transparent: true, opacity: 0.55, depthWrite: false, depthTest: false,
        });
        applyStereographicWarp(glowMat);
        const glow = new THREE.Sprite(glowMat);
        glow.scale.set(0.2, 0.2, 1);
        dot.add(glow);
        group.add(dot);
      });
    }

    const first = c.strands[0][0];
    const label = makeTextSprite(c.name, { color: '#8a8aa0', size: 24, weight: '600', scale: 0.18 });
    label.position.set(first.xyz[0] * 1.02, first.xyz[1] * 1.02, first.xyz[2] * 1.02);
    group.add(label);
  }

  return { group };
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
  const markers = [];

  for (const p of planets) {
    const [x, y, z] = p.xyz;
    let marker;
    let haloMat = null;
    if (p.key === 'Sun') {
      const sunGeom = new THREE.BufferGeometry();
      sunGeom.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
      marker = new THREE.Points(sunGeom, createSunGlowMaterial());

      // See sunHaloTexture's comment: their second glare layer, on top of
      // the point above. depthTest stays on (default) — their own halo
      // respects depth too (PAINTER_ENABLE_DEPTH), so it's correctly
      // hidden behind the ground/terrain when the sun is below the
      // horizon, not left floating through it.
      haloMat = new THREE.SpriteMaterial({ map: sunHaloTexture, transparent: true, opacity: 0, depthWrite: false });
      applyStereographicWarp(haloMat);
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(0.55, 0.55, 1);
      marker.add(halo);
    } else {
      const mat = new THREE.MeshBasicMaterial({ color: PLANET_COLORS[p.key] ?? PLANET_COLOR });
      applyStereographicWarp(mat);
      marker = new THREE.Mesh(geom, mat);
    }
    marker.position.set(x, y, z);
    group.add(marker);

    const text = showDegrees ? `${p.key} ${formatEclipticDegree(p.elon)}` : p.key;
    const label = makeTextSprite(text, { color: PLANET_LABEL_COLORS[p.key] ?? '#b02a2a', size: 34, weight: '700', scale: 0.24 });
    const len = Math.hypot(x, y, z) || 1;
    label.position.set((x / len) * 1.12 * len, (y / len) * 1.12 * len + 0.22, (z / len) * 1.12 * len);
    group.add(label);

    markers.push({ key: p.key, ra: p.ra, dec: p.dec, mesh: marker, label, haloMat });
  }
  return { group, markers };
}

// A short crosshair-style tube through the LIVE "ASC now" marker (see
// buildLiveAscMarker), perpendicular to the ecliptic/zodiac band. A real
// tube, not a plain Line — THREE.Line's linewidth is ignored on most
// platforms (see tubeFromPoints's own header) and this needs to read as a
// deliberately thick indicator, not a hairline. Only ~25 points and rebuilt
// (not appended to) each update, so the per-frame TubeGeometry churn during
// day-rotation playback stays cheap — far cheaper than the full
// computeSkyState() call setDayRotationDeg already does every frame.
// depthTest:false matches the live marker itself, for the same reason (a
// live UI reference point, not a physical object — should read through the
// ground/dome rather than being swallowed by them near the horizon, which
// is most of the time for an ascendant).
export function buildAscPerpendicularLine({ radius = 0.02 } = {}) {
  const material = new THREE.MeshBasicMaterial({ color: HORIZON_AXIS_COLOR, transparent: true, opacity: 0.85, depthTest: false });
  applyStereographicWarp(material);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.renderOrder = 998;
  mesh.visible = false;
  mesh.userData.tubeRadius = radius;
  return mesh;
}

export function updateAscPerpendicularLine(mesh, xyzPoints) {
  const curve = new THREE.CatmullRomCurve3(xyzPoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false);
  const newGeom = new THREE.TubeGeometry(curve, Math.max(2, xyzPoints.length), mesh.userData.tubeRadius, 6, false);
  mesh.geometry.dispose();
  mesh.geometry = newGeom;
}

function buildAngleMarker(point, label, color, hexColor, showDegrees) {
  const group = new THREE.Group();
  const geom = new THREE.SphereGeometry(0.08, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color });
  applyStereographicWarp(mat);
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
  applyStereographicWarp(markerMat);
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

export function buildPositionCircle(result, planetKey, { radius = 0.03 } = {}) {
  const group = new THREE.Group();
  group.add(tubeFromPoints(result.points, POSITION_CIRCLE_COLOR, { opacity: 0.6, radius }));

  const geom = new THREE.SphereGeometry(0.06, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: POSITION_CIRCLE_COLOR });
  applyStereographicWarp(mat);
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
export function buildAspectPlane(result, planetKey, { radius = 0.035 } = {}) {
  const group = new THREE.Group();
  group.add(tubeFromPoints(result.points, ASPECT_PLANE_COLOR, { opacity: 0.65, radius }));

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

// Returns { group, markerMesh, markerMaterial, label, traveledLine,
// remainingLine } — main.js repositions markerMesh and swaps
// markerMaterial.color every animation frame without touching the rest of
// the scene, and calls updateDirectionSweepLines (below) to keep
// traveledLine/remainingLine split at the current progress point.
export function buildDirectionGroup(direction, movingLabel, fixedLabel) {
  const group = new THREE.Group();

  // Split into two lines — SOLID for the arc already traveled (0..now),
  // DASHED for what's still ahead — rather than one uniformly-dashed line,
  // so progress is visible on the arc's own shape, not just the marker's
  // position. Built once here at t=0 (matching markerMesh's own initial
  // position below); updateDirectionSweepLines replaces both lines'
  // geometry wholesale as directionYears advances (called from
  // setDirectionYears in main.js) — same "just rebuild the small geometry
  // every frame" approach already used for the live ASC crosshair
  // (updateAscPerpendicularLine), cheap for a ~60-point line.
  const traveledLine = lineFromPoints([direction.directedXYZ(0), direction.directedXYZ(0)], DIRECTION_COLOR, { opacity: 0.85 });
  const remainingLine = lineFromPoints(direction.sweepPoints, DIRECTION_COLOR, { dashed: true, opacity: 0.6 });
  group.add(traveledLine);
  group.add(remainingLine);

  const markerMaterial = new THREE.MeshBasicMaterial({ color: DIRECTION_COLOR });
  applyStereographicWarp(markerMaterial);
  const markerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), markerMaterial);
  markerMesh.position.set(...direction.directedXYZ(0));
  group.add(markerMesh);

  const label = makeTextSprite(`${movingLabel} → ${fixedLabel}`, { color: '#e08a1e', size: 28, weight: '700', scale: 0.2 });
  label.position.copy(markerMesh.position).multiplyScalar(1.12);
  group.add(label);

  // Which Egyptian bound the promissor is CURRENTLY traveling through —
  // pushed further out (1.22x vs the arrow label's 1.12x) so the two
  // don't overlap, both stacking outward from the sphere the same way.
  // Empty/hidden until main.js's setDirectionYears fills in real text —
  // building it here (not lazily) keeps creation and update in the same
  // "who owns this object" place as every other directionMarker field.
  const boundLabel = makeTextSprite(' ', { color: '#8b5cf6', size: 26, weight: '700', scale: 0.19 });
  boundLabel.position.copy(markerMesh.position).multiplyScalar(1.22);
  boundLabel.visible = false;
  group.add(boundLabel);

  return { group, markerMesh, markerMaterial, label, traveledLine, remainingLine, boundLabel };
}

function replaceLineGeometry(line, points, dashed) {
  line.geometry.dispose();
  line.geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
  if (dashed) line.computeLineDistances();
}

// Resamples traveledLine/remainingLine at the SAME fixed steps
// direction.sweepPoints itself uses (so both halves still read as one
// continuous, evenly-sampled curve), split at directionYears — plus the
// EXACT current point at the split itself, so the solid/dashed boundary
// always lines up precisely with the marker instead of stopping short of
// or overshooting it between fixed sample steps.
export function updateDirectionSweepLines(traveledLine, remainingLine, direction, directionYears) {
  const STEPS = direction.sweepPoints.length - 1;
  const arcYears = direction.arcYears;
  if (!(arcYears > 0) || STEPS <= 0) return;
  const splitStep = Math.max(0, Math.min(STEPS, Math.round((directionYears / arcYears) * STEPS)));

  const traveledPts = [];
  for (let i = 0; i <= splitStep; i++) traveledPts.push(direction.directedXYZ((i / STEPS) * arcYears));
  traveledPts.push(direction.directedXYZ(directionYears));

  const remainingPts = [direction.directedXYZ(directionYears)];
  for (let i = splitStep + 1; i <= STEPS; i++) remainingPts.push(direction.directedXYZ((i / STEPS) * arcYears));

  replaceLineGeometry(traveledLine, traveledPts, false);
  replaceLineGeometry(remainingLine, remainingPts, true);
}

export const DIRECTION_COLORS = { active: DIRECTION_COLOR, hit: DIRECTION_HIT_COLOR };

// ── House-system construction (pedagogical animations) ────────────────────
// Two builders below — buildRegiomontanusConstruction and
// buildPlacidusConstruction — visualize what their matching astro.js
// computers produced. Every piece starts hidden/empty; main.js's own
// animation drivers (startRegioConstruction/startPlacidusConstruction +
// animate()) reveal them one house at a time.
const REGIO_COLOR = 0xd946ef;    // magenta — Regiomontanus's great circles
const PLACIDUS_COLOR = 0x06b6d4; // cyan — Placidus's curved loci; deliberately far from magenta so running one after the other reads as a clear contrast
const PLANET_POS_COLOR = 0xf59e0b; // amber — a planet's own circle of position (same construction as a house arc, through the planet instead of a division point)

// Screen-space lines (sky-shaders.js — the SAME system the equatorial/
// azimuthal grids already use), not THREE.TubeGeometry. A tube's per-call
// cost isn't just the JS math — TubeGeometry generates a full swept
// circular cross-section (radialSegments × tubularSegments vertices, each
// needing a Frenet-frame normal) and re-uploads that as a brand-new WebGL
// buffer — for a ~180-point circle that's 8×181=1448 vertices, and disposing
// + reallocating a GPU buffer that size every single animate() frame during
// day-rotation tracking is exactly the kind of per-frame cost that shows up
// as visible stutter even when it profiles as "fast" JS-side (the GPU-side
// upload/driver work isn't captured by a plain performance.now() wrap). A
// screen-space line needs only 4×(N-1) vertices from plain array fills — no
// curve/frame math — and (bonus) gets a constant PIXEL width instead of
// shrinking/growing with zoom, matching the grids' own look. Materials are
// still MeshBasicMaterial-equivalent-cheap per house (a ShaderMaterial, but
// a tiny stateless one) — buildRegiomontanusConstruction/
// buildPlacidusConstruction below create ONE shared material per system
// (not one per house) for exactly this reason.
function growScreenLine(mesh, points, count) {
  const pts = points.slice(0, Math.max(2, count));
  const fresh = buildScreenLineMesh(pts, mesh.material); // only its geometry is used below; the wrapper Mesh itself is thrown away
  mesh.geometry.dispose();
  mesh.geometry = fresh.geometry;
  mesh.visible = true;
}

function emptyScreenLine(material) {
  return new THREE.Mesh(new THREE.BufferGeometry(), material);
}

// A short tick crossing the zodiac band's own width at a cusp's longitude
// — see computeAscPerpendicular's reuse in astro.js for why this is the
// SAME helper the live ASC crosshair uses.
function updateCuspTick(mesh, points) {
  growScreenLine(mesh, points, points.length);
}

function buildCuspTick(points, material) {
  const mesh = emptyScreenLine(material);
  updateCuspTick(mesh, points);
  mesh.visible = false;
  return mesh;
}

export function disposeConstructionGroup(construction) {
  construction.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const map = obj.material.map;
      if (map?.isCanvasTexture) map.dispose();
      obj.material.dispose();
    }
  });
}

// Visualizes computeRegiomontanusConstruction (astro.js): the 12 equal
// equatorial division points, each one's full house-circle great circle
// (through the horizon's North/South points — not the celestial pole),
// and where that circle meets the ecliptic.
export function buildRegiomontanusConstruction(construction, planetPositions = null) {
  const group = new THREE.Group();
  // ONE shared material for all 12 circles (and another for the 12 thinner
  // ticks) rather than one each — cheaper, and both need their own
  // uResolution kept current by main.js's animate() loop the same way the
  // equatorial/azimuthal grids' own materials already are.
  const lineMaterial = createScreenLineMaterial({ color: REGIO_COLOR, lineWidth: 3, opacity: 0.85 });
  const tickMaterial = createScreenLineMaterial({ color: REGIO_COLOR, lineWidth: 2, opacity: 0.85 });

  const northMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  applyStereographicWarp(northMat);
  const northMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), northMat);
  northMarker.position.set(...construction.northXYZ);
  northMarker.renderOrder = 999;
  group.add(northMarker);
  const northLabel = makeTextSprite('N (horizon)', { color: '#666', size: 22, scale: 0.16 });
  northLabel.position.copy(northMarker.position).multiplyScalar(1.15);
  group.add(northLabel);

  const houses = construction.houses.map((h) => {
    const divisionMat = new THREE.MeshBasicMaterial({ color: REGIO_COLOR });
    applyStereographicWarp(divisionMat);
    const divisionMarker = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), divisionMat);
    divisionMarker.position.set(...h.divisionXYZ);
    divisionMarker.visible = false;
    group.add(divisionMarker);

    const circleMesh = emptyScreenLine(lineMaterial); // filled in progressively by revealHouseCirclePartial
    circleMesh.visible = false;
    group.add(circleMesh);

    const cuspMat = new THREE.MeshBasicMaterial({ color: REGIO_COLOR });
    applyStereographicWarp(cuspMat);
    const cuspMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), cuspMat);
    cuspMarker.position.set(...h.cuspXYZ);
    cuspMarker.visible = false;
    group.add(cuspMarker);

    const cuspLabel = makeTextSprite(`Cusp ${h.house}`, { color: '#a21caf', size: 24, weight: '700', scale: 0.18 });
    cuspLabel.position.copy(cuspMarker.position).multiplyScalar(1.13);
    cuspLabel.visible = false;
    group.add(cuspLabel);

    const cuspTick = buildCuspTick(h.cuspTickXYZ, tickMaterial);
    group.add(cuspTick);

    return { ...h, divisionMarker, circleMesh, cuspMarker, cuspLabel, cuspTick };
  });

  // The animation's final phase: the same house-arc construction applied
  // to each actual planet instead of an equatorial division point — see
  // computePlanetPositionsConstruction (astro.js). Optional: only present
  // when the caller (main.js) passes planetPositions.
  let planetEntries = null;
  let planetLineMaterial = null;
  if (planetPositions) {
    planetLineMaterial = createScreenLineMaterial({ color: PLANET_POS_COLOR, lineWidth: 3, opacity: 0.85 });
    planetEntries = planetPositions.map((p) => {
      const circleMesh = emptyScreenLine(planetLineMaterial);
      circleMesh.visible = false;
      group.add(circleMesh);

      const mundaneMat = new THREE.MeshBasicMaterial({ color: PLANET_POS_COLOR });
      applyStereographicWarp(mundaneMat);
      const mundaneMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), mundaneMat);
      mundaneMarker.position.set(...p.mundaneXYZ);
      mundaneMarker.visible = false;
      group.add(mundaneMarker);

      const mundaneLabel = makeTextSprite(`${p.key}: OA ${p.obliqueAscensionHours.toFixed(2)}h`, {
        color: '#b45309', size: 22, weight: '700', scale: 0.17,
      });
      mundaneLabel.position.copy(mundaneMarker.position).multiplyScalar(1.13);
      mundaneLabel.visible = false;
      group.add(mundaneLabel);

      return { ...p, circleMesh, mundaneMarker, mundaneLabel };
    });
  }

  return { group, northMarker, northLabel, houses, lineMaterial, tickMaterial, planetEntries, planetLineMaterial };
}

export function revealHouseCirclePartial(houseEntry, count) {
  growScreenLine(houseEntry.circleMesh, houseEntry.circlePoints, count);
}

export function revealPlanetCirclePartial(planetEntry, count) {
  growScreenLine(planetEntry.circleMesh, planetEntry.circlePoints, count);
}

export const disposeRegiomontanusConstruction = disposeConstructionGroup;

// Repositions/regeometries an EXISTING built construction to match a fresh
// computeRegiomontanusConstruction result, in place — no scene.remove,
// no dispose, no new materials or text sprites (a cusp label's TEXT is
// always just "Cusp N", the house number, which never changes — only
// WHERE it sits does). Every house's own great circle IS a genuinely
// different circle at each moment (see main.js's own comment on why a
// rigid rotation isn't valid here), so its tube geometry still has to be
// rebuilt each call — but that's real geometry work, not scene-graph
// churn, and is what actually costs the measured ~7-11ms, not the
// churn. Used for live tracking during day-rotation playback: an earlier
// version did a full teardown+rebuild every frame instead, which used
// comparable CPU time but was visibly JERKY rather than smooth — texture
// uploads for a dozen freshly-recreated labels and WebGL buffer alloc/
// dealloc churn are exactly the kind of per-frame cost that shows up as
// stutter even when the total is well inside the frame budget, unlike a
// plain position/geometry update on already-resident GPU objects.
// Regiomontanus always has exactly 12 houses regardless of date/location
// (only Placidus can have cusps come and go — see updatePlacidusConstruction),
// so a straight index-aligned loop is safe here (both arrays are sorted
// the same way, by offsetDeg).
export function updateRegiomontanusConstruction(built, construction, planetPositions = null) {
  built.northMarker.position.set(...construction.northXYZ);
  built.northLabel.position.copy(built.northMarker.position).multiplyScalar(1.15);
  for (let i = 0; i < built.houses.length; i++) {
    const h = built.houses[i];
    const src = construction.houses[i];
    h.divisionXYZ = src.divisionXYZ;
    h.circlePoints = src.circlePoints;
    h.cuspDeg = src.cuspDeg;
    h.cuspXYZ = src.cuspXYZ;
    h.cuspTickXYZ = src.cuspTickXYZ;
    h.raHours = src.raHours;
    h.divisionMarker.position.set(...src.divisionXYZ);
    growScreenLine(h.circleMesh, src.circlePoints, src.circlePoints.length);
    h.cuspMarker.position.set(...src.cuspXYZ);
    h.cuspLabel.position.copy(h.cuspMarker.position).multiplyScalar(1.13);
    updateCuspTick(h.cuspTick, src.cuspTickXYZ);
  }
  // Planet circles-of-position/mundane positions genuinely move as the
  // sky rotates too (same reasoning as the house arcs above) — only
  // refreshed when this construction was built WITH planet data and the
  // caller passes fresh positions (i.e. the animation's planet phase has
  // already finished; see refreshActiveConstructionAtRotation in main.js).
  if (built.planetEntries && planetPositions) {
    for (let i = 0; i < built.planetEntries.length; i++) {
      const e = built.planetEntries[i];
      const src = planetPositions[i];
      e.planetXYZ = src.planetXYZ;
      e.circlePoints = src.circlePoints;
      e.mundaneXYZ = src.mundaneXYZ;
      e.obliqueAscensionHours = src.obliqueAscensionHours;
      growScreenLine(e.circleMesh, src.circlePoints, src.circlePoints.length);
      e.mundaneMarker.position.set(...src.mundaneXYZ);
      e.mundaneLabel.position.copy(e.mundaneMarker.position).multiplyScalar(1.13);
    }
  }
}

// Visualizes computePlacidusConstruction (astro.js): the 4 angular cusps
// (ASC/IC/DSC/MC — shown immediately, not animated, since they're just the
// already-known angles) plus each of the 8 non-angular cusps' curved locus
// — the points across declination that have completed that cusp's target
// fraction of their own semi-arc — and where each locus meets the
// ecliptic. A house missing from construction.curves was undefined at this
// latitude/date (circumpolar cutoff) and is simply not built.
export function buildPlacidusConstruction(construction) {
  const group = new THREE.Group();
  const lineMaterial = createScreenLineMaterial({ color: PLACIDUS_COLOR, lineWidth: 3, opacity: 0.85 });
  const tickMaterial = createScreenLineMaterial({ color: PLACIDUS_COLOR, lineWidth: 2, opacity: 0.85 });

  const angleLabelByHouse = { 1: 'ASC', 4: 'IC', 7: 'DSC', 10: 'MC' };
  const angleMarkers = [];
  for (const [houseStr, label] of Object.entries(angleLabelByHouse)) {
    const house = Number(houseStr);
    const xyz = construction.angleXYZByHouse[house];
    const cuspMat = new THREE.MeshBasicMaterial({ color: PLACIDUS_COLOR });
    applyStereographicWarp(cuspMat);
    const cuspMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), cuspMat);
    cuspMarker.position.set(...xyz);
    cuspMarker.visible = false; // shown all at once when the animation starts — see startPlacidusConstruction
    group.add(cuspMarker);

    const cuspLabel = makeTextSprite(`${label} (Cusp ${house})`, { color: '#0e7490', size: 24, weight: '700', scale: 0.18 });
    cuspLabel.position.copy(cuspMarker.position).multiplyScalar(1.13);
    cuspLabel.visible = false;
    group.add(cuspLabel);

    const cuspTick = buildCuspTick(construction.angleTickByHouse[house], tickMaterial);
    group.add(cuspTick);

    angleMarkers.push({ house, label, cuspMarker, cuspLabel, cuspTick });
  }

  const houses = Object.values(construction.curves).map((c) => {
    const curveMesh = emptyScreenLine(lineMaterial); // filled in progressively by revealPlacidusCurvePartial
    curveMesh.visible = false;
    group.add(curveMesh);

    const cuspMat = new THREE.MeshBasicMaterial({ color: PLACIDUS_COLOR });
    applyStereographicWarp(cuspMat);
    const cuspMarker = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), cuspMat);
    cuspMarker.position.set(...c.cuspXYZ);
    cuspMarker.visible = false;
    group.add(cuspMarker);

    const cuspLabel = makeTextSprite(`Cusp ${c.house}`, { color: '#0e7490', size: 24, weight: '700', scale: 0.18 });
    cuspLabel.position.copy(cuspMarker.position).multiplyScalar(1.13);
    cuspLabel.visible = false;
    group.add(cuspLabel);

    const cuspTick = buildCuspTick(c.cuspTickXYZ, tickMaterial);
    group.add(cuspTick);

    return { ...c, curveMesh, cuspMarker, cuspLabel, cuspTick };
  });
  // Sweep order: outward from the angles on both sides, matching how a
  // person would naturally trisect each quadrant one at a time.
  houses.sort((a, b) => a.house - b.house);

  return { group, angleMarkers, houses, lineMaterial, tickMaterial };
}

export function revealPlacidusCurvePartial(houseEntry, count) {
  growScreenLine(houseEntry.curveMesh, houseEntry.curvePoints, count);
}

export const disposePlacidusConstruction = disposeConstructionGroup;

// Same in-place-update approach as updateRegiomontanusConstruction — see
// its own header for why (avoids the per-frame scene-graph/texture churn
// that made an earlier full-teardown-every-frame version visibly jerky).
// Angular cusps (ASC/IC/DSC/MC) always exist, so those update
// unconditionally. The 8 non-angular ones can genuinely come and go
// (crossing the circumpolar cutoff mid-rotation) — if the AVAILABLE set
// changed since `built` was created, that needs new/removed scene
// objects, not just new positions, so this bails out (returns false) and
// leaves it to the caller to fall back to a full rebuild for that one
// frame; returns true when the common case (same houses, just moved)
// was handled in place.
export function updatePlacidusConstruction(built, construction) {
  for (const a of built.angleMarkers) {
    const xyz = construction.angleXYZByHouse[a.house];
    a.cuspMarker.position.set(...xyz);
    a.cuspLabel.position.copy(a.cuspMarker.position).multiplyScalar(1.13);
    updateCuspTick(a.cuspTick, construction.angleTickByHouse[a.house]);
  }

  const freshByHouse = construction.curves;
  const builtHouseNumbers = new Set(built.houses.map((h) => h.house));
  const freshHouseNumbers = new Set(Object.keys(freshByHouse).map(Number));
  const sameSet = builtHouseNumbers.size === freshHouseNumbers.size
    && [...builtHouseNumbers].every((h) => freshHouseNumbers.has(h));
  if (!sameSet) return false;

  for (const h of built.houses) {
    const src = freshByHouse[h.house];
    h.targetM = src.targetM;
    h.curvePoints = src.curvePoints;
    h.cuspDeg = src.cuspDeg;
    h.cuspXYZ = src.cuspXYZ;
    h.cuspTickXYZ = src.cuspTickXYZ;
    growScreenLine(h.curveMesh, src.curvePoints, src.curvePoints.length);
    h.cuspMarker.position.set(...src.cuspXYZ);
    h.cuspLabel.position.copy(h.cuspMarker.position).multiplyScalar(1.13);
    updateCuspTick(h.cuspTick, src.cuspTickXYZ);
  }
  return true;
}

// A small live-updating marker for wherever the true Ascendant actually is
// right now — distinct from the frozen natal ASC angle marker (which stays
// put during day-rotation playback, since it's the fixed primary-direction
// reference point, not a live "what's rising now" indicator). Hidden by
// default; the caller shows it and repositions markerMesh/label each frame
// while day-rotation is playing.
export function buildLiveAscMarker() {
  // depthTest:false on everything here — this is a live UI reference point,
  // not a physical object, so it should always read through regardless of
  // what's actually in front of it (the ground, now that it's a real
  // depth-occluding photo, would otherwise swallow it every time the real
  // ascendant is near/below the horizon — which is most of the time, since
  // that's what "ascendant" means).
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
  applyStereographicWarp(markerMaterial);
  const markerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), markerMaterial);
  markerMesh.renderOrder = 999;

  // Black border — the classic backface-expansion outline trick: a
  // slightly bigger copy of the same sphere, BackSide only (so just its
  // rim shows past the inner sphere's silhouette), added as a child so it
  // tracks the marker's position automatically.
  const borderMaterial = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide, depthTest: false });
  applyStereographicWarp(borderMaterial);
  const borderMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09 * 1.4, 16, 16), borderMaterial);
  borderMesh.renderOrder = 998;
  markerMesh.add(borderMesh);

  markerMesh.visible = false;
  const label = makeTextSprite('ASC now', { color: '#0e8a94', size: 28, weight: '700', scale: 0.2 });
  label.material.depthTest = false;
  label.renderOrder = 999;
  label.visible = false;

  // Which zodiac sign the live ascendant is currently in — a bigger glyph
  // sitting BEHIND the marker bubble (lower renderOrder than both markerMesh
  // and borderMesh above, all depthTest:false so draw order alone decides
  // what's "in front"), parented to markerMesh so it tracks position for
  // free. Stroked (unlike the band's own glyphs, which sit on a colored
  // ribbon fill) since this one reads directly against the sky/ground —
  // same reasoning as makeTextSprite's stroke option's own header comment.
  const glyphSprite = makeTextSprite('♈', {
    color: '#ffffff', size: 56, weight: '700', scale: 0.42, stroke: '#000000', strokeWidth: 5, opacity: 0.9,
  });
  glyphSprite.material.depthTest = false;
  glyphSprite.renderOrder = 997;
  glyphSprite.visible = false;
  markerMesh.add(glyphSprite);

  // Exposed so the caller can flip its side (BackSide<->FrontSide) with
  // centerView — same fixed-BackSide-breaks-under-the-warp's-mirror issue
  // as sky.skyDomeMat/groundMat (see main.js's setCenterView/rebuild),
  // just not yet reported for this one since it's only visible during
  // day-rotation playback in center view — a much narrower window to
  // notice it in.
  return { markerMesh, label, borderMaterial, glyphSprite };
}

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
  const sky = buildSphere();
  group.add(sky.group);
  const horizonDisc = buildHorizonDisc();
  group.add(horizonDisc.group);
  sky.horizonRing = horizonDisc.ring;
  sky.compassLabels = horizonDisc.labels;
  group.add(buildPoleAxis(state.poleXYZ));

  const rotatables = { planetMarkers: [], eclipticLine: null, eclipticLabels: [], eclipticPoints: [], equatorGroup: null };

  // Fixed-Dec (=0), all-RA content — same invariance under sidereal
  // rotation the equatorial grid's own Dec parallels rely on (see
  // computeEquatorialGrid's header comment), so a single rigid rotation
  // around the natal pole axis is exact, not an approximation — same cheap
  // method already used for the star field/constellations/equatorial-grid
  // meridians (see reprojectRotatables in main.js). Was previously left out
  // of rotatables entirely, so it silently never moved during day-rotation
  // playback while everything else visibly swept around it.
  if (layers.equator) {
    const eq = buildGreatCircle(state.equatorPoints, EQUATOR_COLOR, { labelColor: '#2f6fb0' });
    group.add(eq.group);
    rotatables.equatorGroup = eq.group;
  }
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
  return { group, rotatables, sky };
}

// Orients the star sphere (see buildSphere) into the given moment's alt/az
// frame. basis: { poleXYZ, equinoxXYZ } from astro.js's
// computeSkyRotationBasis — two vectors are enough to fully determine the
// rotation (a third, mutually-perpendicular one is derived via cross
// product), verified numerically against horizonOf directly.
export function setEquatorialSphereOrientation(mesh, basis) {
  const pole = new THREE.Vector3(...basis.poleXYZ).normalize();
  const equinox = new THREE.Vector3(...basis.equinoxXYZ).normalize();
  const third = new THREE.Vector3().crossVectors(equinox, pole).normalize();
  const m = new THREE.Matrix4().makeBasis(equinox, pole, third);
  mesh.quaternion.setFromRotationMatrix(m);
}

// Real catalog stars (see public/bright_stars.json's sourcing note) as
// THREE.Points — tiered into 3 magnitude buckets for size/brightness
// rather than a per-star shader attribute, since a handful of discrete
// sizes reads the same and is far simpler. `stars`: [{ xyz, mag }] from
// computeStarField. Returns the three Points objects so the caller can
// rotate them together (see main.js: a single quaternion around the natal
// pole axis reprojects the whole field for playback, verified to match
// per-star reprojection — cheaper than recomputing 8,900 stars a frame).
// Continuous magnitude → size/color remap (real catalog span in
// public/bright_stars.json is roughly Sirius at -1.46 up to the mag<=5.0
// filter cutoff), replacing the old 3-bucket tier system now that the
// core+halo point shader (sky-shaders.js, ported from Stellarium's
// points.glsl) makes a continuously-varying size actually look smooth
// instead of just changing point-sprite scale with no shape falloff.
const STAR_MIN_MAG = -1.5;
const STAR_MAX_MAG = 5.0;
const STAR_DIM_COLOR = new THREE.Color(0x8f96a6);
const STAR_BRIGHT_COLOR = new THREE.Color(0xf7f9ff);

export function buildStarField(stars) {
  const group = new THREE.Group();
  const positions = new Float32Array(stars.length * 3);
  const sizes = new Float32Array(stars.length);
  const colors = new Float32Array(stars.length * 3);
  const tmpColor = new THREE.Color();

  stars.forEach((s, i) => {
    positions[i * 3] = s.xyz[0];
    positions[i * 3 + 1] = s.xyz[1];
    positions[i * 3 + 2] = s.xyz[2];

    const t = Math.max(0, Math.min(1, (STAR_MAX_MAG - s.mag) / (STAR_MAX_MAG - STAR_MIN_MAG)));
    const tCurve = Math.pow(t, 0.6);
    // World-space size (same convention the old THREE.PointsMaterial
    // sizeAttenuation used) — converted to screen pixels in the vertex
    // shader via uSizeScale/-mvPosition.z, not a pixel count itself.
    sizes[i] = 0.01 + tCurve * 0.02;
    tmpColor.copy(STAR_DIM_COLOR).lerp(STAR_BRIGHT_COLOR, t).multiplyScalar(0.55 + 0.45 * t);
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  });

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('aSize', new THREE.Float32BufferAttribute(sizes, 1));
  geom.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));

  const points = new THREE.Points(geom, createStarPointsMaterial());
  points.renderOrder = -1;
  group.add(points);
  return { group, meshes: [points] };
}

export const SPHERE_RADIUS = RADIUS;
