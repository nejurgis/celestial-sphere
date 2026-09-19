// Cloudflare Pages Function: coordinates -> IANA time zone name.
// Same approach as the rising-sign calculator: ask timeapi.io server-side (so the
// browser doesn't hit its CORS/limits directly). Only the zone NAME is used; the
// UTC offset for a birth date comes from the browser's own historical tz data
// (src/timezone.js), never from "today's" offset.
export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const lat = Number(searchParams.get('lat'));
  const lon = Number(searchParams.get('lon'));
  const json = (body, status = 200, extra = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'Missing or invalid lat/lon' }, 400);
  }
  try {
    const r = await fetch(`https://timeapi.io/api/TimeZone/coordinate?latitude=${lat}&longitude=${lon}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await r.json();
    if (!data.timeZone) return json({ error: 'No time zone found' }, 404);
    // A place's zone rarely changes: let the edge and browser cache it for a day.
    return json({ timeZone: data.timeZone }, 200, { 'Cache-Control': 'public, max-age=86400' });
  } catch {
    return json({ error: 'Timezone lookup unavailable' }, 502);
  }
}
