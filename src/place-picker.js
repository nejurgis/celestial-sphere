// ── place-picker.js ───────────────────────────────────────────────────────
// City search for the birth place: OpenStreetMap Nominatim for the search, and
// /api/timezone (functions/api/timezone.js) for the IANA zone of the chosen
// coordinates — the same pattern as the rising-sign calculator. Nominatim's usage
// policy asks for at most one request a second and discourages as-you-type
// searching, so requests are debounced (500 ms, 3+ characters) and only the latest
// one is used.

const DEBOUNCE_MS = 500;
const MIN_CHARS = 3;

export function initPlacePicker({ input, list, onSelect }) {
  let timer = null, latest = 0;

  const hide = () => { list.hidden = true; list.innerHTML = ''; };
  const show = results => {
    list.innerHTML = '';
    if (!results.length) { list.hidden = true; return; }
    results.forEach(r => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      const primary = document.createElement('span'); primary.className = 'pl-primary'; primary.textContent = r.short;
      const secondary = document.createElement('span'); secondary.className = 'pl-secondary'; secondary.textContent = r.display;
      li.append(primary, secondary);
      li.addEventListener('mousedown', e => { e.preventDefault(); input.value = r.short; hide(); onSelect(r); });
      list.appendChild(li);
    });
    const credit = document.createElement('li');
    credit.className = 'pl-credit'; credit.textContent = 'Search © OpenStreetMap contributors';
    list.appendChild(credit);
    list.hidden = false;
  };

  async function search(query, ticket) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1&featuretype=settlement&accept-language=en`;
      const data = await (await fetch(url)).json();
      if (ticket !== latest) return; // a newer keystroke superseded this
      show(data.map(s => {
        const a = s.address || {};
        const name = a.city || a.town || a.village || a.municipality || a.hamlet || s.name;
        return { short: [name, a.country].filter(Boolean).join(', '), display: s.display_name, lat: parseFloat(s.lat), lon: parseFloat(s.lon) };
      }));
    } catch {
      if (ticket === latest) hide();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < MIN_CHARS) { hide(); return; }
    const ticket = ++latest;
    timer = setTimeout(() => search(q, ticket), DEBOUNCE_MS);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); });
  document.addEventListener('click', e => { if (!e.target.closest('#place-wrap')) hide(); });
}

// Coordinates -> IANA zone name via the Pages Function; null when unavailable.
export async function fetchTimeZone(lat, lon) {
  try {
    const r = await fetch(`/api/timezone?lat=${lat}&lon=${lon}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.timeZone || null;
  } catch {
    return null;
  }
}
