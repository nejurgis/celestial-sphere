// ── stellarium-bridge.js ─────────────────────────────────────────────────
// Option A ("best of both worlds") integration: stellarium-web-engine
// (built via ~/CODE/stellarium-compare, emsdk 1.39.17 — see that project's
// SConstruct/Makefile for the build itself) renders the physically-real
// sky (atmosphere, stars, sun/moon, Milky Way) as an opaque background
// layer; this app's own Three.js canvas draws on top of it, transparent,
// with only the astrological overlay (zodiac ribbon, aspect planes, house
// cusps, directional arcs, labels).
//
// The engine exposes NO camera matrix — its view is two scalars,
// core.observer.yaw/pitch (set via lookAt with a 3D direction) and
// core.fov (set via zoomTo), both driven from C's core_lookat/core_zoomto
// (src/core.c in the stellarium-compare clone). This file's syncCamera is
// the one place that direction vector gets translated between this app's
// coordinate convention and theirs — get this wrong and the Stellarium
// background will silently drift out of alignment with the Three.js
// overlay on top of it while both individually look fine.
//
// Axis mapping — CORRECTED. The original version of this comment claimed
// Stellarium's OBSERVED frame was +X=South, sourced from observer.c's
// "Cartesian -HA,Dec to Cartesian Az,El (S=0,E=90)" comment. That comment
// describes a DIFFERENT, internal-only rotation matrix (ri2h, used inside
// observer_update for the CIRS→horizontal transform) — NOT the actual
// FRAME_OBSERVED convention exposed to JS via lookAt. The real ground
// truth is src/modules/cardinal.c, which hardcodes the literal N/E/S/W
// label positions actually drawn on screen:
//   N=(1,0,0)  E=(0,1,0)  S=(-1,0,0)  W=(0,-1,0)
// i.e. +X=NORTH, not South. Using the wrong one put a North/South flip
// into every camera-direction sync — confirmed by direct observation
// (screenshot showed Three's "N" label and Stellarium's "S" label at the
// same screen position) after "washed out colors"/"rotates the wrong way"
// reports turned out to have nothing to do with color or time-sync (both
// verified independently correct) and everything to do with the camera
// simply pointing at the wrong patch of sky.
//   This app (astro.js altAzToXYZ):  +X=East, +Y=up,  +Z=North
//   Stellarium OBSERVED frame:       +X=North,+Y=East,+Z=up
// so a direction (x,y,z) here becomes (z, x, y) there.

import { eclipticPointToEquatorial, ZODIAC_SIGNS } from './astro.js';
import { ELEMENT_COLORS } from './scene.js';

const BASE_URL = '/stellarium/skydata/';

function hexColor(n) {
  return '#' + n.toString(16).padStart(6, '0');
}

// RA comes back in HOURS (astronomy-engine convention, see astro.js) — a
// GeoJSON "longitude" needs signed degrees in [-180,180).
function raHoursToLonDeg(raHours) {
  let deg = raHours * 15;
  if (deg > 180) deg -= 360;
  return deg;
}

// The zodiac band as a native Stellarium geojson layer instead of a Three.js
// mesh — the motivation is real, not cosmetic: Three's overlay warps this
// app's own approximate per-vertex stereographic projection (stereographic.js),
// which has a known failure mode near the view antipode (see that file's
// o.z>0.999 guard) — wide content sweeping past it can smear across the
// whole screen as a solid flash of whatever color it is, which is exactly
// what showed up as "the sky flashes a zodiac color" once the sky
// dome/milkyway (which used to sit on top of and mask this) were hidden for
// the Stellarium background. Stellarium's own engine has real seam handling
// for this (PROJCONTINUITY, mentioned in this file's own research this
// session) that our approximation doesn't attempt to replicate.
//
// Coordinates are computed ONCE, in ICRF (the default frame — effectively
// J2000 equatorial), not recomputed per frame or per date: the band is a
// fixed ecliptic feature, and ICRF is inertial — Stellarium's own engine
// re-projects it into the live horizon view automatically as time/location
// change, the same way it already does for real stars. `eclipticPointToEquatorial`
// technically returns equator-OF-DATE, not true J2000, but the precession
// drift (~50″/year) is negligible for a decorative band — not adopted for
// real astrometry elsewhere in this app.
const ZODIAC_HALF_WIDTH_DEG = 4; // matches astro.js computeZodiacBand's own default
const ZODIAC_SAMPLES_PER_SIGN = 8;

export function buildZodiacBandGeoJSON(date) {
  const features = ZODIAC_SIGNS.map((sign, s) => {
    const outer = [];
    const inner = [];
    for (let i = 0; i <= ZODIAC_SAMPLES_PER_SIGN; i++) {
      const elon = s * 30 + (i / ZODIAC_SAMPLES_PER_SIGN) * 30;
      const eqOuter = eclipticPointToEquatorial(elon, ZODIAC_HALF_WIDTH_DEG, date);
      const eqInner = eclipticPointToEquatorial(elon, -ZODIAC_HALF_WIDTH_DEG, date);
      outer.push([raHoursToLonDeg(eqOuter.ra), eqOuter.dec]);
      inner.push([raHoursToLonDeg(eqInner.ra), eqInner.dec]);
    }
    const ring = [...outer, ...inner.reverse()];
    ring.push(ring[0]); // GeoJSON rings must be explicitly closed
    return {
      type: 'Feature',
      properties: {
        // Not sign.glyph — Stellarium's bundled font (data/font/NotoSans-*)
        // has no stel.setFont() override anywhere in this integration, and
        // NotoSans doesn't cover the zodiac Unicode block (U+2648-2653):
        // glyph titles silently failed to render. Plain ASCII names work
        // fine through their font; the actual ♈ symbols come from this
        // app's own Three.js glyphSprite instead (kept visible — see
        // updateStellariumBgVisibility in main.js), which uses the
        // browser's own font stack and has always rendered these correctly.
        title: sign.name,
        fill: hexColor(ELEMENT_COLORS[sign.element]),
        // The "washed out in daytime" report turned out to be the N/S
        // camera-direction bug (see this file's header) — the CAMERA was
        // pointed at the wrong patch of sky, not the band's own color being
        // faded. Plain alpha blend (verified in render_gl.c: GL_SRC_ALPHA/
        // GL_ONE_MINUS_SRC_ALPHA, not additive), drawn after the atmosphere
        // since this layer registers after all of Stellarium's built-in
        // modules. 0.6 — a deliberate, slightly-translucent look, not a
        // diagnostic value.
        'fill-opacity': 0.6,
        'stroke-opacity': 0,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  });
  return { type: 'FeatureCollection', features };
}

// Creates (once) a layer + geojson object holding the zodiac band, adds it
// to the scene, and returns the geojson object (for later .data updates,
// though none are expected per the header note above).
//
// z must land strictly BETWEEN atmosphere's render_order (35 — see
// src/modules/atmosphere.c) and landscape's (40). A module's `z` IS its
// render_order (layer_get_render_order in layer.c returns layer->z
// directly), and core_update's DL_SORT(core->obj.children,
// modules_sort_cmp) re-sorts EVERY module by render_order every single
// frame — draw order is NOT insertion order. Below 35 (z=0, first attempt)
// this layer drew BEFORE the atmosphere, which blends ADDITIVELY
// (GL_ONE,GL_ONE — confirmed in render_gl.c's item_atmosphere_render): the
// bright daytime atmosphere was then added ON TOP of this band afterward,
// washing it toward white. Above 40 (z=50, second attempt) it draws AFTER
// the landscape too, so the ground no longer hides the below-horizon half
// of the band — confirmed via the live z-order slider in the standalone
// test harness that only 36-39 avoids both problems.
export function addStellariumZodiacBand(stel, date) {
  const layer = stel.createLayer({ id: 'celestial-sphere-zodiac-band', z: 37.5, visible: true });
  const geo = layer.add('geojson', {});
  geo.data = buildZodiacBandGeoJSON(date);
  return geo;
}

export function stellariumDirToObserved(x, y, z) {
  return [z, x, y];
}

// canvas: a <canvas> element (separate from this app's own `canvas`,
// stacked behind it — see index.html). Returns a Promise<stel>.
export function initStellarium(canvasEl) {
  return new Promise((resolve, reject) => {
    if (!window.StelWebEngine) {
      reject(new Error('stellarium-web-engine.js not loaded (missing <script> tag in index.html)'));
      return;
    }
    window.StelWebEngine({
      wasmFile: '/stellarium/engine/stellarium-web-engine.wasm',
      canvas: canvasEl,
      translateFn: (domain, str) => str, // no i18n needed for a background layer
      onReady: (stel) => {
        const core = stel.core;
        core.stars.addDataSource({ url: BASE_URL + 'stars' });
        core.skycultures.addDataSource({ url: BASE_URL + 'skycultures/western', key: 'western' });
        core.dsos.addDataSource({ url: BASE_URL + 'dso' });
        core.landscapes.addDataSource({ url: BASE_URL + 'landscapes/guereins', key: 'guereins' });
        core.milkyway.addDataSource({ url: BASE_URL + 'surveys/milkyway' });
        core.planets.addDataSource({ url: BASE_URL + 'surveys/sso/moon', key: 'moon' });
        core.planets.addDataSource({ url: BASE_URL + 'surveys/sso/sun', key: 'sun' });
        core.planets.addDataSource({ url: BASE_URL + 'surveys/sso/moon', key: 'default' });

        // This app draws its own ground (Horn-Koppe Spring photo) — avoid
        // double ground/horizon.
        core.landscapes.visible = false;
        // Constellation lines/labels/art and atmosphere are all real
        // Stellarium content this app doesn't draw its own version of (its
        // own constellations use a different skyculture — Egyptian bounds,
        // not western — but those are a separate, astrology-specific layer,
        // not a duplicate of these). Defaulted on here; toggleable via the
        // bottom bar (see stellarium-bar wiring in main.js) since some users
        // may find the western lines/art busy alongside the astrological
        // overlay. The az/eq grids default OFF instead — center view's
        // first-person look starts decluttered, same as this app's own
        // equator/ecliptic layers get unchecked on entering center view
        // (see setCenterView in main.js) — still one bottom-bar click away.
        core.constellations.lines_visible = true;
        core.constellations.labels_visible = true;
        core.constellations.images_visible = true;
        core.atmosphere.visible = true;
        core.lines.azimuthal.visible = false;
        core.lines.equatorial.visible = false;
        // Deep-sky object markers (nebulae/galaxies/clusters) — visual
        // clutter for an astrology app, no toggle for this one.
        core.dsos.visible = false;

        resolve(stel);
      },
    });
  });
}

// date: JS Date. Stellarium's observer.utc is Modified Julian Date, not
// epoch millis (ported from apps/web-frontend/src/assets/sw_helpers.js —
// same DDDate getJD/getMJD math verified in the standalone demo already).
export function syncStellariumTime(stel, date) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  stel.core.observer.utc = jd - 2400000.5;
}

export function syncStellariumLocation(stel, latitudeDeg, longitudeDeg) {
  const obs = stel.core.observer;
  obs.latitude = (latitudeDeg * Math.PI) / 180;
  obs.longitude = (longitudeDeg * Math.PI) / 180;
}

// dir: [x,y,z] unit-ish vector in THIS app's convention (see header).
// fovRad: vertical fov, radians — pass the same NOMINAL fov this app's
// own stereographic warp uses (pre-remap), since Stellarium does its own
// internal remap for its own stereographic projection identically.
export function syncStellariumCamera(stel, dir, fovRad) {
  stel.lookAt(stellariumDirToObserved(...dir), 0);
  stel.zoomTo(fovRad, 0);
}
