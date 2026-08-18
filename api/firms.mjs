// Funzione serverless per Vercel (runtime Node).
// Variabile d'ambiente richiesta: FIRMS_MAP_KEY
import { firmsGeoJSON, CORS, parseBBox } from './_core.mjs';

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { days, bbox } = req.query || {};
  const { status, body } = await firmsGeoJSON(process.env.FIRMS_MAP_KEY, {
    days,
    bbox: parseBBox(bbox)
  });

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
}
