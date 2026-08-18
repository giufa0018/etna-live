// Server locale: file statici + rotta /api/firms.
// Uso:  FIRMS_MAP_KEY=... node dev-proxy.mjs   (oppure scrivi la chiave in .env)
//
// Serve un server perché la pagina usa i moduli ES: aprendola con file://
// il browser blocca gli import.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmsGeoJSON, CORS, parseBBox } from './api/_core.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

await loadDotEnv();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.gpx': 'application/gpx+xml'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/firms') {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
    const { status, body } = await firmsGeoJSON(process.env.FIRMS_MAP_KEY, {
      days: url.searchParams.get('days'),
      bbox: parseBBox(url.searchParams.get('bbox'))
    });
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(body));
  }

  // File statici, con protezione contro i path traversal.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, rel || 'index.html');
  if (!file.startsWith(ROOT)) return res.writeHead(403).end('Forbidden');

  // I file nascosti restano nascosti: .env contiene la chiave FIRMS e vive
  // dentro la cartella servita, quindi senza questo controllo finirebbe
  // in pasto a chiunque raggiunga il server.
  if (rel.split(/[/\\]/).some((part) => part.startsWith('.'))) {
    return res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Forbidden');
  }

  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(PORT, () => {
  const key = process.env.FIRMS_MAP_KEY ? 'configurata' : 'assente (colate e bocche resteranno spente)';
  console.log(`Etna Live su http://localhost:${PORT}  —  FIRMS_MAP_KEY: ${key}`);
});

// Il caso più frequente è banale — un server già avviato in un altro
// terminale — ma di suo Node lo racconta con uno stack trace illeggibile.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nLa porta ${PORT} è già occupata: probabilmente un altro Etna Live è ancora in esecuzione.\n` +
      `Chiudilo con Ctrl+C nel suo terminale, oppure:\n\n` +
      `  PowerShell:  Get-NetTCPConnection -LocalPort ${PORT} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }\n\n` +
      `In alternativa avvia su un'altra porta:  $env:PORT=5174; node dev-proxy.mjs\n`
    );
    process.exit(1);
  }
  throw err;
});

/** Legge un .env minimale, se presente. */
async function loadDotEnv() {
  try {
    const txt = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* nessun .env: si prosegue */ }
}
