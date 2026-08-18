// Classifica dei punti da cui l'Etna è (probabilmente) visibile adesso.
//
// Il punteggio è una stima, non una garanzia: combina la nuvolosità sulla
// vetta, quella sul punto di osservazione, la visibilità orizzontale
// dichiarata dal modello e la distanza dal cratere.

import { SUMMIT, VIEWPOINTS } from './config.js';
import { distance, bearing, compass, clamp, fmtKm } from './util.js';

// Il meteo viene chiesto punto per punto: ogni punto è una chiamata verso
// Open-Meteo, quindi l'insieme va tenuto piccolo. I curati ci sono sempre,
// gli altri entrano per vicinanza fino a questo tetto.
const MAX_POINTS = 40;

/** Unisce i punti curati con quelli di OpenStreetMap, senza duplicati vicini. */
export function mergeViewpoints(osmPoints = []) {
  const out = VIEWPOINTS.map((v) => ({ ...v, src: 'curato' }));

  const extra = osmPoints
    .filter((p) => !out.some((o) => distance([o.lon, o.lat], [p.lon, p.lat]) < 900))
    .map((p) => ({
      ...p,
      side: sideOf(p),
      note: 'Punto panoramico segnalato su OpenStreetMap.',
      d: distance([p.lon, p.lat], [SUMMIT.lon, SUMMIT.lat])
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.max(0, MAX_POINTS - out.length));

  return [...out, ...extra].map((v) => ({
    ...v,
    dist: distance([v.lon, v.lat], [SUMMIT.lon, SUMMIT.lat]),
    brg: bearing([v.lon, v.lat], [SUMMIT.lon, SUMMIT.lat])
  }));
}

function sideOf(p) {
  const b = bearing([SUMMIT.lon, SUMMIT.lat], [p.lon, p.lat]);
  return compass(b);
}

/**
 * Calcola il punteggio di visibilità.
 * @param {object} summitWx  meteo corrente nella cella della vetta
 * @param {object[]} localWx meteo corrente su ciascun punto, stesso ordine
 */
export function scoreViewpoints(points, summitWx, localWx, target = null) {
  // Quando c'è una bocca attiva il bersaglio non è più la vetta ma la colata:
  // distanza e direzione di sguardo vanno riferite a quella, altrimenti si
  // manda la gente a guardare il cratere mentre la lava scende da un'altra parte.
  const T = target ? [target.lon, target.lat] : [SUMMIT.lon, SUMMIT.lat];
  // Quanto la vetta è "annegata" nelle nubi.
  const low = summitWx?.cloud_cover_low ?? summitWx?.cloud_cover ?? 50;
  const mid = summitWx?.cloud_cover_mid ?? 0;
  const summitBlock = clamp((low * 0.55 + mid * 0.45) / 100, 0, 1);
  const summitClear = 1 - summitBlock;

  return points.map((v, i) => {
    const wx = localWx?.[i] || {};
    const dTarget = distance([v.lon, v.lat], T);
    const bTarget = bearing([v.lon, v.lat], T);
    const localCloud = (wx.cloud_cover_low ?? wx.cloud_cover ?? 40) / 100;
    const precip = wx.precipitation ?? 0;

    // La copertura sopra la testa conta meno di quella sulla vetta:
    // da sotto una nuvola bassa si può comunque guardare in alto in lontananza.
    const localClear = clamp(1 - localCloud * 0.5 - Math.min(precip, 4) * 0.12, 0, 1);

    // Visibilità orizzontale contro distanza dal cratere.
    const vis = wx.visibility ?? 24000;
    const visFactor = clamp(vis / Math.max(dTarget, 1), 0, 1);

    // Oltre i 45 km anche col sereno la foschia costiera pesa.
    const distFactor = clamp(1 - Math.max(0, dTarget - 45000) / 40000, 0.25, 1);

    const score = Math.round(100 * summitClear * localClear * Math.pow(visFactor, 0.6) * distFactor);

    return {
      ...v,
      score: clamp(score, 0, 100),
      wx,
      summitClear,
      label: score >= 65 ? 'ottima' : score >= 40 ? 'discreta' : score >= 18 ? 'incerta' : 'scarsa',
      lookDir: compass(bTarget),
      distTarget: dTarget,
      distText: fmtKm(dTarget),
      targetLabel: target ? 'dalla bocca attiva' : 'dal cratere',
      // A parità di condizioni vengono prima i punti curati: hanno indicazioni
      // di accesso verificate, mentre quelli OSM sono solo coordinate.
      priority: v.src === 'curato' ? 1 : 0
    };
  }).sort((a, b) => b.score - a.score || b.priority - a.priority || a.distTarget - b.distTarget);
}

/** Link di navigazione verso il punto. */
export function directions(v, from = null) {
  const dest = `${v.lat},${v.lon}`;
  const gmaps = from
    ? `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${dest}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
  return {
    gmaps,
    apple: `https://maps.apple.com/?daddr=${dest}&dirflg=d`,
    osm: `https://www.openstreetmap.org/directions?to=${dest}`,
    geo: `geo:${dest}`
  };
}

/** Suggerimento testuale in base a ora, meteo e attività termica. */
export function viewingHint(best, scene, erupt) {
  if (!best) return '';
  const lava = (erupt?.level ?? 0) >= 2;
  const where = `da ${best.name} (${best.side}), guardando verso ${best.lookDir}, a ${best.distText} ${best.targetLabel}`;

  if (lava && scene.night) {
    return `Colata in corso: di notte il bagliore si vede anche con qualche nube. Ora la resa migliore è ${where}.`;
  }
  if (lava && best.score < 20) {
    return `Colata in corso, ma la zona è coperta quasi ovunque. Con il buio il bagliore buca la foschia: riprova stanotte ${where.replace('Ora la resa migliore è ', '')}.`;
  }
  if (lava) {
    return `Colata in corso: la resa migliore è ${where}. Di notte si vede molto meglio.`;
  }
  if (scene.night) {
    return `È notte e non risultano colate attive: si distingue solo la sagoma. Meglio all'alba ${where}.`;
  }
  if (best.score < 20) {
    return 'Vetta coperta quasi ovunque adesso. Conviene aspettare o controllare fra qualche ora.';
  }
  return `Ora la resa migliore è ${where}.`;
}
