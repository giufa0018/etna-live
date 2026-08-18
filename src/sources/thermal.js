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
  const proxy = `${SOURCES.firmsProxy}?days=${days}&bbox=${BBOX.join(',')}`;
  let data = await tryFetch(proxy);
  let via = 'proxy';

  // Su GitHub Pages il proxy non esiste; in locale può esserci ma senza
  // chiave. In entrambi i casi si ripiega sul file che GitHub Actions
  // deposita nel repository ogni quarto d'ora. L'errore del proxy si
  // riferisce solo se anche il file manca: altrimenti i dati ci sono
  // comunque e non c'è nulla da segnalare.
  if (!data || data.error) {
    const statico = await tryFetch(SOURCES.firmsStatic);
    if (statico && !statico.error) {
      data = statico;
      via = 'file statico';
    }
  }

  if (!data) {
    return { status: 'unconfigured', fc: empty(), reason: 'né proxy né dati statici disponibili' };
  }
  if (data.error) {
    return { status: 'unconfigured', fc: empty(), reason: data.error };
  }

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

  return {
    status: 'ok',
    via,
    // Il file statico può avere qualche minuto di ritardo: vale la pena saperlo.
    generated: data.generated ?? null,
    fc: { type: 'FeatureCollection', features: feats }
  };
}

/** Scarica e decodifica, restituendo null se la risorsa non c'è. */
async function tryFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (res.status === 404 || res.status === 501) {
      const msg = await serverMessage(res);
      return msg ? { error: msg } : null;
    }
    if (!res.ok) return { error: await serverMessage(res) || `HTTP ${res.status}` };
    return await res.json();
  } catch {
    return null;
  }
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
