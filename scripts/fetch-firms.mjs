// Scarica i punti caldi FIRMS e li salva come file statico nel repository.
//
// Serve a far funzionare la lava anche su GitHub Pages, che ospita solo file
// e non può eseguire il proxy. Qui il proxy lo fa GitHub Actions: gira ogni
// quarto d'ora, tiene la chiave nei segreti del repository e deposita il
// risultato in data/firms.json, che la pagina legge come un file qualsiasi.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { firmsGeoJSON } from '../api/_core.mjs';

const { status, body } = await firmsGeoJSON(process.env.FIRMS_MAP_KEY, { days: 2 });

if (status !== 200) {
  console.error(`FIRMS ha risposto ${status}: ${body.error ?? 'errore sconosciuto'}`);
  process.exit(1);
}

// Se non è cambiato nulla di sostanziale si evita un commit inutile: il
// campo `generated` cambia a ogni giro e da solo non è una notizia.
const path = 'data/firms.json';
let precedente = null;
try { precedente = JSON.parse(await readFile(path, 'utf8')); } catch { /* prima volta */ }

const uguale = precedente &&
  precedente.features.length === body.features.length &&
  JSON.stringify(precedente.features) === JSON.stringify(body.features);

if (uguale) {
  console.log(`Nessuna variazione: ${body.features.length} rilevazioni, invariate.`);
  process.exit(0);
}

await mkdir('data', { recursive: true });
await writeFile(path, JSON.stringify(body));
console.log(`Aggiornate ${body.features.length} rilevazioni da ${body.satellites.length} satelliti.`);
