// Dai punti caldi del satellite alle bocche, ai fronti di colata, al livello
// di attività.
//
// Distinzione da tenere ferma, perché la pagina la dichiara all'utente:
//   MISURATO   dove il suolo è caldo, quanto, quando  (NASA FIRMS)
//   DERIVATO   quali punti formano una bocca          (raggruppamento)
//   SIMULATO   dove scorrerebbe la colata             (discesa sul rilievo)

import { SUMMIT } from './config.js';
import { distance, cacheGet, cacheSet, isoDate } from './util.js';

// Sopra questa quota l'Etna è roccia e cenere: non c'è vegetazione che possa
// bruciare, quindi un punto caldo lassù è quasi certamente vulcanico. È un
// filtro molto più affidabile della sola distanza dal cratere.
const VOLCANIC_MIN_ELE = 1900;
const CLUSTER_EPS_M = 750;      // distanza entro cui due punti sono la stessa bocca
const NEW_VENT_M = 450;         // scostamento oltre il quale una bocca è "nuova"

/**
 * Separa i punti caldi vulcanici dagli incendi, usando la quota reale.
 * Senza DEM si ripiega sulla distanza dal cratere.
 */
export function splitVolcanic(features, dem) {
  const volcanic = [], fires = [];
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const ele = dem?.ready ? dem.elevationAt(lon, lat) : NaN;
    const isVolcanic = Number.isFinite(ele)
      ? ele >= VOLCANIC_MIN_ELE
      : f.properties.distSummit < 4000;
    f.properties.elevation = Number.isFinite(ele) ? Math.round(ele) : null;
    f.properties.origin = isVolcanic ? 'vulcanico' : 'probabile incendio';
    (isVolcanic ? volcanic : fires).push(f);
  }
  return { volcanic, fires };
}

/** Raggruppa i punti vicini in insiemi connessi (single linkage). */
export function cluster(features, eps = CLUSTER_EPS_M) {
  const pts = features.map((f) => ({ f, c: f.geometry.coordinates }));
  const seen = new Set();
  const out = [];

  for (let i = 0; i < pts.length; i++) {
    if (seen.has(i)) continue;
    const queue = [i], group = [];
    seen.add(i);
    while (queue.length) {
      const k = queue.pop();
      group.push(pts[k]);
      for (let j = 0; j < pts.length; j++) {
        if (seen.has(j)) continue;
        if (distance(pts[k].c, pts[j].c) <= eps) { seen.add(j); queue.push(j); }
      }
    }
    out.push(group);
  }
  return out;
}

/** Da ogni gruppo ricava una bocca: centroide, energia, quota, freschezza. */
export function ventsFrom(groups, dem) {
  return groups.map((g, i) => {
    const lon = g.reduce((s, p) => s + p.c[0], 0) / g.length;
    const lat = g.reduce((s, p) => s + p.c[1], 0) / g.length;
    const frp = g.reduce((s, p) => s + (Number(p.f.properties.frp) || 0), 0);
    const maxK = g.reduce((m, p) => Math.max(m, Number(p.f.properties.bright_ti4) || 0), 0);
    const times = g.map((p) => p.f.properties.time).filter(Boolean);
    const ele = dem?.ready ? dem.elevationAt(lon, lat) : NaN;

    return {
      id: `v${i}`,
      lon, lat,
      points: g.length,
      frp: Math.round(frp * 10) / 10,
      maxKelvin: Math.round(maxK),
      lastSeen: times.length ? Math.max(...times) : null,
      elevation: Number.isFinite(ele) ? Math.round(ele) : null,
      distSummit: distance([lon, lat], [SUMMIT.lon, SUMMIT.lat])
    };
  }).sort((a, b) => b.frp - a.frp || b.points - a.points);
}

/**
 * Segnala le bocche mai viste nei giorni precedenti.
 * La memoria è locale: la prima volta che si apre la pagina è tutto "nuovo",
 * quindi il flag compare solo dallo storico del secondo giorno in poi.
 */
export function markNewVents(vents) {
  const hist = cacheGet('vent-history', 60 * 24 * 30) || { days: {}, known: [] };
  const today = isoDate();

  for (const v of vents) {
    const seenBefore = hist.known.some((k) => distance([k.lon, k.lat], [v.lon, v.lat]) < NEW_VENT_M);
    v.isNew = hist.known.length > 0 && !seenBefore;
  }

  // Lo storico tiene solo i centroidi, non i punti: bastano e restano leggeri.
  const merged = [...hist.known];
  for (const v of vents) {
    if (!merged.some((k) => distance([k.lon, k.lat], [v.lon, v.lat]) < NEW_VENT_M)) {
      merged.push({ lon: v.lon, lat: v.lat, first: today });
    }
  }
  hist.known = merged.slice(-60);
  hist.days[today] = vents.length;
  cacheSet('vent-history', hist);

  return vents;
}

/**
 * Livello di attività, 0–3, dai punti caldi vulcanici e dalla loro energia.
 * Soglie tarate a mano: servono a decidere quanto "accendere" la pagina,
 * non a classificare l'eruzione.
 */
export function eruptionLevel(volcanic) {
  const n = volcanic.length;
  const frp = volcanic.reduce((s, f) => s + (Number(f.properties.frp) || 0), 0);

  if (n === 0) return { level: 0, name: 'quiete', frp, count: n, note: 'Nessun punto caldo in area sommitale.' };
  if (n <= 5 && frp < 30) return { level: 1, name: 'punti caldi', frp, count: n, note: 'Calore al cratere: degassamento o crosta ancora tiepida.' };
  if (n <= 25 || frp < 200) return { level: 2, name: 'attività in corso', frp, count: n, note: 'Anomalie termiche estese in area sommitale.' };
  return { level: 3, name: 'eruzione in corso', frp, count: n, note: 'Molti punti caldi ad alta energia: probabile emissione di lava.' };
}

/** Percorsi di massima discesa dalle bocche più energetiche. */
export function flowPaths(vents, dem, max = 4) {
  if (!dem?.ready) return [];
  return vents.slice(0, max).map((v) => {
    // Una colata più alimentata arriva più lontano: lunghezza legata alla FRP.
    const reach = Math.min(11000, 1800 + v.frp * 22);
    const coords = dem.descentPath(v.lon, v.lat, { maxMeters: reach });
    return coords.length > 2 ? { vent: v, coords } : null;
  }).filter(Boolean);
}

// ------------------------------------------------------------- GeoJSON

export const ventsGeoJSON = (vents) => ({
  type: 'FeatureCollection',
  features: vents.map((v) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [v.lon, v.lat] },
    properties: { ...v }
  }))
});

/**
 * Impronta reale delle rilevazioni: un pixel VIIRS copre circa 375 m, quindi
 * ogni punto caldo diventa un disco di quel raggio.
 *
 * Prima qui c'era l'inviluppo convesso del gruppo, che però riempiva anche i
 * vuoti fra una rilevazione e l'altra: dipingeva di lava mezza montagna
 * affermando molto più di quanto il satellite abbia visto.
 */
export const footprintGeoJSON = (volcanic, radius = 190) => ({
  type: 'FeatureCollection',
  features: volcanic.map((f) => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [disc(f.geometry.coordinates, radius)] },
    properties: { frp: f.properties.frp ?? 0, bright_ti4: f.properties.bright_ti4 ?? 0 }
  }))
});

function disc([lon, lat], radius, sides = 12) {
  const ring = [];
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180));
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat]);
  }
  return ring;
}

export const flowsGeoJSON = (paths) => ({
  type: 'FeatureCollection',
  features: paths.map((p) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: p.coords },
    properties: { id: p.vent.id, frp: p.vent.frp }
  }))
});
