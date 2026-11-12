// Compares the app's primary directions (and Regiomontanus cusps) with
// published figures.
//   node scripts/verify-directions.mjs
//
// Sources
//  * Predictive Astrology Textbook, Example №35 (native 1976-11-29, UTC+3):
//    Table 3.9 gives forecasts at the official 12:15; Table 3.10's deviations
//    give the 12:16 (rectified) ones — derived as reality + deviation, so only
//    good to a month. Also from the book: both charts' cusps (Figs 3.1, 3.11),
//    the p.389 control directions, the whole Table 3.10 grid (12:13…12:17) and
//    Example №36 (Venus return chart, Fig. 3.13 / Table 3.11) — checked below.
//  * morinus-astrology.com/diana-death (Princess Diana, 1961-07-01 19:45 +01:00,
//    and Prince William, 1982-06-21 21:03 +01:00): dated directions + cusps.
//  * morinus-astrology.com/thematic-directions (Queen Elizabeth II, 1926-04-21
//    02:40 +01:00): six dated directions incl. to the 5th-house cusp, + cusps.
//    A significator 'C<n>' means house cusp n directed as its zodiac degree
//    (ecliptic latitude 0).
//  * Morin, Astrologia Gallica Book 22 (Holden's translation), Appendix 5: the
//    worked Regiomontanus example is checked at the end.
//
// Row: [promissor, aspect glyph, sinister|dexter, significator, ...book month per time]
// (sinister = +offset in longitude, dexter = −offset). A trailing { xfail: 'why' }
// marks a row the app is KNOWN not to reproduce yet — reported, not counted.
// To compare another method or chart, add a DATASET entry.
//
// Exit code 1 if any non-xfail row is further than TOLERANCE_MONTHS from the book.

import * as A from '../src/astro.js';

const TOLERANCE_MONTHS = 3;
const CUSP_TOLERANCE_DEG = 0.03; // 2′

const DATASET = [
  {
    name: 'Queen Elizabeth II (blog)',
    lat: 51.5, lon: -9 / 60,
    times: [{ label: '02:40 BST', utc: [1926, 4, 21, 1, 40] }],
    cusps: { 2: [16, 8], 3: [3, 38], 5: [10, 9], 6: [25, 33], 8: [16, 8], 9: [3, 38], 11: [10, 9], 12: [25, 33] },
    // Blog gives the dates below as the promittor "approaching" the significator;
    // for the cusp the author adds nine months for the birth (not applied here).
    rows: [
      ['Venus', '⚹', 'sinister', 'C5',      '1947-12'],
      ['Moon',  '□', 'dexter',   'C5',      '1949-10'],
      ['Moon',  '□', 'dexter',   'Mercury', '1952-05'],
      ['Venus', '⚹', 'sinister', 'Mercury', '1956-07'],
      ['Moon',  '⚹', 'sinister', 'Moon',    '1959-12'],
      ['Moon',  '△', 'dexter',   'C5',      '1963-04'],
    ],
  },
  {
    name: 'Example 35 (Borealis)',
    lat: 55 + 45 / 60, lon: 37 + 37 / 60,
    times: [
      { label: '12:15 local', utc: [1976, 11, 29, 9, 15], cusps: { 11: [17, 46], 12: [1, 11], 2: [11, 28], 3: [20, 59] } }, // Fig. 3.11
      { label: '12:16 local', utc: [1976, 11, 29, 9, 16], cusps: { 11: [17, 59], 12: [1, 25], 2: [12, 4], 3: [21, 19] } },  // Fig. 3.1
    ],
    rows: [
      ['Venus',  '⚹', 'sinister', 'ASC',     '2001-01', '2000-10'],
      ['Sun',    '△', 'sinister', 'Jupiter', '2002-04', '2002-03'],
      ['Saturn', '⚹', 'sinister', 'MC',      '2002-12', '2003-01'],
      ['Saturn', '⚹', 'sinister', 'Sun',     '2003-07', '2003-06'],
      ['Sun',    '△', 'sinister', 'ASC',     '2004-12', '2004-09'],
      ['Sun',    '△', 'sinister', 'Venus',   '2008-02', '2008-02'],
      ['Saturn', '△', 'dexter',   'Venus',   '2016-03', '2016-04'],
      ['Venus',  '△', 'sinister', 'ASC',     '2019-07', '2019-04'],
      ['Sun',    '△', 'sinister', 'Moon',    '1990-10', null],
      ['Mars',   '⚹', 'dexter',   'Mars',    '2007-01', null],
      ['Mars',   '□', 'dexter',   'Mars',    '2014-12', null],
      ['Venus',  '△', 'sinister', 'Moon',    '2006-02', null],
      ['Saturn', '⚹', 'sinister', 'DSC',     '2013-02', null],
      // p.389 "final verification" on the rectified chart
      ['Mars',   '△', 'sinister', 'Jupiter', null, '2001-07'],
      ['Mars',   '☍', null,       'Moon',    null, '2019-04', { xfail: 'arc 40.78° → Apr 2018, same month one year early; probably a year slip in the book (unproven)' }],
    ],
  },
  {
    name: 'Diana (blog)',
    lat: 52 + 50 / 60, lon: 0.5,
    times: [{ label: '19:45 BST', utc: [1961, 7, 1, 18, 45] }],
    // Blog's Regiomontanus cusps (11, 12, 2, 3) — the ASC/MC are checked implicitly.
    cusps: { 11: [13, 3], 12: [29, 3], 2: [22, 44], 3: [16, 50] }, // deg, min within sign
    rows: [
      ['Saturn',  '☍', null,       'Mercury', '1991-11'],
      ['Jupiter', '☍', null,       'Mercury', '1997-08'],
      ['Sun',     '□', 'dexter',   'Jupiter', '1997-08'], // blog: "August-September 1997"; significator not named, Jupiter is a life planet
      ['Mercury', '☌', null,       'Mars',    '2017-01', { xfail: 'blog used the shortest-path ("modern") converse: significator\'s pole, arc 54.69° → Dec 2016. Our traditional converse (promissor\'s pole) is 50.49°; see docs §13' }],
    ],
  },
  {
    name: 'William (blog)',
    lat: 51 + 32 / 60, lon: -12 / 60,
    times: [{ label: '21:03 BST', utc: [1982, 6, 21, 20, 3] }],
    rows: [
      ['Saturn', '☍', null, 'IC', '1997-08', { xfail: 'blog used the shortest-path ("modern") converse: significator\'s pole = IC → plain RA difference 14.96° → Aug 1997. Our traditional converse is 11.86°; see docs §13' }],
    ],
  },
];

const BODY = Object.fromEntries(A.PLANETS.map(p => [p.key, p.body]));
const KEYS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'ASC', 'DSC', 'MC', 'IC'];
const SIGN_START = deg => Math.floor(deg / 30) * 30;

let worst = 0;
for (const chart of DATASET) {
  chart.times.forEach((t, ti) => {
    const date = new Date(Date.UTC(...t.utc.slice(0, 1), t.utc[1] - 1, ...t.utc.slice(2)));
    const s = A.computeSkyState(date, chart.lat, chart.lon);
    const angles = { mc: s.mc, ic: s.ic, asc: s.asc, dsc: s.dsc };
    const ang = { ASC: s.asc, DSC: s.dsc, MC: s.mc, IC: s.ic };
    const cuspsAll = A.computeRegiomontanusHouses(date, s.observer, angles);
    const cuspPoint = k => { const e = A.eclipticPointToEquatorial(cuspsAll[k.slice(1)], 0, date); return { key: k, ra: e.ra, dec: e.dec }; };
    const resolve = k => /^C\d+$/.test(k) ? cuspPoint(k) : BODY[k] ? { key: k, body: BODY[k] } : { key: k, ra: ang[k].ra, dec: ang[k].dec };
    const keys = [...KEYS, ...new Set(chart.rows.flatMap(r => [r[0], r[3]]).filter(k => /^C\d+$/.test(k)))];
    const rows = A.computeAllDirections(keys, resolve, k => BODY[k], date, s.observer, 1, 120, { includeBoundCrossings: false, angles });
    console.log(`\n${chart.name} — ${t.label}  (ASC ${A.formatEclipticDegree(s.asc.deg)}, MC ${A.formatEclipticDegree(s.mc.deg)})`);

    const bookCusps = t.cusps ?? chart.cusps;
    if (bookCusps) {
      const cusps = A.computeRegiomontanusHouses(date, s.observer, angles);
      for (const [h, [d, m]] of Object.entries(bookCusps)) {
        const want = SIGN_START(cusps[h]) + d + m / 60, err = cusps[h] - want;
        const ok = Math.abs(err) <= CUSP_TOLERANCE_DEG;
        if (!ok) worst = Infinity;
        console.log(`  cusp ${String(h).padStart(2)}: book ${d}°${String(m).padStart(2, '0')}′  app ${A.formatEclipticDegree(cusps[h])}  (${(err * 60).toFixed(1)}′) ${ok ? 'ok' : 'FAIL'}`);
      }
    }

    console.log('  promissor → significator   book     app         arc      Δ months');
    for (const row of chart.rows) {
      const [p, glyph, dir, sig] = row, book = row[4 + ti];
      const opts = row.find(x => x && typeof x === 'object');
      if (!book || typeof book !== 'string') continue;
      const r = rows.find(x => x.promissorKey === p && x.aspectGlyph === glyph && (dir == null || (x.aspectDir ?? 'sinister') === dir) && x.significatorKey === sig);
      const label = `${p} ${glyph}${dir === 'dexter' ? '(d)' : ''} → ${sig}`.padEnd(26);
      if (!r) { console.log(`  ${label} ${book}   —  not produced`); if (!opts?.xfail) worst = Infinity; continue; }
      const [by, bm] = book.split('-').map(Number);
      const dMonths = (r.date.getUTCFullYear() - by) * 12 + (r.date.getUTCMonth() + 1 - bm);
      if (!opts?.xfail) worst = Math.max(worst, Math.abs(dMonths));
      const arcNote = '';
      console.log(`  ${label} ${book}  ${r.date.toISOString().slice(0, 7)}  ${r.arcDeg.toFixed(2).padStart(6)}° ${r.swapped ? 'conv' : 'dir '}  ${dMonths > 0 ? '+' : ''}${dMonths}${arcNote}${opts?.xfail ? `   [known miss: ${opts.xfail}]` : ''}`);
    }
  });
}
// ── Textbook Table 3.10: rectification grid ──────────────────────────────────
// Deviation (forecast − reality, whole months) of the eight Table 3.9 events for
// birth times 12:13…12:17. The book rounds to months, so allow 1.
{
  const EVENTS = [ // [promissor, glyph, dir, significator, reality 'YYYY-MM']
    ['Venus', '⚹', 'sinister', 'ASC', '2000-12'], ['Sun', '△', 'sinister', 'Jupiter', '2002-10'],
    ['Saturn', '⚹', 'sinister', 'MC', '2002-10'], ['Saturn', '⚹', 'sinister', 'Sun', '2003-05'],
    ['Sun', '△', 'sinister', 'ASC', '2004-09'], ['Sun', '△', 'sinister', 'Venus', '2008-04'],
    ['Saturn', '△', 'dexter', 'Venus', '2016-01'], ['Venus', '△', 'sinister', 'ASC', '2019-05'],
  ];
  const BOOK = {
    13: [7, -5, -1, 4, 10, -2, 2, 8], 14: [4, -6, 1, 3, 7, -2, 2, 5], 15: [1, -6, 2, 2, 3, -2, 2, 2],
    16: [-2, -7, 3, 1, 0, -2, 3, -1], 17: [-5, -8, 4, 0, -3, -2, 3, -4],
  };
  const lat = 55 + 45 / 60, lon = 37 + 37 / 60;
  console.log('\nTextbook Table 3.10 — deviation in months per birth time (book / app)');
  let gridWorst = 0;
  for (const [min, book] of Object.entries(BOOK)) {
    const date = new Date(Date.UTC(1976, 10, 29, 9, Number(min)));
    const s = A.computeSkyState(date, lat, lon);
    const angles = { mc: s.mc, ic: s.ic, asc: s.asc, dsc: s.dsc }, ang = { ASC: s.asc, DSC: s.dsc, MC: s.mc, IC: s.ic };
    const resolve = k => BODY[k] ? { key: k, body: BODY[k] } : { key: k, ra: ang[k].ra, dec: ang[k].dec };
    const rows = A.computeAllDirections(KEYS, resolve, k => BODY[k], date, s.observer, 1, 120, { includeBoundCrossings: false, angles });
    const app = EVENTS.map(([p, g, dir, sig, real]) => {
      const r = rows.find(x => x.promissorKey === p && x.aspectGlyph === g && (x.aspectDir ?? 'sinister') === dir && x.significatorKey === sig);
      const [y, m] = real.split('-').map(Number);
      return (r.date.getUTCFullYear() - y) * 12 + (r.date.getUTCMonth() + 1 - m);
    });
    const off = Math.max(...app.map((v, i) => Math.abs(v - book[i])));
    gridWorst = Math.max(gridWorst, off);
    console.log(`  12:${min}  [${book.join(', ')}]  /  [${app.join(', ')}]  ${off <= 1 ? 'ok' : 'FAIL'}`);
  }
  if (gridWorst > 1) worst = Infinity;
}

// ── Textbook Example №36: directions inside the Venus return chart ───────────
// Fig. 3.13 (1976 native's Venus return, 2019-02-19 10:59:58 UTC, 55°46′N 37°52′E)
// and Table 3.11: Venus's sinister trine directed to ASC / MC / Venus / Saturn,
// through computeReturnDirections (direct arcs 0…360°, 360° = the 294-day cycle).
{
  const date = new Date(Date.UTC(2019, 1, 19, 10, 59, 58));
  const next = new Date(date.getTime() + 294 * 86400000); // the book's round figure
  const R = A.computeReturnDirections(date, next, 55 + 46 / 60, 37 + 52 / 60);
  console.log(`\nTextbook Example 36 — Venus return chart  (ASC ${A.formatEclipticDegree(R.sky.asc.deg)}, MC ${A.formatEclipticDegree(R.sky.mc.deg)})`);
  for (const [h, [d, m]] of Object.entries({ 11: [3, 48], 12: [25, 42], 2: [12, 29], 3: [28, 44] })) {
    const err = R.cusps[h] - (SIGN_START(R.cusps[h]) + d + m / 60), ok = Math.abs(err) <= CUSP_TOLERANCE_DEG;
    if (!ok) worst = Infinity;
    console.log(`  cusp ${String(h).padStart(2)}: book ${d}°${String(m).padStart(2, '0')}′  app ${A.formatEclipticDegree(R.cusps[h])}  (${(err * 60).toFixed(1)}′) ${ok ? 'ok' : 'FAIL'}`);
  }
  { // ⊗ printed in Fig. 3.13: 21°50′ Capricorn
    const err = R.sky.fortune.deg - (270 + 21 + 50 / 60), ok = Math.abs(err) <= 0.05;
    if (!ok) worst = Infinity;
    console.log(`  Part of Fortune: book 21°50′ Cap  app ${A.formatEclipticDegree(R.sky.fortune.deg)}  (${(err * 60).toFixed(1)}′) ${ok ? 'ok' : 'FAIL'}`);
  }
  for (const [sig, want, days] of [['ASC', 303.21, 248], ['MC', 54.48, 44], ['Venus', 172.0, 140], ['Saturn', 174.9, 142]]) {
    const d = R.rows.find(x => x.promissorKey === 'Venus' && x.aspectGlyph === '△' && x.aspectDir === 'sinister' && x.significatorKey === sig);
    const ok = d && !d.swapped && Math.abs(d.arcDeg - want) <= 0.05 && Math.abs(d.days - days) <= 1;
    if (!ok) worst = Infinity;
    console.log(`  Venus △ → ${sig.padEnd(6)} book ${want.toFixed(2).padStart(6)}° ${days} d   app ${d.arcDeg.toFixed(2).padStart(6)}° ${d.days.toFixed(1)} d  ${d.date.toISOString().slice(0, 10)}  ${ok ? 'ok' : 'FAIL'}`);
  }
}

// ── Dykes, Revolutions workshop 2013: the directed solar-return Ascendant ─────
// His worked example (45°N, latitude 44.5°): dates the SR Ascendant enters each
// sign. He uses whole-sign ascension tables (+1 day every other sign) and gives
// the Ascendant only to the degree, so allow 2 days.
{
  console.log('\nDykes 2013 — directed solar-return Ascendant, sign entries');
  for (const [label, srUtc, ascLon, rows] of [
    ['age 26, ASC 11° Leo', [2011, 5, 29, 12], 131, [[150, '2011-07-24'], [180, '2011-09-01'], [210, '2011-10-11'], [270, '2011-12-27'], [300, '2012-01-24'], [0, '2012-03-02'], [30, '2012-03-19']]],
    ['age 27, ASC 17° Lib', [2012, 5, 28, 12], 197, [[210, '2012-07-14'], [240, '2012-08-24'], [300, '2012-10-28'], [330, '2012-11-17'], [30, '2012-12-21'], [60, '2013-01-10'], [120, '2013-03-17'], [150, '2013-04-26']]],
  ]) {
    const sr = new Date(Date.UTC(...srUtc));
    const days = A.ascendantDistributionDays(sr, ascLon, 44.5, 365.2422);
    const errs = rows.map(([lon, want]) => Math.round((sr.getTime() + days(lon) * 86400000 - Date.parse(want + 'T12:00Z')) / 86400000));
    const ok = errs.every(e => Math.abs(e) <= 2);
    if (!ok) worst = Infinity;
    console.log(`  ${label}: days off [${errs.join(', ')}]  ${ok ? 'ok' : 'FAIL'}`);
  }
}

// ── Morin/Holden worked example (Astrologia Gallica Book 22, Appendix 5) ──────
// Direction of Mars to the conjunction of Jupiter in mundo, chart of Sixtus ab
// Hemminga: RAMC 165°24′, latitude 53°N. Published: pole 47°21′, arc 25°46′
// (Morin himself printed 26°45′ — a slip Holden traces to a mis-copied degree).
{
  const dm = (d, m) => d + m / 60;
  const RAMC = dm(165, 24);
  const jup = { ra: dm(263, 14), dec: -dm(22, 53) }, mars = { ra: dm(288, 37), dec: -dm(23, 9) };
  const d = A.computeRegiomontanusDirection(
    { key: 'Mars', ra: mars.ra / 15, dec: mars.dec }, { key: 'Jupiter', ra: jup.ra / 15, dec: jup.dec },
    new Date(0), { latitude: 53 }, { mc: { ra: RAMC / 15 } }, 1, { skipSweep: true });
  const want = dm(25, 46), ok = !d.swapped && Math.abs(d.arcDeg - want) <= 0.02;
  if (!ok) worst = Infinity;
  console.log(`\nMorin/Holden Appendix 5 example (Mars → Jupiter, mundane): book ${want.toFixed(3)}°  app ${d.arcDeg.toFixed(3)}° ${d.swapped ? 'conv' : 'dir'}  ${ok ? 'ok' : 'FAIL'}`);
}

// ── Year view self-check (solar / lunar returns) ─────────────────────────────
// No published figures to compare with, so check the definition itself: at the
// solar return the Sun is back at its natal longitude, at the lunar return the
// Moon is, and the profected sign steps one sign per completed year.
{
  const natal = new Date(Date.UTC(1976, 10, 29, 9, 16)), lat = 55 + 45 / 60, lon = 37 + 37 / 60;
  const natalAsc = A.computeSkyState(natal, lat, lon).asc.deg;
  const target = new Date(Date.UTC(2009, 1, 8));
  const y = A.computeYearView(natal, lat, lon, target, natalAsc);
  const elon = (k, d) => A.eclipticOf(BODY[k], d).elon;
  const wrap = a => Math.abs(((a + 540) % 360) - 180);
  const sunErr = wrap(elon('Sun', y.sr) - elon('Sun', natal));
  const moonErr = wrap(elon('Moon', y.lunarReturn) - elon('Moon', natal));
  const ascSign = Math.floor(natalAsc / 30);
  const signOk = y.profection.signIndex === (ascSign + y.completedYears) % 12 && y.profection.house === (y.completedYears % 12) + 1;
  const spanOk = y.sr <= target && target < y.nextSr;
  const ok = sunErr < 0.001 && moonErr < 0.001 && signOk && spanOk;
  if (!ok) worst = Infinity;
  console.log(`\nYear view: Sun at return off ${sunErr.toFixed(5)}°, Moon at return off ${moonErr.toFixed(5)}°, profection ${signOk ? 'ok' : 'WRONG'}, target inside solar year ${spanOk ? 'ok' : 'WRONG'}  ${ok ? 'ok' : 'FAIL'}`);
}

console.log(`\nworst deviation (excluding known misses): ${worst} month(s) (tolerance ${TOLERANCE_MONTHS})`);
process.exit(worst > TOLERANCE_MONTHS ? 1 : 0);
