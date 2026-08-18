// Rendering dei pannelli. Nessuna logica di dominio qui dentro: solo DOM.
import { escapeHtml, timeAgo, fmtKm, pad2, clamp } from './util.js';
import { wmo } from './sources/weather.js';
import { directions } from './viewpoints.js';

const $ = (id) => document.getElementById(id);

let toastTimer;
export function toast(msg, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function setStatus(text) { $('subtitle').textContent = text; }

export function setDot(state) {
  const d = $('live-dot');
  d.className = 'dot' + (state === 'loading' ? ' loading' : state === 'err' ? ' err' : '');
}

// ------------------------------------------------------------- attività

export function renderActivity({ thermal, thermalStatus, quakes, lava }) {
  if (thermalStatus === 'ok') {
    // In evidenza vanno solo i punti caldi classificati come vulcanici, cioè
    // quelli sopra i 1900 m dove non c'è vegetazione che possa bruciare.
    // Il totale del riquadro comprende gli incendi, che d'estate in Sicilia
    // sono la maggioranza delle rilevazioni.
    $('s-thermal').textContent = lava?.volcanic ?? '—';
    $('s-thermal-sub').textContent = lava?.fires
      ? `+${lava.fires} più in basso, probabili incendi`
      : 'sopra i 1900 m di quota';
    $('s-thermal').parentElement.classList.toggle('hot', (lava?.volcanic ?? 0) > 0);
  } else {
    $('s-thermal').textContent = '—';
    $('s-thermal-sub').textContent = thermalStatus === 'unconfigured' ? 'proxy FIRMS non attivo' : 'dato non disponibile';
  }

  $('s-quakes').textContent = quakes.count24;
  $('s-quakes-sub').textContent = `${quakes.near24} entro 12 km · ${quakes.count7d} in 7 g`;
  $('s-mag').textContent = quakes.maxMag ? quakes.maxMag.toFixed(1) : '—';
  $('s-mag-sub').textContent = quakes.maxMag ? 'magnitudo locale' : 'nessun evento';

  const idx = activityIndex(thermalStatus === 'ok' ? lava : null, quakes);
  $('s-index').textContent = idx.value;
  $('s-index').parentElement.classList.toggle('hot', idx.value >= 45);
  $('s-index-sub').textContent = idx.label;
}

/**
 * Indice sintetico 0–100, puramente indicativo: mette insieme il ritmo
 * sismico rispetto alla settimana e le anomalie termiche in area sommitale.
 * Non è una valutazione di pericolosità e non sostituisce i bollettini INGV.
 */
function activityIndex(lava, q) {
  const seismic = clamp((q.ratio - 0.8) / 2.2, 0, 1) * 45 + clamp(q.near24 / 25, 0, 1) * 15;
  const therm = lava ? clamp(lava.volcanic / 8, 0, 1) * 30 + clamp((lava.erupt?.frp ?? 0) / 300, 0, 1) * 10 : 0;
  const value = Math.round(clamp(seismic + therm, 0, 100));
  const label = value >= 65 ? 'sopra la norma recente'
    : value >= 40 ? 'moderato'
    : value >= 18 ? 'basso' : 'quiete';
  return { value, label };
}

export function renderQuakeList(features, onPick) {
  const ul = $('quake-list');
  ul.innerHTML = '';
  const top = [...features]
    .sort((a, b) => b.properties.time - a.properties.time)
    .slice(0, 12);

  if (!top.length) {
    ul.innerHTML = '<li class="muted">Nessun evento registrato nel periodo.</li>';
    return;
  }

  for (const f of top) {
    const p = f.properties;
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="mag${p.mag >= 3 ? ' big' : ''}">${p.mag.toFixed(1)}</span>` +
      `<span class="body"><span class="t1">${escapeHtml(p.place)}</span>` +
      `<span class="t2">${timeAgo(new Date(p.time))} · prof. ${p.depth.toFixed(1)} km · ${fmtKm(p.distSummit)} dal cratere</span></span>`;
    li.addEventListener('click', () => onPick(f));
    ul.appendChild(li);
  }
}

/** Fascia di stato in cima al pannello Attività. */
export function renderEruption(erupt, firesCount) {
  const box = $('eruption-banner');
  box.className = `erupt lvl${erupt.level}`;
  $('erupt-name').textContent = erupt.name;
  const extra = firesCount > 0
    ? ` Altri ${firesCount} punti caldi più in basso: verosimilmente incendi, non lava.`
    : '';
  $('erupt-note').textContent = erupt.note + extra;
}

/** Elenco delle bocche ricavate dai punti caldi. */
export function renderVents(vents, onPick) {
  const ul = $('vents-list');
  ul.innerHTML = '';

  if (!vents.length) {
    ul.innerHTML = '<li class="muted">Nessuna bocca calda rilevata in area sommitale.</li>';
    return;
  }

  for (const v of vents.slice(0, 8)) {
    const li = document.createElement('li');
    li.className = 'vent';
    li.innerHTML =
      `<span class="mag">${Math.round(v.frp)}<small>MW</small></span>
       <span class="body">
         <span class="t1">${v.elevation ? `Quota ${v.elevation} m` : 'Bocca'}${v.isNew ? '<span class="badge-new">nuova</span>' : ''}</span>
         <span class="t2">${v.points} rilevazion${v.points === 1 ? 'e' : 'i'} · ${v.maxKelvin} K · ${fmtKm(v.distSummit)} dal cratere${v.lastSeen ? ` · ${timeAgo(new Date(v.lastSeen))}` : ''}</span>
       </span>`;
    li.addEventListener('click', () => onPick(v));
    ul.appendChild(li);
  }
}

export function ventPopupHTML(v) {
  return `<div class="pop">
    <h4>Bocca attiva${v.isNew ? ' <span class="badge-new">nuova</span>' : ''}</h4>
    <div class="pk">raggruppamento di ${v.points} rilevazion${v.points === 1 ? 'e' : 'i'} satellitari</div>
    <table>
      <tr><td>Potenza radiativa</td><td>${v.frp} MW</td></tr>
      <tr><td>Temperatura max</td><td>${v.maxKelvin} K</td></tr>
      ${v.elevation ? `<tr><td>Quota</td><td>${v.elevation} m</td></tr>` : ''}
      <tr><td>Dal cratere</td><td>${fmtKm(v.distSummit)}</td></tr>
      ${v.lastSeen ? `<tr><td>Ultimo passaggio</td><td>${new Date(v.lastSeen).toLocaleString('it-IT')}</td></tr>` : ''}
    </table></div>`;
}

export function renderThermalSetup(status, reason) {
  const box = $('thermal-setup');
  if (status === 'ok') { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = status === 'unconfigured'
    ? `<b>Anomalie termiche non attive.</b><br>
       NASA FIRMS non consente chiamate dirette dal browser, quindi serve il mini-proxy incluso
       (<code>api/firms.mjs</code>) e una chiave gratuita, che si ottiene in un minuto su
       <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov</a>.
       Istruzioni nel <code>README.md</code>. <span class="muted">(${escapeHtml(reason || '')})</span>`
    : `<b>Anomalie termiche non disponibili.</b><br>${escapeHtml(reason || 'errore sconosciuto')}`;
}

// ------------------------------------------------------------- dove vederla

export function renderViews(scored, onPick, userPos, erupt) {
  const ul = $('views-list');
  ul.innerHTML = '';

  // Dire su cosa è calcolata la classifica: guardare la colata o guardare la
  // montagna sono due cose diverse, e cambiano il punto migliore.
  const intro = $('views-intro');
  if (intro) {
    intro.textContent = (erupt?.level ?? 0) >= 2
      ? 'Classifica puntata sulla bocca attiva: distanza e direzione sono riferite alla colata, non al cratere. Di notte il bagliore si vede molto più lontano.'
      : 'Classifica puntata sul cratere: nuvolosità in vetta, nuvolosità e visibilità sul posto, distanza.';
  }

  for (const v of scored.slice(0, 14)) {
    const cls = v.score >= 55 ? 'sc-a' : v.score >= 25 ? 'sc-b' : 'sc-c';
    const d = directions(v, userPos);
    const li = document.createElement('li');
    li.innerHTML =
      `<div class="hd">
         <span class="score ${cls}">${v.score}</span>
         <span class="body">
           <span class="t1">${escapeHtml(v.name)}</span>
           <span class="t2">${escapeHtml(v.side || '')} · ${v.distText} · guarda verso ${v.lookDir}${v.ele ? ` · ${v.ele} m` : ''}</span>
         </span>
       </div>
       <div class="t2 muted">${escapeHtml(v.note || '')} — visibilità ${v.label}</div>
       <div class="go">
         <a href="${d.gmaps}" target="_blank" rel="noopener">Come arrivare</a>
         <a href="${d.apple}" target="_blank" rel="noopener">Apple Maps</a>
         <a href="${d.osm}" target="_blank" rel="noopener">OSM</a>
       </div>`;
    li.querySelector('.hd').addEventListener('click', () => onPick(v));
    ul.appendChild(li);
  }
}

// ------------------------------------------------------------- meteo

export function renderWeather(wx, hourly, sun, sunT) {
  const [desc, icon] = wmo(wx.weather_code, wx.is_day);
  $('weather-now').innerHTML =
    `<div class="wx-now">
       <div class="ico">${icon}</div>
       <div>
         <div class="t">${Math.round(wx.temperature_2m)}°C</div>
         <div class="d">${escapeHtml(desc)} in vetta · percepiti ${Math.round(wx.apparent_temperature)}°C</div>
       </div>
     </div>
     <div class="wxrow">
       <div><b>${Math.round(wx.wind_speed_10m)}</b><span>km/h vento</span></div>
       <div><b>${Math.round(wx.wind_gusts_10m ?? 0)}</b><span>raffiche</span></div>
       <div><b>${Math.round(wx.cloud_cover)}%</b><span>nuvole</span></div>
       <div><b>${wx.visibility != null ? Math.round(wx.visibility / 1000) : '—'}</b><span>km vista</span></div>
     </div>
     <div class="kv" style="margin-top:12px">
       <span>Nubi basse / medie / alte</span><b>${Math.round(wx.cloud_cover_low ?? 0)}% · ${Math.round(wx.cloud_cover_mid ?? 0)}% · ${Math.round(wx.cloud_cover_high ?? 0)}%</b>
       <span>Precipitazioni</span><b>${(wx.precipitation ?? 0).toFixed(1)} mm</b>
       <span>Umidità</span><b>${Math.round(wx.relative_humidity_2m ?? 0)}%</b>
     </div>`;

  $('sun-info').innerHTML =
    `<span>Altezza del sole</span><b>${sun.altitude.toFixed(1)}°</b>
     <span>Azimut</span><b>${Math.round(sun.azimuth)}°</b>
     <span>Alba</span><b>${sunT.rise ? hm(sunT.rise) : '—'}</b>
     <span>Tramonto</span><b>${sunT.set ? hm(sunT.set) : '—'}</b>`;

  $('weather-chart').innerHTML = sparkline(hourly);
}

const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** Grafico compatto: temperatura, nuvolosità e precipitazioni sulle 24 h. */
function sparkline(h) {
  if (!h?.time?.length) return '';
  const now = Date.now();
  const idx = h.time.findIndex((t) => new Date(t).getTime() >= now - 3600000);
  const s = Math.max(0, idx), e = Math.min(h.time.length, s + 24);
  const T = h.temperature_2m.slice(s, e);
  const C = h.cloud_cover.slice(s, e);
  const P = h.precipitation.slice(s, e);
  const n = T.length;
  if (!n) return '';

  const W = 300, H = 96, pad = 4;
  const tmin = Math.min(...T), tmax = Math.max(...T);
  const span = Math.max(1, tmax - tmin);
  const x = (i) => pad + (i * (W - pad * 2)) / (n - 1);
  const y = (v) => H - 20 - ((v - tmin) / span) * (H - 42);

  const cloudBars = C.map((c, i) =>
    `<rect x="${x(i) - 4}" y="6" width="8" height="${(c / 100) * 16}" fill="#9fb0c8" opacity="0.35" rx="1"/>`).join('');
  const rainBars = P.map((p, i) => p > 0
    ? `<rect x="${x(i) - 3}" y="${H - 18 - Math.min(p, 5) * 3}" width="6" height="${Math.min(p, 5) * 3}" fill="#5ec8ff" opacity="0.7" rx="1"/>` : '').join('');
  const path = T.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const labels = T.map((v, i) => (i % 6 === 0)
    ? `<text x="${x(i)}" y="${H - 4}" fill="#94a3b8" font-size="9" text-anchor="middle">${new Date(h.time[s + i]).getHours()}</text>` : '').join('');

  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Andamento meteo 24 ore">
    ${cloudBars}${rainBars}
    <path d="${path}" fill="none" stroke="#ffd166" stroke-width="1.8" stroke-linejoin="round"/>
    <text x="${pad}" y="${y(tmax) - 4}" fill="#ffd166" font-size="9">${Math.round(tmax)}°</text>
    <text x="${pad}" y="${y(tmin) + 10}" fill="#94a3b8" font-size="9">${Math.round(tmin)}°</text>
    ${labels}
  </svg>`;
}

// ------------------------------------------------------------- info

export function renderInfo() {
  $('info-sources').innerHTML = `
    <p>Ogni numero in questa pagina arriva da una fonte pubblica, riscaricata a intervalli regolari.</p>
    <h3>Fonti</h3>
    <ul>
      <li><b>Rilievo 3D</b> — Terrain Tiles (Mapzen/AWS Open Data), quote in codifica terrarium.</li>
      <li><b>Immagini</b> — Esri World Imagery; mosaico giornaliero NASA GIBS (VIIRS true color).</li>
      <li><b>Sismicità</b> — servizio FDSN dell'<a href="https://terremoti.ingv.it/" target="_blank" rel="noopener">INGV</a>, aggiornato in continuo.</li>
      <li><b>Anomalie termiche</b> — <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">NASA FIRMS</a> (VIIRS/MODIS), via proxy.</li>
      <li><b>Meteo</b> — <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, modello ad area limitata.</li>
      <li><b>Sentieri e punti panoramici</b> — <a href="https://www.openstreetmap.org/" target="_blank" rel="noopener">OpenStreetMap</a> via Overpass.</li>
    </ul>
    <h3>Limiti da tenere presenti</h3>
    <ul>
      <li>Le anomalie termiche sono passaggi satellitari: alcune ore di ritardo e nessuna copertura sotto le nubi spesse.</li>
      <li>Il pennacchio disegnato è una <em>ricostruzione dal vento reale</em>, non un'osservazione della nube.</li>
      <li>Le quote dei crateri e l'indice di attività sono indicativi.</li>
    </ul>
    <h3>Prima di salire</h3>
    <ul>
      <li>Bollettini ufficiali: <a href="https://www.ct.ingv.it/" target="_blank" rel="noopener">INGV — Osservatorio Etneo</a>.</li>
      <li>Accessi e regole: <a href="https://www.parcoetna.it/" target="_blank" rel="noopener">Parco dell'Etna</a>. Sopra i 2900 m serve una guida alpina autorizzata.</li>
      <li>Questa pagina è informativa e non sostituisce le comunicazioni della Protezione Civile.</li>
    </ul>`;
}

// ------------------------------------------------------------- GPX

export function renderGpxList(tracks, onFly, onRemove) {
  const ul = $('gpx-list');
  ul.innerHTML = '';
  if (!tracks.length) {
    ul.innerHTML = '<li class="muted small" style="background:none;padding:2px">Nessuna traccia caricata.</li>';
    return;
  }
  for (const t of tracks) {
    const li = document.createElement('li');
    li.innerHTML =
      `<span class="swatch" style="background:${t.color}"></span>
       <span class="nm" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}<br>
         <span class="muted" style="font-size:11px">${fmtKm(t.length)} · +${t.gain} m</span>
       </span>
       <button class="x" title="Rimuovi">×</button>`;
    li.querySelector('.nm').addEventListener('click', () => onFly(t));
    li.querySelector('.x').addEventListener('click', () => onRemove(t));
    ul.appendChild(li);
  }
}

// ------------------------------------------------------------- popup

export function quakePopupHTML(p) {
  return `<div class="pop">
    <h4>Magnitudo ${p.mag.toFixed(1)} <span class="pk">${escapeHtml(p.magType)}</span></h4>
    <table>
      <tr><td>Località</td><td>${escapeHtml(p.place)}</td></tr>
      <tr><td>Quando</td><td>${new Date(p.time).toLocaleString('it-IT')}</td></tr>
      <tr><td>Profondità</td><td>${p.depth.toFixed(1)} km</td></tr>
      <tr><td>Dal cratere</td><td>${fmtKm(p.distSummit)}</td></tr>
    </table></div>`;
}

export function thermalPopupHTML(p) {
  return `<div class="pop">
    <h4>Anomalia termica</h4>
    <table>
      <tr><td>Temperatura</td><td>${p.bright_ti4 ? Math.round(p.bright_ti4) + ' K' : '—'}</td></tr>
      <tr><td>Potenza radiativa</td><td>${p.frp != null ? Number(p.frp).toFixed(1) + ' MW' : '—'}</td></tr>
      <tr><td>Rilevata</td><td>${p.time ? new Date(p.time).toLocaleString('it-IT') : '—'}</td></tr>
      <tr><td>Sensore</td><td>${escapeHtml(p.satellite || p.instrument || 'VIIRS')}</td></tr>
      <tr><td>Affidabilità</td><td>${escapeHtml(String(p.confidence ?? '—'))}</td></tr>
      <tr><td>Dal cratere</td><td>${fmtKm(p.distSummit)}</td></tr>
    </table></div>`;
}

export function poiPopupHTML(p) {
  return `<div class="pop">
    <h4>${escapeHtml(p.name)}</h4>
    <div class="pk">${escapeHtml(p.kind)}</div>
    ${p.ele ? `<table><tr><td>Quota</td><td>${p.ele} m</td></tr></table>` : ''}
    <div class="go">
      <a href="https://www.google.com/maps/dir/?api=1&destination=${p.lat ?? ''},${p.lon ?? ''}" target="_blank" rel="noopener">Come arrivare</a>
      <a href="https://www.openstreetmap.org/node/${p.osmId}" target="_blank" rel="noopener">Su OSM</a>
    </div></div>`;
}

export function trailPopupHTML(p) {
  return `<div class="pop">
    <h4>${escapeHtml(p.name || 'Sentiero senza nome')}</h4>
    <table>
      <tr><td>Tipo</td><td>${p.kind === 'route' ? 'itinerario escursionistico' : escapeHtml(p.kind)}</td></tr>
      ${p.length ? `<tr><td>Lunghezza</td><td>${fmtKm(p.length)}</td></tr>` : ''}
      ${p.sac ? `<tr><td>Difficoltà (SAC)</td><td>${escapeHtml(p.sac)}</td></tr>` : ''}
      ${p.surface ? `<tr><td>Fondo</td><td>${escapeHtml(p.surface)}</td></tr>` : ''}
    </table></div>`;
}

export function viewpointPopupHTML(v, userPos) {
  const d = directions(v, userPos);
  return `<div class="pop">
    <h4>${escapeHtml(v.name)}</h4>
    <div class="pk">visibilità ${v.label} · punteggio ${v.score}</div>
    <table>
      <tr><td>Dal cratere</td><td>${v.distText}</td></tr>
      <tr><td>Direzione</td><td>guarda verso ${v.lookDir}</td></tr>
      ${v.ele ? `<tr><td>Quota</td><td>${v.ele} m</td></tr>` : ''}
    </table>
    ${v.note ? `<p class="muted" style="margin:6px 0 0;font-size:11.5px">${escapeHtml(v.note)}</p>` : ''}
    <div class="go">
      <a href="${d.gmaps}" target="_blank" rel="noopener">Come arrivare</a>
      <a href="${d.osm}" target="_blank" rel="noopener">OSM</a>
    </div></div>`;
}
