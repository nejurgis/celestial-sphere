// ── chart2d.js ────────────────────────────────────────────────────────────
// Traditional 2D circular chart wheel (SVG). Ecliptic-longitude-accurate —
// signs, planets and (when enabled) house cusps sit at their true longitude
// around a fixed ring, not stylistically forced onto an equal-spaced grid.
// ASC anchors the wheel at 9 o'clock; longitude increases clockwise on
// screen from there, matching the direction houses 1→2→3…→12 actually sweep.

import { ZODIAC_SIGNS, EGYPTIAN_BOUNDS, boundOf } from './astro.js';
import { ELEMENT_COLORS } from './scene.js';

const PLANET_GLYPHS = { Sun: '☉', Moon: '☽', Mercury: '☿', Venus: '♀', Mars: '♂', Jupiter: '♃', Saturn: '♄' };
// Same accent per element as the 3D zodiac band (scene.js's ELEMENT_COLORS)
// — was a separate, divergent pastel set before, so the two views disagreed
// on what each element's color even was.
const ELEMENT_FILL = Object.fromEntries(
  Object.entries(ELEMENT_COLORS).map(([el, hex]) => [el, '#' + hex.toString(16).padStart(6, '0')])
);

// Egyptian-bound ruler colors — one per classical planet, used for both the
// bounds-ring ticks and the small ruler badge under each planet glyph.
const RULER_COLOR = { Mercury: '#5b8bd4', Venus: '#c05fa8', Mars: '#c0392b', Jupiter: '#7a4fbf', Saturn: '#555' };

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
function toXY(elon, ascDeg, r) {
  const phi = ((180 - (elon - ascDeg)) * Math.PI) / 180;
  return [CX + r * Math.cos(phi), CY + r * Math.sin(phi)];
}

// Arc from elonFrom to elonTo in the direction of increasing longitude
// (which is how toXY's phi sweeps, i.e. counterclockwise on screen —
// sweep-flag 0, matching phi's negated relationship to elon above).
function arcPath(ascDeg, r, elonFrom, elonTo) {
  const [x1, y1] = toXY(elonFrom, ascDeg, r);
  const [x2, y2] = toXY(elonTo, ascDeg, r);
  const sweep = ((elonTo - elonFrom) % 360 + 360) % 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 0 ${x2} ${y2}`;
}

export function renderChart2D(svg, { planets, asc, mc, dsc, ic, houses, showHouses, showBounds, dateLabel }) {
  const ascDeg = ((asc.deg % 360) + 360) % 360;
  const parts = [];

  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_OUTER}" fill="none" stroke="#333" stroke-width="1.5"/>`);
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_SIGN_IN}" fill="none" stroke="#999" stroke-width="1"/>`);
  // Inner circle capping the house spokes — same idea as a traditional
  // printed wheel's small center ring (an empty hub the spokes converge on)
  // rather than the spokes just trailing off toward the middle.
  parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_HOUSE_LINE_IN}" fill="none" stroke="#999" stroke-width="1"/>`);

  // Zodiac ring — 12 sign wedges, tinted by element.
  ZODIAC_SIGNS.forEach((sign, i) => {
    const from = i * 30, to = from + 30;
    const outerArc = arcPath(ascDeg, R_OUTER, from, to);
    const [xi2, yi2] = toXY(to, ascDeg, R_SIGN_IN);
    const [xi1, yi1] = toXY(from, ascDeg, R_SIGN_IN);
    const d = `${outerArc} L ${xi2} ${yi2} A ${R_SIGN_IN} ${R_SIGN_IN} 0 0 0 ${xi1} ${yi1} Z`;
    parts.push(`<path d="${d}" fill="${ELEMENT_FILL[sign.element]}" fill-opacity="0.55" stroke="#bbb" stroke-width="0.5"/>`);
    const [gx, gy] = toXY(from + 15, ascDeg, (R_OUTER + R_SIGN_IN) / 2);
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
    parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_BOUNDS_OUT}" fill="none" stroke="#ccc" stroke-width="0.5"/>`);
    parts.push(`<circle cx="${CX}" cy="${CY}" r="${R_BOUNDS_IN}" fill="none" stroke="#ccc" stroke-width="0.5"/>`);
    EGYPTIAN_BOUNDS.forEach((terms, signIndex) => {
      let from = 0;
      terms.forEach(({ ruler, to }) => {
        const mid = signIndex * 30 + (from + to) / 2;
        const [x1, y1] = toXY(signIndex * 30 + from, ascDeg, R_BOUNDS_IN);
        const [x2, y2] = toXY(signIndex * 30 + from, ascDeg, R_BOUNDS_OUT);
        parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#ccc" stroke-width="0.5"/>`);
        const [lx, ly] = toXY(mid, ascDeg, R_BOUNDS_LABEL);
        parts.push(`<text x="${lx}" y="${ly}" font-size="8" text-anchor="middle" dominant-baseline="central" fill="${RULER_COLOR[ruler]}">${ruler[0]}</text>`);
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
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#c99" stroke-width="1.3"/>`);
      const [lx, ly] = toXY(cuspDeg + 3, ascDeg, R_HOUSE_LABEL);
      parts.push(`<text x="${lx}" y="${ly}" font-size="10" text-anchor="middle" fill="#888">${h}</text>`);
    }
  }

  // Angles — ASC/DSC/MC/IC, always shown (they're real regardless of the
  // houses toggle; house cusps 1/4/7/10 sit exactly on top of these).
  const angleDefs = [
    { key: 'ASC', deg: asc.deg, color: '#0e8a94' },
    { key: 'DSC', deg: dsc.deg, color: '#0e8a94' },
    { key: 'MC', deg: mc.deg, color: '#d4a017' },
    { key: 'IC', deg: ic.deg, color: '#d4a017' },
  ];
  angleDefs.forEach(({ key, deg, color }) => {
    const [x1, y1] = toXY(deg, ascDeg, R_HOUSE_LINE_IN);
    const [x2, y2] = toXY(deg, ascDeg, R_OUTER);
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2"/>`);
    const [lx, ly] = toXY(deg, ascDeg, R_ANGLE_LABEL);
    parts.push(`<text x="${lx}" y="${ly}" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central" fill="${color}">${key}</text>`);
  });

  // Planets — placed by true longitude; ones bunched within 6° stack inward
  // so their glyphs stay legible instead of overlapping.
  const withRel = planets
    .map(p => ({ ...p, rel: ((p.elon - ascDeg) % 360 + 360) % 360 }))
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
    const flagColor = p.motion === 'retrograde' ? '#c0392b' : '#d97706';
    const [tx, ty] = toXY(p.elon, ascDeg, r + 17);
    parts.push(`<text x="${tx}" y="${ty}" font-size="9" text-anchor="middle" dominant-baseline="central" fill="${flag ? flagColor : '#555'}" ${flag ? 'font-weight="700"' : ''}>${deg}°${String(min).padStart(2, '0')}′${flag}</text>`);
    if (showBounds) {
      const ruler = boundOf(p.elon).ruler;
      parts.push(`<text x="${x}" y="${y + 13}" font-size="7" font-weight="700" text-anchor="middle" fill="${RULER_COLOR[ruler]}">${ruler[0]}</text>`);
    }
  });

  if (dateLabel) parts.push(`<text x="${CX}" y="${CY}" font-size="10" text-anchor="middle" fill="#999">${dateLabel}</text>`);

  svg.innerHTML = parts.join('');
}
