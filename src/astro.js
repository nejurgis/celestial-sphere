// ── astro.js ──────────────────────────────────────────────────────────────
// Thin wrapper around astronomy-engine: real planetary positions, converted
// between ecliptic / equatorial / horizontal coordinate systems. No fudged
// data — every position in the scene comes from here.

import * as Astronomy from 'astronomy-engine';
import { CONSTELLATION_LINES } from './constellation-data.js';

export const PLANETS = [
  { key: 'Sun', body: Astronomy.Body.Sun },
  { key: 'Moon', body: Astronomy.Body.Moon },
  { key: 'Mercury', body: Astronomy.Body.Mercury },
  { key: 'Venus', body: Astronomy.Body.Venus },
  { key: 'Mars', body: Astronomy.Body.Mars },
  { key: 'Jupiter', body: Astronomy.Body.Jupiter },
  { key: 'Saturn', body: Astronomy.Body.Saturn },
];

export function makeObserver(latitude, longitude) {
  return new Astronomy.Observer(latitude, longitude, 0);
}

export const ZODIAC_SIGNS = [
  { name: 'Aries', glyph: '♈', element: 'fire' },
  { name: 'Taurus', glyph: '♉', element: 'earth' },
  { name: 'Gemini', glyph: '♊', element: 'air' },
  { name: 'Cancer', glyph: '♋', element: 'water' },
  { name: 'Leo', glyph: '♌', element: 'fire' },
  { name: 'Virgo', glyph: '♍', element: 'earth' },
  { name: 'Libra', glyph: '♎', element: 'air' },
  { name: 'Scorpio', glyph: '♏', element: 'water' },
  { name: 'Sagittarius', glyph: '♐', element: 'fire' },
  { name: 'Capricorn', glyph: '♑', element: 'earth' },
  { name: 'Aquarius', glyph: '♒', element: 'air' },
  { name: 'Pisces', glyph: '♓', element: 'water' },
];

// ── Egyptian bounds (terms) ──────────────────────────────────────────────
// Each sign split into 5 unequal terms, each ruled by one of the 5 non-
// luminary classical planets. The oldest, most widely-attested bounds table
// (per Ptolemy, who describes it as the older Egyptian system as against
// his own revised terms) — distinct from "Ptolemaic terms". `to` is the
// cumulative end-of-term degree within the sign (0-30). Verified against
// reference tables: summing each planet's degrees across all 12 signs gives
// Saturn 57°, Jupiter 79°, Mars 66°, Venus 82°, Mercury 76° (=360° total),
// the standard checksum for this table.
export const EGYPTIAN_BOUNDS = [
  [{ ruler: 'Jupiter', to: 6 }, { ruler: 'Venus', to: 12 }, { ruler: 'Mercury', to: 20 }, { ruler: 'Mars', to: 25 }, { ruler: 'Saturn', to: 30 }], // Aries
  [{ ruler: 'Venus', to: 8 }, { ruler: 'Mercury', to: 14 }, { ruler: 'Jupiter', to: 22 }, { ruler: 'Saturn', to: 27 }, { ruler: 'Mars', to: 30 }], // Taurus
  [{ ruler: 'Mercury', to: 6 }, { ruler: 'Jupiter', to: 12 }, { ruler: 'Venus', to: 17 }, { ruler: 'Mars', to: 24 }, { ruler: 'Saturn', to: 30 }], // Gemini
  [{ ruler: 'Mars', to: 7 }, { ruler: 'Venus', to: 13 }, { ruler: 'Mercury', to: 19 }, { ruler: 'Jupiter', to: 26 }, { ruler: 'Saturn', to: 30 }], // Cancer
  [{ ruler: 'Jupiter', to: 6 }, { ruler: 'Venus', to: 11 }, { ruler: 'Saturn', to: 18 }, { ruler: 'Mercury', to: 24 }, { ruler: 'Mars', to: 30 }], // Leo
  [{ ruler: 'Mercury', to: 7 }, { ruler: 'Venus', to: 17 }, { ruler: 'Jupiter', to: 21 }, { ruler: 'Mars', to: 28 }, { ruler: 'Saturn', to: 30 }], // Virgo
  [{ ruler: 'Saturn', to: 6 }, { ruler: 'Mercury', to: 14 }, { ruler: 'Jupiter', to: 21 }, { ruler: 'Venus', to: 28 }, { ruler: 'Mars', to: 30 }], // Libra
  [{ ruler: 'Mars', to: 7 }, { ruler: 'Venus', to: 11 }, { ruler: 'Mercury', to: 19 }, { ruler: 'Jupiter', to: 24 }, { ruler: 'Saturn', to: 30 }], // Scorpio
  [{ ruler: 'Jupiter', to: 12 }, { ruler: 'Venus', to: 17 }, { ruler: 'Mercury', to: 21 }, { ruler: 'Saturn', to: 26 }, { ruler: 'Mars', to: 30 }], // Sagittarius
  [{ ruler: 'Mercury', to: 7 }, { ruler: 'Jupiter', to: 14 }, { ruler: 'Venus', to: 22 }, { ruler: 'Saturn', to: 26 }, { ruler: 'Mars', to: 30 }], // Capricorn
  [{ ruler: 'Mercury', to: 7 }, { ruler: 'Venus', to: 13 }, { ruler: 'Jupiter', to: 20 }, { ruler: 'Mars', to: 25 }, { ruler: 'Saturn', to: 30 }], // Aquarius
  [{ ruler: 'Venus', to: 12 }, { ruler: 'Jupiter', to: 16 }, { ruler: 'Mercury', to: 19 }, { ruler: 'Mars', to: 28 }, { ruler: 'Saturn', to: 30 }], // Pisces
];

// The Egyptian bound a given ecliptic longitude falls in. signIndex/termIndex
// together uniquely identify the term-segment (used to detect a "change of
// bound" even at a same-ruler-but-different-sign boundary, which is still a
// real transition since bounds reset per sign).
export function boundOf(elonDeg) {
  const norm = ((elonDeg % 360) + 360) % 360;
  const signIndex = Math.floor(norm / 30);
  const degInSign = norm % 30;
  const terms = EGYPTIAN_BOUNDS[signIndex];
  const termIndex = terms.findIndex(t => degInSign < t.to);
  const idx = termIndex === -1 ? terms.length - 1 : termIndex;
  const fromDeg = idx === 0 ? 0 : terms[idx - 1].to;
  return { ruler: terms[idx].ruler, signIndex, termIndex: idx, fromDeg, toDeg: terms[idx].to };
}

// "14° Ari" style — the point's position expressed as degree-within-sign,
// same convention most chart displays use rather than raw 0-360 longitude.
export function formatEclipticDegree(elonDeg) {
  const norm = ((elonDeg % 360) + 360) % 360;
  const signIndex = Math.floor(norm / 30);
  const degInSign = Math.floor(norm % 30);
  return `${degInSign}°${ZODIAC_SIGNS[signIndex].name.slice(0, 3)}`;
}

// How many days of real motion (centered on "now") to sample when tracing a
// planet's path — wide enough to capture one full retrograde loop. Roughly
// matched to each body's synodic period. Sun/Moon excluded (no loop / loop
// too fast to be legible at this scale).
export const PATH_WINDOW_DAYS = {
  Mercury: 70,
  Venus: 300,
  Mars: 420,
  Jupiter: 220,
  Saturn: 200,
};

// Topocentric RA (hours)/Dec (deg) of-date — required (not J2000) for Horizon().
export function equatorialOf(body, date, observer) {
  const eq = Astronomy.Equator(body, date, observer, true, true);
  return { ra: eq.ra, dec: eq.dec };
}

// Geocentric ecliptic longitude/latitude (deg) — the zodiac-sign coordinate.
export function eclipticOf(body, date) {
  const vec = Astronomy.GeoVector(body, date, true);
  const ecl = Astronomy.Ecliptic(vec);
  return { elon: ecl.elon, elat: ecl.elat };
}

// Moon's horizon position + real apparent magnitude — the moonlight input
// the Schaefer sky-brightness model needs (skybrightness.js). Real
// magnitude (not a fixed guess) since it drives the model's actual
// moonlight-brightness term, same as Stellarium's own atmosphere.c does.
export function computeMoonInfo(date, observer) {
  const { ra, dec } = equatorialOf(Astronomy.Body.Moon, date, observer);
  const { azimuth, altitude } = horizonOf(date, observer, ra, dec);
  const mag = Astronomy.Illumination(Astronomy.Body.Moon, date).mag;
  return { altitude, azimuth, mag };
}

// Sun+Moon altitude only, deliberately NOT the full computeSkyState (which
// also computes every other planet, both angle circles, and the pole —
// wasted work when called dozens of times to build a day/night brightness
// curve, see day-slider.js).
export function computeSunMoonAltitude(date, observer) {
  const sunEq = equatorialOf(Astronomy.Body.Sun, date, observer);
  const moonEq = equatorialOf(Astronomy.Body.Moon, date, observer);
  const sunAlt = horizonOf(date, observer, sunEq.ra, sunEq.dec).altitude;
  const moonAlt = horizonOf(date, observer, moonEq.ra, moonEq.dec).altitude;
  return { sunAlt, moonAlt };
}

// RA(hours)/Dec(deg) → azimuth(deg, 0=N/90=E)/altitude(deg) for this observer+time.
export function horizonOf(date, observer, raHours, decDeg) {
  return Astronomy.Horizon(date, observer, raHours, decDeg, 'normal');
}

// Same, but WITHOUT atmospheric refraction — refraction bends real light
// depending on altitude (strongest near the horizon, ~0 at zenith), so it's
// correct for a real star or planet's apparent position but wrong to use
// when deriving a PURE coordinate-frame rotation (equatorial → horizontal),
// since refraction isn't a rigid rotation and would introduce a small
// (~0.001-0.01, verified numerically) systematic error into that transform.
function horizonOfAirless(date, observer, raHours, decDeg) {
  return Astronomy.Horizon(date, observer, raHours, decDeg, null);
}

// The rotation that carries the equatorial frame (RA=0,Dec=0 → +X;
// Dec=+90 → +Y) into this observer/moment's horizontal (alt/az) frame, as
// two unit vectors an orthonormal-basis-alignment can be built from. Used
// to orient a star-texture sphere (built with plain equatorial UVs) into
// the scene's alt/az space — verified against horizonOf directly for
// several RA/Dec (machine-precision match once refraction is excluded, see
// horizonOfAirless above).
export function computeSkyRotationBasis(date, observer, radius = 1) {
  const poleH = horizonOfAirless(date, observer, 0, 90);
  const equinoxH = horizonOfAirless(date, observer, 0, 0);
  return {
    poleXYZ: altAzToXYZ(poleH.altitude, poleH.azimuth, radius),
    equinoxXYZ: altAzToXYZ(equinoxH.altitude, equinoxH.azimuth, radius),
  };
}

// A point ON the ecliptic (elon, elat=0..) → equatorial RA/Dec of-date, so it
// can be run through horizonOf() the same way a planet is.
export function eclipticPointToEquatorial(elonDeg, elatDeg, date) {
  const sphere = new Astronomy.Spherical(elatDeg, elonDeg, 1);
  const eclVec = Astronomy.VectorFromSphere(sphere, date);
  const rot = Astronomy.Rotation_ECL_EQD(date);
  const eqVec = Astronomy.RotateVector(rot, eclVec);
  return Astronomy.EquatorFromVector(eqVec); // { ra (hours), dec, dist, vec }
}

// Inverse of eclipticPointToEquatorial: RA(hours)/Dec(deg) of-date → ecliptic
// longitude/latitude (deg) of-date. Needed to find a directed (primary-
// motion) point's zodiac position, since primary motion advances RA — an
// equatorial quantity — not ecliptic longitude directly.
//
// `rotation`, if given, is a precomputed Astronomy.Rotation_EQD_ECL(date) —
// pass it when calling this many times for the SAME date (e.g. sampling a
// direction's whole arc, or a whole directions table): the rotation itself
// involves nutation/precession and is by far the expensive part, and it
// only depends on `date`, not on raHours/decDeg, so recomputing it per
// sample is pure waste. Omit it for one-off calls.
export function equatorialOfDateToEcliptic(raHours, decDeg, date, rotation) {
  const sphere = new Astronomy.Spherical(decDeg, raHours * 15, 1);
  const eqVec = Astronomy.VectorFromSphere(sphere, date);
  const rot = rotation ?? Astronomy.Rotation_EQD_ECL(date);
  const eclVec = Astronomy.RotateVector(rot, eqVec);
  const sph = Astronomy.SphereFromVector(eclVec);
  return { elon: ((sph.lon % 360) + 360) % 360, elat: sph.lat };
}

// Alt/Az (deg) → unit-sphere xyz. North=+Z, East=+X, zenith=+Y (right-handed).
export function altAzToXYZ(altitudeDeg, azimuthDeg, radius = 1) {
  const alt = (altitudeDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const x = radius * Math.cos(alt) * Math.sin(az);
  const y = radius * Math.sin(alt);
  const z = radius * Math.cos(alt) * Math.cos(az);
  return [x, y, z];
}

// Full data set the scene needs for one moment + one observer.
export function computeSkyState(date, latitude, longitude, radius = 1) {
  const observer = makeObserver(latitude, longitude);

  const planets = PLANETS.map(({ key, body }) => {
    const { ra, dec } = equatorialOf(body, date, observer);
    const { azimuth, altitude } = horizonOf(date, observer, ra, dec);
    const { elon, elat } = eclipticOf(body, date);
    return {
      key, ra, dec, azimuth, altitude, elon, elat,
      xyz: altAzToXYZ(altitude, azimuth, radius),
    };
  });

  const equatorPoints = [];
  const eclipticPoints = [];
  const STEPS = 144;
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * 360;

    const { azimuth: eqAz, altitude: eqAlt } = horizonOf(date, observer, t / 15, 0);
    equatorPoints.push({ deg: t, xyz: altAzToXYZ(eqAlt, eqAz, radius) });

    const eclEq = eclipticPointToEquatorial(t, 0, date);
    const { azimuth: ecAz, altitude: ecAlt } = horizonOf(date, observer, eclEq.ra, eclEq.dec);
    eclipticPoints.push({
      deg: t, azimuth: ecAz, altitude: ecAlt, ra: eclEq.ra, dec: eclEq.dec,
      xyz: altAzToXYZ(ecAlt, ecAz, radius),
    });
  }

  // North celestial pole direction (Dec=90, RA irrelevant).
  const poleHorizon = horizonOf(date, observer, 0, 90);
  const poleXYZ = altAzToXYZ(poleHorizon.altitude, poleHorizon.azimuth, radius);

  // The four angles — Midheaven/Imum Coeli (meridian crossings of the
  // ecliptic) and Ascendant/Descendant (horizon crossings) — located
  // numerically from the sampled ecliptic circle rather than closed-form
  // trig, since we already have the full sampled circle to hand.
  const angDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

  // MC/IC: the two points nearest az=0 and az=180 (the meridian, at any
  // altitude) — a great circle crosses another great circle at exactly two
  // antipodal points, so "nearest az=0" and "nearest az=180" are exactly
  // those two crossings. Whichever is higher is MC (upper culmination).
  const byAz0 = [...eclipticPoints].sort((a, b) => angDist(a.azimuth, 0) - angDist(b.azimuth, 0))[0];
  const byAz180 = [...eclipticPoints].sort((a, b) => angDist(a.azimuth, 180) - angDist(b.azimuth, 180))[0];
  const mc = byAz0.altitude > byAz180.altitude ? byAz0 : byAz180;
  const ic = mc === byAz0 ? byAz180 : byAz0;

  // ASC/DSC: interpolate the ecliptic-longitude where altitude crosses zero
  // between consecutive samples, then recompute that exact point through
  // the real pipeline (not interpolated xyz/azimuth — only elon is
  // estimated by interpolation, everything else is exact for that elon).
  const crossingElons = [];
  for (let i = 0; i < eclipticPoints.length - 1; i++) {
    const a = eclipticPoints[i], b = eclipticPoints[i + 1];
    if ((a.altitude >= 0) !== (b.altitude >= 0)) {
      const frac = a.altitude / (a.altitude - b.altitude);
      crossingElons.push(a.deg + frac * (b.deg - a.deg));
    }
  }
  const horizonCrossings = crossingElons.map(elon => {
    const eclEq = eclipticPointToEquatorial(elon, 0, date);
    const { azimuth, altitude } = horizonOf(date, observer, eclEq.ra, eclEq.dec);
    return {
      deg: ((elon % 360) + 360) % 360, azimuth, altitude, ra: eclEq.ra, dec: eclEq.dec,
      xyz: altAzToXYZ(altitude, azimuth, radius),
    };
  });
  const asc = horizonCrossings.find(c => c.azimuth > 0 && c.azimuth < 180) ?? null; // rising, east
  // DSC is analytically the exact antipode of ASC on the ecliptic — two
  // great circles (ecliptic, horizon) always cross at exactly antipodal
  // points — so it's recomputed through the real pipeline for elon =
  // asc.deg+180 rather than reused from horizonCrossings' OTHER entry,
  // which comes from a separate, independent linear interpolation with its
  // own small error. Reusing it made ASC/DSC land a fraction of a degree
  // short of exactly opposite, which showed up as a visibly non-horizontal
  // ASC-DSC line in the 2D chart (a straight line through two points that
  // are almost-but-not-quite 180° apart isn't horizontal).
  let dsc = null;
  if (asc) {
    const dscElon = (asc.deg + 180) % 360;
    const eclEq = eclipticPointToEquatorial(dscElon, 0, date);
    const { azimuth, altitude } = horizonOf(date, observer, eclEq.ra, eclEq.dec);
    dsc = { deg: dscElon, azimuth, altitude, ra: eclEq.ra, dec: eclEq.dec, xyz: altAzToXYZ(altitude, azimuth, radius) };
  }

  return { observer, planets, equatorPoints, eclipticPoints, poleXYZ, mc, ic, asc, dsc };
}

// A planet's real path across the sky over `windowDays` centered on `date`
// (its actual retrograde loop). Each sampled day's REAL ecliptic position
// (elon, elat) is projected through the *same* frozen equatorial/horizon
// frame as everything else on the sphere for `date` — so the loop appears
// as an accurate deviation from the static ecliptic circle drawn for "now",
// exactly matching how the reference software plots it. Not a live-changing
// animation; a snapshot of motion relative to today's sky orientation.
export function computePlanetPath(body, date, observer, windowDays, radius = 1, stepDays = 3) {
  const points = [];
  for (let d = -windowDays; d <= windowDays; d += stepDays) {
    const sampleDate = new Date(date.getTime() + d * 86400000);
    const { elon, elat } = eclipticOf(body, sampleDate);
    const eclEq = eclipticPointToEquatorial(elon, elat, date); // frozen frame = display date
    const { azimuth, altitude } = horizonOf(date, observer, eclEq.ra, eclEq.dec);
    points.push({ offsetDays: d, elon, elat, xyz: altAzToXYZ(altitude, azimuth, radius) });
  }
  const maxLat = points.reduce((m, p) => (Math.abs(p.elat) > Math.abs(m.elat) ? p : m), points[0]);
  return { points, maxLat };
}

// A planet's circle of position: the great circle of constant right
// ascension running from pole to pole through the planet (its "hour
// circle"). Depends only on the planet's RA, not its declination — the
// circle passes through the planet regardless of how far it sits from the
// equator. Where this circle crosses the celestial equator (Dec=0) is the
// planet's mundane position.
export function computePositionCircle(raHours, date, observer, radius = 1, steps = 180) {
  const points = [];
  for (let i = 0; i <= steps * 2; i++) {
    const phi = (i / (steps * 2)) * 360;
    const onNearSide = phi <= 180;
    const dec = onNearSide ? phi - 90 : 270 - phi;
    const ra = onNearSide ? raHours : (raHours + 12) % 24;
    const { azimuth, altitude } = horizonOf(date, observer, ra, dec);
    points.push(altAzToXYZ(altitude, azimuth, radius));
  }
  const mundane = horizonOf(date, observer, raHours, 0);
  return { points, mundaneXYZ: altAzToXYZ(mundane.altitude, mundane.azimuth, radius) };
}

// ── Primary directions (equatorial/"in mundo") ────────────────────────────
// The promissor's directed position advances in RA at the rate of diurnal
// (primary) motion; the significator's position circle — fixed RA — stays
// put. Naibod's key converts degrees of that advance into years of life:
// 360°/365.2422 days ≈ 0.9856°/year, the Sun's mean daily motion — the same
// key the video names. If the forward arc exceeds 180°, promissor and
// significator swap roles (a "converse" direction) rather than predicting
// a 180+ year wait, per the video's own rule.
export const NAIBOD_DEG_PER_YEAR = 360 / 365.2422;

// A sidereal day (rotation relative to the stars, not the sun) is ~23h56m4s —
// slightly shorter than a calendar day, since the calendar day also has to
// cover the sun's own ~0.9856 deg of motion (see NAIBOD_DEG_PER_YEAR above).
// Used to simulate primary/diurnal motion: reproject a body's NATAL RA/Dec
// through a LATER sidereal moment (real horizon rotation) without touching
// its real orbital position, so playback shows the natal sky visibly
// turning — not a single marker creeping across an otherwise-static scene.
const SIDEREAL_DAY_MS = 86164090.5;
export function siderealRotatedDate(natalDate, rotationDeg) {
  return new Date(natalDate.getTime() + (rotationDeg / 360) * SIDEREAL_DAY_MS);
}

function forwardArcDeg(fromDeg, toDeg) {
  return (((toDeg - fromDeg) % 360) + 360) % 360;
}

// promissor/significator: { key, body }. Declination of the moving point is
// held at its natal value throughout — diurnal rotation is a rotation about
// the pole, so a real point's declination never changes as it turns; only
// its RA-relative-to-the-horizon does.
// point: { key, body } for a planet (RA/Dec looked up via equatorialOf), or
// { key, ra, dec } for an angle (ASC/DSC/MC/IC — already computed, no body
// to look up). Directing an angle is a standard technique in its own right
// (directing the Ascendant to a promissor's aspect/conjunction is one of the
// most common primary-direction methods), so angles work in either role.
function resolveEquatorial(point, date, observer) {
  return point.body ? equatorialOf(point.body, date, observer) : { ra: point.ra, dec: point.dec };
}

// Shared by both arc systems below: once a system has decided WHICH point
// moves, WHICH stays fixed, and the arc's length in degrees, the simulated
// motion itself (advance RA at Naibod's rate, natal declination held fixed)
// and everything derived from it — directedXYZ, directedElon, the rendered
// sweep — is identical regardless of which system found that arc length.
function buildDirectionResult(moving, fixed, movingEq, arcDeg, swapped, natalDate, observer, radius, opts) {
  const movingRA0 = movingEq.ra * 15;
  const movingDec = movingEq.dec;
  const arcYears = arcDeg / NAIBOD_DEG_PER_YEAR;

  function directedRAHours(tYears) {
    const t = Math.max(0, Math.min(tYears, arcYears));
    return (((movingRA0 + t * NAIBOD_DEG_PER_YEAR) % 360) + 360) % 360 / 15;
  }

  function directedXYZ(tYears) {
    const { azimuth, altitude } = horizonOf(natalDate, observer, directedRAHours(tYears), movingDec);
    return altAzToXYZ(altitude, azimuth, radius);
  }

  // The moving point's ecliptic longitude at t years into the direction —
  // not needed for the horizon-frame sweep itself, but is how a directed
  // point's Egyptian bound (or sign) is found: primary motion advances RA,
  // so its zodiacal position has to be read off via the inverse transform.
  // The EQD->ECL rotation depends only on natalDate (fixed for this whole
  // direction), so it's computed once here rather than per sample — matters
  // when a caller (e.g. the directions table) samples this hundreds of
  // times per direction across hundreds of directions.
  const eqdEclRotation = Astronomy.Rotation_EQD_ECL(natalDate);
  function directedElon(tYears) {
    return equatorialOfDateToEcliptic(directedRAHours(tYears), movingDec, natalDate, eqdEclRotation).elon;
  }

  // Skippable — bulk table generation (computeAllDirections) needs the
  // summary numbers for hundreds of combinations, not each one's rendered
  // sweep path.
  const sweepPoints = [];
  if (!opts.skipSweep) {
    const STEPS = 60;
    for (let i = 0; i <= STEPS; i++) sweepPoints.push(directedXYZ((i / STEPS) * arcYears));
  }

  return {
    movingKey: moving.key, fixedKey: fixed.key, swapped,
    arcDeg, arcYears, directedXYZ, directedElon, sweepPoints,
  };
}

// opts.selfReturn: a planet directed to its OWN natal position (promissor
// and significator are the same body, cast in plain conjunction) — the
// forward arc is genuinely 0deg (already there), but the meaningful
// question here is "when does primary motion bring it all the way back
// around", i.e. one full primary rotation, 360deg (~365 years via Naibod —
// not coincidentally close to a calendar year, since Naibod's key IS the
// sun's mean motion). Without this flag a same-body direction just
// reports an instant (0-year) arc, which isn't a useful answer.
export function computeDirection(promissor, significator, natalDate, observer, radius = 1, opts = {}) {
  const pEq = resolveEquatorial(promissor, natalDate, observer);
  const sEq = resolveEquatorial(significator, natalDate, observer);
  const pRAdeg = pEq.ra * 15;
  const sRAdeg = sEq.ra * 15;

  const forward = forwardArcDeg(pRAdeg, sRAdeg);
  const isSelfReturn = opts.selfReturn && forward === 0;

  // Self-return: no meaningful "swap" (promissor and significator are the
  // same point) — always the promissor completing one full primary
  // rotation back to itself.
  const swapped = !isSelfReturn && forward > 180;
  const moving = swapped ? significator : promissor;
  const fixed = swapped ? promissor : significator;
  const movingEq = swapped ? sEq : pEq;
  const arcDeg = isSelfReturn ? 360 : (swapped ? forwardArcDeg(sRAdeg, pRAdeg) : forward);

  return buildDirectionResult(moving, fixed, movingEq, arcDeg, swapped, natalDate, observer, radius, opts);
}

// ── Primary directions (Placidus semi-arc, "in mundo" via the diurnal/
// nocturnal semicircle) ──────────────────────────────────────────────────
// Where computeDirection treats every point uniformly via its raw RA
// (Regiomontanus's circle-of-position method), Placidus's semi-arc system —
// "the most influential system underlying modern ephemeris-based
// directing" — instead measures a point's mundane position as a FRACTION of
// whichever semi-arc it's currently traveling: diurnal (above horizon,
// between ASC and DSC via the MC) or nocturnal (below, via the IC).
// cos(S_diurnal) = −tan(lat)·tan(dec); S_nocturnal = 180°−S_diurnal.
//
// Primary motion advances a point's RA, which DECREASES its hour angle
// H = RAMC−RA at the same rate — so unlike plain RA (which simply wraps
// every 360°), a point's semi-arc FRACTION isn't periodic in a simple way:
// which semi-arc even applies flips every time it crosses a horizon or
// meridian. The fix used here is the same rescaling Placidus house cusps
// themselves use — remap each quadrant (MC→ASC, ASC→IC, IC→DSC, DSC→MC) to
// exactly 90° regardless of its true angular width, giving a single
// continuous, monotonic "mundo angle" M(H) that primary motion decreases
// smoothly through, quadrant after quadrant, however many years the arc
// spans — then solve for the crossing numerically (bisection), matching
// this file's existing "sample and solve" approach to angles/houses rather
// than hand-deriving per-quadrant case formulas.
function semiArcsOf(decDeg, latDeg) {
  const x = Math.max(-1, Math.min(1, -Math.tan((latDeg * Math.PI) / 180) * Math.tan((decDeg * Math.PI) / 180)));
  const diurnal = (Math.acos(x) * 180) / Math.PI;
  return { diurnal, nocturnal: 180 - diurnal };
}

function hourAngleDeg(raHours, ramcHours) {
  const h = ((ramcHours - raHours) * 15) % 360;
  return h > 180 ? h - 360 : h < -180 ? h + 360 : h;
}

// H reduced to (-180,180] -> M in [-180,180]: 0=MC, ±90=ASC/DSC, ±180=IC.
function placidusQuadrantAngle(hDeg, sDiurnal) {
  const sNoct = 180 - sDiurnal;
  if (hDeg >= 0 && hDeg <= sDiurnal) return (hDeg / sDiurnal) * 90; // MC -> DSC
  if (hDeg > sDiurnal) return 90 + ((hDeg - sDiurnal) / sNoct) * 90; // DSC -> IC
  if (hDeg < 0 && hDeg >= -sDiurnal) return (hDeg / sDiurnal) * 90; // MC -> ASC
  return -180 + ((hDeg + 180) / sNoct) * 90; // IC -> ASC
}

// Same, but continuous across repeated 360° cycles of H (needed since a
// direction's arc can span many decades — many quadrant crossings).
function placidusUnwrappedAngle(hUnwrapped, sDiurnal) {
  const cycle = Math.floor((hUnwrapped + 180) / 360);
  return placidusQuadrantAngle(hUnwrapped - cycle * 360, sDiurnal) + cycle * 360;
}

// Smallest E >= 0 (degrees of H-decrease, i.e. of primary motion) such that
// the moving point's mundo angle, starting at hourAngle0, first reaches
// target's fixed mundo angle (targetH/targetSDiurnal) going forward.
function placidusArcDeg(hourAngle0, sDiurnal, targetH, targetSDiurnal) {
  const startM = placidusQuadrantAngle(hourAngle0, sDiurnal);
  const targetMBase = placidusQuadrantAngle(targetH, targetSDiurnal);
  let targetM = targetMBase;
  while (targetM > startM) targetM -= 360;
  while (targetM <= startM - 360) targetM += 360;
  if (Math.abs(targetM - startM) < 1e-9) return 0;

  const mAt = E => placidusUnwrappedAngle(hourAngle0 - E, sDiurnal);
  let lo = 0, hi = Math.max(360, (startM - targetM) * 2);
  while (mAt(hi) > targetM) hi *= 1.5;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (mAt(mid) > targetM) lo = mid; else hi = mid;
  }
  return hi;
}

// angles: { mc } (only mc.ra — RAMC — is needed; from computeSkyState).
export function computePlacidusDirection(promissor, significator, natalDate, observer, angles, radius = 1, opts = {}) {
  const pEq = resolveEquatorial(promissor, natalDate, observer);
  const sEq = resolveEquatorial(significator, natalDate, observer);
  const ramcHours = angles.mc.ra;
  const lat = observer.latitude;

  const Hp = hourAngleDeg(pEq.ra, ramcHours), Hs = hourAngleDeg(sEq.ra, ramcHours);
  const Sp = semiArcsOf(pEq.dec, lat).diurnal, Ss = semiArcsOf(sEq.dec, lat).diurnal;

  const isSelfReturn = opts.selfReturn && promissor.key === significator.key && Hp === Hs;
  if (isSelfReturn) return buildDirectionResult(promissor, significator, pEq, 360, false, natalDate, observer, radius, opts);

  // Report whichever direction (promissor->significator, or its converse)
  // completes sooner — same spirit as computeDirection's >180° swap rule,
  // generalized since Placidus's arc isn't bounded to [0,360) the same way.
  const direct = placidusArcDeg(Hp, Sp, Hs, Ss);
  const converse = placidusArcDeg(Hs, Ss, Hp, Sp);
  const swapped = converse < direct;
  const moving = swapped ? significator : promissor;
  const fixed = swapped ? promissor : significator;
  const movingEq = swapped ? sEq : pEq;

  return buildDirectionResult(moving, fixed, movingEq, swapped ? converse : direct, swapped, natalDate, observer, radius, opts);
}

// Every Egyptian-bound change the moving point passes through over the
// course of a direction — a change of dignity mid-direction is itself
// traditionally read as significant, not just where the direction lands.
// Samples directedElon() at fine resolution, then bisects around each
// detected sign/term change for a tight year estimate (same numeric-first
// approach as the rest of this file, rather than solving in closed form).
export function computeBoundCrossings(direction, steps = 2000) {
  const { arcYears, directedElon } = direction;
  if (!directedElon || arcYears <= 0) return [];

  const key = b => `${b.signIndex}.${b.termIndex}`;
  const boundAt = t => boundOf(directedElon(t));

  const crossings = [];
  let prevT = 0;
  let prevBound = boundAt(0);
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * arcYears;
    const bound = boundAt(t);
    if (key(bound) !== key(prevBound)) {
      let lo = prevT, hi = t;
      const loKey = key(prevBound);
      for (let k = 0; k < 30; k++) {
        const mid = (lo + hi) / 2;
        if (key(boundAt(mid)) === loKey) lo = mid; else hi = mid;
      }
      crossings.push({ years: hi, elon: directedElon(hi), from: boundOf(directedElon(lo)), to: boundOf(directedElon(hi)) });
      prevBound = bound;
    }
    prevT = t;
  }
  return crossings;
}

// ── Star field ────────────────────────────────────────────────────────────
// catalog: [[raHours, decDeg, mag, name], ...] — real per-star data (see
// public/bright_stars.json's own sourcing note), not a photographic
// texture. Positions are computed once at natal time, same as everything
// else; the caller reprojects the whole field for playback via a single
// rotation about the natal pole axis rather than recomputing each star
// (verified numerically to match per-star horizonOf to ~0.005°, well
// under a point-star's visual size — the residual is pure atmospheric
// refraction, not an approximation error in the rotation itself).
export function computeStarField(date, observer, radius, catalog) {
  return catalog.map(([raHours, dec, mag, name]) => {
    const { azimuth, altitude } = horizonOf(date, observer, raHours, dec);
    return { xyz: altAzToXYZ(altitude, azimuth, radius), mag, name };
  });
}

// ── Equatorial grid (RA/Dec) ──────────────────────────────────────────────
// Declination parallels (fixed Dec, all RA) — same as the plain celestial
// equator line elsewhere in this file, their alt/az SHAPE is invariant
// under sidereal rotation (every point on a Dec-parallel gets the same
// hour-angle shift as time passes, so the curve just slides along itself
// rather than changing shape) — computed once, no reprojection needed.
// RA meridians (fixed RA, pole to pole) don't have that property — a
// meridian's alt/az shape genuinely sweeps as time passes, the same way
// the ecliptic line does, so the caller needs to reproject these during
// playback (see reprojectRotatables in main.js).
export function computeEquatorialGrid(date, observer, radius = 1, opts = {}) {
  const decStep = opts.decStep ?? 10;
  const raStepHours = opts.raStepHours ?? 1;
  const labelDec = opts.labelDec ?? 75; // where RA-meridian hour labels sit, away from pole clutter
  const STEPS = 72;

  const decCircles = [];
  for (let dec = -80; dec <= 80; dec += decStep) {
    if (dec === 0) continue; // the plain celestial equator line already covers this
    const points = [];
    for (let i = 0; i <= STEPS; i++) {
      const raHours = (i / STEPS) * 24;
      const { azimuth, altitude } = horizonOf(date, observer, raHours, dec);
      points.push({ ra: raHours, dec, xyz: altAzToXYZ(altitude, azimuth, radius) });
    }
    const labelH = horizonOf(date, observer, 0, dec);
    decCircles.push({ dec, points, labelXYZ: altAzToXYZ(labelH.altitude, labelH.azimuth, radius) });
  }

  const raMeridians = [];
  for (let raHours = 0; raHours < 24; raHours += raStepHours) {
    const points = [];
    for (let i = 0; i <= STEPS; i++) {
      const dec = -90 + (i / STEPS) * 180;
      const { azimuth, altitude } = horizonOf(date, observer, raHours, dec);
      points.push({ ra: raHours, dec, xyz: altAzToXYZ(altitude, azimuth, radius) });
    }
    const labelH = horizonOf(date, observer, raHours, labelDec);
    raMeridians.push({
      raHours, points,
      labelRa: raHours, labelDec, labelXYZ: altAzToXYZ(labelH.altitude, labelH.azimuth, radius),
    });
  }

  return { decCircles, raMeridians };
}

// ── Azimuthal grid (Alt/Az) ────────────────────────────────────────────────
// This app's own local horizon frame already IS alt/az (altAzToXYZ) —
// unlike the equatorial grid above, these lines never depend on date or
// observer and never need reprojection during playback: an altitude
// parallel or azimuth meridian is fixed relative to the horizon by
// definition, full stop.
export function computeAzimuthalGrid(radius = 1, opts = {}) {
  const altStep = opts.altStep ?? 10;
  const azStep = opts.azStep ?? 30;
  const labelAlt = opts.labelAlt ?? 75; // where azimuth-meridian labels sit, away from pole clutter
  const STEPS = 72;

  const altCircles = [];
  for (let alt = -80; alt <= 80; alt += altStep) {
    if (alt === 0) continue; // the horizon ring already covers this
    const points = [];
    for (let i = 0; i <= STEPS; i++) {
      const az = (i / STEPS) * 360;
      points.push({ az, alt, xyz: altAzToXYZ(alt, az, radius) });
    }
    altCircles.push({ alt, points, labelXYZ: altAzToXYZ(alt, 0, radius) });
  }

  const azMeridians = [];
  for (let az = 0; az < 360; az += azStep) {
    const points = [];
    for (let i = 0; i <= STEPS; i++) {
      const alt = -90 + (i / STEPS) * 180;
      points.push({ az, alt, xyz: altAzToXYZ(alt, az, radius) });
    }
    azMeridians.push({ az, points, labelXYZ: altAzToXYZ(labelAlt, az, radius) });
  }

  return { altCircles, azMeridians };
}

// A short arc through a given ecliptic longitude, perpendicular to the
// ecliptic/zodiac band — spans elat [-halfWidthDeg, +halfWidthDeg] through
// that point, deliberately NOT a full pole-to-pole great circle. Used for
// the live "ASC now" marker's own short crosshair line during day-rotation
// playback (see buildAscPerpendicularLine/setDayRotationDeg in main.js) —
// halfWidthDeg defaults a bit wider than computeZodiacBand's own ±4°, so
// the line visibly pokes out past the band on both sides.
export function computeAscPerpendicular(elonDeg, date, observer, radius = 1, halfWidthDeg = 6) {
  const STEPS = 24;
  const points = [];
  for (let i = 0; i <= STEPS; i++) {
    const elat = -halfWidthDeg + (i / STEPS) * (halfWidthDeg * 2);
    const eq = eclipticPointToEquatorial(elonDeg, elat, date);
    const { azimuth, altitude } = horizonOf(date, observer, eq.ra, eq.dec);
    points.push({ elat, xyz: altAzToXYZ(altitude, azimuth, radius) });
  }
  return { points };
}

// ── Zodiacal constellations ───────────────────────────────────────────────
// The 12 real star figures the zodiac signs are named after — genuinely
// different from the zodiac BAND (which is 12 equal 30° slices of the
// ecliptic, a coordinate convention) and from ZODIAC_SIGNS' glyphs. A
// constellation's actual boundary/shape doesn't line up with its "sign"'s
// 30° slice — e.g. the Sun spends about 45 days in the constellation Virgo
// but the zodiac sign Virgo is exactly 30°/~30 days, and the constellation
// Ophiuchus overlaps the ecliptic too even though it's not one of the 12
// signs. Star positions from CONSTELLATION_LINES (see that file for
// sourcing/verification) are fixed points, same as a planet's instantaneous
// RA/Dec — reproject them during playback the same way (see
// reprojectRotatables in main.js), unlike the equatorial grid's Dec circles.
export function computeConstellations(date, observer, radius = 1) {
  return CONSTELLATION_LINES.map(c => ({
    id: c.id,
    name: c.name,
    strands: c.strands.map(strand => strand.map(([raDeg, decDeg]) => {
      const raHours = (((raDeg % 360) + 360) % 360) / 15;
      const { azimuth, altitude } = horizonOf(date, observer, raHours, decDeg);
      return { ra: raHours, dec: decDeg, xyz: altAzToXYZ(altitude, azimuth, radius) };
    })),
  }));
}

// ── Zodiac band ────────────────────────────────────────────────────────────
// A thick ribbon following the ecliptic, split into the 12 signs. Each
// segment's inner/outer edges are real ecliptic-latitude offsets (±halfWidth)
// run through the same equatorial/horizon pipeline as everything else, not a
// flat visual approximation — the ribbon actually curves with the sky.
export function computeZodiacBand(date, observer, radius = 1, halfWidthDeg = 4, samplesPerSign = 8) {
  return ZODIAC_SIGNS.map((sign, s) => {
    const inner = [];
    const outer = [];
    for (let i = 0; i <= samplesPerSign; i++) {
      const elon = s * 30 + (i / samplesPerSign) * 30;
      const eqOuter = eclipticPointToEquatorial(elon, halfWidthDeg, date);
      const eqInner = eclipticPointToEquatorial(elon, -halfWidthDeg, date);
      const hOuter = horizonOf(date, observer, eqOuter.ra, eqOuter.dec);
      const hInner = horizonOf(date, observer, eqInner.ra, eqInner.dec);
      outer.push({ ra: eqOuter.ra, dec: eqOuter.dec, xyz: altAzToXYZ(hOuter.altitude, hOuter.azimuth, radius) });
      inner.push({ ra: eqInner.ra, dec: eqInner.dec, xyz: altAzToXYZ(hInner.altitude, hInner.azimuth, radius) });
    }
    const midEq = eclipticPointToEquatorial(s * 30 + 15, 0, date);
    const midH = horizonOf(date, observer, midEq.ra, midEq.dec);
    return {
      ...sign, index: s, inner, outer,
      midRa: midEq.ra, midDec: midEq.dec,
      midXYZ: altAzToXYZ(midH.altitude, midH.azimuth, radius),
    };
  });
}

// ── Morinus's plane of aspects ──────────────────────────────────────────────
// A great circle that (a) always passes through the planet's current
// position and (b) is inclined to the ecliptic by exactly the planet's
// maximum celestial latitude over its CURRENT node-to-node swing (not an
// arbitrary sampling window — the swing bounded by the two nearest zero-
// latitude crossings on either side of "now"). Those two constraints pin
// down the plane's tilt but leave its exact orientation (which of two
// mirror-image circles) ambiguous from the constraints alone; resolved by
// requiring the plane's local direction of travel at the planet's position
// to match the planet's actual direction of motion.
//
// This is solved as vector geometry (a plane through the origin has a unit
// normal N), not trig-formula branching:
//   - N must make angle `inclination` with the ecliptic pole Z=(0,0,1).
//   - N must be perpendicular to the planet's position vector P (so the
//     plane through the origin with normal N contains P).
// Those two conditions generically admit exactly two solutions for N
// (mirror images), disambiguated as described above.

const eclipticToCartesian = (elonDeg, elatDeg) => {
  const lon = (elonDeg * Math.PI) / 180, lat = (elatDeg * Math.PI) / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
};
const cartesianToEcliptic = ([x, y, z]) => {
  const elat = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
  const elon = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { elon, elat };
};
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const norm3 = v => { const n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };

export function computeAspectPlane(body, date, observer, radius = 1, searchWindowDays = 250, steps = 120) {
  const nowEcl = eclipticOf(body, date);
  const P0 = eclipticToCartesian(nowEcl.elon, nowEcl.elat);
  const sampleElat = d => eclipticOf(body, new Date(date.getTime() + d * 86400000)).elat;

  // Nearest node (elat=0 crossing) on each side of "now".
  const nowSign = Math.sign(nowEcl.elat) || 1;
  let prevNodeDay = -searchWindowDays;
  for (let d = -1; d >= -searchWindowDays; d--) {
    if (Math.sign(sampleElat(d)) !== nowSign) { prevNodeDay = d; break; }
  }
  let nextNodeDay = searchWindowDays;
  for (let d = 1; d <= searchWindowDays; d++) {
    if (Math.sign(sampleElat(d)) !== nowSign) { nextNodeDay = d; break; }
  }

  // Max |latitude| within this single swing only.
  let maxAbsLat = Math.abs(nowEcl.elat);
  for (let d = prevNodeDay; d <= nextNodeDay; d++) {
    const e = Math.abs(sampleElat(d));
    if (e > maxAbsLat) maxAbsLat = e;
  }
  const inclinationDeg = maxAbsLat;
  const iRad = (inclinationDeg * Math.PI) / 180;

  // Solve for the plane's normal N: angle(N,Z)=i, N ⊥ P0.
  const Z = [0, 0, 1];
  const Zperp = sub3(Z, scale3(P0, dot3(Z, P0)));
  const sinGamma = Math.hypot(...Zperp) || 1e-9; // |component of Z perpendicular to P0|
  const e1 = norm3(Zperp);
  const e2 = norm3(cross3(P0, e1));
  const cosTheta = Math.max(-1, Math.min(1, Math.cos(iRad) / sinGamma));
  const theta0 = Math.acos(cosTheta);

  const buildN = theta => norm3([
    Math.cos(theta) * e1[0] + Math.sin(theta) * e2[0],
    Math.cos(theta) * e1[1] + Math.sin(theta) * e2[1],
    Math.cos(theta) * e1[2] + Math.sin(theta) * e2[2],
  ]);
  const Na = buildN(theta0);
  const Nb = buildN(-theta0);

  // Disambiguate: whichever candidate's in-plane tangent direction at P0
  // best matches the planet's real short-term motion direction.
  const laterEcl = eclipticOf(body, new Date(date.getTime() + 6 * 3600000));
  const P1 = eclipticToCartesian(laterEcl.elon, laterEcl.elat);
  const realDir = norm3(sub3(P1, P0));
  const tangentAt = N => norm3(cross3(N, P0));
  const score = N => Math.abs(dot3(tangentAt(N), realDir));
  const N = score(Na) >= score(Nb) ? Na : Nb;

  // Sample the circle: any two orthonormal vectors spanning the plane ⊥ N.
  const ref = Math.abs(N[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm3(cross3(N, ref));
  const v = cross3(N, u);

  const points = [];
  for (let k = 0; k <= steps; k++) {
    const phi = (k / steps) * 2 * Math.PI;
    const vec = [
      Math.cos(phi) * u[0] + Math.sin(phi) * v[0],
      Math.cos(phi) * u[1] + Math.sin(phi) * v[1],
      Math.cos(phi) * u[2] + Math.sin(phi) * v[2],
    ];
    const { elon, elat } = cartesianToEcliptic(vec);
    const eq = eclipticPointToEquatorial(elon, elat, date);
    const h = horizonOf(date, observer, eq.ra, eq.dec);
    points.push(altAzToXYZ(h.altitude, h.azimuth, radius));
  }

  return { points, inclinationDeg, planetElon: nowEcl.elon, planetElat: nowEcl.elat, N, P0, u, v, date };
}

// A classical aspect of the planet, cast IN THE ASPECT PLANE (not the
// ecliptic) — Morinus's whole point. The aspect point is simply the
// position on the same great circle offset by the aspect angle, measured
// along the circle from the planet's own position — same u/v parametrization
// already used to sample the plane's points, so this is exact, not a second
// approximation layered on top.
//
// offsetDeg: 60=sextile, 90=square, 120=trine, 180=opposition. sinister
// (direction of increasing sign order, the classical default) is positive;
// dexter (against the order of signs) is negative — pass -offsetDeg for it.
export function computeAspectPoint(aspectPlane, offsetDeg) {
  const { P0, u, v, date } = aspectPlane;
  const phi0 = Math.atan2(dot3(P0, v), dot3(P0, u));
  const phi = phi0 + (offsetDeg * Math.PI) / 180;
  const vec = [
    Math.cos(phi) * u[0] + Math.sin(phi) * v[0],
    Math.cos(phi) * u[1] + Math.sin(phi) * v[1],
    Math.cos(phi) * u[2] + Math.sin(phi) * v[2],
  ];
  const { elon, elat } = cartesianToEcliptic(vec);
  const eq = eclipticPointToEquatorial(elon, elat, date);
  return { elon, elat, ra: eq.ra, dec: eq.dec };
}

// ── Houses (Regiomontanus) ───────────────────────────────────────────────
// Classical "rational" house system: the celestial EQUATOR (not the
// ecliptic) is divided into 12 equal 30° arcs starting at the RAMC (the
// meridian). Through each division point, together with the North/South
// points of the local horizon, runs a "house circle" — its intersection
// with the ecliptic is the house cusp. Solved numerically (sample the
// ecliptic, find where it crosses each house-circle's plane), matching this
// file's existing style for ASC/DSC/MC/IC rather than closed-form trig.
//
// Houses 1/4/7/10 are exactly the ASC/IC/DSC/MC already computed elsewhere
// (true for any quadrant house system) — only 11/12/2/3/5/6/8/9 need this.
// Cusp k and cusp k+6 always share one house circle (antipodal division
// points on the equator give the exact same great circle), so only 4
// circles are needed for the remaining 8 cusps.
export function computeRegiomontanusHouses(date, observer, angles, radius = 1) {
  const { mc, ic, asc, dsc } = angles;
  const ramcHours = mc.ra;

  const STEPS = 720; // 0.5° ecliptic sampling — plenty for a cusp line's width
  const fine = [];
  for (let i = 0; i <= STEPS; i++) {
    const t = (i / STEPS) * 360;
    const eq = eclipticPointToEquatorial(t, 0, date);
    const { azimuth, altitude } = horizonOf(date, observer, eq.ra, eq.dec);
    fine.push({ deg: t, xyz: altAzToXYZ(altitude, azimuth, radius) });
  }

  const NORTH = altAzToXYZ(0, 0, radius); // North point of the horizon

  // The house circle for an equatorial division point: the great circle
  // through NORTH, the (antipodal) south horizon point, and the division
  // point itself. Where it crosses the sampled ecliptic (sign change of the
  // signed distance to the circle's plane) is a candidate cusp.
  function circleCrossings(divisionRaHours) {
    const ra = ((divisionRaHours % 24) + 24) % 24;
    const { azimuth, altitude } = horizonOf(date, observer, ra, 0);
    const D = altAzToXYZ(altitude, azimuth, radius);
    const Nh = cross3(NORTH, D);
    const out = [];
    for (let i = 0; i < fine.length - 1; i++) {
      const a = fine[i], b = fine[i + 1];
      const da = dot3(a.xyz, Nh), db = dot3(b.xyz, Nh);
      if ((da >= 0) !== (db >= 0)) {
        const frac = da / (da - db);
        out.push((((a.deg + frac * (b.deg - a.deg)) % 360) + 360) % 360);
      }
    }
    return out;
  }

  // Does x lie strictly between lo and hi going forward (increasing) from
  // lo, wrapping through 360 if hi < lo? Used to tell a cusp apart from its
  // antipodal opposite among a house circle's two ecliptic crossings.
  const between = (x, lo, hi) => {
    const span = ((hi - lo) % 360 + 360) % 360;
    const rel = ((x - lo) % 360 + 360) % 360;
    return rel > 0 && rel < span;
  };

  const cusps = { 1: asc.deg, 4: ic.deg, 7: dsc.deg, 10: mc.deg };
  const RANGE = {
    11: [mc.deg, asc.deg], 12: [mc.deg, asc.deg],
    2: [asc.deg, ic.deg], 3: [asc.deg, ic.deg],
    5: [ic.deg, dsc.deg], 6: [ic.deg, dsc.deg],
    8: [dsc.deg, mc.deg], 9: [dsc.deg, mc.deg],
  };
  const PAIRS = [[30, 11, 5], [60, 12, 6], [120, 2, 8], [150, 3, 9]];

  for (const [offsetDeg, a, b] of PAIRS) {
    const crossings = circleCrossings(ramcHours + offsetDeg / 15);
    for (const x of crossings) {
      const [loA, hiA] = RANGE[a];
      cusps[between(x, loA, hiA) ? a : b] = x;
    }
  }

  return cusps; // { 1..12: ecliptic longitude in degrees }
}

// Which house (1-12) an ecliptic longitude falls in, given a cusps object
// from computeRegiomontanusHouses. A point exactly on cusp h belongs to
// house h (the standard convention — a house starts at its own cusp).
export function houseOf(elonDeg, cusps) {
  const norm = ((elonDeg % 360) + 360) % 360;
  for (let h = 1; h <= 12; h++) {
    const lo = cusps[h], hi = cusps[h === 12 ? 1 : h + 1];
    if (lo == null || hi == null) continue;
    const span = ((hi - lo) % 360 + 360) % 360;
    const rel = ((norm - lo) % 360 + 360) % 360;
    if (rel === 0 || rel < span) return h;
  }
  return null;
}

// ── Houses (Whole Sign) ───────────────────────────────────────────────────
// The oldest, simplest house system: house 1 IS the entire zodiac sign
// containing the Ascendant (cusp = that sign's own 0°), each next house the
// next whole sign in order — no equator/RAMC math at all, unlike
// Regiomontanus above. Same flat { 1..12: elon } shape, so it's a drop-in
// for houseOf/renderChart2D either way.
export function computeWholeSignHouses(asc) {
  const signStart = Math.floor((((asc.deg % 360) + 360) % 360) / 30) * 30;
  const cusps = {};
  for (let h = 1; h <= 12; h++) cusps[h] = (signStart + (h - 1) * 30) % 360;
  return cusps;
}

// ── Full directions table ("Prognosis") ─────────────────────────────────────
// Every promissor/significator/aspect combination the source material's own
// software lists, sorted chronologically — not just the one currently
// selected in the main panel.

export const ASPECT_DEFS = [
  { deg: 0, glyph: '☌', dir: null },
  { deg: 60, glyph: '⚹', dir: 'sinister' }, { deg: -60, glyph: '⚹', dir: 'dexter' },
  { deg: 90, glyph: '□', dir: 'sinister' }, { deg: -90, glyph: '□', dir: 'dexter' },
  { deg: 120, glyph: '△', dir: 'sinister' }, { deg: -120, glyph: '△', dir: 'dexter' },
  { deg: 180, glyph: '☍', dir: null }, // sinister/dexter coincide exactly at opposition
];

// pointKeys: the set of usable promissor/significator keys.
// resolvePoint(key): key -> {key,body} or {key,ra,dec}, same shape computeDirection expects.
// bodyOf(key): key -> astronomy-engine Body, or undefined/null for an angle
//   (angles only get the plain-conjunction variant — their "aspect plane"
//   would just be the ecliptic itself, elat is 0 by definition).
// opts.includeBoundCrossings: also emit a row (kind:'bound') for every
// Egyptian-bound a PLANET (or angle) enters via its own primary motion, from
// its own natal position — one self-directed timeline per point, computed
// once (not once per promissor/significator/aspect combination: a bound
// crossing is intrinsic to the moving point's own path, independent of
// which significator it's eventually being directed toward). Deliberately
// scoped to plain natal points only, not aspect-cast promissor points
// (e.g. "Mercury's opposition point") — those are a real promissor concept
// elsewhere in this table, but reading "a planet enters a new bound" as
// "a synthetic aspect-derived point enters a new bound" is confusing more
// than it's useful.
// opts.angles: { mc, ic, asc, dsc } (from computeSkyState) — when given
// alongside includeBoundCrossings, each bound-change row also gets `house`:
// the NATAL house (fixed, Regiomontanus) the crossing's zodiac position
// falls in — not a house that itself moves with the direction, the same
// "which of my houses is being activated" reading transits use.
export function computeAllDirections(pointKeys, resolvePoint, bodyOf, natalDate, observer, radius = 1, maxYears = 150, opts = {}) {
  const includeBoundCrossings = opts.includeBoundCrossings ?? true;
  const system = opts.system ?? 'regiomontanus'; // or 'placidus'
  const direct = (p, s, o) => system === 'placidus'
    ? computePlacidusDirection(p, s, natalDate, observer, opts.angles, radius, o)
    : computeDirection(p, s, natalDate, observer, radius, o);
  const rows = [];
  for (const promissorKey of pointKeys) {
    const body = bodyOf(promissorKey);
    const basePoint = resolvePoint(promissorKey);
    const aspectPlane = body ? computeAspectPlane(body, natalDate, observer, radius) : null;
    const variants = body ? ASPECT_DEFS : [ASPECT_DEFS[0]];

    for (const variant of variants) {
      let promissorPoint = basePoint;
      let promissorElon = aspectPlane ? aspectPlane.planetElon : null;
      if (variant.deg !== 0) {
        const aspectPoint = computeAspectPoint(aspectPlane, variant.deg);
        promissorPoint = { key: promissorKey, ra: aspectPoint.ra, dec: aspectPoint.dec };
        promissorElon = aspectPoint.elon;
      }

      for (const significatorKey of pointKeys) {
        if (significatorKey === promissorKey) continue;
        const significatorPoint = resolvePoint(significatorKey);
        const direction = direct(promissorPoint, significatorPoint, { skipSweep: true });
        if (direction.arcYears > maxYears) continue;
        const date = new Date(natalDate.getTime() + direction.arcYears * 365.2422 * 86400000);
        rows.push({
          kind: 'direction', significatorKey, promissorKey, aspectGlyph: variant.glyph, aspectDir: variant.dir,
          promissorElon, arcDeg: direction.arcDeg, arcYears: direction.arcYears,
          swapped: direction.swapped, date,
        });
      }
    }
  }

  if (includeBoundCrossings) {
    const houseCusps = opts.angles ? computeRegiomontanusHouses(natalDate, observer, opts.angles, radius) : null;
    for (const key of pointKeys) {
      const point = resolvePoint(key);
      const selfDirection = computeDirection(point, point, natalDate, observer, radius, { selfReturn: true, skipSweep: true });
      const steps = Math.max(200, Math.ceil((maxYears / selfDirection.arcYears) * 1500));
      for (const c of computeBoundCrossings(selfDirection, steps)) {
        if (c.years > maxYears) continue;
        rows.push({
          kind: 'bound', movingKey: key,
          fromRuler: c.from.ruler, toRuler: c.to.ruler, signIndex: c.to.signIndex,
          house: houseCusps ? houseOf(c.elon, houseCusps) : null,
          arcYears: c.years, date: new Date(natalDate.getTime() + c.years * 365.2422 * 86400000),
        });
      }
    }
  }

  rows.sort((a, b) => a.arcYears - b.arcYears);
  return rows;
}
