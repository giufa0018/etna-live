// Meteo reale da Open-Meteo (nessuna chiave, CORS aperto).
import { SOURCES, SUMMIT } from '../config.js';
import { fetchJSON } from '../util.js';

const CURRENT = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m', 'precipitation',
  'weather_code', 'cloud_cover', 'cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
  'visibility', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day'
].join(',');

const HOURLY = [
  'temperature_2m', 'precipitation', 'snowfall', 'cloud_cover',
  'wind_speed_10m', 'wind_direction_10m', 'freezing_level_height'
].join(',');

/** Codici WMO → descrizione italiana + emoji. */
export function wmo(code, isDay = 1) {
  const t = {
    0: ['Sereno', isDay ? '☀️' : '🌙'],
    1: ['Prevalentemente sereno', isDay ? '🌤️' : '🌙'],
    2: ['Parzialmente nuvoloso', isDay ? '⛅' : '☁️'],
    3: ['Coperto', '☁️'],
    45: ['Nebbia', '🌫️'], 48: ['Nebbia con brina', '🌫️'],
    51: ['Pioviggine debole', '🌦️'], 53: ['Pioviggine', '🌦️'], 55: ['Pioviggine intensa', '🌧️'],
    56: ['Pioviggine gelata', '🌧️'], 57: ['Pioviggine gelata intensa', '🌧️'],
    61: ['Pioggia debole', '🌦️'], 63: ['Pioggia', '🌧️'], 65: ['Pioggia forte', '🌧️'],
    66: ['Pioggia gelata', '🌧️'], 67: ['Pioggia gelata forte', '🌧️'],
    71: ['Neve debole', '🌨️'], 73: ['Neve', '❄️'], 75: ['Neve abbondante', '❄️'],
    77: ['Nevischio', '🌨️'],
    80: ['Rovesci deboli', '🌦️'], 81: ['Rovesci', '🌧️'], 82: ['Rovesci violenti', '⛈️'],
    85: ['Rovesci di neve', '🌨️'], 86: ['Rovesci di neve forti', '❄️'],
    95: ['Temporale', '⛈️'], 96: ['Temporale con grandine', '⛈️'], 99: ['Temporale forte', '⛈️']
  };
  return t[code] || ['—', '🌡️'];
}

/** Meteo in vetta: condizioni attuali + 48 h orarie. */
export async function fetchSummitWeather() {
  const url = `${SOURCES.openMeteo}?latitude=${SUMMIT.lat}&longitude=${SUMMIT.lon}` +
    `&current=${CURRENT}&hourly=${HOURLY}&forecast_days=2&timezone=Europe%2FRome&wind_speed_unit=kmh`;
  const d = await fetchJSON(url);
  return { current: d.current, hourly: d.hourly, elevation: d.elevation };
}

/**
 * Condizioni attuali per una lista di punti, in una sola richiesta.
 * Open-Meteo accetta latitudini/longitudini separate da virgola e
 * restituisce un array nello stesso ordine.
 */
export async function fetchPointsWeather(points) {
  if (!points.length) return [];
  const lat = points.map((p) => p.lat.toFixed(4)).join(',');
  const lon = points.map((p) => p.lon.toFixed(4)).join(',');
  const url = `${SOURCES.openMeteo}?latitude=${lat}&longitude=${lon}` +
    `&current=weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,visibility,precipitation,temperature_2m,is_day` +
    `&timezone=Europe%2FRome`;
  const d = await fetchJSON(url);
  const arr = Array.isArray(d) ? d : [d];
  return arr.map((r) => r.current);
}

/** Quote reali (m) per una lista di [lon,lat]; max 100 punti per chiamata. */
export async function fetchElevations(coords) {
  const out = [];
  for (let i = 0; i < coords.length; i += 100) {
    const chunk = coords.slice(i, i + 100);
    const url = `${SOURCES.elevation}?latitude=${chunk.map((c) => c[1].toFixed(5)).join(',')}` +
      `&longitude=${chunk.map((c) => c[0].toFixed(5)).join(',')}`;
    const d = await fetchJSON(url);
    out.push(...d.elevation);
  }
  return out;
}
