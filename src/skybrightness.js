// ── skybrightness.js ─────────────────────────────────────────────────────
// Ported from Stellarium Web Engine's skybrightness.c/.h — Bradley
// Schaefer's 1998 sky brightness model ("To the Visual Limits", Sky &
// Telescope 5/1998, pp. 57-60). This is what actually supplies the sky
// dome's Y (luminance) channel in their engine — Preetham (atmosphere.glsl,
// this app's sky-shaders.js) only supplies the x,y CHROMATICITY, per their
// own comment in that file ("re-inject a_luminance for Y component"). Using
// Preetham's own Yz for luminance (this app's earlier approach) applies a
// daylight-only model outside its domain — which is why it needed the
// uNightFade taper, a thetaS clamp, and exposure/contrast tuning to fake a
// night behavior Preetham was never given. Schaefer has real night terms
// (twilight, moonlight, airglow), so none of that patching is needed here.
//
// Two genuine simplifications from their C, both disclosed:
//   - No solar-eclipse handling (their eclipse_factor, derived from the
//     sun's own apparent magnitude dimming during an eclipse) — this app
//     doesn't model eclipses, so it's always 1.0 (omitted entirely below).
//   - bortleIndex defaults to their OWN hardcoded core.c default (3) — not
//     real location-aware light-pollution data (their engine doesn't have
//     that either; it's a user-adjustable debug value there, not derived
//     from anything real).
// temperature=15°C and relativeHumidity=40% are THEIR OWN hardcoded
// defaults too (atmosphere.c's prepare_skybrightness call), not a guess
// made here.
//
// This file is the CPU-side half: skybrightnessPrepare computes the terms
// that depend only on date/location/moon-sun geometry (not per-vertex view
// direction) — matches their own split (atmosphere.c calls this once per
// frame; here it's called once per setSkyDayNight, i.e. once per sky-state
// update, not per rendered frame). The actual per-vertex luminance
// evaluation for every dome vertex happens in GLSL, in sky-shaders.js's
// SKY_DOME_VERTEX (schaeferLuminance there, kept numerically identical to
// skybrightnessGetLuminance below). skybrightnessGetLuminance is ALSO
// called directly from here in plain JS, once per setSkyDayNight, to
// evaluate the luminance at the sun's own position — main.js uses that
// (floored at a fixed minimum) as the sky dome's tonemap reference. It's
// also how the port itself was numerically verified before any shader
// code was written.

const D2R = Math.PI / 180;
function exp10(x) { return Math.exp(x * Math.LN10); }

export function skybrightnessPrepare({ year, month, moonMag, latitudeRad, altitudeM, distMoonZenithRad, distSunZenithRad }) {
  const RA = (month - 3) * 0.52359878;
  const bNightTerm = 1.0e-13 + 0.3e-13 * Math.cos(0.57118 * (year - 1992));
  const signLatitude = latitudeRad >= 0 ? 1 : -1;
  const temperature = 15, relativeHumidity = 40;

  const KR = 0.1066 * Math.exp(-altitudeM / 8200);
  const KA = 0.1 * Math.exp(-altitudeM / 1500) *
    Math.pow(1 - 0.32 / Math.log(relativeHumidity / 100), 1.33) *
    (1 + 0.33 * signLatitude * Math.sin(RA));
  const KO = 0.031 * Math.exp(-altitudeM / 8200) * (3 + 0.4 *
    (latitudeRad * Math.cos(RA) - Math.cos(3 * latitudeRad))) / 3;
  const KW = 0.031 * 0.94 * (relativeHumidity / 100) *
    Math.exp(temperature / 15) * Math.exp(-altitudeM / 8200);
  const K = KR + KA + KO + KW;

  const cosDistMoonZenith = Math.cos(distMoonZenithRad);
  const airmassMoon = cosDistMoonZenith < 0 ? 40
    : 1 / (cosDistMoonZenith + 0.025 * Math.exp(-11 * cosDistMoonZenith));
  const cosDistSunZenith = Math.cos(distSunZenithRad);
  const airmassSun = cosDistSunZenith < 0 ? 40
    : 1 / (cosDistSunZenith + 0.025 * Math.exp(-11 * cosDistSunZenith));

  // Graduate the moon's impact from 0 to 100% as its altitude ranges 0-10°
  // (their comment: to avoid a discontinuity at moonrise).
  let mt = exp10(-0.4 * (moonMag + 54.32));
  if (distMoonZenithRad > 90 * D2R) mt = 0;
  else if (distMoonZenithRad > 75 * D2R) mt *= (90 * D2R - distMoonZenithRad) / (15 * D2R);
  const bMoonTerm = mt * 1e6;

  const C3 = exp10(-0.4 * K * airmassMoon);
  const bTwilightTerm = -6.724 + 22.918312 * (Math.PI / 2 - distSunZenithRad);
  const C4 = exp10(-0.4 * K * airmassSun);

  return { bNightTerm, K, bMoonTerm, C3, bTwilightTerm, C4 };
}

// cosMoonDist/cosSunDist/cosZenithDist: cosines of the angle between the
// VIEW direction and the moon/sun/zenith respectively. Returns real cd/m².
export function skybrightnessGetLuminance(sb, cosMoonDist, cosSunDist, cosZenithDist) {
  const cap = Math.cos(1 * D2R);
  cosMoonDist = Math.min(cosMoonDist, cap);
  cosSunDist = Math.min(cosSunDist, cap);
  const moonDist = Math.acos(cosMoonDist);
  const sunDist = Math.acos(cosSunDist);

  const bKX = exp10(-0.4 * sb.K * (1 / (cosZenithDist + 0.025 * Math.exp(-11 * cosZenithDist))));

  const FS = 18886.28 / (sunDist * sunDist) + exp10(6.15 - (sunDist + 0.001) * 1.43239) + 229086.77 * (1.06 + cosSunDist * cosSunDist);
  const bDaylight = 9.289663e-12 * (1 - bKX) * (FS * sb.C4 + 440000 * (1 - sb.C4));

  const bTwilightK = sb.bTwilightTerm + 0.063661977 * Math.acos(cosZenithDist) / Math.max(sb.K, 0.05);
  let bTwilight = 0;
  if (bTwilightK > -32) bTwilight = exp10(bTwilightK) * (1.7453293 / sunDist) * (1 - bKX);

  let bTotal = Math.min(bTwilight, bDaylight);

  const FM = 18886.28 / (moonDist * moonDist) + exp10(6.15 - moonDist * 1.43239) + 229086.77 * (1.06 + cosMoonDist * cosMoonDist);
  const bMoon = sb.bMoonTerm * (1 - bKX) * (FM * sb.C3 + 440000 * (1 - sb.C3)) / 1e6;
  bTotal += bMoon;

  if (bTotal > 0 && (sb.bNightTerm * bKX) / bTotal > 0.01) {
    bTotal += (0.4 + 0.6 / Math.sqrt(0.04 + 0.96 * cosZenithDist * cosZenithDist)) * sb.bNightTerm * bKX;
    bTotal += 0.0000000000012; // their own "ad-hoc addition to make the sky slightly more blueish"
  }
  bTotal = Math.max(bTotal, 0);
  return bTotal / 1.11e-15 * 3.183e-6; // nanolambert -> cd/m^2 (NLAMBERT_TO_CDM2)
}
