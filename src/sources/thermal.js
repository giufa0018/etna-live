// Anomalie termiche (lava, bocche attive, colate calde) da NASA FIRMS.
//
// FIRMS non manda header CORS, quindi il browser non può chiamarlo direttamente:
// la richiesta passa da un piccolo proxy che tiene la chiave lato server
// (api/firms.js su Vercel, worker.js su Cloudflare, dev-proxy.mjs in locale).
// Senza proxy configurato la pagina resta pienamente funzionante: questo
// modulo restituisce semplicemente stato "unconfigured".

import { SOURCES, BBOX, SUMMIT } from '../config.js';
import { distance } from '../util.js';

export async function fetchThermal(days = 2) {
  const url = `${SOURCES.firmsProxy}?days=${days}&bbox=${BBOX.join(',')}`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  } catch {
    return { status: 'unconfigured', fc: empty(), reason: 'proxy irraggiungibile' };
  }

  if (res.status === 404 || res.status === 501) {
    return { status: 'unconfigured', fc: empty(), reason: await serverMessage(res) || 'proxy non installato' };
  }
  if (!res.ok) {
    return { status: 'error', fc: empty(), reason: await serverMessage(res) || `HTTP ${res.status}` };
  }

  let data;
  try { data = await res.json(); }
  catch { return { status: 'unconfigured', fc: empty(), reason: 'risposta non JSON' }; }

  const feats = (data.features || []).map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        ...p,
        distSummit: distance([lon, lat], [SUMMIT.lon, SUMMIT.lat]),
        ageH: p.time ? (Date.now() - p.time) / 3600000 : null
      }
    };
  });

  return { status: 'ok', fc: { type: 'FeatureCollection', features: feats } };
}

// Raggio entro cui un punto caldo è plausibilmente vulcanico. Più in là, sui
// fianchi boscosi e nei coltivi, d'estate dominano gli incendi: il satellite
// non distingue una colata da un campo che brucia, li vede entrambi caldi.
const SUMMIT_RADIUS_M = 4000;

/** Sintesi delle anomalie: quante, quanto vicine, quanto energetiche. */
export function thermalStats(fc) {
  const f = fc.features;
  const in24 = f.filter((x) => x.properties.ageH == null || x.properties.ageH <= 24);
  const summit = in24.filter((x) => x.properties.distSummit < SUMMIT_RADIUS_M);
  const sumFrp = (arr) => arr.reduce((s, x) => s + (Number(x.properties.frp) || 0), 0);
  const maxT = in24.reduce((m, x) => Math.max(m, Number(x.properties.bright_ti4) || 0), 0);

  return {
    count24: in24.length,
    summit24: summit.length,
    // L'energia va contata solo in area sommitale: un incendio boschivo a
    // 8 km può irradiare più di una colata e falserebbe l'indice di attività.
    frpSummit: sumFrp(summit),
    frpTotal: sumFrp(in24),
    maxKelvin: maxT
  };
}

const empty = () => ({ type: 'FeatureCollection', features: [] });

/** Il proxy spiega da sé cosa manca: vale la pena mostrarlo all'utente. */
async function serverMessage(res) {
  try {
    const j = await res.clone().json();
    return typeof j?.error === 'string' ? j.error : null;
  } catch { return null; }
}
