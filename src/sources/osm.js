// Sentieri, punti panoramici e cime da OpenStreetMap via Overpass.
// Dati statici nel breve periodo: si tengono in cache 24 h e si scaricano
// in modo pigro, per non rallentare il primo disegno della mappa.

import { SOURCES, BBOX, BBOX_CORE } from '../config.js';
import { cacheGet, cacheSet, lineLength } from '../util.js';

const bb = ([w, s, e, n]) => `${s},${w},${n},${e}`;
const round = (c) => [Math.round(c.lon * 1e5) / 1e5, Math.round(c.lat * 1e5) / 1e5];

async function overpass(query, timeoutMs = 90000) {
  let lastErr;
  for (const endpoint of SOURCES.overpass) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
        return await res.json();
      } finally { clearTimeout(timer); }
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

/** Sentieri: relazioni escursionistiche + sentieri/piste con nome. */
export async function fetchTrails() {
  const cached = cacheGet('trails', 60 * 24);
  if (cached) return cached;

  const q = `[out:json][timeout:150];
(
  relation["route"="hiking"](${bb(BBOX_CORE)});
  way["highway"~"^(path|track)$"]["name"](${bb(BBOX_CORE)});
);
out geom;`;

  const data = await overpass(q, 150000);
  const features = [];

  for (const el of data.elements || []) {
    const tags = el.tags || {};
    const name = tags.name || tags.ref || null;

    if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.map(round);
      if (coords.length < 2) continue;
      features.push(line(coords, {
        id: `w${el.id}`, name, kind: tags.highway || 'path',
        sac: tags.sac_scale || null, surface: tags.surface || null,
        length: Math.round(lineLength(coords)), src: 'osm'
      }));
    }

    if (el.type === 'relation' && el.members) {
      const parts = el.members
        .filter((m) => m.type === 'way' && m.geometry && m.geometry.length > 1)
        .map((m) => m.geometry.map(round));
      if (!parts.length) continue;
      features.push({
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: parts },
        properties: {
          id: `r${el.id}`, name, kind: 'route',
          network: tags.network || null, sac: tags['sac_scale'] || null,
          length: Math.round(parts.reduce((s, p) => s + lineLength(p), 0)),
          src: 'osm'
        }
      });
    }
  }

  const fc = { type: 'FeatureCollection', features };
  cacheSet('trails', fc);
  return fc;
}

/** Punti panoramici (tourism=viewpoint) da OpenStreetMap. */
export async function fetchOsmViewpoints() {
  const cached = cacheGet('viewpoints-v3', 60 * 24);
  if (cached) return cached;

  // Solo tourism=viewpoint: le cime taggate sono centinaia e riempirebbero
  // la mappa di etichette senza aiutare a scegliere dove andare.
  const q = `[out:json][timeout:60];
node["tourism"="viewpoint"]["name"](${bb(BBOX)});
out body;`;

  const data = await overpass(q, 60000);
  // Solo elementi con un nome: un "Punto panoramico" anonimo non aiuta
  // nessuno a decidere dove andare, e affollerebbe la mappa.
  const items = (data.elements || [])
    .filter((el) => el.lat && el.lon && el.tags?.name)
    .map((el) => ({
      name: el.tags.name,
      lon: Math.round(el.lon * 1e5) / 1e5,
      lat: Math.round(el.lat * 1e5) / 1e5,
      ele: el.tags.ele ? Math.round(parseFloat(el.tags.ele)) : null,
      kind: el.tags.natural === 'peak' ? 'peak' : 'viewpoint',
      src: 'osm'
    }));

  cacheSet('viewpoints-v3', items);
  return items;
}

// Cosa vale la pena segnalare a chi va sull'Etna, e come è taggato su OSM.
const POI_KINDS = [
  { key: 'grotta',    emoji: '🕳️', q: 'node["natural"="cave_entrance"]' },
  { key: 'rifugio',   emoji: '🏠', q: 'node["tourism"="alpine_hut"]' },
  { key: 'rifugio',   emoji: '🏠', q: 'node["tourism"="wilderness_hut"]' },
  { key: 'albero',    emoji: '🌳', q: 'node["natural"="tree"]["denotation"="natural_monument"]' },
  { key: 'cratere',   emoji: '🌋', q: 'node["natural"="volcano"]["name"]' },
  { key: 'sorgente',  emoji: '💧', q: 'node["natural"="spring"]["name"]' },
  { key: 'area sosta', emoji: '🅿️', q: 'node["amenity"="parking"]["name"]' },
  { key: 'ristoro',   emoji: '🍽️', q: 'node["amenity"~"^(restaurant|cafe)$"]["name"]' },
  { key: 'museo',     emoji: '🏛️', q: 'node["tourism"="museum"]["name"]' },
  { key: 'panorama',  emoji: '🔭', q: 'node["tourism"="viewpoint"]["name"]' }
];

/**
 * Punti di interesse attorno al vulcano. Query separata e su richiesta:
 * il livello nasce spento e i dati si scaricano solo se lo si accende.
 */
export async function fetchPOIs() {
  const cached = cacheGet('pois-v1', 60 * 24);
  if (cached) return cached;

  const body = POI_KINDS.map((k) => `${k.q}(${bb(BBOX_CORE)});`).join('\n  ');
  const q = `[out:json][timeout:90];\n(\n  ${body}\n);\nout body;`;
  const data = await overpass(q, 90000);

  const features = (data.elements || [])
    .filter((el) => el.lat && el.lon)
    .map((el) => {
      const t = el.tags || {};
      const kind =
        t.natural === 'cave_entrance' ? 'grotta'
        : t.tourism === 'alpine_hut' || t.tourism === 'wilderness_hut' ? 'rifugio'
        : t.natural === 'tree' ? 'albero monumentale'
        : t.natural === 'volcano' ? 'cratere'
        : t.natural === 'spring' ? 'sorgente'
        : t.amenity === 'parking' ? 'area sosta'
        : t.amenity === 'museum' || t.tourism === 'museum' ? 'museo'
        : t.amenity ? 'ristoro'
        : 'panorama';

      const lon = Math.round(el.lon * 1e5) / 1e5;
      const lat = Math.round(el.lat * 1e5) / 1e5;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          name: t.name || nameless(kind),
          kind,
          // Servono nel popup per il link "come arrivare": le proprietà sono
          // l'unica cosa che sopravvive al passaggio in vector tile.
          lon, lat,
          ele: t.ele ? Math.round(parseFloat(t.ele)) : null,
          website: t.website || t['contact:website'] || null,
          osmId: el.id
        }
      };
    });

  const fc = { type: 'FeatureCollection', features };
  cacheSet('pois-v1', fc);
  return fc;
}

const nameless = (kind) => ({
  grotta: 'Grotta senza nome',
  rifugio: 'Rifugio',
  'albero monumentale': 'Albero monumentale',
  'area sosta': 'Parcheggio'
}[kind] || 'Punto di interesse');

const line = (coordinates, properties) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates },
  properties
});
