// ── chart2d.js ────────────────────────────────────────────────────────────
// 2D chart wheel (SVG), laid out like the printed wheels in the source text:
// a plain wheel with a thin outer band that carries each cusp's degree, sign
// and minutes; planets labelled glyph · degrees · sign · minutes (R/S for
// retrograde/stationary); a large hub with the birth date, time, UTC offset and
// place; and a 0–30° strip underneath showing where each planet falls within its
// sign. Monochrome. ASC anchors the wheel at 9 o'clock and houses run
// counterclockwise from it.
//
// Two geometries: the *equal wheel* (default) draws every house as a 30° sector
// bounded by its real Regiomontanus cusp, with longitudes mapped piecewise-
// linearly into their house so planets keep their place within it; the *true
// wheel* places everything at its actual ecliptic longitude.

import { ZODIAC_SIGNS, EGYPTIAN_BOUNDS, boundOf } from './astro.js';

const PLANET_GLYPHS = { Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄' };
const INK = '#222', GREY = '#777', LINE = '#999';

const CX = 250, CY = 250;
const R_OUT = 232;          // outer circle
const R_RIM = 200;          // inner circle of the outer band (cusp labels live between R_RIM and R_OUT)
const R_HUB = 78;           // centre hub
const R_CUSP_LABEL = 216;   // middle of the outer band
const R_BOUNDS_IN = 178, R_BOUNDS_LABEL = 189; // Egyptian bounds strip, just inside the rim
const R_PLANET_OUT = 170;   // outer end of a planet label (its glyph)
const LEVEL_STEP = 52;      // radial step for a planet bunched with a neighbour
const FS_DIGIT = 10.5, FS_SIGN = 13, FS_GLYPH = 18, FS_CUSP = 11.5, FS_CUSP_SIGN = 14;

// Equal-wheel mode: houses drawn as equal 30° sectors bounded by the real
// Regiomontanus cusps; every ecliptic longitude is mapped piecewise-linearly into
// its house's sector. null = the ordinary true-longitude wheel.
let REL = null;

function makeEqualWheelMap(cusps) {
  return elon => {
    const norm = ((elon % 360) + 360) % 360;
    for (let h = 1; h <= 12; h++) {
      const lo = cusps[h], hi = cusps[h === 12 ? 1 : h + 1];
      const span = (((hi - lo) % 360) + 360) % 360;
      const inside = (((norm - lo) % 360) + 360) % 360;
      if (inside < span || (h === 12 && inside === span)) return (h - 1) * 30 + (span > 0 ? (inside / span) * 30 : 0);
    }
    return 0;
  };
}

// Degrees from the ASC around the wheel, counterclockwise. (phi below: the ASC
// is at phi = 180°, 9 o'clock; SVG's y-down axis makes increasing phi run
// clockwise on screen, and houses run counterclockwise, hence the minus.)
const relOf = (elon, ascDeg) => (REL ? REL(elon) : (((elon - ascDeg) % 360) + 360) % 360);

function xyRel(rel, r) {
  const phi = ((180 - rel) * Math.PI) / 180;
  return [CX + r * Math.cos(phi), CY + r * Math.sin(phi)];
}
const toXY = (elon, ascDeg, r) => xyRel(relOf(elon, ascDeg), r);

const pad2 = n => String(n).padStart(2, '0');
const signGlyph = i => `${ZODIAC_SIGNS[i].glyph}︎`; // VS15: force the plain text glyph, not the emoji one

// 17.95° of a sign → { d: '17', m: '57', sign: index }, carrying 59.6′ into the next degree/sign.
function splitDeg(elon) {
  const norm = ((elon % 360) + 360) % 360;
  let sign = Math.floor(norm / 30);
  let d = Math.floor(norm % 30);
  let m = Math.round((norm % 30 - d) * 60);
  if (m === 60) { m = 0; d += 1; if (d === 30) { d = 0; sign = (sign + 1) % 12; } }
  return { d: pad2(d), m: pad2(m), sign };
}

const text = (x, y, size, body, extra = '', fill = INK) =>
  `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${size}" text-anchor="middle" dominant-baseline="central" fill="${fill}" ${extra}>${body}</text>`;

export function renderChart2D(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, hubLines, equalWheel }) {
  REL = equalWheel && houses ? makeEqualWheelMap(houses) : null;
  try {
    drawChart(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, hubLines });
  } finally {
    REL = null;
  }
}

function drawChart(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, hubLines }) {
  const ascDeg = ((asc.deg % 360) + 360) % 360;
  const parts = [];

  // ── Wheel frame: outer circle, the inner circle of the band, the hub. ──
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_OUT}" fill="none" stroke="${INK}" stroke-width="1.6"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_RIM}" fill="none" stroke="${INK}" stroke-width="1.1"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_HUB}" fill="none" stroke="${INK}" stroke-width="1.1"/>`);

  // ── Egyptian bounds strip, just inside the rim. ──
  if (showBounds) {
    parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_BOUNDS_IN}" fill="none" stroke="${LINE}" stroke-width="0.8"/>`);
    EGYPTIAN_BOUNDS.forEach((terms, signIndex) => {
      let from = 0;
      terms.forEach(({ ruler, to }) => {
        const [x1, y1] = toXY(signIndex * 30 + from, ascDeg, R_BOUNDS_IN);
        const [x2, y2] = toXY(signIndex * 30 + from, ascDeg, R_RIM);
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE}" stroke-width="0.6"/>`);
        const ra = relOf(signIndex * 30 + from, ascDeg);
        const span = (((relOf(signIndex * 30 + to, ascDeg) - ra) % 360) + 360) % 360;
        const [lx, ly] = xyRel(ra + span / 2, R_BOUNDS_LABEL);
        parts.push(text(lx, ly, 8, ruler[0], '', GREY));
        from = to;
      });
    });
  }

  // ── House spokes and cusp labels. The four angles are always drawn. ──
  const angleDefs = [
    { key: 'ASC', deg: asc.deg, house: 1 }, { key: 'IC', deg: ic.deg, house: 4 },
    { key: 'DSC', deg: dsc.deg, house: 7 }, { key: 'MC', deg: mc.deg, house: 10 },
  ];
  const isAngleHouse = h => h === 1 || h === 4 || h === 7 || h === 10;

  const spoke = (deg, width) => {
    const [x1, y1] = toXY(deg, ascDeg, R_HUB);
    const [x2, y2] = toXY(deg, ascDeg, R_RIM);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="${width}"/>`);
  };

  // Degree · sign · minutes in the outer band: one line near the top/bottom of
  // the wheel, two lines (degrees over sign+minutes) elsewhere, where the band
  // is too narrow for a long horizontal label.
  const cuspLabel = deg => {
    const { d, m, sign } = splitDeg(deg);
    const [x, y] = toXY(deg, ascDeg, R_CUSP_LABEL);
    const nearTopBottom = Math.abs(y - CY) > R_CUSP_LABEL * 0.86;
    if (nearTopBottom) {
      parts.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" fill="${INK}" font-size="${FS_CUSP}">${d}° <tspan font-size="${FS_CUSP_SIGN}">${signGlyph(sign)}</tspan> ${m}′</text>`);
    } else {
      parts.push(text(x, y - 7, FS_CUSP, `${d}°`));
      parts.push(`<text x="${x.toFixed(2)}" y="${(y + 7).toFixed(2)}" text-anchor="middle" dominant-baseline="central" fill="${INK}" font-size="${FS_CUSP}"><tspan font-size="${FS_CUSP_SIGN}">${signGlyph(sign)}</tspan> ${m}′</text>`);
    }
  };

  if (showHouses && houses) {
    for (let h = 1; h <= 12; h++) {
      if (houses[h] == null || isAngleHouse(h)) continue;
      spoke(houses[h], 1.2);
      cuspLabel(houses[h]);
    }
  }
  angleDefs.forEach(({ key, deg }) => {
    spoke(deg, 2.6);
    cuspLabel(deg);
    // The angle's name, just outside the wheel.
    const [x, y] = toXY(deg, ascDeg, R_OUT + 16);
    const anchor = Math.abs(x - CX) < 40 ? 'middle' : x < CX ? 'end' : 'start';
    parts.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="11" font-weight="700" text-anchor="${anchor}" dominant-baseline="central" fill="${INK}">${key}</text>`);
  });

  // ── Planets: glyph outermost, then degrees, sign, minutes, R/S. ──
  // A label centred on a spoke would sit on top of the line, so (like the
  // printed wheel) push it to the side of the nearest spoke, staying in its house.
  const spokeRels = (showHouses && houses ? Object.values(houses) : angleDefs.map(a => a.deg)).map(d => relOf(d, ascDeg));
  const SPOKE_MARGIN = 6; // wheel degrees (~18 px at the planets' radius)
  const clearOfSpokes = rel => {
    for (const sr of spokeRels) {
      const delta = ((rel - sr + 540) % 360) - 180; // signed distance from that spoke
      if (Math.abs(delta) < SPOKE_MARGIN) return rel + (delta >= 0 ? 1 : -1) * (SPOKE_MARGIN - Math.abs(delta));
    }
    return rel;
  };
  const placed = planets
    .map(p => ({ ...p, rel: clearOfSpokes(relOf(p.elon, ascDeg)) }))
    .sort((a, b) => a.rel - b.rel);
  let lastRel = null, level = 0;
  placed.forEach(p => {
    level = lastRel != null && p.rel - lastRel < 8 ? level + 1 : 0;
    lastRel = p.rel;
    const rOut = R_PLANET_OUT - level * LEVEL_STEP;
    const [x, y] = xyRel(p.rel, rOut);
    const { d, m, sign } = splitDeg(p.elon);
    const flag = p.motion === 'retrograde' ? 'R' : p.motion === 'stationary' ? 'S' : '';
    const glyph = PLANET_GLYPHS[p.key] ?? p.key[0];
    const horizontal = Math.abs(Math.cos(((180 - p.rel) * Math.PI) / 180)) > 0.8;

    if (horizontal) {
      // One line reading inward from the glyph: on the left it runs left→right,
      // on the right the order is mirrored so the glyph stays outermost.
      const onLeft = x < CX;
      const seq = [[glyph, FS_GLYPH, false], [`${d}°`, FS_DIGIT, false], [signGlyph(sign), FS_SIGN, false], [`${m}′`, FS_DIGIT, false]];
      if (flag) seq.push([flag, FS_DIGIT, true]);
      const ordered = onLeft ? seq : [...seq].reverse();
      const body = ordered.map(([b, size, bold], i) => `<tspan${i ? ' dx="4"' : ''} font-size="${size}"${bold ? ' font-weight="700"' : ''}>${b}</tspan>`).join('');
      parts.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="${onLeft ? 'start' : 'end'}" dominant-baseline="central" fill="${INK}" font-size="${FS_DIGIT}">${body}</text>`);
    } else {
      // A vertical stack reading inward from the glyph (down in the top half of
      // the wheel, up in the bottom half).
      const inward = y < CY ? 1 : -1;
      const lines = [
        [`${d}°`, FS_DIGIT, 0], [signGlyph(sign), FS_SIGN, 0], [`${m}′`, FS_DIGIT, 0],
      ];
      if (flag) lines.push([flag, FS_DIGIT, 1]);
      parts.push(text(x, y, FS_GLYPH, glyph));
      let cursor = y + inward * 17;
      lines.forEach(([body, size, bold]) => {
        parts.push(text(x, cursor, size, body, bold ? 'font-weight="700"' : ''));
        cursor += inward * (size > 12 ? 14 : 12);
      });
    }
  });

  // ── Hub: date, time, UTC offset and place. ──
  if (hubLines?.length) {
    const start = CY - ((hubLines.length - 1) * 15) / 2;
    hubLines.forEach((line, i) => parts.push(text(CX, start + i * 15, 10.5, line)));
  }

  // ── Strip under the wheel: each planet's degree within its sign on 0–30°. ──
  const X0 = 20, X1 = 480, Y_RULER = 604;
  const xOf = deg => X0 + (deg / 30) * (X1 - X0);
  parts.push(`<line x1="${X0}" y1="${Y_RULER}" x2="${X1}" y2="${Y_RULER}" stroke="${INK}" stroke-width="1.2"/>`);
  for (let t = 0; t <= 30; t++) {
    const x = xOf(t), major = t % 5 === 0;
    parts.push(`<line x1="${x}" y1="${Y_RULER}" x2="${x}" y2="${Y_RULER + (major ? 9 : 5)}" stroke="${INK}" stroke-width="${major ? 1.1 : 0.7}"/>`);
    if (major) parts.push(text(x, Y_RULER + 20, 10, `${t}°`, '', GREY));
  }
  const strip = planets
    .map(p => ({ key: p.key, tick: xOf(((p.elon % 360) + 360) % 30), sign: Math.floor((((p.elon % 360) + 360) % 360) / 30) }))
    .sort((a, b) => a.tick - b.tick);
  // Spread the labels so bunched planets don't overlap, keeping each tied to its tick by a leader.
  const MIN_GAP = 26;
  strip.forEach(s => { s.x = s.tick; });
  for (let iter = 0; iter < 200; iter++) {
    let moved = false;
    for (let i = 1; i < strip.length; i++) {
      const gap = strip[i].x - strip[i - 1].x;
      if (gap < MIN_GAP - 0.01) { const push = (MIN_GAP - gap) / 2; strip[i - 1].x -= push; strip[i].x += push; moved = true; }
    }
    if (!moved) break;
  }
  strip.forEach(s => {
    s.x = Math.max(X0 - 10, Math.min(X1 + 10, s.x));
    parts.push(text(s.x, Y_RULER - 62, FS_GLYPH, PLANET_GLYPHS[s.key] ?? s.key[0]));
    parts.push(text(s.x, Y_RULER - 42, FS_SIGN, signGlyph(s.sign)));
    parts.push(`<line x1="${s.x.toFixed(2)}" y1="${Y_RULER - 30}" x2="${s.tick.toFixed(2)}" y2="${Y_RULER}" stroke="${INK}" stroke-width="0.9"/>`);
  });

  svg.innerHTML = parts.join('');
}
