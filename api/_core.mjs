// Logica condivisa dal proxy FIRMS, indipendente dalla piattaforma.
//
// NASA FIRMS non espone header CORS: il browser non può chiamarlo direttamente.
// Questo modulo scarica il CSV lato server, lo normalizza in GeoJSON e lo
// restituisce. La chiave resta sulla piattaforma di hosting, mai nel client.

const SATELLITES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
const DEFAULT_BBOX = [14.72, 37.52, 15.36, 38.0];

/**
 * @param {string} mapKey  chiave FIRMS
 * @param {object} opts    { days, bbox }
 * @returns {Promise<{status:number, body:object}>}
 */
export async function firmsGeoJSON(mapKey, { days = 2, bbox = DEFAULT_BBOX } = {}) {
  if (!mapKey) {
    return { status: 501, body: { error: 'FIRMS_MAP_KEY non configurata sul server' } };
  }

  const d = Math.min(Math.max(parseInt(days, 10) || 2, 1), 10);
  const area = bbox.join(',');
  const results = await Promise.allSettled(
    SATELLITES.map((sat) => fetchOne(mapKey, sat, area, d))
  );

  const ok = results.filter((r) => r.status === 'fulfilled');
  if (!ok.length) {
    const why = results[0]?.reason?.message || 'nessuna risposta da FIRMS';
    return { status: 502, body: { error: why } };
  }

  const seen = new Set();
  const features = [];
  for (const r of ok) {
    for (const f of r.value) {
      const k = `${f.properties.latitude.toFixed(4)}|${f.properties.longitude.toFixed(4)}|${f.properties.time}`;
      if (seen.has(k)) continue;
      seen.add(k);
      features.push(f);
    }
  }

  features.sort((a, b) => b.properties.time - a.properties.time);

  return {
    status: 200,
    body: {
      type: 'FeatureCollection',
      generated: Date.now(),
      days: d,
      satellites: SATELLITES,
      features
    }
  };
}

async function fetchOne(key, satellite, area, days) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${satellite}/${area}/${days}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'etna-live/1.0' } });
  const text = await res.text();

  if (!res.ok) throw new Error(`FIRMS ${satellite}: HTTP ${res.status}`);
  if (/invalid map_key/i.test(text)) throw new Error('FIRMS_MAP_KEY non valida');
  if (/^\s*$/.test(text)) return [];

  return parseCSV(text, satellite);
}

function parseCSV(text, satellite) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name);
  const iLat = col('latitude'), iLon = col('longitude');
  if (iLat < 0 || iLon < 0) return [];

  const iBright = col('bright_ti4') >= 0 ? col('bright_ti4') : col('brightness');
  const iBright2 = col('bright_ti5') >= 0 ? col('bright_ti5') : col('bright_t31');
  const iFrp = col('frp'), iConf = col('confidence'), iDate = col('acq_date');
  const iTime = col('acq_time'), iSat = col('satellite'), iInst = col('instrument');
  const iDayNight = col('daynight');

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const lat = parseFloat(c[iLat]), lon = parseFloat(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: {
        latitude: lat,
        longitude: lon,
        bright_ti4: num(c[iBright]),
        bright_ti5: num(c[iBright2]),
        frp: num(c[iFrp]),
        confidence: c[iConf] ?? null,
        satellite: c[iSat] || satellite,
        instrument: c[iInst] || null,
        daynight: c[iDayNight] || null,
        time: toEpoch(c[iDate], c[iTime])
      }
    });
  }
  return out;
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** acq_date "YYYY-MM-DD" + acq_time "HHMM" (UTC) → epoch ms. */
function toEpoch(date, time) {
  if (!date) return null;
  const t = String(time ?? '0').padStart(4, '0');
  const iso = `${date}T${t.slice(0, 2)}:${t.slice(2, 4)}:00Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=180, s-maxage=300, stale-while-revalidate=600'
};

export function parseBBox(raw) {
  if (!raw) return DEFAULT_BBOX;
  const parts = String(raw).split(',').map(Number);
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : DEFAULT_BBOX;
}
