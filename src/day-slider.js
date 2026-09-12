// ── day-slider.js ───────────────────────────────────────────────────────
// Mobile time-of-day slider, matching Stellarium Web's own design (their
// date-time-picker.vue, apps/web-frontend/src/components/ in the
// stellarium-web-engine repo): a single 24h window — local noon to the
// NEXT local noon, always containing whatever moment is currently
// selected — you drag through, with a translucent blue gradient behind it
// showing real day/night/twilight brightness for THIS location, computed
// from actual Sun+Moon altitude rather than a generic sunset graphic.

import { computeSunMoonAltitude, makeObserver } from './astro.js';

const NB_STOPS = 49; // matches Stellarium Web's own sampling density

// Noon (local) on whichever day contains `date`, always the PRECEDING one
// — so the resulting 24h window [start, start+1440min) always contains
// `date` somewhere inside it. Same rule as Stellarium Web's own
// `sliderStartTime` computed property.
export function sliderStartTime(date) {
  const t = new Date(date);
  if (t.getHours() < 12) t.setDate(t.getDate() - 1);
  t.setHours(12, 0, 0, 0);
  return t;
}

export function minutesSinceSliderStart(date, start) {
  return Math.round((date.getTime() - start.getTime()) / 60000);
}

// Same brightness curve Stellarium Web's own gradient uses — daylight
// (sunAlt>0) saturates near full opacity, deep moonless night goes fully
// transparent, twilight/dawn/moonlight interpolate between. Derived from
// real per-location Sun/Moon altitude at each sampled minute, not a fixed
// day/night icon.
function brightnessOpacity(sunAlt, moonAlt) {
  const moonBrightness = moonAlt < 0 ? 0 : (2 / 35) * Math.min(20, moonAlt) / 20;
  let raw;
  if (sunAlt > 0) raw = Math.min(10, 1 + sunAlt) + moonBrightness;
  else if (sunAlt < -16) raw = moonBrightness;
  else if (sunAlt < -10) raw = (1 / 35) * (16 + sunAlt) / 6 + moonBrightness;
  else raw = (1 - 1 / 35) * (10 + sunAlt) / 10 + 1 / 35 + moonBrightness;
  return Math.log10(1 + raw * 10) / 2;
}

export function computeDayStops(start, latitude, longitude) {
  const observer = makeObserver(latitude, longitude);
  const stops = [];
  for (let i = 0; i <= NB_STOPS; i++) {
    const t = new Date(start.getTime() + ((1440 * i) / NB_STOPS) * 60000);
    const { sunAlt, moonAlt } = computeSunMoonAltitude(t, observer);
    stops.push({ percent: i / NB_STOPS, opacity: brightnessOpacity(sunAlt, moonAlt), sunAlt, moonAlt });
  }
  return stops;
}

export function hintForMinute(stops, minute) {
  const stop = stops[Math.floor((minute / 1440) * stops.length)];
  if (!stop) return '';
  if (stop.sunAlt > 0) return 'Daylight';
  if (stop.sunAlt < -16) return stop.moonAlt < 5 ? 'Dark night' : 'Moonlight';
  return minute > 720 ? 'Dawn' : 'Twilight';
}

// Builds the gradient bar's inner SVG markup (a single horizontal
// <linearGradient> with one stop per sample) — regenerate only when
// `stops` actually changes (new sliderStartTime or location), not on every
// slider drag tick.
export function buildGradientSvg(stops) {
  const stopEls = stops
    .map((s) => `<stop offset="${(s.percent * 100).toFixed(2)}%" stop-color="rgb(64,209,255)" stop-opacity="${s.opacity.toFixed(3)}"/>`)
    .join('');
  return `<svg width="100%" height="100%" preserveAspectRatio="none"><defs><linearGradient id="daySliderGrad" x1="0%" y1="0%" x2="100%" y2="0%">${stopEls}</linearGradient></defs><rect width="100%" height="100%" fill="url(#daySliderGrad)"/></svg>`;
}
