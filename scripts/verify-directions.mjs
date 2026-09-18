// Compares the app's primary directions (and Regiomontanus cusps) with
// published figures.
//   node scripts/verify-directions.mjs
//
// Sources
//  * Predictive Astrology Textbook, Example №35 (native 1976-11-29, UTC+3):
//    Table 3.9 gives forecasts at the official 12:15; Table 3.10's deviations
//    give the 12:16 (rectified) ones — derived as reality + deviation, so only
//    good to a month.
//  * morinus-astrology.com/diana-death (Princess Diana, 1961-07-01 19:45 +01:00,
//    and Prince William, 1982-06-21 21:03 +01:00): dated directions + cusps.
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
    name: 'Example 35 (Borealis)',
    lat: 55 + 45 / 60, lon: 37 + 37 / 60,
    times: [{ label: '12:15 local', utc: [1976, 11, 29, 9, 15] }, { label: '12:16 local', utc: [1976, 11, 29, 9, 16] }],
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
      ['Mercury', '☌', null,       'Mars',    '2017-01', { xfail: 'arc 50.5° (2012-09) vs 54.7° implied; no tested variant gives it' }],
    ],
  },
  {
    name: 'William (blog)',
    lat: 51 + 32 / 60, lon: -12 / 60,
    times: [{ label: '21:03 BST', utc: [1982, 6, 21, 20, 3] }],
    rows: [
      ['Saturn', '☍', null, 'IC', '1997-08', { xfail: 'exact circle-of-position arc is 11.9° (1994-07); blog date equals the plain RA difference, 15.0°' }],
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
    const resolve = k => BODY[k] ? { key: k, body: BODY[k] } : { key: k, ra: ang[k].ra, dec: ang[k].dec };
    const rows = A.computeAllDirections(KEYS, resolve, k => BODY[k], date, s.observer, 1, 120, { includeBoundCrossings: false, angles });
    console.log(`\n${chart.name} — ${t.label}  (ASC ${A.formatEclipticDegree(s.asc.deg)}, MC ${A.formatEclipticDegree(s.mc.deg)})`);

    if (chart.cusps) {
      const cusps = A.computeRegiomontanusHouses(date, s.observer, angles);
      for (const [h, [d, m]] of Object.entries(chart.cusps)) {
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
      console.log(`  ${label} ${book}  ${r.date.toISOString().slice(0, 7)}  ${r.arcDeg.toFixed(2).padStart(6)}° ${r.swapped ? 'conv' : 'dir '}  ${dMonths > 0 ? '+' : ''}${dMonths}${opts?.xfail ? `   [known miss: ${opts.xfail}]` : ''}`);
    }
  });
}
console.log(`\nworst deviation (excluding known misses): ${worst} month(s) (tolerance ${TOLERANCE_MONTHS})`);
process.exit(worst > TOLERANCE_MONTHS ? 1 : 0);
