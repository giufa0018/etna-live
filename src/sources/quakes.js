// Sismicità dal servizio FDSN dell'INGV (nessuna chiave, CORS aperto).
import { SOURCES, BBOX, SUMMIT } from '../config.js';
import { fetchJSON, distance } from '../util.js';

/** Terremoti degli ultimi `days` giorni nel riquadro etneo, come GeoJSON. */
export async function fetchQuakes(days = 7) {
  const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19);
  const url = `${SOURCES.ingv}?starttime=${start}` +
    `&minlat=${BBOX[1]}&maxlat=${BBOX[3]}&minlon=${BBOX[0]}&maxlon=${BBOX[2]}` +
    `&minmag=0&orderby=time&limit=800&format=geojson`;

  const raw = await fetchJSON(url, { timeout: 25000 });
  const feats = (raw.features || []).map((f) => {
    // Il tempo INGV è UTC ma arriva senza suffisso Z.
    const t = new Date(f.properties.time.endsWith('Z') ? f.properties.time : f.properties.time + 'Z');
    const [lon, lat, depth] = f.geometry.coordinates;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        id: f.properties.eventId,
        mag: f.properties.mag ?? 0,
        magType: f.properties.magType || 'ML',
        depth: depth ?? 0,
        place: f.properties.place || '—',
        time: t.getTime(),
        ageH: (Date.now() - t.getTime()) / 3600000,
        distSummit: distance([lon, lat], [SUMMIT.lon, SUMMIT.lat])
      }
    };
  }).filter((f) => Number.isFinite(f.properties.mag));

  return { type: 'FeatureCollection', features: feats };
}

/** Statistiche di sintesi sulla sismicità. */
export function quakeStats(fc) {
  const f = fc.features;
  const last24 = f.filter((x) => x.properties.ageH <= 24);
  const last7d = f;
  const near = last24.filter((x) => x.properties.distSummit < 12000);
  const maxMag = last24.reduce((m, x) => Math.max(m, x.properties.mag), 0);

  // Baseline: media giornaliera dei 7 giorni, usata solo come riferimento relativo.
  const perDay = last7d.length / 7;
  const ratio = perDay > 0 ? last24.length / perDay : 1;

  return {
    count24: last24.length,
    count7d: last7d.length,
    near24: near.length,
    maxMag,
    perDay,
    ratio,
    // Energia relativa (proxy log-lineare), utile solo per confronti interni.
    energy24: last24.reduce((s, x) => s + Math.pow(10, 1.5 * x.properties.mag), 0)
  };
}
