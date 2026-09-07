// ── astro.js ──────────────────────────────────────────────────────────────
// Thin wrapper around astronomy-engine: real planetary positions, converted
// between ecliptic / equatorial / horizontal coordinate systems. No fudged
// data — every position in the scene comes from here.

import * as Astronomy from 'astronomy-engine';

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

// RA(hours)/Dec(deg) → azimuth(deg, 0=N/90=E)/altitude(deg) for this observer+time.
export function horizonOf(date, observer, raHours, decDeg) {
  return Astronomy.Horizon(date, observer, raHours, decDeg, 'normal');
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
  const dsc = horizonCrossings.find(c => c !== asc) ?? null; // setting, west

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

export function computeDirection(promissor, significator, natalDate, observer, radius = 1) {
  const pEq = resolveEquatorial(promissor, natalDate, observer);
  const sEq = resolveEquatorial(significator, natalDate, observer);
  const pRAdeg = pEq.ra * 15;
  const sRAdeg = sEq.ra * 15;

  const forward = forwardArcDeg(pRAdeg, sRAdeg);
  const swapped = forward > 180;
  const moving = swapped ? significator : promissor;
  const fixed = swapped ? promissor : significator;
  const movingEq = swapped ? sEq : pEq;
  const movingRA0 = movingEq.ra * 15;
  const movingDec = movingEq.dec;
  const arcDeg = swapped ? forwardArcDeg(sRAdeg, pRAdeg) : forward;
  const arcYears = arcDeg / NAIBOD_DEG_PER_YEAR;

  function directedXYZ(tYears) {
    const t = Math.max(0, Math.min(tYears, arcYears));
    const raHours = (((movingRA0 + t * NAIBOD_DEG_PER_YEAR) % 360) + 360) % 360 / 15;
    const { azimuth, altitude } = horizonOf(natalDate, observer, raHours, movingDec);
    return altAzToXYZ(altitude, azimuth, radius);
  }

  const sweepPoints = [];
  const STEPS = 60;
  for (let i = 0; i <= STEPS; i++) sweepPoints.push(directedXYZ((i / STEPS) * arcYears));

  return {
    movingKey: moving.key, fixedKey: fixed.key, swapped,
    arcDeg, arcYears, directedXYZ, sweepPoints,
  };
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
      outer.push(altAzToXYZ(hOuter.altitude, hOuter.azimuth, radius));
      inner.push(altAzToXYZ(hInner.altitude, hInner.azimuth, radius));
    }
    const midEq = eclipticPointToEquatorial(s * 30 + 15, 0, date);
    const midH = horizonOf(date, observer, midEq.ra, midEq.dec);
    return {
      ...sign, index: s, inner, outer,
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

  return { points, inclinationDeg, planetElon: nowEcl.elon, planetElat: nowEcl.elat, N, P0 };
}
