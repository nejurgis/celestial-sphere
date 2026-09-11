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

// Returns { group, markerMesh, markerMaterial, label } — main.js repositions
// markerMesh and swaps markerMaterial.color every animation frame without
// touching the rest of the scene.
export function buildDirectionGroup(direction, movingLabel, fixedLabel) {
  const group = new THREE.Group();

  group.add(lineFromPoints(direction.sweepPoints, DIRECTION_COLOR, { dashed: true, opacity: 0.7 }));

  const markerMaterial = new THREE.MeshBasicMaterial({ color: DIRECTION_COLOR });
  applyStereographicWarp(markerMaterial);
  const markerMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), markerMaterial);
  markerMesh.position.set(...direction.directedXYZ(0));
  group.add(markerMesh);

  const label = makeTextSprite(`${movingLabel} → ${fixedLabel}`, { color: '#e08a1e', size: 28, weight: '700', scale: 0.2 });
  label.position.copy(markerMesh.position).multiplyScalar(1.12);
  group.add(label);

  return { group, markerMesh, markerMaterial, label };
}

export const DIRECTION_COLORS = { active: DIRECTION_COLOR, hit: DIRECTION_HIT_COLOR };

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
