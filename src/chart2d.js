// ── chart2d.js ────────────────────────────────────────────────────────────
// Traditional 2D circular chart wheel (SVG). Ecliptic-longitude-accurate —
// signs, planets and (when enabled) house cusps sit at their true longitude
// around a fixed ring, not stylistically forced onto an equal-spaced grid.
// ASC anchors the wheel at 9 o'clock; longitude increases clockwise on
// screen from there, matching the direction houses 1→2→3…→12 actually sweep.

import { ZODIAC_SIGNS, EGYPTIAN_BOUNDS, boundOf } from './astro.js';

const PLANET_GLYPHS = { Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄' };
// The wheel is deliberately monochrome: greys and black only.
const INK = '#222', GREY = '#777', LINE = '#999';

const CX = 250, CY = 250;
const R_OUTER = 232, R_SIGN_IN = 200;
const R_BOUNDS_OUT = 200, R_BOUNDS_IN = 178, R_BOUNDS_LABEL = 189;
const R_HOUSE_LABEL = 168, R_HOUSE_LINE_IN = 60, R_PLANET = 148, R_ANGLE_LABEL = 244;
const STACK_STEP = 34; // radial gap between bunched planets — room for each one's degree label

// phi's SIGN is what fixes the wheel's rotation sense: ascDeg always maps
// to phi=180° (9 o'clock — "ASC anchors the wheel at 9 o'clock" below), and
// SVG's y-down coordinate system makes INCREASING phi sweep visually
// CLOCKWISE on screen. The standard astrological convention (any published
// chart wheel) is the opposite — houses 1→2→3…→12 sweep COUNTERCLOCKWISE
// from the ASC — so elon increasing must DECREASE phi, not increase it.
// (An earlier version had this backwards — the whole wheel visibly mirrored
// left-right/spun the wrong way, reported as "the chart is reversed".)
// Equal-wheel mode: the 12 houses are drawn as equal 30° sectors (house 1 from
// the ASC at 9 o'clock, counterclockwise), but each house is still bounded by its
// real Regiomontanus cusp. Every ecliptic longitude is mapped piecewise-linearly
// into its house's 30° sector, so planets keep their true place *within* their
// house and the zodiac ring is warped to match (a sign that spans a wide house
// looks wide, one squeezed between narrow houses looks narrow). null = the
// ordinary true-longitude wheel.
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

// Degrees from the ASC around the wheel, counterclockwise.
const relOf = (elon, ascDeg) => (REL ? REL(elon) : (((elon - ascDeg) % 360) + 360) % 360);

function xyRel(rel, r) {
  const phi = ((180 - rel) * Math.PI) / 180;
  return [CX + r * Math.cos(phi), CY + r * Math.sin(phi)];
}

function toXY(elon, ascDeg, r) {
  return xyRel(relOf(elon, ascDeg), r);
}

// Midpoint (in wheel degrees) of the stretch from elon a to elon b.
function relMid(a, b, ascDeg) {
  const ra = relOf(a, ascDeg);
  const span = (((relOf(b, ascDeg) - ra) % 360) + 360) % 360;
  return ra + span / 2;
}

export function renderChart2D(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, dateLabel, equalWheel }) {
  REL = equalWheel && houses ? makeEqualWheelMap(houses) : null;
  try {
    drawChart(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, dateLabel });
  } finally {
    REL = null;
  }
}

function drawChart(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, dateLabel }) {
  const ascDeg = ((asc.deg % 360) + 360) % 360;
  const parts = [];

  // The zodiac ring: an outer and an inner circle with a straight divider at each
  // sign boundary (drawn as circles + lines rather than 12 wedge paths — a wedge's
  // inner arc has to be traced in the opposite direction and, for a sign that spans
  // a wide stretch of the equal wheel, went wrong and showed up as a stray
  // elliptical curve).
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_OUTER}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_SIGN_IN}" fill="none" stroke="#999" stroke-width="1"/>`);
  // Small hub the house spokes converge on.
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_HOUSE_LINE_IN}" fill="none" stroke="#999" stroke-width="1"/>`);

  ZODIAC_SIGNS.forEach((sign, i) => {
    const from = i * 30, to = from + 30;
    const [bx1, by1] = toXY(from, ascDeg, R_SIGN_IN);
    const [bx2, by2] = toXY(from, ascDeg, R_OUTER);
    parts.push(`<line x1="${bx1}" y1="${by1}" x2="${bx2}" y2="${by2}" stroke="#999" stroke-width="0.8"/>`);
    const [gx, gy] = xyRel(relMid(from, to, ascDeg), (R_OUTER + R_SIGN_IN) / 2);
    // ︎ (VS15, text-presentation selector) forces the plain glyph
    // instead of WebKit's colorful emoji-style rendering for the zodiac
    // Unicode block (U+2648-2653) — font-family alone doesn't override
    // that. Same fix already used for the 3D band's own glyph sprites (see
    // scene.js buildZodiacBand's `${seg.glyph}︎` — same character, just
    // typed literally there instead of as an escape).
    parts.push(`<text x="${gx}" y="${gy}" font-size="16" text-anchor="middle" dominant-baseline="central" fill="#444">${sign.glyph}︎</text>`);
  });

  // Degree ticks — every 10°, longer at sign boundaries (every 30°).
  for (let d = 0; d < 360; d += 10) {
    const [x1, y1] = toXY(d, ascDeg, R_SIGN_IN);
    const [x2, y2] = toXY(d, ascDeg, R_SIGN_IN - (d % 30 === 0 ? 10 : 5));
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#aaa" stroke-width="${d % 30 === 0 ? 1 : 0.5}"/>`);
  }

  // Egyptian bounds — 5 unequal ruled segments per sign, colored by ruler.
  if (showBounds) {
    EGYPTIAN_BOUNDS.forEach((terms, signIndex) => {
      let from = 0;
      terms.forEach(({ ruler, to }) => {
        const [x1, y1] = toXY(signIndex * 30 + from, ascDeg, R_BOUNDS_IN);
        const [x2, y2] = toXY(signIndex * 30 + from, ascDeg, R_BOUNDS_OUT);
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ccc" stroke-width="0.5"/>`);
        const [lx, ly] = xyRel(relMid(signIndex * 30 + from, signIndex * 30 + to, ascDeg), R_BOUNDS_LABEL);
        parts.push(`<text x="${lx}" y="${ly}" font-size="8" text-anchor="middle" dominant-baseline="central" fill="${GREY}">${ruler[0]}</text>`);
        from = to;
      });
    });
  }

  // House cusps — in a quadrant system (Regiomontanus/Placidus-family),
  // angular houses 1/4/7/10 sit exactly on the ASC/IC/DSC/MC spokes drawn
  // below, so only the 8 intermediate cusps need their own line here.
  // Whole sign is NOT a quadrant system — house 1 starts at the
  // Ascendant's whole SIGN boundary, not the Ascendant's own degree, so
  // its angular cusps generally sit somewhere else entirely and need a
  // line too. Checked numerically (angularDist < 0.25°) rather than by an
  // explicit "which system" flag, so this keeps working for any current or
  // future house system without the two files needing to agree on names.
  const angularDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  if (showHouses && houses) {
    const angleDegByHouse = { 1: ascDeg, 4: ic.deg, 7: dsc.deg, 10: mc.deg };
    for (let h = 1; h <= 12; h++) {
      const cuspDeg = houses[h];
      if (cuspDeg == null) continue;
      const angleDeg = angleDegByHouse[h];
      if (angleDeg != null && angularDist(cuspDeg, angleDeg) < 0.25) continue;
      const [x1, y1] = toXY(cuspDeg, ascDeg, R_HOUSE_LINE_IN);
      const [x2, y2] = toXY(cuspDeg, ascDeg, R_SIGN_IN);
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${LINE}" stroke-width="1.3"/>`);
      const [lx, ly] = REL ? xyRel((h - 1) * 30 + 15, R_HOUSE_LABEL) : toXY(cuspDeg + 3, ascDeg, R_HOUSE_LABEL);
      parts.push(`<text x="${lx}" y="${ly}" font-size="10" text-anchor="middle" fill="#888">${h}</text>`);
    }
  }

  // Angles — ASC/DSC/MC/IC, always shown (they're real regardless of the
  // houses toggle; house cusps 1/4/7/10 sit exactly on top of these). Each is
  // labelled with its own degree and sign.
  const degSign = deg => {
    const d = ((deg % 360) + 360) % 360;
    let whole = Math.floor(d % 30), min = Math.round(((d % 30) - whole) * 60);
    let signIndex = Math.floor(d / 30);
    if (min === 60) { min = 0; whole += 1; if (whole === 30) { whole = 0; signIndex = (signIndex + 1) % 12; } }
    return `${whole}°${String(min).padStart(2, '0')}′${ZODIAC_SIGNS[signIndex].glyph}\uFE0E`;
  };
  // Outside the ring, anchored away from it so the text never runs into the wheel.
  const outsideLabel = (deg, r, inner, size = 11) => {
    const [x, y] = toXY(deg, ascDeg, r);
    const dx = x - CX;
    const anchor = Math.abs(dx) < 40 ? 'middle' : dx < 0 ? 'end' : 'start';
    return `<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" dominant-baseline="central" fill="${INK}">${inner}</text>`;
  };
  const angleDefs = [
    { key: 'ASC', deg: asc.deg }, { key: 'DSC', deg: dsc.deg },
    { key: 'MC', deg: mc.deg }, { key: 'IC', deg: ic.deg },
  ];
  angleDefs.forEach(({ key, deg }) => {
    const [x1, y1] = toXY(deg, ascDeg, R_HOUSE_LINE_IN);
    const [x2, y2] = toXY(deg, ascDeg, R_OUTER);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="2"/>`);
    parts.push(outsideLabel(deg, R_ANGLE_LABEL, `<tspan font-weight="700" font-size="12">${key}</tspan> ${degSign(deg)}`));
  });

  // The other eight cusps: degree and sign at the rim, with their house lines.
  if (showHouses && houses) {
    const isAngle = h => h === 1 || h === 4 || h === 7 || h === 10;
    for (let h = 1; h <= 12; h++) {
      if (isAngle(h) || houses[h] == null) continue;
      parts.push(outsideLabel(houses[h], R_ANGLE_LABEL, degSign(houses[h]), 10.5));
    }
  }

  // Planets — placed by true longitude; ones bunched within 6° stack inward
  // so their glyphs stay legible instead of overlapping.
  const withRel = planets
    .map(p => ({ ...p, rel: relOf(p.elon, ascDeg) }))
    .sort((a, b) => a.rel - b.rel);
  let lastRel = null, stack = 0;
  withRel.forEach(p => {
    stack = lastRel != null && p.rel - lastRel < 6 ? stack + 1 : 0;
    lastRel = p.rel;
    const r = R_PLANET - stack * STACK_STEP;
    const [x, y] = toXY(p.elon, ascDeg, r);
    parts.push(`<circle cx="${x}" cy="${y}" r="10" fill="#fff" stroke="#666" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${y}" font-size="12" text-anchor="middle" dominant-baseline="central" fill="#222">${PLANET_GLYPHS[p.key] ?? p.key[0]}</text>`);
    // Degree within sign + motion flag (℞ retrograde, S stationary), just
    // outside the glyph.
    const inSign = ((p.elon % 360) + 360) % 30;
    let deg = Math.floor(inSign), min = Math.round((inSign - deg) * 60);
    if (min === 60) { deg += 1; min = 0; }
    const flag = p.motion === 'retrograde' ? ' ℞' : p.motion === 'stationary' ? ' S' : '';
    const flagColor = INK;
    const [tx, ty] = toXY(p.elon, ascDeg, r + 17);
    parts.push(`<text x="${tx}" y="${ty}" font-size="9" text-anchor="middle" dominant-baseline="central" fill="${flag ? flagColor : '#555'}" ${flag ? 'font-weight="700"' : ''}>${deg}°${String(min).padStart(2, '0')}′${flag}</text>`);
    if (showBounds) {
      const ruler = boundOf(p.elon).ruler;
      parts.push(`<text x="${x}" y="${y + 13}" font-size="7" font-weight="700" text-anchor="middle" fill="${GREY}">${ruler[0]}</text>`);
    }
  });

  if (dateLabel) parts.push(`<text x="${CX}" y="${CY}" font-size="10" text-anchor="middle" fill="#999">${dateLabel}</text>`);

  svg.innerHTML = parts.join('');
}
