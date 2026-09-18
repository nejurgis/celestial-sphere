// Compares the app's primary directions with published forecasts.
//   node scripts/verify-directions.mjs
//
// Dataset: Predictive Astrology Textbook, Example №35 (native born
// 1976-11-29, 37°37'E 55°45'N, UTC+3). Table 3.9 gives forecasts at the
// official 12:15; Table 3.10's deviations give the 12:16 (rectified) ones —
// derived here as  reality + deviation  and therefore only good to a month.
// To compare another method or chart, add a DATASET entry: same shape.
//
// Exit code 1 if any row is further than TOLERANCE_MONTHS from the book.

import * as A from '../src/astro.js';

const TOLERANCE_MONTHS = 3;

const DATASET = [{
  name: 'Example 35 (Borealis)',
  utc: [1976, 11, 29, 9], // hh:mm below are local (UTC+3); the UTC hour of 12:xx is 09
  lat: 55 + 45 / 60, lon: 37 + 37 / 60,
  // promissor, aspect glyph, direction (sinister = +offset, dexter = -offset), significator,
  // book forecast at 12:15, at 12:16 (null = not published)
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
}];

const BODY = Object.fromEntries(A.PLANETS.map(p => [p.key, p.body]));
const KEYS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'ASC', 'DSC', 'MC', 'IC'];

let worst = 0;
for (const chart of DATASET) {
  for (const [minute, col] of [[15, 4], [16, 5]]) {
    const date = new Date(Date.UTC(chart.utc[0], chart.utc[1] - 1, chart.utc[2], chart.utc[3], minute));
    const s = A.computeSkyState(date, chart.lat, chart.lon);
    const ang = { ASC: s.asc, DSC: s.dsc, MC: s.mc, IC: s.ic };
    const resolve = k => BODY[k] ? { key: k, body: BODY[k] } : { key: k, ra: ang[k].ra, dec: ang[k].dec };
    const rows = A.computeAllDirections(KEYS, resolve, k => BODY[k], date, s.observer, 1, 120, {
      includeBoundCrossings: false, angles: { mc: s.mc, ic: s.ic, asc: s.asc, dsc: s.dsc },
    });
    console.log(`\n${chart.name} — 12:${minute} local  (ASC ${A.formatEclipticDegree(s.asc.deg)}, MC ${A.formatEclipticDegree(s.mc.deg)})`);
    console.log('promissor → significator   book     app         arc      Δ months');
    for (const row of chart.rows) {
      const [p, glyph, dir, sig] = row, book = row[col];
      if (!book) continue;
      const r = rows.find(x => x.promissorKey === p && x.aspectGlyph === glyph && (x.aspectDir ?? 'sinister') === dir && x.significatorKey === sig);
      const label = `${p} ${glyph}${dir === 'dexter' ? '(d)' : ''} → ${sig}`.padEnd(26);
      if (!r) { console.log(`${label} ${book}   —  not produced`); worst = Infinity; continue; }
      const [by, bm] = book.split('-').map(Number);
      const dMonths = (r.date.getUTCFullYear() - by) * 12 + (r.date.getUTCMonth() + 1 - bm);
      worst = Math.max(worst, Math.abs(dMonths));
      console.log(`${label} ${book}  ${r.date.toISOString().slice(0, 7)}  ${r.arcDeg.toFixed(2).padStart(6)}° ${r.swapped ? 'conv' : 'dir '}  ${dMonths > 0 ? '+' : ''}${dMonths}`);
    }
  }
}
console.log(`\nworst deviation: ${worst} month(s) (tolerance ${TOLERANCE_MONTHS})`);
process.exit(worst > TOLERANCE_MONTHS ? 1 : 0);
