// Alternativa a Vercel: Cloudflare Worker che serve i file statici (via Assets)
// e la rotta /api/firms. Il segreto si imposta con:
//   npx wrangler secret put FIRMS_MAP_KEY
import { firmsGeoJSON, CORS, parseBBox } from './api/_core.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/firms') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      const { status, body } = await firmsGeoJSON(env.FIRMS_MAP_KEY, {
        days: url.searchParams.get('days'),
        bbox: parseBBox(url.searchParams.get('bbox'))
      });

      return new Response(JSON.stringify(body), {
        status,
        headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    // Tutto il resto sono i file statici del sito.
    return env.ASSETS.fetch(request);
  }
};
