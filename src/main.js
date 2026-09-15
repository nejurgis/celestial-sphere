import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  computeSkyState, computePlanetPath, computePositionCircle, computeDirection, computeZodiacBand,
  computeAspectPlane, computeAspectPoint, computeAllDirections, computeRegiomontanusHouses,
  computeBoundCrossings, computePlacidusDirection, boundOf,
  computeSkyRotationBasis, computeStarField, ZODIAC_SIGNS,
  siderealRotatedDate, horizonOf, altAzToXYZ, computeMoonInfo,
  formatEclipticDegree, NAIBOD_DEG_PER_YEAR, PLANETS, PATH_WINDOW_DAYS,
  computeEquatorialGrid, computeAzimuthalGrid, computeAscPerpendicular, computeWholeSignHouses,
  computeRegiomontanusConstruction, computePlacidusConstruction,
} from './astro.js';
import { skybrightnessPrepare, skybrightnessGetLuminance } from './skybrightness.js';
import {
  buildSkyGroup, buildPlanetPath, buildPositionCircle, buildDirectionGroup, updateDirectionSweepLines, buildZodiacBand,
  buildAspectPlane, buildLiveAscMarker, buildAscPerpendicularLine, updateAscPerpendicularLine, buildStarField, elementColorForDeg,
  setEquatorialSphereOrientation, DIRECTION_COLORS, SPHERE_RADIUS, starGlowTexture, sunHaloTexture,
  buildEquatorialGrid, buildAzimuthalGrid,
  buildRegiomontanusConstruction, revealHouseCirclePartial, disposeRegiomontanusConstruction, updateRegiomontanusConstruction,
  buildPlacidusConstruction, revealPlacidusCurvePartial, disposePlacidusConstruction, updatePlacidusConstruction,
} from './scene.js';
import { renderChart2D } from './chart2d.js';
import { updateTextSprite } from './labels.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { warpActiveUniform, stereographicFovRemap } from './stereographic.js';
import { initStellarium, syncStellariumTime, syncStellariumLocation, syncStellariumCamera, addStellariumZodiacBand } from './stellarium-bridge.js';
import { sliderStartTime, minutesSinceSliderStart, computeDayStops, hintForMinute, buildGradientSvg } from './day-slider.js';

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

// Reveals the mobile-only day/night gradient slider (see day-slider.js and
// index.html's .mobile-only rule) — coarse pointer is the same touch-vs-
// desktop heuristic this app already used for the (since-reverted) gyro
// feature: phones/tablets, not a mouse-driven laptop.
if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
  document.body.classList.add('is-touch');
}

// ── Renderer / scene / camera ────────────────────────────────────────────

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Opaque by default (matches the look before Stellarium existed) — only
// the Stellarium background layer (center view + toggle on) needs this
// canvas transparent so its opaque render shows through underneath.
renderer.setClearAlpha(1);

// ── Stellarium background layer (Option A) ──────────────────────────────
// See stellarium-bridge.js for the coordinate-convention writeup. Lazily
// initialized (6MB+ of WASM/skydata) on first entering center view, not at
// page load — always on there now, no manual toggle (removed; it only
// existed for A/B comparison while this integration was being debugged).
const stelBgCanvas = document.getElementById('stel-bg');
let stelInstance = null;
let stellariumLoading = false;
const stellariumViewDir = new THREE.Vector3(); // reused each frame, avoid per-frame alloc

// ── Stellarium layer toggle bar (constellation art/lines, atmosphere,
// az/eq grids, fullscreen) — same icons as stellarium-web-engine's own
// demo footer. Click handlers are safe to attach before Stellarium loads
// (each just no-ops via the stelInstance guard); initial .active state
// gets set once loadStellarium's promise resolves, matching the real
// defaults set in stellarium-bridge.js's initStellarium.
const stellariumBar = document.getElementById('stellarium-bar');
function wireStellariumToggle(btnId, getVisible, setVisible) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    if (!stelInstance) return;
    const next = !getVisible();
    setVisible(next);
    btn.classList.toggle('active', next);
  });
  return btn;
}
// Azimuthal/equatorial are dual-mode: Stellarium's real background only
// ever composites in center view (see updateStellariumBgVisibility) — in
// outside view there's no Stellarium sky to draw a grid over, so these two
// buttons drive this app's OWN Three.js grids there instead (built in
// rebuild(), see ownAzimuthalGroup/ownEquatorialGroup). Persisted booleans
// (ownAzimuthalVisible/ownEquatorialVisible) survive a rebuild() since the
// group itself gets destroyed and rebuilt every time.
let ownAzimuthalVisible = false;
let ownEquatorialVisible = false;
let ownAzimuthalGroup = null;
let ownEquatorialGroup = null;
function wireDualGridToggle(btnId, { stelGet, stelSet, getOwnVisible, setOwnVisible }) {
  const btn = document.getElementById(btnId);
  btn.addEventListener('click', () => {
    if (centerView) {
      if (!stelInstance) return;
      const next = !stelGet();
      stelSet(next);
      btn.classList.toggle('active', next);
    } else {
      const next = !getOwnVisible();
      setOwnVisible(next);
      btn.classList.toggle('active', next);
    }
  });
  return btn;
}
const stelToggleButtons = [
  wireStellariumToggle('stel-btn-cst-art',
    () => stelInstance.core.constellations.images_visible,
    (v) => { stelInstance.core.constellations.images_visible = v; }),
  wireStellariumToggle('stel-btn-cst-lines',
    () => stelInstance.core.constellations.lines_visible,
    (v) => { stelInstance.core.constellations.lines_visible = v; stelInstance.core.constellations.labels_visible = v; }),
  wireStellariumToggle('stel-btn-atmosphere',
    () => stelInstance.core.atmosphere.visible,
    (v) => { stelInstance.core.atmosphere.visible = v; }),
  wireDualGridToggle('stel-btn-azimuthal', {
    stelGet: () => stelInstance.core.lines.azimuthal.visible,
    stelSet: (v) => { stelInstance.core.lines.azimuthal.visible = v; },
    getOwnVisible: () => ownAzimuthalVisible,
    setOwnVisible: (v) => { ownAzimuthalVisible = v; if (ownAzimuthalGroup) ownAzimuthalGroup.visible = v; },
  }),
  wireDualGridToggle('stel-btn-equatorial', {
    stelGet: () => stelInstance.core.lines.equatorial.visible,
    stelSet: (v) => { stelInstance.core.lines.equatorial.visible = v; },
    getOwnVisible: () => ownEquatorialVisible,
    setOwnVisible: (v) => { ownEquatorialVisible = v; if (ownEquatorialGroup) ownEquatorialGroup.visible = v; },
  }),
];
const stelBtnFullscreen = document.getElementById('stel-btn-fullscreen');
stelBtnFullscreen.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  stelBtnFullscreen.classList.toggle('active', !!document.fullscreenElement);
});

function updateStellariumBgVisibility() {
  // stelInBackground — should Stellarium's real WASM sky actually composite
  // onto the canvas. CENTER-VIEW-ONLY: Stellarium's engine is inherently
  // first-person (a fixed ~fisheye view from standing on the ground), which
  // is exactly what center view is — but outside view is a third-person
  // shot of a small distant globe MODEL, a completely different framing
  // that Stellarium's own dome-shaped render doesn't fit into at any fov.
  // (An earlier attempt made this true in both views — the un-warped
  // Stellarium sky then filled the whole screen behind the tiny globe,
  // reported as "it looks like we're inside again.") hideOwnSky mirrors it
  // 1:1 now — no reason left for a separate variable, but kept named for
  // clarity at each call site below.
  const stelInBackground = centerView && !!stelInstance;
  const hideOwnSky = stelInBackground;
  stelBgCanvas.style.display = stelInBackground ? 'block' : 'none';
  // Bar itself is just buttons, not Stellarium's rendered sky — stays
  // available in both views once loaded (requested: available immediately,
  // not only after round-tripping through center view once).
  stellariumBar.classList.toggle('visible', !!stelInstance);
  // cst-art/cst-lines/atmosphere (.center-only, see index.html) only mean
  // anything where Stellarium's real background actually renders.
  stellariumBar.classList.toggle('center-view', centerView);
  renderer.setClearAlpha(stelInBackground ? 0 : 1);
  // Stellarium now draws the real atmosphere/stars — this app's own dome +
  // milky way (both fully cover the canvas, additive) would otherwise sit
  // in front of it. Ground stays OURS though: Stellarium's own landscape is
  // deliberately off (bridge.js) since this app already has its own
  // Horn-Koppe photo ground — hiding both would leave no ground at all.
  if (sky) {
    sky.skyDomeMesh.visible = !hideOwnSky;
    sky.milkyWayMesh.visible = !hideOwnSky;
  }
  starFieldMeshes.forEach((m) => { m.visible = !hideOwnSky; });
  // Zodiac band now also exists natively in Stellarium (see
  // addStellariumZodiacBand) — this app's own ribbon/name-label copies are
  // what was actually smearing across the screen (see stellarium-
  // bridge.js), so hide those. glyphSprite (the ♈ symbol) stays VISIBLE
  // even when Stellarium's active: Stellarium's own geojson "title" text
  // can't render it (its bundled NotoSans font has no coverage for the
  // zodiac Unicode block, U+2648-2653, and nothing in this integration
  // calls stel.setFont to swap it) — this app's own sprite, drawn via the
  // browser's own font stack, is the only thing that actually shows the
  // symbol, so it needs to keep reprojecting live via reprojectRotatables
  // exactly as it always has.
  for (const seg of rotatables.zodiacSegments ?? []) {
    if (seg.ribbonMesh) seg.ribbonMesh.visible = !hideOwnSky;
    if (seg.nameSprite) seg.nameSprite.visible = !hideOwnSky;
  }

  // Azimuthal/equatorial grid buttons + groups: whichever grid is relevant
  // to the CURRENT view (Stellarium's real one in center view, this app's
  // own in outside view) shows/reflects state; the other mode's group (if
  // it exists from a prior rebuild) stays hidden.
  if (ownAzimuthalGroup) ownAzimuthalGroup.visible = ownAzimuthalVisible && !centerView;
  if (ownEquatorialGroup) ownEquatorialGroup.visible = ownEquatorialVisible && !centerView;
  const azBtn = document.getElementById('stel-btn-azimuthal');
  const eqBtn = document.getElementById('stel-btn-equatorial');
  if (centerView) {
    if (stelInstance) {
      azBtn.classList.toggle('active', stelInstance.core.lines.azimuthal.visible);
      eqBtn.classList.toggle('active', stelInstance.core.lines.equatorial.visible);
    }
  } else {
    azBtn.classList.toggle('active', ownAzimuthalVisible);
    eqBtn.classList.toggle('active', ownEquatorialVisible);
  }
}

// Idempotent — lazy-loads Stellarium on first call, no-ops on every call
// after that. Called from setCenterView on entering center view.
function loadStellarium() {
  if (stelInstance || stellariumLoading) return;
  stellariumLoading = true;
  initStellarium(stelBgCanvas).then((stel) => {
    stelInstance = stel;
    stellariumLoading = false;
    if (natalDate && natalObserver) {
      // Astronomy.Observer already stores lat/lon in degrees (its own
      // constructor's input unit) — no radian conversion needed here.
      syncStellariumTime(stel, natalDate);
      syncStellariumLocation(stel, natalObserver.latitude, natalObserver.longitude);
    }
    // Native geojson layer, not a Three.js mesh — see stellarium-
    // bridge.js's header comment for why (this app's own approximate
    // per-vertex warp can smear wide content across the whole screen
    // near the view antipode; Stellarium's real engine doesn't have that
    // failure mode). Built once off whatever date is current right now —
    // see that function's own header for why it's never rebuilt.
    addStellariumZodiacBand(stel, natalDate ?? new Date());
    // Matches the true defaults set in stellarium-bridge.js's initStellarium.
    stelToggleButtons.forEach((btn) => btn.classList.add('active'));
    updateStellariumBgVisibility();
  }).catch((err) => {
    console.error('Stellarium init failed:', err);
    stellariumLoading = false;
  });
}
// Eager, not lazy-on-first-center-view-visit — Stellarium's background and
// bottom bar are now usable from outside view too (see updateStellariumBgVisibility/
// animate above), so there's no single "first time it's needed" moment
// left to hang the lazy-load off of. Starts loading immediately in the
// background; the page itself doesn't wait on it (nothing here blocks on
// this promise).
loadStellarium();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(SPHERE_RADIUS * 2.5, SPHERE_RADIUS * 1.7, SPHERE_RADIUS * 3.0); // matches OUTSIDE_CAMERA_POS below — duplicated because that const isn't declared yet at this point in the file

// Bloom for the real EXR star texture's bright stars, per
// donmccurdy.com/2024/04/27/emission-and-bloom — render to an open [0,∞)
// HDR buffer (EffectComposer's render targets default to HalfFloatType)
// so genuinely-bright pixels survive past 1.0, then UnrealBloomPass
// thresholds and blurs them.
//
// Deliberately NOT adding the article's other half (renderer.toneMapping +
// a final OutputPass): every material in this scene is a flat, exact-hex
// MeshBasicMaterial chosen for legibility (Mars=red, ASC=teal, etc.), not
// meant to read as "lit" — tonemapping's shader chunk applies to EVERY
// material by default (not just this one texture), and would reshape all
// of those colors for no benefit this app wants. Skipping it also avoids a
// real correctness trap: RenderPass and OutputPass share the renderer's
// live toneMapping setting, so naively enabling it tonemaps (clamping to
// ≤1) BEFORE bloom ever sees the HDR values, unless every other material
// is separately marked toneMapped:false.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.4, 1.0);
composer.addPass(bloomPass);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const OUTSIDE_DISTANCE = { min: SPHERE_RADIUS * 1.2, max: SPHERE_RADIUS * 6 };
// Distance chosen so the WHOLE sphere fits in frame with a bit of margin
// at DEFAULT_FOV (32°, half-angle 16°): a sphere of radius R at distance d
// subtends half-angle asin(R/d), so asin(R/d) needs to stay under 16° with
// room to spare. The previous (1.6,1.1,1.9)*R position was only ~2.72*R out
// — asin(1/2.72)=21.6°, wider than the 16° half-fov, so the sphere's own
// edges were clipped by the frustum (reported: "so we could see the full
// sphere"). This vector keeps the same viewing angle/direction, just scaled
// out to ~4.26*R (asin(1/4.26)=13.6°, comfortably inside 16°).
const OUTSIDE_CAMERA_POS = new THREE.Vector3(SPHERE_RADIUS * 2.5, SPHERE_RADIUS * 1.7, SPHERE_RADIUS * 3.0);
const CENTER_DISTANCE = 0.01; // ~0, but nonzero so orbiting has something to pivot on
controls.minDistance = OUTSIDE_DISTANCE.min;
controls.maxDistance = OUTSIDE_DISTANCE.max;

// "View from center" — the observer's actual first-person view. Rather than
// a different controls scheme, this just collapses OrbitControls' own orbit
// distance to ~0: with the camera pinned that close to its target, dragging
// still "orbits" the camera around the target the same way it always did,
// but since the orbit radius is negligible next to the scene's scale, the
// camera barely moves — the net effect is purely a change of look direction,
// i.e. looking around from a fixed point, using the exact same drag/damping
// behavior as the outside view.
const DEFAULT_FOV = 32; // outside view — plain perspective, warp inactive there
const CENTER_VIEW_FOV = 75; // explicit request — Stellarium's own real default is 50° (core.c: core->fov = 50*DD2R), kept as a reference point in MIN_FOV's comment below, but 75° is the deliberate choice here
const MIN_FOV = 20;
// 185° is Stellarium's own STEREOGRAPHIC projection's UI cap
// (proj_stereographic.c: .max_ui_fov = 185*DD2R — this is the actual
// projection their sky view uses, confirmed from their source; the 120°
// figure from proj_perspective.c cited here earlier was the wrong
// projection class to reference). Their true fov MIN is 1/3600° (arcsecond
// telescope zoom) — not adopted, since our scene has no fine real-scale
// detail to zoom into; MIN_FOV stays a practical UI floor instead. All
// three are NOMINAL fov values (see nominalFov/applyCameraFov below) —
// what actually reaches camera.fov is these remapped through
// stereographicFovRemap.
const MAX_FOV = 185;

let centerView = false;
// The fov the USER perceives/controls (shown nowhere numerically, but what
// the wheel handler and CENTER_VIEW_FOV/MIN_FOV/MAX_FOV mean) — different
// from camera.fov once the stereographic warp is active, since Stellarium's
// own projection feeds a REMAPPED (narrower) fov to the underlying linear
// perspective matrix and lets the warp expand it back out. See
// stereographic.js's stereographicFovRemap and its own file-header proof
// (theirs is proj_stereographic_init: fovy2 = 2*atan(2*tan(fovy/4))).
let nominalFov = CENTER_VIEW_FOV;
function applyCameraFov() {
  camera.fov = centerView ? stereographicFovRemap(nominalFov) : DEFAULT_FOV;
  camera.updateProjectionMatrix();
}
function setCenterView(on) {
  centerView = on;
  // Center view starts decluttered — this app's own equator/ecliptic great
  // circles compete visually with Stellarium's real first-person sky the
  // same way its own N/E/S/W labels and western constellations would (see
  // sky.compassLabels below and the stellarium-bar's az/eq grids, which
  // default off there too — see stellarium-bridge.js). One-directional: only
  // unchecks on the way IN, doesn't restore on the way back out, and the
  // Layers panel checkboxes stay a normal manual toggle either way.
  if (on) {
    let declutter = false;
    if (layerCheckboxes.equator.checked) { layerCheckboxes.equator.checked = false; declutter = true; }
    if (layerCheckboxes.ecliptic.checked) { layerCheckboxes.ecliptic.checked = false; declutter = true; }
    if (declutter) rebuild();
  }
  warpActiveUniform.value = on ? 1.0 : 0.0;
  // OrbitControls maps drag distance to yaw/pitch at a FIXED pixel ratio,
  // independent of fov — calibrated (at the default rotateSpeed=1) for
  // outside view's narrow 32° plain-perspective fov. Center view's much
  // wider, stereographically-warped fov (CENTER_VIEW_FOV) makes the exact
  // same pixel delta sweep a visibly bigger angle on screen, so the few
  // pixels of unavoidable finger-contact jitter a touchscreen registers on
  // a plain TAP (not a real drag) was enough to visibly spin the sky —
  // reported as "the zodiac band rotates when I just tap the screen" on
  // mobile, where mice don't have that jitter so it went unnoticed on
  // desktop. Toned down here so accidental jitter reads as imperceptible
  // and a deliberate look-around swipe still works.
  controls.rotateSpeed = on ? 0.35 : 1;
  if (on) {
    controls.minDistance = CENTER_DISTANCE;
    controls.maxDistance = CENTER_DISTANCE;
    controls.target.set(0, 0, 0);
    // Default look direction: the natal Ascendant. OrbitControls derives
    // the camera's actual facing (target - position) from this offset once
    // controls.update() runs below, at the SAME magnitude (CENTER_DISTANCE)
    // the original fixed (0,0,CENTER_DISTANCE) offset used — just pointed
    // the opposite way from ASC's own direction instead of a fixed +Z, so
    // (target - position) comes out exactly along ascDir.
    const ascDir = lastState?.asc
      ? new THREE.Vector3(...lastState.asc.xyz).normalize()
      : new THREE.Vector3(0, 0, 1);
    camera.position.copy(ascDir).multiplyScalar(-CENTER_DISTANCE);
    nominalFov = CENTER_VIEW_FOV;
    applyCameraFov();
    loadStellarium(); // idempotent, no-ops if already loaded
  } else {
    controls.minDistance = OUTSIDE_DISTANCE.min;
    controls.maxDistance = OUTSIDE_DISTANCE.max;
    controls.target.set(0, 0, 0);
    camera.position.copy(OUTSIDE_CAMERA_POS);
    applyCameraFov();
  }
  controls.update();
  centerViewBtn.textContent = on ? '🌐 Outside view' : '🎯 View from center';
  // See sky-shaders.js: the dome (and, same reasoning, the ground photo)
  // renders only the surface correct for the camera's current side of the
  // shell, to avoid double-hitting both walls of the open bowl (the
  // "brightness is crazy" bug). Swapped from the original (on ? BackSide :
  // FrontSide) — the stereographic warp's mirror fix (o.x=-o.x in
  // stereographic.js, only active when uWarpActive>0.5, i.e. exactly when
  // `on` is true here) is a reflection, and reflections invert triangle
  // winding order, which is what FrontSide/BackSide culling is based on.
  // The warp being introduced flipped which culling side is actually
  // correct for center view — without this, the ground disappeared
  // entirely (culled as "back-facing" after the now-inverted winding) and
  // the dome flickered (same mechanism, less total loss since it's
  // additive-blended rather than alphaTest-masked).
  if (sky) {
    sky.skyDomeMat.side = on ? THREE.FrontSide : THREE.BackSide;
    sky.groundMat.side = on ? THREE.FrontSide : THREE.BackSide;
    sky.horizonRing.visible = !on;
    // Stellarium's own real N/E/S/W labels (cardinal.c) render in center
    // view once its background loads — this app's own compass labels would
    // just duplicate them there.
    sky.compassLabels.visible = !on;
    // Ground photo makes sense wrapped around you from INSIDE (center
    // view) — from outside, it's the same photo wrapped around the
    // sphere's exterior, which doesn't read as a landscape at all, just a
    // textured hemisphere. Center-view-only.
    sky.groundMesh.visible = on;
  }
  // Same fixed-BackSide-vs-warp-mirror issue as sky/ground above — the live
  // ASC marker's outline uses the same backface-expansion trick.
  if (liveAscMarker) liveAscMarker.borderMaterial.side = on ? THREE.FrontSide : THREE.BackSide;
  // Three's CPU frustum culling tests bounding spheres against the
  // UNWARPED (linear, narrower) frustum — the whole point of the warp is
  // that wide true angles compress inward to fit that narrower frustum in
  // the vertex shader, so an object at, say, 80° off-axis is outside the
  // linear frustum and gets culled before the shader ever runs, even
  // though after warping it belongs on screen. Small objects (constellation
  // strands/dots, planet/angle markers, zodiac segments, grid meridians,
  // every label) are the ones this bites — the big origin-centered meshes
  // survive because their bounding spheres contain the camera. Off in
  // outside view, where camera.fov and the actual view already agree.
  if (skyGroup) skyGroup.traverse(o => { o.frustumCulled = !on; });
  updateStellariumBgVisibility();
}

// In center view, orbit "zoom" (dolly toward/away from target) does
// nothing — the camera IS the target, pinned at CENTER_DISTANCE — so
// trackpad/wheel scroll instead widens or narrows the field of view: from a
// narrow, binoculars-like view up to a near-fisheye ~185° that shows almost
// the entire sky dome at once, genuinely stereographic now (see
// stereographic.js) rather than an ultra-wide perspective camera — the same
// projection Stellarium's own sky view uses. Outside view is untouched —
// OrbitControls' own dolly-zoom still handles scroll there, and the warp is
// inactive (plain perspective, looking at the globe from afar).
canvas.addEventListener('wheel', (e) => {
  if (!centerView) return;
  e.preventDefault();
  nominalFov = Math.max(MIN_FOV, Math.min(MAX_FOV, nominalFov + e.deltaY * 0.05));
  applyCameraFov();
  camera.updateProjectionMatrix();
}, { passive: false });

scene.add(new THREE.AmbientLight(0xffffff, 1));

let skyGroup = null;
let rotatables = { planetMarkers: [], eclipticLine: null, eclipticLabels: [], eclipticPoints: [], zodiacSegments: [], equatorialMeridianGroup: null, constellationGroup: null };
let natalDate = null;
let natalObserver = null;
let lastState = null;

// Primary-direction playback state.
let direction = null;
let directionYears = 0;
let isPlaying = false;
let playYearsPerSecond = 10;
let directionMarker = null; // { markerMesh, markerMaterial, label }
let liveAscMarker = null; // { markerMesh, label } — where the ASC really is, live, during day-rotation
let liveAscPerpLine = null; // short crosshair line through liveAscMarker, perpendicular to the zodiac band
let sky = null; // { groundMat, milkyWayMat, milkyWayMesh, skyDomeMat, horizonRing } from buildSphere, via buildSkyGroup
let cachedSunMarker = null; // set once in rebuild(), not re-.find()'d every animate() frame
let equatorialGridMaterial = null; // shared screen-space-line material (sky-shaders.js) — needs uResolution kept current, see animate()
let azimuthalGridMaterial = null; // same, for this app's own outside-view azimuthal grid
let starFieldMeshes = []; // THREE.Points per magnitude tier — rotated together for playback
let natalPoleDirection = null; // THREE.Vector3, set at rebuild() — axis the star field rotates around

// Real catalog stars (Hipparcos/Yale/Gliese "HYG" database, public domain,
// filtered to mag<=5.0 — see the file's own header). Tiny (~44KB) compared
// to a texture, fetched once; rebuild() just no-ops the star-field part
// until this resolves, then a rebuild is triggered so it appears.
let starCatalog = null;
fetch('/bright_stars.json').then(r => r.json()).then(data => { starCatalog = data; rebuild(); });
let boundCrossings = []; // Egyptian-bound changes the current direction passes through

// Diurnal-rotation playback — the sky's own real 24h turn, independent of
// (and additive with) any primary-direction playback above. 360° = one
// sidereal day. DAY_ROTATION_SECONDS is how long a full loop takes to play.
let dayRotationDeg = 0;
let dayRotating = false;
const DAY_ROTATION_SECONDS = 18;
function totalRotationDeg() {
  return directionYears * NAIBOD_DEG_PER_YEAR + dayRotationDeg;
}

function resize() {
  const { clientWidth, clientHeight } = canvas.parentElement;
  renderer.setSize(clientWidth, clientHeight, false);
  composer.setSize(clientWidth, clientHeight);
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
    path: layers.path && significatorIsBody,
    positionCircle: layers.positionCircle && !!significatorKey,
    aspectPlane: layers.aspectPlane && significatorIsBody,
    direction: layers.direction && !!(significatorKey && promissorKey),
  };
  legendRows.forEach(row => { row.hidden = !visible[row.dataset.layer]; });
}

function updateReadout() {
  if (!direction) {
    readout.textContent = '—';
    directionPanel.classList.remove('hit', 'long-arc');
    return;
  }
  const hit = directionYears >= direction.arcYears;
  directionPanel.classList.toggle('hit', hit);
  // Past a normal lifespan (self-returns especially — e.g. Jupiter to
  // Jupiter is a ~365-year period) — greys the promissor/aspect/
  // significator selection row itself, not just a table row elsewhere,
  // since THIS pairing is the one actually selected and playable right
  // now. Still fully functional (transport/tour both still work on it) —
  // greyed as a "this exceeds a normal lifespan" signal, not disabled.
  directionPanel.classList.toggle('long-arc', direction.arcYears > 90);
  readout.textContent = hit
    ? `Directional arc reached — ${direction.arcYears.toFixed(1)} yrs${direction.swapped ? ' (converse)' : ''}`
    : `Directional arc: ${directionYears.toFixed(1)} / ${direction.arcYears.toFixed(1)} yrs${direction.swapped ? ' (converse)' : ''}`;
  updateBoundCrossingsPassed();
}

// Egyptian-bound changes along the moving point's directed path — a change
// of dignity mid-direction, traditionally read as significant in its own
// right (not just where the direction ultimately lands). Clicking a chip
// jumps the transport to that year.
function renderBoundCrossings() {
  boundCrossingsEl.innerHTML = boundCrossings.map((c, i) => {
    const glyph = key => PLANET_GLYPHS[key] ?? key;
    return `<span class="crossing" data-index="${i}" title="${c.from.ruler} → ${c.to.ruler}">${c.years.toFixed(1)}y ${glyph(c.from.ruler)}→${glyph(c.to.ruler)}</span>`;
  }).join('');
  boundCrossingsEl.querySelectorAll('.crossing').forEach(el => {
    el.addEventListener('click', () => {
      stopPlaying();
      setDirectionYears(boundCrossings[Number(el.dataset.index)].years);
    });
  });
  updateBoundCrossingsPassed();
}

function updateBoundCrossingsPassed() {
  boundCrossingsEl.querySelectorAll('.crossing').forEach((el, i) => {
    el.classList.toggle('passed', boundCrossings[i].years <= directionYears);
  });
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

  // Background sky (day/night crossfade, Milky Way orientation, star
  // field) tracks the SAME combined rotation as everything else here —
  // both primary-direction (years) and day-rotation playback physically
  // represent the sky turning, so both should move it. Star field uses
  // the cheap single-rotation approximation (verified against per-star
  // reprojection); Milky Way keeps the full basis recompute since it's
  // just 2 horizonOf calls either way.
  if (sky) {
    const liveState = computeSkyState(fakeDate, natalObserver.latitude, natalObserver.longitude, SPHERE_RADIUS);
    const sunPlanet = liveState.planets.find(p => p.key === 'Sun');
    setSkyDayNight(sunPlanet?.altitude ?? 0, sunPlanet?.azimuth ?? 0, fakeDate, natalObserver);
  }
  if (natalPoleDirection) {
    const poleQuat = new THREE.Quaternion().setFromAxisAngle(natalPoleDirection, (rotationDeg * Math.PI) / 180);
    for (const m of starFieldMeshes) m.quaternion.copy(poleQuat);
    // Constellations (lines+dots+name labels, all one group) and RA
    // meridians are fixed celestial content, same as the star field — a
    // single rigid rotation around the natal pole axis reproduces their
    // true reprojection exactly, far cheaper than the old approach
    // (recomputing every point's horizon position and rebuilding
    // TubeGeometry/BufferGeometry from scratch every single frame, which
    // was visibly stuttering during day-rotation/direction playback).
    if (rotatables.constellationGroup) rotatables.constellationGroup.quaternion.copy(poleQuat);
    if (rotatables.equatorialMeridianGroup) rotatables.equatorialMeridianGroup.quaternion.copy(poleQuat);
    if (rotatables.equatorGroup) rotatables.equatorGroup.quaternion.copy(poleQuat);
  }

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
    // The geometry's cached bounding sphere was computed from the ORIGINAL
    // (natal) positions and doesn't auto-update when the buffer is mutated
    // directly — without this, the renderer's frustum culling can use that
    // stale volume and wrongly decide a now-rotated-into-view line is still
    // off-screen, silently skipping it.
    rotatables.eclipticLine.geometry.computeBoundingSphere();
  }
  for (const l of rotatables.eclipticLabels) {
    const [x, y, z] = reposition(l.ra, l.dec);
    const len = Math.hypot(x, y, z) || 1;
    l.sprite.position.set((x / len) * (SPHERE_RADIUS * 1.03), (y / len) * (SPHERE_RADIUS * 1.03), (z / len) * (SPHERE_RADIUS * 1.03));
  }

  // RA meridians and constellations are handled above via the pole
  // quaternion (poleQuat), not per-point here — see that block.

  // Zodiac band moves WITH the planets (it's ecliptic content, same as
  // them) — otherwise planets visibly detach from their own zodiac band
  // as soon as any direction is played, which reads as broken.
  for (const seg of rotatables.zodiacSegments ?? []) {
    if (seg.ribbonMesh) {
      const posAttr = seg.ribbonMesh.geometry.attributes.position;
      const n = seg.innerPts.length;
      for (let i = 0; i < n; i++) {
        const [ix, iy, iz] = reposition(seg.innerPts[i].ra, seg.innerPts[i].dec);
        const [ox, oy, oz] = reposition(seg.outerPts[i].ra, seg.outerPts[i].dec);
        posAttr.setXYZ(i * 2, ix, iy, iz);
        posAttr.setXYZ(i * 2 + 1, ox, oy, oz);
      }
      posAttr.needsUpdate = true;
      // Same stale-bounding-sphere frustum-culling trap as the ecliptic
      // line above — each sign's own ribbon segment mesh has its own
      // cached bounding sphere that needs recomputing after reprojection,
      // or the renderer can wrongly cull it once it's rotated into view.
      seg.ribbonMesh.geometry.computeBoundingSphere();
    }
    const [mx, my, mz] = reposition(seg.midRa, seg.midDec);
    const mlen = Math.hypot(mx, my, mz) || 1;
    const dir = [mx / mlen, my / mlen, mz / mlen];
    if (seg.glyphSprite) seg.glyphSprite.position.set(dir[0] * (SPHERE_RADIUS * 1.01), dir[1] * (SPHERE_RADIUS * 1.01), dir[2] * (SPHERE_RADIUS * 1.01));
    if (seg.nameSprite) seg.nameSprite.position.set(dir[0] * (SPHERE_RADIUS * 1.16), dir[1] * (SPHERE_RADIUS * 1.16) - 0.15, dir[2] * (SPHERE_RADIUS * 1.16));
  }
}

function setDirectionYears(t) {
  if (!direction) return;
  directionYears = Math.max(0, Math.min(t, direction.arcYears));
  if (directionMarker) {
    directionMarker.markerMesh.position.set(...direction.directedXYZ(directionYears));
    directionMarker.label.position.copy(directionMarker.markerMesh.position).multiplyScalar(1.12);
    updateDirectionSweepLines(directionMarker.traveledLine, directionMarker.remainingLine, direction, directionYears);
    // Which Egyptian bound the promissor is CURRENTLY traveling through —
    // redrawn only when it actually changes (not every frame during
    // playback, which would otherwise repaint the label's canvas ~60x/sec
    // for a value that's usually unchanged across many consecutive frames).
    if (directionMarker.boundLabel && direction.directedElon) {
      const bound = boundOf(direction.directedElon(directionYears));
      if (bound.ruler !== directionMarker.lastBoundRuler) {
        directionMarker.lastBoundRuler = bound.ruler;
        updateTextSprite(directionMarker.boundLabel, `${pointLabel(bound.ruler)}'s bound`, { color: '#8b5cf6', size: 26, weight: '700', scale: 0.19 });
        directionMarker.boundLabel.visible = true;
      }
      directionMarker.boundLabel.position.copy(directionMarker.markerMesh.position).multiplyScalar(1.22);
    }
    const hit = directionYears >= direction.arcYears;
    directionMarker.markerMaterial.color.set(hit ? DIRECTION_COLORS.hit : DIRECTION_COLORS.active);
    if (hit) stopPlaying();
  }
  // Deliberately NOT syncing Stellarium's clock to directionYears (unlike
  // setDayRotationDeg below, which does sync). directionYears is a SYMBOLIC
  // primary-direction arc — this app's own planet markers represent it by
  // holding each planet's RA/Dec fixed at its NATAL value and rotating only
  // by the equivalent hour-angle (reposition() below), which has no real
  // orbital motion in it at all. Stellarium has no such symbolic mode — it
  // only computes TRUE ephemeris positions for a real calendar date. Naively
  // feeding totalRotationDeg (years+day) into Stellarium's clock was tried
  // and was WRONG: since years feed through the same
  // (rotationDeg/360)*SIDEREAL_DAY_MS formula as day-rotation, "30 years of
  // direction" advanced Stellarium's clock by ~30 SIDEREAL DAYS, not 30
  // years — real planets ended up in essentially arbitrary positions,
  // unrelated to either the natal chart or the symbolic direction being
  // played. Leaving Stellarium's clock alone during years-playback (frozen
  // at whatever day-rotation moment it was last synced to) is the more
  // honest choice: Stellarium shows the real sky at a real moment, this
  // app's own markers show the symbolic technique on top of it — the two
  // are not expected to depict the same planet positions once years are
  // involved, by design of what each is showing.
  reprojectRotatables(totalRotationDeg());
  slider.value = String(directionYears);
  updateReadout();
}

function formatClockTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function setDayRotationDeg(deg) {
  dayRotationDeg = ((deg % 360) + 360) % 360;
  reprojectRotatables(totalRotationDeg());
  dayRotationSlider.value = String(dayRotationDeg);

  // The natal ASC/DSC/MC/IC markers stay frozen at their birth-moment
  // position (correct for primary directions, misleading here — the real
  // ascendant changes sign roughly every two hours) — so recompute the true
  // angles live at this rotated moment, both for a text readout and to move
  // a separate, dedicated "ASC now" 3D marker to where the ascendant
  // genuinely is right now, matching how it'd actually look outside.
  if (natalObserver) {
    const fakeDate = siderealRotatedDate(natalDate, dayRotationDeg);
    dayRotationReadout.textContent = `${formatClockTime(fakeDate)} (+${(dayRotationDeg / 15).toFixed(1)}h)`;
    const liveState = computeSkyState(fakeDate, natalObserver.latitude, natalObserver.longitude, SPHERE_RADIUS);
    dayRotationAscReadout.textContent = liveState.asc ? formatEclipticDegree(liveState.asc.deg) : '—';
    refreshActiveConstructionAtRotation(fakeDate, liveState);

    if (liveAscMarker && liveState.asc) {
      const visible = dayRotationDeg !== 0;
      liveAscMarker.markerMesh.visible = visible;
      liveAscMarker.label.visible = visible;
      if (liveAscPerpLine) liveAscPerpLine.visible = visible;
      if (visible) {
        liveAscMarker.markerMesh.position.set(...liveState.asc.xyz);
        liveAscMarker.markerMesh.material.color.set(elementColorForDeg(liveState.asc.deg));
        liveAscMarker.label.position.copy(liveAscMarker.markerMesh.position).multiplyScalar(1.12);
        updateTextSprite(liveAscMarker.label, `ASC ${formatEclipticDegree(liveState.asc.deg)}`, { color: '#0e8a94', size: 28, weight: '700', scale: 0.2 });
        const signIndex = Math.floor((((liveState.asc.deg % 360) + 360) % 360) / 30);
        updateTextSprite(liveAscMarker.glyphSprite, ZODIAC_SIGNS[signIndex].glyph, {
          color: '#ffffff', size: 56, weight: '700', scale: 0.42, stroke: '#000000', strokeWidth: 5,
        });
        if (liveAscPerpLine) {
          const seg = computeAscPerpendicular(liveState.asc.deg, fakeDate, natalObserver, SPHERE_RADIUS);
          updateAscPerpendicularLine(liveAscPerpLine, seg.points.map(p => p.xyz));
        }
      }
    }
  }

  // dayRotationDeg ALONE, deliberately not totalRotationDeg — day-rotation
  // is real elapsed hours, which Stellarium's real clock can faithfully
  // represent; directionYears is a symbolic arc with no real-calendar-time
  // meaning (see the long comment in setDirectionYears for why folding it
  // into Stellarium's clock was tried and was wrong — it moved Stellarium's
  // date by ~years/360 SIDEREAL DAYS, not years, scattering its real
  // planets to arbitrary unrelated positions).
  // Deliberately LAST in this function, after all the core readout/marker
  // updates above — this is newer, more experimental integration code, and
  // if it ever throws (Stellarium not fully ready, etc.) it must not be
  // able to silently abort the ASC readout/marker logic that already
  // worked correctly before Stellarium existed.
  if (stelInstance && natalDate) {
    syncStellariumTime(stelInstance, siderealRotatedDate(natalDate, dayRotationDeg));
  }
}

// dayFactor drives the ground photo's own brightness (color-multiplied
// toward black at night, same technique as Stellarium's
// get_global_brightness() — see groundMat's comment in scene.js) and the
// Milky Way's crossfade opacity. The sky itself is the real Preetham dome
// (sky-shaders.js) — it needs no crossfade, just the sun's direction and a
// night-fade uniform (see that file for why the fade exists: Preetham's
// fit isn't valid for deep-night sun angles).
function setSkyDayNight(sunAltitudeDeg, sunAzimuthDeg, date, observer) {
  if (!sky) return;
  const dayFactor = Math.max(0, Math.min(1, (sunAltitudeDeg + 8) / 10));
  sky.groundMat.color.setScalar(dayFactor);
  // NOT touching alphaTest here — tried disabling it at night to force the
  // whole disc opaque, but the ground geometry deliberately extends ~40°
  // ABOVE the true horizon (to hold the photo's own sky-to-terrain margin,
  // see GROUND_THETA_START); alphaTest is what keeps that margin's real-sky
  // pixels transparent so content above the true horizon stays visible.
  // Disabling it made the ground swallow everything up to +40° altitude at
  // night, not just below the true horizon — the zodiac band "breaking"
  // early during night hours. The color tint alone already makes the
  // opaque (terrain) pixels solid black at night; that's sufficient.
  // Capped well under 1 — at full opacity the source photo's dust-lane
  // texture reads as a busy brown cloud, not the soft pale glow real dark
  // skies (and Stellarium's own rendering) show.
  sky.milkyWayMat.opacity = (1 - dayFactor) * 0.35;
  setEquatorialSphereOrientation(sky.milkyWayMesh, computeSkyRotationBasis(date, observer, SPHERE_RADIUS));

  // The real catalog star field had NO day/night dimming at all — it
  // always rendered at full catalog brightness, additively stacking with
  // the (already fairly bright) daytime sky dome across ~1600 stars
  // scattered over the whole dome. That's enough combined additive light
  // to push large areas past the bloom threshold, which is what was
  // actually behind "the whole sky is too bright" persisting after the
  // dome's own tonemap and the yellow-color fixes — those were real bugs
  // too, but this is what was still swamping the screen in daylight.
  if (starFieldMeshes[0]) starFieldMeshes[0].material.uniforms.uDayFade.value = 1 - dayFactor;

  const [sx, sy, sz] = altAzToXYZ(sunAltitudeDeg, sunAzimuthDeg, 1);
  sky.skyDomeMat.uniforms.uSun.value.set(sx, sy, sz);

  // Real sky luminance (Schaefer 1998, skybrightness.js) — replaces the old
  // Preetham-Yz-plus-uNightFade approximation. See skybrightness.js's
  // header for exactly what this ports and what's disclosed-simplified.
  const moon = computeMoonInfo(date, observer);
  const [mx, my, mz] = altAzToXYZ(moon.altitude, moon.azimuth, 1);
  sky.skyDomeMat.uniforms.uMoon.value.set(mx, my, mz);

  const sb = skybrightnessPrepare({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    moonMag: moon.mag,
    latitudeRad: (observer.latitude * Math.PI) / 180,
    altitudeM: 0, // makeObserver always uses sea level — no elevation input in this app
    distMoonZenithRad: ((90 - moon.altitude) * Math.PI) / 180,
    distSunZenithRad: ((90 - sunAltitudeDeg) * Math.PI) / 180,
  });
  sky.skyDomeMat.uniforms.uSbNightTerm.value = sb.bNightTerm;
  sky.skyDomeMat.uniforms.uSbK.value = sb.K;
  sky.skyDomeMat.uniforms.uSbMoonTerm.value = sb.bMoonTerm;
  sky.skyDomeMat.uniforms.uSbC3.value = sb.C3;
  sky.skyDomeMat.uniforms.uSbTwilightTerm.value = sb.bTwilightTerm;
  sky.skyDomeMat.uniforms.uSbC4.value = sb.C4;

  // Tonemap white-point: their own shape, log(1+p*L)/log(1+p*Lwmax). Third
  // attempt — the first two each solved one problem and broke the other:
  //   1. Per-moment reference (zenith, then luminance-at-the-sun) — this
  //      tonemap is PURELY relative, so whenever L is close to its own
  //      reference the ratio approaches 1 (white) regardless of absolute
  //      scale. A clear night sky is fairly uniform, so sampling the
  //      reference FROM the night sky made the whole night read as white.
  //   2. Fixed absolute reference (~8000 cd/m², clear-noon-zenith) — fixed
  //      night correctly, but the log curve saturates fast: once L passes
  //      roughly Lwmax/10 the ratio is already near its ceiling, so the
  //      whole sky reads close to max within the first few degrees of
  //      sunrise — a physically-driven brightness increase, but the FIXED
  //      reference gave it nowhere to go, so it read as an abrupt snap
  //      rather than a gradual dawn.
  // Fix: a per-moment reference (luminance AT the sun's own position, so
  // the reference tracks whichever regime actually dominates) FLOORED at
  // a fixed minimum — the floor is what stops a uniformly-dim night from
  // reading as its own white point, and the tracking is what keeps
  // sunrise from slamming into a fixed ceiling within a few degrees.
  // Verified numerically across the full sun-altitude range: night stays
  // near-black, twilight graduates smoothly, sunrise ramps over a wider
  // effective range instead of snapping, day stays bright and stable.
  const cosZenithAtSun = Math.max(Math.abs(sy), 0.02);
  const cosSunMoonDist = sx * mx + sy * my + sz * mz;
  const lumAtSun = skybrightnessGetLuminance(sb, cosSunMoonDist, 1.0, cosZenithAtSun);
  sky.skyDomeMat.uniforms.uLwmax.value = Math.max(lumAtSun, 600);

  // Their planets.c sun-halo layer (see sunHaloTexture's comment in
  // scene.js): opacity = |sin(altitude)|, their own "ad-hoc" formula —
  // fades to 0 right at the horizon, full strength both high in the sky
  // and (harmlessly, since it's depth-tested behind the opaque ground
  // there) below it.
  sunHaloBaseOpacity = Math.abs(Math.sin((sunAltitudeDeg * Math.PI) / 180));
  applySunBrightness();
}

// sunHaloBaseOpacity is the |sin(altitude)| value computed in
// setSkyDayNight — applied to the halo sprite here. uBrightness (the
// point-shader uniform) stays at its material default (1.0, sky-
// shaders.js) — no longer scaled live, so it isn't touched here at all.
let sunHaloBaseOpacity = 0;
function applySunBrightness() {
  if (!cachedSunMarker?.haloMat) return;
  cachedSunMarker.haloMat.opacity = sunHaloBaseOpacity;
}

function rebuild() {
  const date = new Date(dateInput.value || Date.now());
  const latitude = parseFloat(latInput.value);
  const longitude = parseFloat(lonInput.value);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return;

  if (stelInstance) {
    syncStellariumTime(stelInstance, date);
    syncStellariumLocation(stelInstance, latitude, longitude);
  }

  stopPlaying();
  stopRegioConstruction();
  stopPlacidusConstruction();
  const preservedDayRotationDeg = dayRotationDeg; // a layer toggle etc. shouldn't reset "what time it is"
  dayRotating = false;
  dayRotateBtn.textContent = '▶';

  if (skyGroup) {
    scene.remove(skyGroup);
    skyGroup.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        // Only dispose PER-INSTANCE textures (each label's own CanvasTexture)
        // — milkyWayTexture/groundTexture are module-level singletons
        // (TextureLoader-based, isCanvasTexture is false, already excluded
        // naturally) but starGlowTexture AND sunHaloTexture are ALSO
        // module-level singletons despite being CanvasTextures
        // (makeGlowTexture in scene.js), so both need an explicit
        // exclusion here too — the same class of bug recurs for any future
        // makeGlowTexture() singleton, so check this list first if a glow
        // ever goes missing after a rebuild.
        const map = obj.material.map;
        if (map?.isCanvasTexture && map !== starGlowTexture && map !== sunHaloTexture) map.dispose();
        obj.material.dispose();
      }
    });
  }

  const layers = readLayerCheckboxes();

  natalDate = date;
  const state = computeSkyState(date, latitude, longitude, SPHERE_RADIUS);
  natalObserver = state.observer;
  lastState = state;
  const built = buildSkyGroup(state, layers);
  skyGroup = built.group;
  rotatables = built.rotatables;
  cachedSunMarker = rotatables.planetMarkers?.find(m => m.key === 'Sun') ?? null;
  sky = built.sky;
  // Swapped — see setCenterView's identical assignment for why (stereographic
  // warp's mirror fix inverts triangle winding, flipping which culling side
  // is correct whenever the warp is active, i.e. whenever centerView is true).
  sky.skyDomeMat.side = centerView ? THREE.FrontSide : THREE.BackSide;
  sky.groundMat.side = centerView ? THREE.FrontSide : THREE.BackSide;
  sky.horizonRing.visible = !centerView;
  sky.compassLabels.visible = !centerView; // see setCenterView's identical line for why
  sky.groundMesh.visible = centerView; // see setCenterView's identical line for why
  const sunPlanet = state.planets.find(p => p.key === 'Sun');
  setSkyDayNight(sunPlanet?.altitude ?? 0, sunPlanet?.azimuth ?? 0, date, state.observer);

  natalPoleDirection = new THREE.Vector3(...state.poleXYZ).normalize();
  starFieldMeshes = [];
  if (starCatalog) {
    const stars = computeStarField(date, state.observer, SPHERE_RADIUS, starCatalog);
    const starField = buildStarField(stars);
    skyGroup.add(starField.group);
    starFieldMeshes = starField.meshes;
  }

  liveAscMarker = buildLiveAscMarker();
  liveAscMarker.borderMaterial.side = centerView ? THREE.FrontSide : THREE.BackSide;
  skyGroup.add(liveAscMarker.markerMesh);
  skyGroup.add(liveAscMarker.label);
  liveAscPerpLine = buildAscPerpendicularLine();
  skyGroup.add(liveAscPerpLine);

  if (layers.zodiacBand || layers.zodiacNames) {
    const zodiacBand = computeZodiacBand(date, state.observer, SPHERE_RADIUS);
    const zb = buildZodiacBand(zodiacBand, { band: layers.zodiacBand, names: layers.zodiacNames });
    skyGroup.add(zb.group);
    rotatables.zodiacSegments = zb.segments;
  }

  // Were user-adjustable sliders; now fixed at their old defaults.
  const constellationLineWidth = 0.008;
  const otherLineWidth = 0.015;

  // Own azimuthal/equatorial grids — only ever the ones actually shown
  // (outside view; center view uses Stellarium's real grids instead, see
  // updateStellariumBgVisibility), but always built here since skyGroup
  // itself gets fully torn down/rebuilt above. Visibility gets set to the
  // persisted toggle state immediately, then resynced (along with the
  // bottom-bar buttons) by updateStellariumBgVisibility() at the end of
  // this function.
  const equatorialGrid = computeEquatorialGrid(date, state.observer, SPHERE_RADIUS);
  const eqGrid = buildEquatorialGrid(equatorialGrid, { radius: otherLineWidth });
  skyGroup.add(eqGrid.group);
  ownEquatorialGroup = eqGrid.group;
  rotatables.equatorialMeridianGroup = eqGrid.meridianGroup;
  equatorialGridMaterial = eqGrid.gridLineMaterial;

  const azimuthalGrid = computeAzimuthalGrid(SPHERE_RADIUS);
  const azGrid = buildAzimuthalGrid(azimuthalGrid, { radius: otherLineWidth });
  skyGroup.add(azGrid.group);
  ownAzimuthalGroup = azGrid.group;
  azimuthalGridMaterial = azGrid.gridLineMaterial;
  // This app's own constellation rendering removed entirely (was a
  // redundant duplicate once Stellarium's own real constellations were
  // turned on — see the bottom bar's "Constellations" button, which is now
  // the sole control). Stellarium naturally shows whichever constellations
  // are currently in view — since the zodiac band sits along the
  // ecliptic, the zodiac constellations show up there routinely; the rest
  // only appear incidentally while panning elsewhere. No special-casing
  // needed to get that effect — it just falls out of real content.

  const significatorKey = significatorSelect.value;
  if (significatorKey) {
    // Real motion path only makes sense for an actual orbiting body — angles
    // (ASC/DSC/MC/IC) aren't astronomy-engine bodies and have no loop of
    // their own, so skip that part for them but still show a position circle.
    if (BODY_BY_KEY[significatorKey]) {
      const body = BODY_BY_KEY[significatorKey];
      if (layers.path) {
        const windowDays = PATH_WINDOW_DAYS[significatorKey] ?? 200;
        const path = computePlanetPath(body, date, state.observer, windowDays, SPHERE_RADIUS);
        skyGroup.add(buildPlanetPath(path, significatorKey));
      }

      if (layers.aspectPlane) {
        const aspectPlane = computeAspectPlane(body, date, state.observer, SPHERE_RADIUS);
        skyGroup.add(buildAspectPlane(aspectPlane, significatorKey, { radius: otherLineWidth }));
      }
    }

    if (layers.positionCircle) {
      const significatorPoint = resolveDirectionPoint(significatorKey, state);
      if (significatorPoint) {
        const eq = significatorPoint.body ? state.planets.find(p => p.key === significatorKey) : significatorPoint;
        const posCircle = computePositionCircle(eq.ra, date, state.observer, SPHERE_RADIUS);
        skyGroup.add(buildPositionCircle(posCircle, significatorKey, { radius: otherLineWidth }));
      }
    }
  }

  const promissorKey = promissorSelect.value;
  const aspectDeg = parseFloat(aspectSelect.value) * parseFloat(aspectDirectionSelect.value);
  direction = null;
  directionMarker = null;
  directionYears = 0;
  if (significatorKey && promissorKey) {
    let promissorPoint = resolveDirectionPoint(promissorKey, state);

    // A non-conjunction aspect is cast IN THE PROMISSOR'S ASPECT PLANE, not
    // the ecliptic — that's the whole point of the Morinus construction.
    // Only meaningful for a real body (angles sit at elat=0, so their
    // "aspect plane" would just be the ecliptic itself).
    if (aspectDeg !== 0 && BODY_BY_KEY[promissorKey]) {
      const promissorAspectPlane = computeAspectPlane(BODY_BY_KEY[promissorKey], date, state.observer, SPHERE_RADIUS);
      if (layers.aspectPlane) skyGroup.add(buildAspectPlane(promissorAspectPlane, promissorKey, { radius: otherLineWidth }));
      const aspectPoint = computeAspectPoint(promissorAspectPlane, aspectDeg);
      promissorPoint = { key: `${promissorKey} ${ASPECT_GLYPHS[aspectSelect.value]}`, ra: aspectPoint.ra, dec: aspectPoint.dec };
    }

    const isSelfReturn = promissorKey === significatorKey;
    direction = systemSelect.value === 'placidus' && !isSelfReturn
      ? computePlacidusDirection(
          promissorPoint, resolveDirectionPoint(significatorKey, state),
          date, state.observer, { mc: state.mc }, SPHERE_RADIUS,
        )
      : computeDirection(
          promissorPoint, resolveDirectionPoint(significatorKey, state),
          date, state.observer, SPHERE_RADIUS, { selfReturn: isSelfReturn },
        );
    const { group, markerMesh, markerMaterial, label, traveledLine, remainingLine, boundLabel } = buildDirectionGroup(direction, direction.movingKey, direction.fixedKey);
    group.visible = layers.direction;
    skyGroup.add(group);
    directionMarker = { markerMesh, markerMaterial, label, traveledLine, remainingLine, boundLabel };
    setDirectionYears(0); // initializes traveled/remaining split + bound label, not just marker position
    slider.max = String(direction.arcYears);
    playYearsPerSecond = Math.max(1, direction.arcYears / 8);
    boundCrossings = computeBoundCrossings(direction);
  } else {
    slider.max = '1';
    boundCrossings = [];
  }
  slider.value = '0';
  renderBoundCrossings();
  updateReadout();
  updateLegend(layers, significatorKey, promissorKey);

  scene.add(skyGroup);
  // Fresh objects default frustumCulled=true — reapply the current view
  // mode's setting (see setCenterView) since a rebuild() (date/layer/line-
  // width change, etc.) doesn't otherwise touch it.
  skyGroup.traverse(o => { o.frustumCulled = !centerView; });

  setDayRotationDeg(preservedDayRotationDeg);
  if (!chart2dPanel.hidden) renderChart2DPanel();
  // Fresh sky.group/starFieldMeshes default visible=true — reapply current
  // Stellarium hide-state (see updateStellariumBgVisibility) since it
  // doesn't otherwise survive a rebuild.
  updateStellariumBgVisibility();
  syncDaySlider();
}

function renderChart2DPanel() {
  if (!lastState) return;
  const showHouses = chart2dHousesCheckbox.checked;
  const showBounds = chart2dBoundsCheckbox.checked;
  const houses = showHouses
    ? (chart2dHouseSystemSelect.value === 'whole-sign'
        ? (lastState.asc ? computeWholeSignHouses(lastState.asc) : null)
        : computeRegiomontanusHouses(natalDate, natalObserver, { mc: lastState.mc, ic: lastState.ic, asc: lastState.asc, dsc: lastState.dsc }, SPHERE_RADIUS))
    : null;
  renderChart2D(chart2dSvg, {
    planets: lastState.planets, asc: lastState.asc, mc: lastState.mc, dsc: lastState.dsc, ic: lastState.ic,
    houses, showHouses, showBounds, dateLabel: natalDate.toISOString().slice(0, 16).replace('T', ' '),
  });
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
  if (dayRotating) {
    setDayRotationDeg(dayRotationDeg + dt * (360 / DAY_ROTATION_SECONDS));
  }
  if (regioAnimActive) {
    advanceRegioConstruction(dt);
  }
  if (placidusAnimActive) {
    advancePlacidusConstruction(dt);
  }
  if (dateStepPlaying) {
    dateStepElapsedMs += dt * DATE_STEP_MS[dateStepUnitSelect.value] * DATE_STEP_RATE_STEPS[dateStepRateIndex];
    // rebuild() itself (full skyGroup teardown/rebuild, star field
    // included) is too heavy to call at a full 60fps without hurting frame
    // rate — throttled to ~12/sec, still reads as continuous motion to the
    // eye rather than the once-a-second jump-cut this replaced.
    if (now - dateStepLastRebuildAt >= DATE_STEP_REBUILD_INTERVAL_MS) {
      dateStepLastRebuildAt = now;
      dateInput.value = toLocalDatetimeValue(new Date(dateStepBaseMs + dateStepElapsedMs));
      rebuild();
    }
  }
  // Guided tour (see startGuidedTour) ends itself the moment playback stops
  // — either naturally (setDirectionYears' own stopPlaying() call on
  // reaching arcYears) or the user pausing manually — rather than hooking
  // every existing dir-transport button individually.
  if (tourActive && !isPlaying) endGuidedTour();
  if (tourActive && centerView && directionMarker) {
    const lookDir = directionMarker.markerMesh.position.clone().normalize();
    camera.position.copy(lookDir).multiplyScalar(-CENTER_DISTANCE);
    controls.target.set(0, 0, 0);
    updateTourNarration(now);
  }
  controls.update();

  if (centerView && stelInstance) {
    // Center-view-only — see updateStellariumBgVisibility's header: outside
    // view is a third-person shot of a distant globe model, not a place
    // Stellarium's first-person sky can meaningfully sync a camera into.
    camera.getWorldDirection(stellariumViewDir);
    syncStellariumCamera(stelInstance, [stellariumViewDir.x, stellariumViewDir.y, stellariumViewDir.z], (nominalFov * Math.PI) / 180);
  }

  // Point size (stars, sun glow) is set in each vertex shader as screen
  // pixels ÷ (-mvPosition.z) — this scale converts that into actual
  // drawing-buffer pixels for the CURRENT fov (which changes continuously
  // in center view via scroll-to-zoom, see the wheel listener above),
  // matching Three.js's own built-in sizeAttenuation convention.
  const px = canvas.parentElement.clientHeight * renderer.getPixelRatio();
  const sizeScale = px / (2 * Math.tan((camera.fov * Math.PI) / 360));
  if (starFieldMeshes[0]) starFieldMeshes[0].material.uniforms.uSizeScale.value = sizeScale;
  if (cachedSunMarker) cachedSunMarker.mesh.material.uniforms.uSizeScale.value = sizeScale;

  // Equatorial/azimuthal grid AND house-construction screen-space line
  // width (sky-shaders.js) also need the current drawing-buffer size in
  // pixels, kept live for window resize.
  if (equatorialGridMaterial || azimuthalGridMaterial || regioConstruction || placidusConstruction) {
    const dpr = renderer.getPixelRatio();
    const res = [canvas.parentElement.clientWidth * dpr, canvas.parentElement.clientHeight * dpr];
    if (equatorialGridMaterial) equatorialGridMaterial.uniforms.uResolution.value.set(...res);
    if (azimuthalGridMaterial) azimuthalGridMaterial.uniforms.uResolution.value.set(...res);
    if (regioConstruction) {
      regioConstruction.lineMaterial.uniforms.uResolution.value.set(...res);
      regioConstruction.tickMaterial.uniforms.uResolution.value.set(...res);
    }
    if (placidusConstruction) {
      placidusConstruction.lineMaterial.uniforms.uResolution.value.set(...res);
      placidusConstruction.tickMaterial.uniforms.uResolution.value.set(...res);
    }
  }

  if (centerView && stelInstance) {
    // Bypass EffectComposer/UnrealBloomPass here — its multi-pass chain
    // ends in a MeshBasicMaterial copy (transparent:false by default) then
    // an AdditiveBlending pass on top, and whether that correctly carries
    // alpha=0 through from RenderPass's transparent clear to the final
    // screen draw is genuinely unclear without visual testing. A plain
    // renderer.render() alpha-composites correctly (well-established,
    // that's what setClearAlpha(0)/alpha:true above is built on) — trades
    // bloom for a background that's guaranteed to actually show through.
    renderer.render(scene, camera);
  } else {
    composer.render();
  }
}

// ── Controls panel ───────────────────────────────────────────────────────

const dateInput = document.getElementById('date-input');
const latInput = document.getElementById('lat-input');
const lonInput = document.getElementById('lon-input');
const nowBtn = document.getElementById('now-btn');
const dayRotateBtn = document.getElementById('day-rotate-btn');
const dateStepBackBtn = document.getElementById('date-step-back');
const datePlayBtn = document.getElementById('date-play');
const dateStepFwdBtn = document.getElementById('date-step-fwd');
const dateStepUnitSelect = document.getElementById('date-step-unit');
const dateStepSlowerBtn = document.getElementById('date-step-slower');
const dateStepFasterBtn = document.getElementById('date-step-faster');
const dateStepRateReadout = document.getElementById('date-step-rate');
const dayRotationSlider = document.getElementById('day-rotation-slider');
const dayRotationReadout = document.getElementById('day-rotation-readout');
const dayRotationAscReadout = document.getElementById('day-rotation-asc');
const centerViewBtn = document.getElementById('center-view-btn');
const significatorSelect = document.getElementById('significator-select');

const LAYER_IDS = ['equator', 'ecliptic', 'planets', 'zodiacBand', 'zodiacNames', 'angles', 'degrees', 'aspectPlane', 'path', 'positionCircle', 'direction'];
const layerCheckboxes = Object.fromEntries(LAYER_IDS.map(id => [id, document.getElementById(`layer-${id}`)]));

const primaryDirectionsToggle = document.getElementById('primary-directions-toggle');

function readLayerCheckboxes() {
  const layers = Object.fromEntries(LAYER_IDS.map(id => [id, layerCheckboxes[id].checked]));
  // Master toggle — "all the things that relate to primary directions":
  // the directional arc itself, the promissor's position circle, the
  // Morinus aspect plane it's cast on, and the significator's real motion
  // path. Their checkboxes are hidden from the Layers panel in lockstep
  // (see syncPrimaryDirectionsLayerRows) whenever this is off, so forcing
  // them false here too keeps a hidden row from silently leaving its layer
  // switched on with no way to turn it back off.
  if (!primaryDirectionsToggle.checked) {
    layers.direction = false;
    layers.positionCircle = false;
    layers.aspectPlane = false;
    layers.path = false;
  }
  return layers;
}

// Hides/shows the four Layers-panel rows above in lockstep with the master
// toggle, rather than leaving inert (or misleadingly still-checked)
// checkboxes visible for layers that can't currently show anything.
const primaryDirectionsLayerRows = document.querySelectorAll('.primary-directions-only');
function syncPrimaryDirectionsLayerRows() {
  const on = primaryDirectionsToggle.checked;
  primaryDirectionsLayerRows.forEach((row) => { row.hidden = !on; });
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
[dateInput, latInput, lonInput, significatorSelect, ...Object.values(layerCheckboxes)].forEach(el => el.addEventListener('change', rebuild));

// ── Mobile day/night gradient slider (day-slider.js) ─────────────────────
// The element refs below still resolve on desktop (CSS just hides the row
// via .mobile-only — see body.is-touch near the top of this file) — but
// syncDaySlider() itself early-exits there, so the ~50 Sun/Moon astronomy
// calls behind computeDayStops never run on every single rebuild() for a
// slider nobody can see.
const daySliderInput = document.getElementById('day-slider');
const daySliderGradient = document.getElementById('day-slider-gradient');
const daySliderHint = document.getElementById('day-slider-hint');
let daySliderCachedStart = null; // Date — only regenerate the gradient when this actually changes
let daySliderCachedStops = null;
let daySliderCachedLat = null;
let daySliderCachedLon = null;

// Repositions the slider/gradient/hint to match the CURRENT dateInput —
// called at the end of every rebuild() (date, location, Now, steppers, any
// of it), so the slider always reflects the single source of truth
// (dateInput) rather than drifting out of sync with it.
function syncDaySlider() {
  if (!document.body.classList.contains('is-touch')) return;
  const date = new Date(dateInput.value || Date.now());
  const latitude = parseFloat(latInput.value);
  const longitude = parseFloat(lonInput.value);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return;
  const start = sliderStartTime(date);
  if (!daySliderCachedStart || daySliderCachedStart.getTime() !== start.getTime()
      || daySliderCachedLat !== latitude || daySliderCachedLon !== longitude) {
    daySliderCachedStart = start;
    daySliderCachedLat = latitude;
    daySliderCachedLon = longitude;
    daySliderCachedStops = computeDayStops(start, latitude, longitude);
    daySliderGradient.innerHTML = buildGradientSvg(daySliderCachedStops);
  }
  const minute = Math.min(1439, Math.max(0, minutesSinceSliderStart(date, daySliderCachedStart)));
  daySliderInput.value = String(minute);
  daySliderHint.textContent = hintForMinute(daySliderCachedStops, minute);
}

// Dragging updates dateInput live but throttles the actual rebuild() (full
// skyGroup teardown/rebuild) to DATE_STEP_REBUILD_INTERVAL_MS — a 'range'
// input's 'input' event fires on every pixel of drag movement, and calling
// something as heavy as rebuild() at that rate visibly stutters (same
// throttle already used for the date-play transport below).
let daySliderLastRebuildAt = 0;
daySliderInput.addEventListener('input', () => {
  if (!daySliderCachedStart) return;
  const minute = parseInt(daySliderInput.value, 10);
  const date = new Date(daySliderCachedStart.getTime() + minute * 60000);
  dateInput.value = toLocalDatetimeValue(date);
  daySliderHint.textContent = hintForMinute(daySliderCachedStops, minute);
  const now = performance.now();
  if (now - daySliderLastRebuildAt >= DATE_STEP_REBUILD_INTERVAL_MS) {
    daySliderLastRebuildAt = now;
    rebuild();
  }
});
// Drag has ended (or a tap without drag) — make sure the very last position
// always lands a rebuild(), even if the throttle above skipped it.
daySliderInput.addEventListener('change', rebuild);

// ── Calendar date stepper ────────────────────────────────────────────────
// Steps the real date-input forward/back by a whole selected unit (no
// numeric multiplier — "1 day" IS the step, same way Stellarium's own real-
// time transport works). Distinct from dayRotating below (which scrubs
// within a single natal day, sidereal degrees, no date change) and from
// the direction transport's `isPlaying` (which scrubs directionYears) —
// all three drive a rebuild() differently, so starting one stops the
// others rather than letting them fight over the date/sky state.
const DATE_STEP_MS = { minute: 60000, hour: 3600000, day: 86400000, week: 604800000 };
let dateStepPlaying = false;
// ◀/▶ step buttons jump by exactly one whole unit (see stepDateBy). Play
// is different on purpose — continuous flow, like the direction transport's
// own play button, not a once-per-second jump-cut: the base moment is
// captured once when play starts, and a running ms offset from it (fed by
// dt every animate() frame, see below) advances the effective date
// smoothly at a rate of "1 selected unit per real second" instead of
// visibly snapping forward in whole-unit increments.
let dateStepBaseMs = 0;
let dateStepElapsedMs = 0;
let dateStepLastRebuildAt = 0;
const DATE_STEP_REBUILD_INTERVAL_MS = 80; // ~12/sec
function stopDateStepping() {
  dateStepPlaying = false;
  datePlayBtn.textContent = '▶';
}
function stepDateBy(units) {
  const ms = DATE_STEP_MS[dateStepUnitSelect.value] * units;
  const d = new Date(dateInput.value || Date.now());
  d.setTime(d.getTime() + ms);
  dateInput.value = toLocalDatetimeValue(d);
  rebuild();
}
dateStepBackBtn.addEventListener('click', () => { stopDateStepping(); stepDateBy(-1); });
dateStepFwdBtn.addEventListener('click', () => { stopDateStepping(); stepDateBy(1); });

// Play's own speed, separate from the unit dropdown above (which only
// sizes ◀/▶'s single-click step) — base rate is still "1 selected unit per
// real second," this just scales it, the same relationship Stellarium's
// own rewind/fast-forward buttons have to its base time rate. Needed
// because a flat 1-unit/sec rate is fine at hour/day but wrong at the
// extremes: a week/sec blows through a year in under a minute, a
// minute/sec barely moves in a normal viewing session.
const DATE_STEP_RATE_STEPS = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];
let dateStepRateIndex = DATE_STEP_RATE_STEPS.indexOf(1);
function formatRate(r) { return `${r < 1 ? r : Math.round(r)}×`; }
function syncDateStepRateReadout() { dateStepRateReadout.textContent = formatRate(DATE_STEP_RATE_STEPS[dateStepRateIndex]); }
dateStepSlowerBtn.addEventListener('click', () => {
  dateStepRateIndex = Math.max(0, dateStepRateIndex - 1);
  syncDateStepRateReadout();
});
dateStepFasterBtn.addEventListener('click', () => {
  dateStepRateIndex = Math.min(DATE_STEP_RATE_STEPS.length - 1, dateStepRateIndex + 1);
  syncDateStepRateReadout();
});
syncDateStepRateReadout();
datePlayBtn.addEventListener('click', () => {
  dateStepPlaying = !dateStepPlaying;
  datePlayBtn.textContent = dateStepPlaying ? '⏸' : '▶';
  if (dateStepPlaying) {
    dateStepBaseMs = new Date(dateInput.value || Date.now()).getTime();
    dateStepElapsedMs = 0;
    dateStepLastRebuildAt = 0;
    stopPlaying();
    dayRotating = false;
    dayRotateBtn.textContent = '▶';
  }
});

dayRotateBtn.addEventListener('click', () => {
  stopDateStepping();
  dayRotating = !dayRotating;
  dayRotateBtn.textContent = dayRotating ? '⏸' : '▶';
});
dayRotationSlider.addEventListener('input', () => {
  stopDateStepping();
  dayRotating = false;
  dayRotateBtn.textContent = '▶';
  setDayRotationDeg(parseFloat(dayRotationSlider.value));
});

centerViewBtn.addEventListener('click', () => setCenterView(!centerView));

// Hides every floating panel except the top-left controls one, to declutter
// the view (e.g. for a clean screenshot) — leaves the 2D chart/directions
// table panels alone since those are already independently opt-in, not part
// of the base always-on clutter.
const focusModeBtn = document.getElementById('focus-mode-btn');
const focusModePanels = ['layers-panel', 'legend'].map(id => document.getElementById(id));
let focusMode = false;
focusModeBtn.addEventListener('click', () => {
  focusMode = !focusMode;
  focusModePanels.forEach(el => { el.hidden = focusMode; });
  // direction-panel isn't a plain focus-mode casualty — it only exists at
  // all when primary directions is on (see that toggle's own handler), so
  // "Show panels" must not resurrect it when that toggle is off.
  directionPanel.hidden = focusMode ? true : !primaryDirectionsToggle.checked;
  focusModeBtn.textContent = focusMode ? '▭ Show panels' : '▭ Focus mode';
});

// ── Direction transport panel ────────────────────────────────────────────

const directionPanel = document.getElementById('direction-panel');
primaryDirectionsToggle.addEventListener('change', () => {
  directionPanel.hidden = !primaryDirectionsToggle.checked;
  syncPrimaryDirectionsLayerRows();
  if (!primaryDirectionsToggle.checked) {
    stopPlaying(); // don't keep animating a direction the user can no longer see
    tablePanel.hidden = true; // its own toggle button just went away too — see syncPrimaryDirectionsLayerRows
  }
  rebuild();
});
directionPanel.hidden = !primaryDirectionsToggle.checked; // sync initial state (checkbox starts checked, so this is a no-op today, but keeps the two in sync if the default ever changes)
syncPrimaryDirectionsLayerRows();
const systemSelect = document.getElementById('system-select');
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
const boundCrossingsEl = document.getElementById('bound-crossings');

[systemSelect, promissorSelect, aspectSelect, aspectDirectionSelect].forEach(el => el.addEventListener('change', rebuild));

playBtn.addEventListener('click', () => {
  if (!direction) return;
  isPlaying = !isPlaying;
  playBtn.textContent = isPlaying ? '⏸' : '▶';
  if (isPlaying) {
    stopDateStepping();
    if (directionYears >= direction.arcYears) setDirectionYears(0);
  }
});

resetBtn.addEventListener('click', () => { stopPlaying(); setDirectionYears(0); });
endBtn.addEventListener('click', () => { stopPlaying(); if (direction) setDirectionYears(direction.arcYears); });
stepBackBtn.addEventListener('click', () => { stopPlaying(); setDirectionYears(directionYears - parseFloat(stepSizeSelect.value)); });
stepFwdBtn.addEventListener('click', () => { stopPlaying(); setDirectionYears(directionYears + parseFloat(stepSizeSelect.value)); });
slider.addEventListener('input', () => { stopPlaying(); setDirectionYears(parseFloat(slider.value)); });

// ── Guided tour ───────────────────────────────────────────────────────────
// "Understanding primary directions" is hardest in center view specifically
// — it's a whole-sphere sweep along the equator, easy to see as a shape
// from outside, but in a first-person warped-fisheye view the moving
// marker is very often just plain behind you. This automates BOTH halves
// of watching it properly: plays the direction from 0 → arcYears at a
// slower, actually-watchable pace (TOUR_DURATION_SECONDS, vs. free play's
// own arcYears/8), and re-aims the camera at the moving marker every frame
// so it's always in view without the user having to hunt for it — same
// -dir*CENTER_DISTANCE / target=(0,0,0) trick setCenterView's own
// ASC-facing default uses to look in a given direction from a camera
// that's pinned near the origin.
const TOUR_DURATION_SECONDS = 22;
const tourStartBtn = document.getElementById('tour-start-btn');
const tourPanel = document.getElementById('tour-panel');
const tourTitleEl = document.getElementById('tour-title');
const tourNarrationEl = document.getElementById('tour-narration');
const tourEndBtn = document.getElementById('tour-end-btn');
let tourActive = false;
let tourLastYears = 0;
let tourFlashUntil = 0; // performance.now() timestamp — a bound-crossing announcement holds the narration line until this passes

function tourIntroText() {
  const proName = pointLabel(promissorSelect.value);
  const sigName = pointLabel(significatorSelect.value);
  const aspectGlyph = ASPECT_GLYPHS[Math.abs(parseFloat(aspectSelect.value))] ?? '☌';
  return `${proName} is directed to ${sigName} (${aspectGlyph}). The promissor sweeps forward along the celestial equator — 1° of arc per year (the Naibod key) — until it reaches this aspect. Watch it travel; the camera follows automatically.`;
}

function startGuidedTour() {
  if (!direction) return;
  if (!centerView) setCenterView(true);
  stopPlaying();
  stopDateStepping();
  dayRotating = false;
  dayRotateBtn.textContent = '▶';
  setDirectionYears(0);
  tourActive = true;
  tourLastYears = 0;
  tourFlashUntil = 0;
  tourPanel.hidden = false;
  tourTitleEl.textContent = `${pointLabel(promissorSelect.value)} → ${pointLabel(significatorSelect.value)}`;
  tourNarrationEl.textContent = tourIntroText();
  playYearsPerSecond = Math.max(0.5, direction.arcYears / TOUR_DURATION_SECONDS);
  isPlaying = true;
  playBtn.textContent = '⏸';
}

function endGuidedTour() {
  tourActive = false;
  tourPanel.hidden = true;
  stopPlaying();
}

// Called once per frame while touring (see animate()) — flashes a short
// announcement for ~2.5s whenever a new Egyptian-bound crossing is passed,
// otherwise shows the live years-elapsed progress line.
function updateTourNarration(nowMs) {
  if (!direction) return;
  for (const c of boundCrossings) {
    if (tourLastYears < c.years && directionYears >= c.years) {
      tourNarrationEl.textContent = `${pointLabel(promissorSelect.value)} now enters ${c.to.ruler}'s bound.`;
      tourFlashUntil = nowMs + 2500;
      break;
    }
  }
  tourLastYears = directionYears;
  if (nowMs < tourFlashUntil) return;
  const hit = directionYears >= direction.arcYears;
  tourNarrationEl.textContent = hit
    ? `Direction complete — exact at ${direction.arcYears.toFixed(1)} years.`
    : `Sweeping forward: ${directionYears.toFixed(1)} / ${direction.arcYears.toFixed(1)} years elapsed.`;
}

tourStartBtn.addEventListener('click', startGuidedTour);
tourEndBtn.addEventListener('click', endGuidedTour);

// ── Regiomontanus construction (pedagogical animation) ───────────────────
// Regiomontanus is a purely SPATIAL construction (where in the sky a house
// circle falls), unlike Placidus's temporal one (how far through a body's
// own diurnal/nocturnal arc it's traveled) — this animates the actual
// geometry step by step: the equator split into 12 equal 30° arcs from
// RAMC, each division point's own great circle through the horizon's real
// North/South points (not the celestial pole), and where that circle
// crosses the ecliptic to land the cusp. Independent of skyGroup's own
// lifecycle (added straight to `scene`, not skyGroup) so it isn't torn
// down/rebuilt by every unrelated rebuild() call — stopRegioConstruction()
// is what tears it down instead, called both from its own Stop button and
// automatically at the top of rebuild() (same self-terminating pattern as
// the guided tour above).
const REGIO_CIRCLE_SECONDS = 1.8; // how long one house's great circle takes to "grow" in
const REGIO_HOLD_SECONDS = 1.3;   // pause on the landed cusp before moving to the next house
const regioConstructBtn = document.getElementById('regio-construct-btn');
const regioPanel = document.getElementById('regio-panel');
const regioNarrationEl = document.getElementById('regio-narration');
const regioStopBtn = document.getElementById('regio-stop-btn');
let regioConstruction = null; // { group, northMarker, houses: [...] } from buildRegiomontanusConstruction
let regioAnimActive = false;
let regioAnimHouseIdx = 0;
let regioAnimPhase = 'circle'; // 'circle' (growing) | 'hold' (paused on the landed cusp)
let regioAnimElapsed = 0;

function regioIntroText() {
  return "Regiomontanus divides the celestial equator into 12 equal 30° arcs from RAMC, then projects each division point through a great circle passing through the horizon's own North and South points. Where that circle crosses the ecliptic is the house cusp — purely spatial (where in the sky), unlike Placidus's temporal construction (how far through a body's own daily arc).";
}
function regioHouseText(h) {
  return `House ${h.house}: division point at RAMC+${h.offsetDeg}° on the equator → great circle through the horizon's N/S → crosses the ecliptic at ${formatEclipticDegree(h.cuspDeg)}.`;
}

function startRegioConstruction() {
  if (!lastState || !natalObserver) return;
  stopRegioConstruction();
  stopPlacidusConstruction(); // the two are mutually exclusive — same "explain a house system" slot, avoids 20 criss-crossing lines at once
  const construction = computeRegiomontanusConstruction(
    natalDate, natalObserver, { mc: lastState.mc, ic: lastState.ic, asc: lastState.asc, dsc: lastState.dsc }, SPHERE_RADIUS,
  );
  regioConstruction = buildRegiomontanusConstruction(construction);
  scene.add(regioConstruction.group);
  regioAnimActive = true;
  regioAnimHouseIdx = 0;
  regioAnimPhase = 'circle';
  regioAnimElapsed = 0;
  regioConstruction.houses[0].divisionMarker.visible = true;
  regioPanel.hidden = false;
  regioNarrationEl.textContent = regioIntroText();
  regioConstructBtn.textContent = '■ Stop';
}

function stopRegioConstruction() {
  if (regioConstruction) {
    scene.remove(regioConstruction.group);
    disposeRegiomontanusConstruction(regioConstruction);
  }
  regioConstruction = null;
  regioAnimActive = false;
  regioPanel.hidden = true;
  regioConstructBtn.textContent = '📐 How houses are built (Regiomontanus)';
}

// Called once per frame from animate() while regioAnimActive — advances
// the current house's growing-circle / holding-on-cusp phases, and steps
// to the next house (in the sweep order computeRegiomontanusConstruction
// already sorted by) once both phases finish. Stays on the last frame
// (everything revealed, all 12 cusps visible) once done, rather than
// clearing itself — the user reviews the finished wheel via the Stop
// button, same as the guided tour ends on its own final frame.
function advanceRegioConstruction(dt) {
  if (!regioAnimActive || !regioConstruction) return;
  const h = regioConstruction.houses[regioAnimHouseIdx];
  regioAnimElapsed += dt;
  if (regioAnimPhase === 'circle') {
    const frac = Math.min(1, regioAnimElapsed / REGIO_CIRCLE_SECONDS);
    const count = Math.max(2, Math.round(frac * h.circlePoints.length));
    revealHouseCirclePartial(h, count);
    if (frac >= 1) {
      h.cuspMarker.visible = true;
      h.cuspLabel.visible = true;
      h.cuspTick.visible = true;
      regioNarrationEl.textContent = regioHouseText(h);
      regioAnimPhase = 'hold';
      regioAnimElapsed = 0;
    }
  } else if (regioAnimPhase === 'hold') {
    if (regioAnimElapsed >= REGIO_HOLD_SECONDS) {
      regioAnimHouseIdx += 1;
      regioAnimElapsed = 0;
      if (regioAnimHouseIdx >= regioConstruction.houses.length) {
        regioAnimActive = false;
        regioNarrationEl.textContent = 'All 12 house cusps built — each one is just where its own great circle crosses the ecliptic.';
      } else {
        regioAnimPhase = 'circle';
        regioConstruction.houses[regioAnimHouseIdx].divisionMarker.visible = true;
      }
    }
  }
}

regioConstructBtn.addEventListener('click', () => {
  if (regioConstruction) stopRegioConstruction(); else startRegioConstruction();
});
regioStopBtn.addEventListener('click', stopRegioConstruction);

// ── Placidus construction (pedagogical animation) ────────────────────────
// The comparison case: Placidus is TEMPORAL, not spatial — each cusp is
// the ecliptic point that has completed 1/3 or 2/3 of its own diurnal/
// nocturnal semi-arc, traced out here as a curved locus (across
// declination) rather than a great circle. The 4 angular cusps (ASC/IC/
// DSC/MC) are shown immediately, unanimated, since they're the same
// already-known angles any quadrant system shares; only the 8 non-angular
// ones animate. Same lifecycle pattern as Regiomontanus above (own scene
// group, self-terminating via stopPlacidusConstruction).
const PLACIDUS_CURVE_SECONDS = 1.8;
const PLACIDUS_HOLD_SECONDS = 1.3;
const placidusConstructBtn = document.getElementById('placidus-construct-btn');
const placidusPanel = document.getElementById('placidus-panel');
const placidusNarrationEl = document.getElementById('placidus-narration');
const placidusStopBtn = document.getElementById('placidus-stop-btn');
let placidusConstruction = null; // { group, angleMarkers, houses: [...] } from buildPlacidusConstruction
let placidusAnimActive = false;
let placidusAnimHouseIdx = 0;
let placidusAnimPhase = 'curve'; // 'curve' (growing) | 'hold' (paused on the landed cusp)
let placidusAnimElapsed = 0;

function placidusIntroText(maxDecDeg) {
  return `Placidus divides each degree's diurnal/nocturnal semi-arc into thirds — a cusp is the ecliptic point that has completed a given fraction of its OWN journey through the sky, not a point on any circle. Undefined past ±${maxDecDeg.toFixed(1)}° declination here (the co-latitude) — circumpolar points never rise or set, so they have no semi-arc to divide at all.`;
}
// Houses 11/2/5/8 each trisect their quadrant at the 1/3 point (closer to
// the preceding angle — MC/ASC/IC/DSC respectively), 12/3/6/9 at 2/3 —
// matches PLACIDUS_CUSP_TARGET_M in astro.js exactly (e.g. house 11's
// target -30° is 1/3 of the way through the 90°-wide MC→ASC quadrant).
const PLACIDUS_FRACTION_LABEL = { 11: '1/3', 2: '1/3', 5: '1/3', 8: '1/3', 12: '2/3', 3: '2/3', 6: '2/3', 9: '2/3' };
function placidusHouseText(h) {
  return `House ${h.house}: the locus of points ${PLACIDUS_FRACTION_LABEL[h.house]} through their own diurnal/nocturnal semi-arc → crosses the ecliptic at ${formatEclipticDegree(h.cuspDeg)}.`;
}

function startPlacidusConstruction() {
  if (!lastState || !natalObserver) return;
  stopPlacidusConstruction();
  stopRegioConstruction();
  const construction = computePlacidusConstruction(
    natalDate, natalObserver, { mc: lastState.mc, ic: lastState.ic, asc: lastState.asc, dsc: lastState.dsc }, SPHERE_RADIUS,
  );
  placidusConstruction = buildPlacidusConstruction(construction);
  scene.add(placidusConstruction.group);
  for (const a of placidusConstruction.angleMarkers) {
    a.cuspMarker.visible = true;
    a.cuspLabel.visible = true;
    a.cuspTick.visible = true;
  }
  placidusAnimActive = placidusConstruction.houses.length > 0;
  placidusAnimHouseIdx = 0;
  placidusAnimPhase = 'curve';
  placidusAnimElapsed = 0;
  placidusPanel.hidden = false;
  placidusNarrationEl.textContent = placidusIntroText(construction.maxDecDeg)
    + (placidusAnimActive ? '' : ' Every non-angular cusp is undefined at this latitude/date — only the 4 angles (ASC/IC/DSC/MC) exist.');
  placidusConstructBtn.textContent = '■ Stop';
}

function stopPlacidusConstruction() {
  if (placidusConstruction) {
    scene.remove(placidusConstruction.group);
    disposePlacidusConstruction(placidusConstruction);
  }
  placidusConstruction = null;
  placidusAnimActive = false;
  placidusPanel.hidden = true;
  placidusConstructBtn.textContent = '📐 How houses are built (Placidus)';
}

function advancePlacidusConstruction(dt) {
  if (!placidusAnimActive || !placidusConstruction) return;
  const h = placidusConstruction.houses[placidusAnimHouseIdx];
  placidusAnimElapsed += dt;
  if (placidusAnimPhase === 'curve') {
    const frac = Math.min(1, placidusAnimElapsed / PLACIDUS_CURVE_SECONDS);
    const count = Math.max(2, Math.round(frac * h.curvePoints.length));
    revealPlacidusCurvePartial(h, count);
    if (frac >= 1) {
      h.cuspMarker.visible = true;
      h.cuspLabel.visible = true;
      h.cuspTick.visible = true;
      placidusNarrationEl.textContent = placidusHouseText(h);
      placidusAnimPhase = 'hold';
      placidusAnimElapsed = 0;
    }
  } else if (placidusAnimPhase === 'hold') {
    if (placidusAnimElapsed >= PLACIDUS_HOLD_SECONDS) {
      placidusAnimHouseIdx += 1;
      placidusAnimElapsed = 0;
      if (placidusAnimHouseIdx >= placidusConstruction.houses.length) {
        placidusAnimActive = false;
        placidusNarrationEl.textContent = 'Every definable cusp built — each is a curved locus, not a circle, and some may be missing entirely at extreme latitudes.';
      } else {
        placidusAnimPhase = 'curve';
      }
    }
  }
}

placidusConstructBtn.addEventListener('click', () => {
  if (placidusConstruction) stopPlacidusConstruction(); else startPlacidusConstruction();
});
placidusStopBtn.addEventListener('click', stopPlacidusConstruction);

// ── Live house-cusp tracking during day-rotation ──────────────────────────
// The NATAL MC/IC/ASC/DSC (and RAMC, which every house cusp is ultimately
// measured from) all genuinely change as the day rotates — unlike the
// zodiac band/planets/ecliptic (reprojectRotatables' own rigid pole-axis
// rotation, correct because THEIR positions are fixed-RA/Dec points simply
// viewed through a later horizon), a house circle is defined by one FIXED
// point (the horizon's own North) and one point that itself moves with
// time (the equatorial division point at RAMC+offset) — the circle
// through them does not just rotate, its shape genuinely changes. So
// keeping this "accurate" means recomputing the whole construction at the
// rotated moment's real angles, not reprojecting the existing geometry.
// Only runs once a construction has FINISHED its own reveal animation
// (mid-reveal + also-rotating would be two animations fighting over the
// same geometry). Measured ~7-11ms even for Placidus (the pricier of the
// two — its own cusp search is tens of thousands of trig evaluations) —
// well inside a frame budget, so this runs every animate() frame, same as
// the zodiac band's own reprojection; an earlier throttled version (every
// 200ms) made the cusps visibly lag behind the band's own smooth rotation.

function refreshActiveConstructionAtRotation(fakeDate, liveState) {
  if (!(regioConstruction && !regioAnimActive) && !(placidusConstruction && !placidusAnimActive)) return;
  const angles = { mc: liveState.mc, ic: liveState.ic, asc: liveState.asc, dsc: liveState.dsc };

  if (regioConstruction && !regioAnimActive) {
    updateRegiomontanusConstruction(regioConstruction, computeRegiomontanusConstruction(fakeDate, natalObserver, angles, SPHERE_RADIUS));
  } else if (placidusConstruction && !placidusAnimActive) {
    const construction = computePlacidusConstruction(fakeDate, natalObserver, angles, SPHERE_RADIUS);
    const updatedInPlace = updatePlacidusConstruction(placidusConstruction, construction);
    if (!updatedInPlace) {
      // The AVAILABLE set of non-angular cusps itself changed (crossed the
      // circumpolar cutoff mid-rotation) — needs new/removed scene
      // objects, which the in-place updater deliberately doesn't attempt.
      // Falls back to a full rebuild just for this one frame.
      scene.remove(placidusConstruction.group);
      disposePlacidusConstruction(placidusConstruction);
      placidusConstruction = buildPlacidusConstruction(construction);
      scene.add(placidusConstruction.group);
      for (const a of placidusConstruction.angleMarkers) { a.cuspMarker.visible = true; a.cuspLabel.visible = true; a.cuspTick.visible = true; }
      for (const h of placidusConstruction.houses) { revealPlacidusCurvePartial(h, h.curvePoints.length); h.cuspMarker.visible = true; h.cuspLabel.visible = true; h.cuspTick.visible = true; }
    }
  }
}

// ── Directions table ("Prognosis") ───────────────────────────────────────
// Every promissor/significator/aspect combination, chronologically — not
// just the one direction selected above. Computed on demand (not on every
// rebuild) since it's ~500-1000 combinations; still only tens of
// milliseconds, but no reason to pay that on every input change.

const TABLE_POINT_KEYS = [...PLANETS.map(p => p.key), ...ANGLE_KEYS];
const PLANET_GLYPHS = { Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄' };
const pointLabel = key => PLANET_GLYPHS[key] ?? key;

const tableToggleBtn = document.getElementById('table-toggle-btn');
const tablePanel = document.getElementById('table-panel');
const tableMinYears = document.getElementById('table-min-years');
const tableMaxYears = document.getElementById('table-max-years');
const tableBoundsCheckbox = document.getElementById('table-bounds');
const tableSystemSelect = document.getElementById('table-system');
const tableRecomputeBtn = document.getElementById('table-recompute-btn');
const tableCloseBtn = document.getElementById('table-close-btn');
const tableStatus = document.getElementById('table-status');
const tableBody = document.getElementById('table-body');

function computeTable() {
  if (!natalObserver) return;
  tableStatus.textContent = 'Computing…';
  const minYears = parseFloat(tableMinYears.value) || 0;
  const maxYears = parseFloat(tableMaxYears.value) || 150;
  const resolvePoint = key => resolveDirectionPoint(key, lastState);
  const bodyOf = key => BODY_BY_KEY[key];

  const t0 = performance.now();
  const rows = computeAllDirections(
    TABLE_POINT_KEYS, resolvePoint, bodyOf, natalDate, natalObserver, SPHERE_RADIUS, maxYears,
    {
      includeBoundCrossings: tableBoundsCheckbox.checked,
      angles: { mc: lastState.mc, ic: lastState.ic, asc: lastState.asc, dsc: lastState.dsc },
      system: tableSystemSelect.value,
    },
  ).filter(r => r.arcYears >= minYears);
  const ms = (performance.now() - t0).toFixed(0);

  // Harmonious (sextile/trine) vs hard (square/opposition) aspects — a
  // general astrological convention, not part of Morinus's own system
  // (which doesn't rate directions by nature). Conjunction is left neutral:
  // its nature depends on which planets are involved, not knowable generically.
  const ASPECT_NATURE = { '⚹': 'nature-easy', '△': 'nature-easy', '□': 'nature-hard', '☍': 'nature-hard' };
  // Traditional benefic/malefic classification of the promissor planet,
  // layered on top of the aspect-based coloring above (used as a fallback
  // for Sun/Moon/Mercury/angle promissors, which this classification
  // doesn't cover). Mars/Saturn's malefic default is mitigated two ways:
  // dignity (their own sign or exaltation) or a harmonious aspect
  // (sextile/trine) softening the same way it does for any other promissor.
  const MARS_DIGNITY_SIGNS = [0, 7, 9];   // Aries, Scorpio, Capricorn (exaltation)
  const SATURN_DIGNITY_SIGNS = [10, 9, 6]; // Aquarius, Capricorn, Libra (exaltation)

  function rowNatureClass(r) {
    if (r.promissorKey === 'Venus' || r.promissorKey === 'Jupiter') return 'nature-easy';
    if (r.promissorKey === 'Mars' || r.promissorKey === 'Saturn') {
      const dignitySigns = r.promissorKey === 'Mars' ? MARS_DIGNITY_SIGNS : SATURN_DIGNITY_SIGNS;
      const signIndex = r.promissorElon != null ? Math.floor((((r.promissorElon % 360) + 360) % 360) / 30) : -1;
      if (dignitySigns.includes(signIndex)) return ''; // dignified — mitigated, neutral
      if (ASPECT_NATURE[r.aspectGlyph] === 'nature-easy') return 'nature-easy'; // soft aspect softens it too
      return 'nature-hard';
    }
    return ASPECT_NATURE[r.aspectGlyph] ?? '';
  }

  tableBody.innerHTML = rows.map(r => {
    const dateStr = r.date.toISOString().slice(0, 10);

    if (r.kind === 'bound') {
      // A planet's (or angle's) own primary-motion path entering a new
      // Egyptian bound — one row per real crossing, deduped across the
      // whole table (computed once per point, not once per direction).
      const signGlyph = r.signIndex != null ? ZODIAC_SIGNS[r.signIndex].glyph : '';
      const position = `${pointLabel(r.fromRuler)}→${pointLabel(r.toRuler)} (${signGlyph})`;
      const houseCell = r.house != null ? `House ${r.house}` : '—';
      return `<tr class="type-b">
        <td>—</td>
        <td>${pointLabel(r.movingKey)}</td>
        <td>${position}</td>
        <td>${houseCell}</td>
        <td>B</td>
        <td>${r.arcYears.toFixed(1)}</td>
        <td>${dateStr}</td>
      </tr>`;
    }

    const promissorLabel = pointLabel(r.promissorKey) + (r.aspectGlyph !== '☌' ? r.aspectGlyph : '') + (r.aspectDir ? (r.aspectDir === 'dexter' ? ' (dex)' : '') : '');
    const position = r.promissorElon != null ? formatEclipticDegree(r.promissorElon) : '—';
    const type = r.swapped ? 'C' : 'D';
    const natureClass = rowNatureClass(r);
    // Past a normal lifespan — still a real, computable pairing (kept in
    // the table for reference), just greyed rather than competing visually
    // with the ones someone will actually live to see.
    const longArcClass = r.arcYears > 90 ? 'long-arc' : '';
    return `<tr class="type-${type.toLowerCase()} ${natureClass} ${longArcClass}">
      <td>${pointLabel(r.significatorKey)}</td>
      <td>${promissorLabel}</td>
      <td>${position}</td>
      <td>${r.arcDeg.toFixed(1)}°</td>
      <td>${type}</td>
      <td>${r.arcYears.toFixed(1)}</td>
      <td>${dateStr}</td>
    </tr>`;
  }).join('');

  tableStatus.textContent = `${rows.length} rows · ${ms}ms`;
}

tableToggleBtn.addEventListener('click', () => {
  tablePanel.hidden = !tablePanel.hidden;
  if (!tablePanel.hidden) computeTable();
});
tableCloseBtn.addEventListener('click', () => { tablePanel.hidden = true; });
tableRecomputeBtn.addEventListener('click', computeTable);
tableMaxYears.addEventListener('change', computeTable);
tableMinYears.addEventListener('change', computeTable);
tableBoundsCheckbox.addEventListener('change', computeTable);
tableSystemSelect.addEventListener('change', computeTable);

// ── 2D chart wheel ────────────────────────────────────────────────────────

const chart2dToggleBtn = document.getElementById('chart2d-toggle-btn');
const chart2dPanel = document.getElementById('chart2d-panel');
const chart2dCloseBtn = document.getElementById('chart2d-close-btn');
const chart2dHousesCheckbox = document.getElementById('chart2d-houses');
const chart2dHouseSystemSelect = document.getElementById('chart2d-house-system');
const chart2dBoundsCheckbox = document.getElementById('chart2d-bounds');
const chart2dSvg = document.getElementById('chart2d-svg');

chart2dToggleBtn.addEventListener('click', () => {
  chart2dPanel.hidden = !chart2dPanel.hidden;
  if (!chart2dPanel.hidden) renderChart2DPanel();
});
chart2dCloseBtn.addEventListener('click', () => { chart2dPanel.hidden = true; });
chart2dHousesCheckbox.addEventListener('change', () => { if (!chart2dPanel.hidden) renderChart2DPanel(); });
chart2dHouseSystemSelect.addEventListener('change', () => { if (!chart2dPanel.hidden) renderChart2DPanel(); });
chart2dBoundsCheckbox.addEventListener('change', () => { if (!chart2dPanel.hidden) renderChart2DPanel(); });

resize();
rebuild();
animate();
