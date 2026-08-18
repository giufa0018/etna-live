// Caricamento e analisi di tracce GPX dell'utente.
import { lineLength, cacheGet, cacheSet, distance } from './util.js';
import { fetchElevations } from './sources/weather.js';

const PALETTE = ['#ffd166', '#ff6a1f', '#c9a7ff', '#5ec8ff', '#8ef0a0', '#ff8fb1'];

/** Analizza un file GPX e restituisce una lista di tracce. */
export function parseGPX(text, fallbackName = 'Traccia') {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('GPX non valido');

  const tracks = [];
  const gpxName = doc.querySelector('gpx > metadata > name')?.textContent?.trim();

  const collect = (pts) => pts.map((p) => {
    const lon = parseFloat(p.getAttribute('lon'));
    const lat = parseFloat(p.getAttribute('lat'));
    const ele = parseFloat(p.querySelector('ele')?.textContent ?? 'NaN');
    return { lon, lat, ele };
  }).filter((p) => Number.isFinite(p.lon) && Number.isFinite(p.lat));

  doc.querySelectorAll('trk').forEach((trk, i) => {
    const name = trk.querySelector('name')?.textContent?.trim() || gpxName || `${fallbackName} ${i + 1}`;
    const pts = [];
    trk.querySelectorAll('trkseg').forEach((seg) => {
      pts.push(...collect([...seg.querySelectorAll('trkpt')]));
    });
    if (pts.length > 1) tracks.push({ name, pts });
  });

  doc.querySelectorAll('rte').forEach((rte, i) => {
    const name = rte.querySelector('name')?.textContent?.trim() || `Rotta ${i + 1}`;
    const pts = collect([...rte.querySelectorAll('rtept')]);
    if (pts.length > 1) tracks.push({ name, pts });
  });

  if (!tracks.length) throw new Error('Nessuna traccia trovata nel file');
  return tracks;
}

/** Riduce i punti mantenendo la forma (Douglas-Peucker semplificato per distanza). */
export function simplify(pts, minMeters = 12) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    if (distance([a.lon, a.lat], [pts[i].lon, pts[i].lat]) >= minMeters) out.push(pts[i]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Statistiche: lunghezza, dislivello positivo/negativo, quote estreme. */
export async function analyze(track) {
  const pts = simplify(track.pts);
  const coords = pts.map((p) => [p.lon, p.lat]);
  let eles = pts.map((p) => p.ele);

  // Se il GPX non porta le quote, si interrogano quelle reali del DEM.
  if (eles.some((e) => !Number.isFinite(e))) {
    try {
      const sampled = sampleEven(coords, 100);
      const got = await fetchElevations(sampled.coords);
      eles = spreadBack(got, sampled.idx, coords.length);
    } catch {
      eles = coords.map(() => NaN);
    }
  }

  let gain = 0, loss = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < eles.length; i++) {
    const e = eles[i];
    if (!Number.isFinite(e)) continue;
    min = Math.min(min, e); max = Math.max(max, e);
    if (i > 0 && Number.isFinite(eles[i - 1])) {
      const d = e - eles[i - 1];
      if (d > 0.8) gain += d; else if (d < -0.8) loss -= d;
    }
  }

  return {
    coords,
    eles,
    length: Math.round(lineLength(coords)),
    gain: Math.round(gain),
    loss: Math.round(loss),
    min: Number.isFinite(min) ? Math.round(min) : null,
    max: Number.isFinite(max) ? Math.round(max) : null
  };
}

function sampleEven(coords, n) {
  const step = Math.max(1, Math.ceil(coords.length / n));
  const out = { coords: [], idx: [] };
  for (let i = 0; i < coords.length; i += step) { out.coords.push(coords[i]); out.idx.push(i); }
  if (out.idx[out.idx.length - 1] !== coords.length - 1) {
    out.coords.push(coords[coords.length - 1]);
    out.idx.push(coords.length - 1);
  }
  return out;
}

function spreadBack(values, idx, total) {
  const res = new Array(total).fill(NaN);
  idx.forEach((k, i) => { res[k] = values[i]; });
  // interpolazione lineare fra i campioni
  let last = 0;
  for (let i = 1; i < total; i++) {
    if (Number.isFinite(res[i])) {
      const span = i - last;
      for (let j = 1; j < span; j++) res[last + j] = res[last] + (res[i] - res[last]) * (j / span);
      last = i;
    }
  }
  return res;
}

// ------------------------------------------------------------- persistenza

export function loadSaved() {
  return cacheGet('gpx', 60 * 24 * 365) || [];
}

export function save(tracks) {
  cacheSet('gpx', tracks.map((t) => ({
    id: t.id, name: t.name, color: t.color,
    coords: t.coords.map((c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]),
    length: t.length, gain: t.gain, loss: t.loss, min: t.min, max: t.max
  })));
}

export const colorFor = (i) => PALETTE[i % PALETTE.length];

export function toFeature(track) {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: track.coords },
    properties: {
      id: track.id, name: track.name, color: track.color,
      length: track.length, gain: track.gain, loss: track.loss, kind: 'gpx'
    }
  };
}
