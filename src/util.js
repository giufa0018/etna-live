// Utilità condivise: geometria sferica, posizione del sole, cache, fetch.

export const R_EARTH = 6371008.8;
export const rad = Math.PI / 180;
export const deg = 180 / Math.PI;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);

/** Interpola due colori "#rrggbb". */
export function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

/** Distanza in metri fra due [lon,lat] (haversine). */
export function distance(a, b) {
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const la1 = a[1] * rad, la2 = b[1] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Azimut iniziale in gradi (0 = nord, orario) da a verso b. */
export function bearing(a, b) {
  const la1 = a[1] * rad, la2 = b[1] * rad, dLon = (b[0] - a[0]) * rad;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * deg + 360) % 360;
}

/** Punto a `dist` metri da `origin` lungo l'azimut `brg`. */
export function destination(origin, brg, dist) {
  const d = dist / R_EARTH, b = brg * rad;
  const la1 = origin[1] * rad, lo1 = origin[0] * rad;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [((lo2 * deg + 540) % 360) - 180, la2 * deg];
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
export const compass = (d) => CARDINALS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

/** Lunghezza totale di una LineString in metri. */
export function lineLength(coords) {
  let t = 0;
  for (let i = 1; i < coords.length; i++) t += distance(coords[i - 1], coords[i]);
  return t;
}

/** Distanze progressive lungo una polilinea, per poterla tagliare a frazioni. */
export function cumulativeLengths(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + distance(coords[i - 1], coords[i]));
  return cum;
}

/**
 * Porzione di polilinea fra due frazioni (0–1) della sua lunghezza,
 * con gli estremi interpolati per un avanzamento fluido.
 */
export function sliceLine(coords, cum, t0, t1) {
  const total = cum[cum.length - 1];
  if (!total) return [];
  const d0 = clamp(t0, 0, 1) * total, d1 = clamp(t1, 0, 1) * total;
  if (d1 <= d0) return [];

  const at = (d) => {
    let i = 1;
    while (i < cum.length && cum[i] < d) i++;
    if (i >= cum.length) return coords[coords.length - 1];
    const span = cum[i] - cum[i - 1] || 1;
    const f = (d - cum[i - 1]) / span;
    const a = coords[i - 1], b = coords[i];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };

  const out = [at(d0)];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] > d0 && cum[i] < d1) out.push(coords[i]);
  }
  out.push(at(d1));
  return out;
}

// ---------------------------------------------------------------- sole
// Algoritmo astronomico standard (stesso impianto di SunCalc), riscritto
// qui per non dipendere da una CDN esterna.
const J2000 = 2451545, DAY_MS = 86400000, OBLIQ = 23.4397 * rad;

function toDays(date) { return date.valueOf() / DAY_MS - 0.5 + 2440588 - J2000; }

/** Posizione del sole: { altitude, azimuth } in gradi (azimut 0 = nord, orario). */
export function sunPosition(date, lat, lon) {
  const d = toDays(date);
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQ) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQ), Math.cos(L));
  const lw = -lon * rad, phi = lat * rad;
  const H = rad * (280.16 + 360.9856235 * d) - lw - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  const azSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude: altitude * deg, azimuth: (azSouth * deg + 180 + 360) % 360 };
}

/** Alba e tramonto (approssimati al minuto) per la data e il luogo dati. */
export function sunTimes(date, lat, lon) {
  const start = new Date(date); start.setHours(0, 0, 0, 0);
  let rise = null, set = null, prev = sunPosition(start, lat, lon).altitude;
  for (let m = 1; m <= 24 * 60; m += 1) {
    const t = new Date(start.getTime() + m * 60000);
    const alt = sunPosition(t, lat, lon).altitude;
    if (prev < 0 && alt >= 0 && !rise) rise = t;
    if (prev > 0 && alt <= 0 && !set) set = t;
    prev = alt;
  }
  return { rise, set };
}

// ---------------------------------------------------------------- rete
export async function fetchJSON(url, { timeout = 20000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${url.split('?')[0]}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** Primo endpoint che risponde, provando la lista in ordine. */
export async function fetchFirst(urls, opts) {
  let last;
  for (const u of urls) {
    try { return await fetchJSON(u, opts); } catch (e) { last = e; }
  }
  throw last;
}

// ---------------------------------------------------------------- cache
const NS = 'etna-live:';

export function cacheGet(key, maxAgeMin) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > maxAgeMin * 60000) return null;
    return v;
  } catch { return null; }
}

export function cacheSet(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify({ t: Date.now(), v: value })); }
  catch { /* quota piena o storage negato: si prosegue senza cache */ }
}

// ---------------------------------------------------------------- formato
export const fmtKm = (m) => m >= 1000 ? `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km` : `${Math.round(m)} m`;

export function timeAgo(date) {
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 60) return 'ora';
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400) return `${Math.floor(s / 3600)} h fa`;
  return `${Math.floor(s / 86400)} g fa`;
}

export const pad2 = (n) => String(n).padStart(2, '0');

/** Data ISO (YYYY-MM-DD) in UTC, con scarto opzionale in giorni. */
export function isoDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Ora corrente in Sicilia, indipendente dal fuso del browser. */
export function romeNow() {
  const s = new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' });
  return new Date(s);
}

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
