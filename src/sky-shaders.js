// ── sky-shaders.js ──────────────────────────────────────────────────────
// Two GLSL materials ported from Stellarium Web Engine's real shaders
// (github.com/Stellarium/stellarium-web-engine, data/shaders/), at the
// user's request to implement things "the way they do it" rather than the
// canvas-gradient/sprite approximations used before.
//
// SKY DOME — chromaticity (x,y) from atmosphere.glsl's vertex shader: the
// xyY Perez distribution formula, the xyY→sRGB matrix, gammaf(), and the
// Jensen et al. 2000 scotopic/mesopic night-vision blue-shift are copied
// verbatim (same coefficients, same order of operations) from that file.
// Luminance (Y) is NOT from Preetham/atmosphere.glsl — per that file's own
// comment ("re-inject a_luminance for Y component"), Stellarium doesn't
// get luminance from Preetham either; it comes from a separate model
// (Schaefer 1998, their skybrightness.c) fed in as a precomputed
// a_luminance attribute. That model is ported here instead — see
// skybrightness.js for the full explanation and what's disclosed-
// simplified (no eclipse handling, a fixed Bortle-3 light-pollution
// default matching their own hardcoded core.c value).
//
// Turbidity default is 0.96 (their own "calibrated visually" value,
// atmosphere.c) — Preetham only steers hue now, not brightness, so their
// low turbidity makes sense in a way it wouldn't if it were also driving
// luminance.
//
// Tonemap: their own shape (core.c's tonemapper, log(1+p*L)/log(1+p*Lwmax),
// p=2.2), with uLwmax computed in main.js as the luminance AT THE SUN'S OWN
// position, floored at a fixed minimum (~600 cd/m²) — not their frame-to-
// frame exponentially-smoothed eye-adaptation white point. Two simpler
// attempts first, each fixing one problem and breaking the other: a
// per-moment reference alone (zenith, then sun-position) made a uniformly-
// dim night read as its own white point (this tonemap is PURELY relative —
// L close to its own reference always reads ~white regardless of absolute
// scale); a fixed absolute reference alone fixed that but made sunrise
// slam into a fixed ceiling within a few degrees (the log curve saturates
// fast once L passes roughly Lwmax/10). Flooring the per-moment reference
// gets both: the floor stops dim-night-reads-white, and the tracking
// reference keeps sunrise's ramp from hitting a wall. See main.js's
// setSkyDayNight for the full reasoning.
//
// STAR POINTS — ported verbatim from points.glsl's fragment shader: a sharp
// smoothstep core disc plus a soft smoothstep-falloff halo, additively
// blended. Stellarium computes a_size/a_color per star from magnitude via
// its own (not-in-this-file) formula; ours is a simple continuous remap
// since our catalog only carries magnitude, not a color index — real
// stellar color (Betelgeuse red, Rigel blue-white) isn't reproduced, just a
// dim-to-bright pale tint.
//
// GRID LINES — ported from lines.glsl's fragment shader almost verbatim:
// constant-SCREEN-PIXEL-width lines (not world-space, so they stay a
// consistent thickness regardless of zoom, unlike a tube) with a smoothstep
// anti-aliased edge and an optional soft glow falloff, combined via
// max(glow,base) exactly as their comment describes ("avoid changing
// brightness"). What's different: their vertex shader receives an
// already-screen-space-tessellated position per vertex (a_wpos), built by
// C++ code elsewhere in their engine — the actual expansion-into-a-ribbon
// step isn't in this shader file. Ours does that expansion in the vertex
// shader itself instead (the standard "fat line" technique: each segment
// becomes a quad, expanded perpendicular to its screen-space direction by
// uLineWidth), since Three.js has no equivalent CPU-side 2D tessellation
// stage to hook into. No mitered joins between segments (each segment is
// an independent quad) — invisible at these line widths on this dense a
// polyline.

import * as THREE from 'three';
import { STEREOGRAPHIC_GLSL, warpActiveUniform } from './stereographic.js';

const SKY_DOME_VERTEX = /* glsl */ `
${STEREOGRAPHIC_GLSL}
uniform float uWarpActive;
varying vec3 vColor;

uniform vec3 uSun;        // normalized sun direction, same XYZ frame as this geometry
uniform vec3 uMoon;       // normalized moon direction, same frame
uniform float uTurbidity; // Preetham turbidity — 0.96 default (their own "calibrated visually"
                          // value; makes sense once Preetham only steers hue, not brightness)
// Schaefer sky-brightness terms (skybrightness.js's skybrightnessPrepare) —
// depend on date/location/moon-sun geometry only, not per-vertex view
// direction, so computed once on the CPU per sky-state update (see
// main.js's setSkyDayNight), not per vertex.
uniform float uSbNightTerm;
uniform float uSbK;
uniform float uSbMoonTerm;
uniform float uSbC3;
uniform float uSbTwilightTerm;
uniform float uSbC4;
uniform float uLwmax; // fixed absolute tonemap reference (cd/m²) — see file header
uniform float uExposureOverride; // live debug slider (index.html) — 1.0 = no change

float gammaf(float c) {
  return c < 0.0031308 ? 19.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

vec3 xyyToSrgb(vec3 xyy) {
  mat3 xyzToRgb = mat3(
     3.2406, -0.9689,  0.0557,
    -1.5372,  1.8758, -0.2040,
    -0.4986,  0.0415,  1.0570
  );
  vec3 xyz = vec3(xyy.x * xyy.z / xyy.y, xyy.z, (1.0 - xyy.x - xyy.y) * xyy.z / xyy.y);
  return clamp(xyzToRgb * xyz, 0.0, 1.0);
}

// Preetham/Perez distribution F(theta,gamma) for one channel's A..E —
// CHROMATICITY only (x,y), per atmosphere.glsl's own comment that Y comes
// from elsewhere. Unchanged from the original port; verified correct.
float perezF(float A, float B, float C, float D, float E, float cosTheta, float gamma, float cosGamma2) {
  return (1.0 + A * exp(B / cosTheta)) * (1.0 + C * exp(D * gamma) + E * cosGamma2);
}

// Schaefer 1998 sky brightness — ported from skybrightness.c's
// skybrightness_get_luminance, the PER-VERTEX half (skybrightness.js has
// the CPU-side prepare step + a JS copy of this same function, used once
// per update to compute uLwmax). Returns real cd/m².
float fastExpf(float x) {
  x = 1.0 + x / 1024.0;
  x *= x; x *= x; x *= x; x *= x;
  x *= x; x *= x; x *= x; x *= x;
  x *= x; x *= x;
  return x;
}
float fastExp10f(float x) { return fastExpf(x * 2.302585093); } // * ln(10)

float schaeferLuminance(float cosMoonDist, float cosSunDist, float cosZenithDist) {
  const float cap = 0.9998477; // cos(1 deg) — avoids a near-zero-distance singularity
  cosMoonDist = min(cosMoonDist, cap);
  cosSunDist = min(cosSunDist, cap);
  float moonDist = acos(cosMoonDist);
  float sunDist = acos(cosSunDist);

  float bKX = fastExp10f(-0.4 * uSbK * (1.0 / (cosZenithDist + 0.025 * fastExpf(-11.0 * cosZenithDist))));

  float FS = 18886.28 / (sunDist * sunDist) + fastExp10f(6.15 - (sunDist + 0.001) * 1.43239) + 229086.77 * (1.06 + cosSunDist * cosSunDist);
  float bDaylight = 9.289663e-12 * (1.0 - bKX) * (FS * uSbC4 + 440000.0 * (1.0 - uSbC4));

  float bTwilightK = uSbTwilightTerm + 0.063661977 * acos(cosZenithDist) / max(uSbK, 0.05);
  float bTwilight = 0.0;
  if (bTwilightK > -32.0) {
    bTwilight = fastExp10f(bTwilightK) * (1.7453293 / sunDist) * (1.0 - bKX);
  }

  float bTotal = min(bTwilight, bDaylight);

  float FM = 18886.28 / (moonDist * moonDist) + fastExp10f(6.15 - moonDist * 1.43239) + 229086.77 * (1.06 + cosMoonDist * cosMoonDist);
  float bMoon = uSbMoonTerm * (1.0 - bKX) * (FM * uSbC3 + 440000.0 * (1.0 - uSbC3)) / 1000000.0;
  bTotal += bMoon;

  if (bTotal > 0.0 && (uSbNightTerm * bKX) / bTotal > 0.01) {
    bTotal += (0.4 + 0.6 / sqrt(0.04 + 0.96 * cosZenithDist * cosZenithDist)) * uSbNightTerm * bKX;
    bTotal += 0.0000000000012; // their own "ad-hoc addition to make the sky slightly more blueish"
  }
  bTotal = max(bTotal, 0.0);
  return bTotal / 1.11e-15 * 3.183e-6; // nanolambert -> cd/m^2
}

void main() {
  vec3 p = normalize(position);
  p.y = abs(p.y); // mirror below horizon, same trick as Stellarium's a_sky_pos.z abs()

  float T = uTurbidity;
  float cosGamma = clamp(dot(p, uSun), -1.0, 1.0);
  float gamma = acos(cosGamma);
  float cosGamma2 = cosGamma * cosGamma;
  float cosTheta = max(p.y, 1e-3);

  // Perez A..E, x/y channels only (Preetham 1999) — the Y-channel A..E this
  // file used to also carry are gone; Schaefer replaces that entirely.
  float Ax = -0.0193 * T - 0.2592, Bx = -0.0665 * T + 0.0008, Cx = -0.0004 * T + 0.2125, Dx = -0.0641 * T - 0.8989, Ex = -0.0033 * T + 0.0452;
  float Ay = -0.0167 * T - 0.2608, By = -0.0950 * T + 0.0092, Cy = -0.0079 * T + 0.2102, Dy = -0.0441 * T - 1.6537, Ey = -0.0109 * T + 0.0529;

  // Sun zenith angle, clamped — Preetham's chromaticity fit (unlike
  // Schaefer) still isn't meant for deep-night sun angles, so this keeps
  // the cubic zenith-chromaticity polynomials from extrapolating into
  // nonsense there. Low-stakes now (at deep night Schaefer's luminance is
  // tiny regardless of what chromaticity says), unlike before when this
  // same clamp was load-bearing for Preetham's own Yz formula too.
  float sunCosTheta = clamp(uSun.y, -0.05, 1.0);
  float thetaS = min(acos(sunCosTheta), 1.68);
  float T2 = T * T;
  float ts2 = thetaS * thetaS, ts3 = ts2 * thetaS;

  float xz = (0.00166 * ts3 - 0.00375 * ts2 + 0.00209 * thetaS) * T2
           + (-0.02903 * ts3 + 0.06377 * ts2 - 0.03202 * thetaS + 0.00394) * T
           + (0.11693 * ts3 - 0.21196 * ts2 + 0.06052 * thetaS + 0.25886);
  float yz = (0.00275 * ts3 - 0.00610 * ts2 + 0.00317 * thetaS) * T2
           + (-0.04214 * ts3 + 0.08970 * ts2 - 0.04153 * thetaS + 0.00516) * T
           + (0.15346 * ts3 - 0.26756 * ts2 + 0.06670 * thetaS + 0.26688);

  float thetaSCosTheta = 1.0; // cos(theta) at the zenith itself, for the normalizer
  float sunCosTheta2 = sunCosTheta * sunCosTheta;
  float normX = max(perezF(Ax, Bx, Cx, Dx, Ex, thetaSCosTheta, thetaS, sunCosTheta2), 1e-4);
  float normYc = max(perezF(Ay, By, Cy, Dy, Ey, thetaSCosTheta, thetaS, sunCosTheta2), 1e-4);

  vec3 xyy;
  xyy.x = xz * perezF(Ax, Bx, Cx, Dx, Ex, cosTheta, gamma, cosGamma2) / normX;
  xyy.y = yz * perezF(Ay, By, Cy, Dy, Ey, cosTheta, gamma, cosGamma2) / normYc;

  // Defensive clamp, not from their file: xyY→sRGB divides by xyy.y (see
  // xyyToSrgb), so a near-zero y from some not-yet-found edge case in the
  // ratio above would blow X/Z up. Wide of every value seen in testing.
  xyy.y = max(xyy.y, 0.05);

  // Real luminance, cd/m² — replaces Preetham's own Yz entirely.
  float cosMoonDist = clamp(dot(p, uMoon), -1.0, 1.0);
  xyy.z = schaeferLuminance(cosMoonDist, cosGamma, cosTheta);

  // Jensen et al. 2000 scotopic/mesopic night-vision blue-shift — verbatim
  // from atmosphere.glsl, operating on the raw (pre-tonemap) luminance.
  // Now genuinely calibrated: xyy.z is real cd/m², so the 0.01/3.981
  // thresholds (real scotopic/photopic transition luminances) actually
  // land at the right solar altitude, unlike with the old scaled Preetham
  // Yz standing in for it.
  float op = (log(max(xyy.z, 1e-6)) / log(10.0) + 2.0) / 2.6;
  float s = xyy.z <= 0.01 ? 0.0 : (xyy.z > 3.981 ? 1.0 : op * op * (3.0 - 2.0 * op));
  xyy.x = mix(0.25, xyy.x, s);
  xyy.y = mix(0.25, xyy.y, s);
  xyy.z = 0.4468 * (1.0 - s) * xyy.z + s * xyy.z;

  // Their own tonemap shape (core.c's tonemapper: log(1+p*L)/log(1+p*Lwmax)),
  // p=2.2 — see file header for what uLwmax is (floored per-moment
  // reference, computed in main.js) and why.
  xyy.z = log(1.0 + 2.2 * xyy.z) / log(1.0 + 2.2 * max(uLwmax, 1e-6));
  xyy.z = clamp(xyy.z * uExposureOverride, 0.0, 1.0); // live debug slider, index.html

  vec3 rgb = xyyToSrgb(xyy);
  vColor = vec3(gammaf(rgb.r), gammaf(rgb.g), gammaf(rgb.b));

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  if (uWarpActive > 0.5) { mvPosition.xyz = stereographicWarp(mvPosition.xyz); }
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SKY_DOME_FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`;

// Additive: the dome is real skylight, not a painted-on tint — at night its
// near-zero output adds nothing over the stars/Milky Way behind it, and in
// daylight its brightness naturally overwhelms them without needing a
// separate opaque "hide the stars" layer (see the file header).
//
// side is FrontSide by default (correct for the app's default outside
// view — an external camera looking at the globe should see only the
// outward-facing surface). Center view flips it to BackSide (the
// conventional skybox setup for a camera INSIDE a shell) — see
// setCenterView in main.js, which must reapply this after every rebuild()
// since buildSphere() makes a fresh material each time.
//
// Deliberately NOT DoubleSide: an open bowl viewed from outside at an
// elevated angle (this app's default camera position) lets a single ray
// cross BOTH the near rim wall and the far inner wall — with additive
// blending those summed to solid white across most of the visible disc,
// which was the "brightness is crazy" bug. Each view mode only ever needs
// one of the two surfaces, so culling the other outright (rather than
// relying on depth-testing, which would also have to write depth and
// wrongly occlude the stars/Milky Way behind it) fixes this with no
// downside.
export function createSkyDomeMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_DOME_VERTEX,
    fragmentShader: SKY_DOME_FRAGMENT,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, -1, 0) },
      uMoon: { value: new THREE.Vector3(0, -1, 0) },
      uTurbidity: { value: 0.96 }, // their own "calibrated visually" default
      uSbNightTerm: { value: 0 },
      uSbK: { value: 0.2 },
      uSbMoonTerm: { value: 0 },
      uSbC3: { value: 0 },
      uSbTwilightTerm: { value: 0 },
      uSbC4: { value: 0 },
      uLwmax: { value: 600 },
      // Default lower than 1.0 — the tonemap's own Lwmax pins luminance-AT-
      // THE-SUN to white (ratio→1) by construction (see file header), so a
      // large swath of dome near the sun reads near-white at exposure=1.
      // User's own slider test confirmed the dome default needs to read
      // "very slight." 0.3 chosen as a first real value; not yet re-verified
      // against the day/twilight/night sweep the other tonemap constants were.
      uExposureOverride: { value: 0.3 },
      uWarpActive: warpActiveUniform,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.FrontSide,
  });
}

const STAR_POINT_VERTEX = /* glsl */ `
${STEREOGRAPHIC_GLSL}
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uSizeScale;
uniform float uWarpActive;

void main() {
  vColor = aColor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // Size attenuation uses the TRUE (pre-warp) distance — the warp changes
  // where things land on screen, not how physically far away they are.
  gl_PointSize = aSize * uSizeScale / -mvPosition.z;
  if (uWarpActive > 0.5) { mvPosition.xyz = stereographicWarp(mvPosition.xyz); }
  gl_Position = projectionMatrix * mvPosition;
}
`;

const STAR_POINT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
uniform float uCoreSize; // 0 = halo only (unsupported here), 1 = no halo
uniform float uDayFade;  // 1 = full night brightness, 0 = invisible (daylight) — see main.js's setSkyDayNight
uniform float uBrightnessOverride; // live debug slider (index.html) — 1.0 = no change

void main() {
  float dist = 2.0 * distance(gl_PointCoord, vec2(0.5));
  float k = smoothstep(uCoreSize * 1.25, uCoreSize * 0.75, dist);
  k += smoothstep(1.0, 0.0, dist) * 0.08;
  gl_FragColor = vec4(vColor, clamp(k, 0.0, 1.0) * uDayFade * uBrightnessOverride);
}
`;

export function createStarPointsMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: STAR_POINT_VERTEX,
    fragmentShader: STAR_POINT_FRAGMENT,
    uniforms: {
      uSizeScale: { value: 300 },
      uCoreSize: { value: 0.4 },
      uDayFade: { value: 1 },
      uBrightnessOverride: { value: 1 },
      uWarpActive: warpActiveUniform,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

// The sun's marker, same core+halo technique as the stars above (points.glsl)
// — every other planet marker is a small flat-colored dot, but the sun is
// the one body that's an actual light source, so it gets the glow treatment
// instead. A single-point THREE.Points object (not a Sprite) specifically so
// it can reuse this exact shader/uniform setup rather than needing a
// separate billboard-math vertex shader.
const SUN_GLOW_VERTEX = /* glsl */ `
${STEREOGRAPHIC_GLSL}
uniform float uSizeScale;
uniform float uSize;
uniform float uWarpActive;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uSizeScale / -mvPosition.z;
  if (uWarpActive > 0.5) { mvPosition.xyz = stereographicWarp(mvPosition.xyz); }
  gl_Position = projectionMatrix * mvPosition;
}
`;

const SUN_GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uCoreSize;
uniform float uBrightness; // live debug slider (index.html) — 1.0 = default
void main() {
  float dist = 2.0 * distance(gl_PointCoord, vec2(0.5));
  float k = smoothstep(uCoreSize * 1.25, uCoreSize * 0.75, dist);
  // Wider than the stars' 0.08 halo weight, but dialed back from an
  // earlier 0.18 — combined with the separate sunHaloTexture sprite and
  // bloom, the sun kept reading as too bright even after the dome's own
  // tonemap was fixed.
  k += smoothstep(1.0, 0.0, dist) * 0.1;
  gl_FragColor = vec4(uColor, clamp(k * uBrightness, 0.0, 1.0));
}
`;

export function createSunGlowMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: SUN_GLOW_VERTEX,
    fragmentShader: SUN_GLOW_FRAGMENT,
    uniforms: {
      uSizeScale: { value: 300 },
      uSize: { value: 0.11 },
      // Dimmer than pure white on purpose: this additively stacks with the
      // sky dome's own near-sun brightness at the same screen position (see
      // dome's uSun direction) in an HDR bloom buffer — full white here
      // pushed that combined pixel well past the bloom threshold, which
      // UnrealBloomPass then smeared into a huge soft blob (worse in
      // outside view's narrower default fov, where the same bloom-kernel
      // pixel radius covers proportionally more of the screen).
      uColor: { value: new THREE.Color(0xcc9f5c) },
      uCoreSize: { value: 0.5 },
      uBrightness: { value: 1.0 },
      uWarpActive: warpActiveUniform,
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

const SCREEN_LINE_VERTEX = /* glsl */ `
${STEREOGRAPHIC_GLSL}
attribute vec3 aOther;  // the segment's other endpoint
attribute float aSide;  // -1 or +1, which edge of the ribbon
attribute float aAlong; // 0 at this segment's first point, 1 at its second

uniform vec2 uResolution;  // drawing-buffer pixels
uniform float uLineWidth;  // pixels
uniform float uWarpActive;

varying float vDist; // signed pixel distance from the centerline

void main() {
  vec4 mvThis = modelViewMatrix * vec4(position, 1.0);
  vec4 mvOther = modelViewMatrix * vec4(aOther, 1.0);
  if (uWarpActive > 0.5) {
    mvThis.xyz = stereographicWarp(mvThis.xyz);
    mvOther.xyz = stereographicWarp(mvOther.xyz);
  }
  vec4 clipThis = projectionMatrix * mvThis;
  vec4 clipOther = projectionMatrix * mvOther;

  // Both endpoints behind the camera (or the near plane) — degenerate this
  // vertex out of view entirely rather than let a negative w through.
  if (clipThis.w <= 0.0 && clipOther.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  // Dividing by a non-positive w (one endpoint behind the camera/near
  // plane, the other in front) inverts that endpoint's screen position
  // across the viewport center — screenOther-screenThis flips ~180°, and
  // the ribbon quad stretches into a screen-spanning spike. Clamping w
  // keeps the direction vector sane; the segment still gets clipped
  // correctly downstream since gl_Position itself is untouched here.
  float wThis = max(clipThis.w, 1e-3);
  float wOther = max(clipOther.w, 1e-3);
  vec2 screenThis = clipThis.xy / wThis * uResolution * 0.5;
  vec2 screenOther = clipOther.xy / wOther * uResolution * 0.5;
  vec2 diff = screenOther - screenThis;
  float diffLen = length(diff);
  vec2 dir = diffLen > 1e-4 ? diff / diffLen : vec2(1.0, 0.0);
  if (aAlong >= 0.5) dir = -dir;
  vec2 perp = vec2(-dir.y, dir.x);

  // Padded past uLineWidth so the quad has room for the AA edge/glow falloff
  // without clipping it — matches how Stellarium's own u_line_glow reaches
  // out to a fixed 5px radius past the nominal width.
  float halfWidth = uLineWidth * 0.5 + 3.0;
  vec2 offsetPx = perp * aSide * halfWidth;

  vec4 clipPos = clipThis;
  clipPos.xy += offsetPx / (uResolution * 0.5) * clipPos.w;
  gl_Position = clipPos;

  vDist = aSide * halfWidth;
}
`;

const SCREEN_LINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uLineWidth;
uniform float uLineGlow;
varying float vDist;

void main() {
  float dist = abs(vDist);
  // Anti-aliased edge — verbatim from lines.glsl.
  float base = smoothstep(uLineWidth / 2.0 + 1.2, uLineWidth / 2.0 - 1.2, dist);
  // 5px-radius soft glow — verbatim from lines.glsl.
  float glow = (1.0 - dist / 5.0) * uLineGlow;
  float alpha = max(glow, base) * uOpacity;
  if (alpha <= 0.003) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

function buildScreenLineGeometry(points) {
  const segCount = points.length - 1;
  const positions = new Float32Array(segCount * 4 * 3);
  const others = new Float32Array(segCount * 4 * 3);
  const sides = new Float32Array(segCount * 4);
  const alongs = new Float32Array(segCount * 4);
  const indices = new Uint32Array(segCount * 6);

  for (let i = 0; i < segCount; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const base = i * 4;
    const verts = [
      { p: p0, other: p1, side: 1, along: 0 },
      { p: p0, other: p1, side: -1, along: 0 },
      { p: p1, other: p0, side: 1, along: 1 },
      { p: p1, other: p0, side: -1, along: 1 },
    ];
    verts.forEach((v, k) => {
      const idx = base + k;
      positions[idx * 3] = v.p[0]; positions[idx * 3 + 1] = v.p[1]; positions[idx * 3 + 2] = v.p[2];
      others[idx * 3] = v.other[0]; others[idx * 3 + 1] = v.other[1]; others[idx * 3 + 2] = v.other[2];
      sides[idx] = v.side;
      alongs[idx] = v.along;
    });
    indices.set([base, base + 1, base + 2, base + 1, base + 3, base + 2], i * 6);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aOther', new THREE.BufferAttribute(others, 3));
  geom.setAttribute('aSide', new THREE.BufferAttribute(sides, 1));
  geom.setAttribute('aAlong', new THREE.BufferAttribute(alongs, 1));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  return geom;
}

export function createScreenLineMaterial({ color = 0xffffff, lineWidth = 1.5, glow = 0, opacity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: SCREEN_LINE_VERTEX,
    fragmentShader: SCREEN_LINE_FRAGMENT,
    uniforms: {
      uResolution: { value: new THREE.Vector2(1024, 768) },
      uLineWidth: { value: lineWidth },
      uLineGlow: { value: glow },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uWarpActive: warpActiveUniform,
    },
    transparent: true,
    depthWrite: false,
  });
}

export function buildScreenLineMesh(points, material) {
  return new THREE.Mesh(buildScreenLineGeometry(points), material);
}
