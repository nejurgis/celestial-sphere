// ── timezone.js ───────────────────────────────────────────────────────────
// Birth-place wall-clock time <-> UTC, using the browser's own (historical) IANA
// time-zone data through Intl. So 09:43 on 19 April 1991 "in Europe/Vilnius" is
// read with the offset Vilnius actually had that day (EEST, UTC+3), whatever the
// zone the viewer's computer is in — and DST transitions are handled by the
// engine, not by a fixed offset.

const formatters = new Map();
function formatterFor(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
}

export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function isValidTz(tz) {
  try { formatterFor(tz); return true; } catch { return false; }
}

function wallParts(tz, utcMs) {
  const v = {};
  for (const p of formatterFor(tz).formatToParts(new Date(utcMs))) if (p.type !== 'literal') v[p.type] = Number(p.value);
  if (v.hour === 24) v.hour = 0; // some engines report midnight as 24
  return v;
}

// Offset of `tz` from UTC in milliseconds at the instant utcMs (local = utc + offset).
export function tzOffsetMs(tz, utcMs) {
  const v = wallParts(tz, utcMs);
  return Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute, v.second) - Math.floor(utcMs / 1000) * 1000;
}

// Local wall-clock fields in `tz` -> a Date. Uses the offset in force at that
// moment; re-checks once so a wall time just after a DST change lands correctly.
export function zonedToDate(year, month, day, hour, minute, second, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = tzOffsetMs(tz, guess);
  let utc = guess - first;
  const second_ = tzOffsetMs(tz, utc);
  if (second_ !== first) utc = guess - second_;
  return new Date(utc);
}

// "YYYY-MM-DDTHH:MM[:SS]" (a datetime-local value) read as wall time in tz.
export function parseLocalInput(value, tz) {
  const m = /^(-?\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value || '');
  if (!m) return null;
  return zonedToDate(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0), tz);
}

// A Date -> the datetime-local string for wall time in tz.
export function formatLocalInput(date, tz) {
  const v = wallParts(tz, date.getTime());
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(v.year, 4)}-${pad(v.month)}-${pad(v.day)}T${pad(v.hour)}:${pad(v.minute)}`;
}

export function formatClockInTz(date, tz) {
  const v = wallParts(tz, date.getTime());
  const pad = n => String(n).padStart(2, '0');
  return `${pad(v.hour)}:${pad(v.minute)}:${pad(v.second)}`;
}

export function formatDateInTz(date, tz) {
  return date.toLocaleDateString('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
}

// 'UTC+03:00' (seconds appended only for the odd pre-1900 local-mean-time offsets).
export function offsetLabel(tz, date) {
  const total = Math.round(tzOffsetMs(tz, date.getTime()) / 1000);
  const sign = total >= 0 ? '+' : '−';
  const abs = Math.abs(total);
  const pad = n => String(n).padStart(2, '0');
  const base = `UTC${sign}${pad(Math.floor(abs / 3600))}:${pad(Math.floor((abs % 3600) / 60))}`;
  return abs % 60 ? `${base}:${pad(abs % 60)}` : base;
}
