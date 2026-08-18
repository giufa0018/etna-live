// Orchestratore: mette insieme mappa, fonti dati, pannelli e aggiornamenti.
import { SUMMIT, CRATERS, REFRESH_MIN } from './config.js';
import { sunPosition, sunTimes, romeNow, pad2, isoDate, cumulativeLengths, sliceLine } from './util.js';
import { createMap, sceneFromConditions, applyScene, flyPreset, startOrbit, makeMarker } from './map.js';
import { DEM } from './dem.js';
import * as Lava from './lava.js';
import { WeatherFX } from './fx.js';
import { fetchSummitWeather, fetchPointsWeather } from './sources/weather.js';
import { fetchQuakes, quakeStats } from './sources/quakes.js';
import { fetchThermal, thermalStats } from './sources/thermal.js';
import { fetchTrails, fetchOsmViewpoints, fetchPOIs } from './sources/osm.js';
import { mergeViewpoints, scoreViewpoints, viewingHint } from './viewpoints.js';
import { parseGPX, analyze, loadSaved, save, colorFor, toFeature } from './gpx.js';
import * as UI from './ui.js';

const $ = (id) => document.getElementById(id);

const state = {
  weather: null,
  hourly: null,
  scene: null,
  sun: null,
  quakes: { type: 'FeatureCollection', features: [] },
  quakeStats: null,
  thermal: { type: 'FeatureCollection', features: [] },
  thermalStatus: 'unconfigured',
  thermalReason: '',
  thermalStats: { count24: 0, summit24: 0, frpTotal: 0 },
  points: [],
  scored: [],
  gpx: [],
  userPos: null,
  markers: { craters: [], views: [] },
  orbitStop: null,
  vents: [],
  flows: [],
  volcanic: 0,
  erupt: { level: 0, name: 'in attesa di dati', note: '', count: 0, frp: 0 },
  fires: 0
};

// Rilievo locale ad alta risoluzione: serve solo per simulare le colate.
const dem = new DEM();
let warnedThermal = false;
let flowAnim = null;
let anchorMarker = null;

const map = createMap('map');
const fx = new WeatherFX($('fx'), map);
let popup = null;

// La mappa è pronta solo dopo il primo render WebGL. Il caricamento dei dati
// non deve dipendere da questo: in una scheda aperta in secondo piano il
// render non avviene, e la pagina resterebbe vuota. I dati arrivano subito,
// la mappa li riceve appena è in grado di disegnarli.
const mapReady = new Promise((resolve) => {
  if (map.loaded()) resolve();
  else map.once('load', resolve);
});

const pendingData = new Map();
let mapIsReady = false;

mapReady.then(() => {
  mapIsReady = true;
  for (const [id, data] of pendingData) map.getSource(id)?.setData(data);
  pendingData.clear();
  addCraterMarkers();
  addViewpointMarkers();
  wireMapInteractions();

  // I marker di MapLibre seguono la quota del terreno, map.project() no:
  // un marker invisibile sulla vetta dà al canvas il punto giusto da cui
  // far salire fumo e braci, anche mentre si ruota o si inclina la scena.
  const el = document.createElement('div');
  el.style.cssText = 'width:1px;height:1px;opacity:0;pointer-events:none';
  anchorMarker = new maplibregl.Marker({ element: el })
    .setLngLat([SUMMIT.lon, SUMMIT.lat]).addTo(map);
  fx.setAnchor(() => {
    const r = anchorMarker.getElement().getBoundingClientRect();
    return r.width || r.height || r.top ? { x: r.left, y: r.top } : null;
  });
  syncToggles();
  if (state.scene) applyScene(map, state.scene, state.sun, $('l-autolight').checked);
});

/** Aggiorna una sorgente GeoJSON, aspettando la mappa se serve. */
function setData(id, data) {
  if (mapIsReady) map.getSource(id)?.setData(data);
  else pendingData.set(id, data);
}

// ------------------------------------------------------------- avvio
// La chiamata a boot() è in fondo al file: `scheduler` è dichiarato con const
// più sotto e non sarebbe ancora inizializzato se partisse da qui.

async function boot() {
  UI.renderInfo();
  wireControls();
  restoreGpx();

  await runAll(true);
  scheduler.start();

  // Il rilievo per le colate e i dati OSM sono pesanti: partono per ultimi,
  // a pagina già viva.
  dem.load().then(({ tiles, failed }) => {
    if (!dem.ready) return UI.toast('Rilievo per le colate non caricato: percorsi non disponibili.');
    if (failed) console.warn(`DEM: ${failed} tile mancanti su ${tiles + failed}`);
    recomputeLava();   // ora le quote sono note: incendi e bocche si separano meglio
  });
  loadOsmLayers();
}

map.on('error', (e) => {
  // Le tile mancanti ai bordi sono normali; si segnala solo il resto.
  if (e?.error?.status === 404) return;
  console.warn('maplibre:', e?.error?.message || e);
});

// ------------------------------------------------------------- dati

async function refreshWeather() {
  const { current, hourly } = await fetchSummitWeather();
  state.weather = current;
  state.hourly = hourly;
  updateSunAndScene();

  const freezing = (state.hourly?.freezing_level_height?.[0] ?? 4000) < SUMMIT.ele;
  fx.apply(current, state.scene, freezing);

  UI.renderWeather(current, hourly, state.sun, state.sunTimes);
  await refreshViewpointScores();
}

async function refreshQuakes() {
  state.quakes = await fetchQuakes(7);
  state.quakeStats = quakeStats(state.quakes);
  setData('quakes', state.quakes);
  UI.renderQuakeList(state.quakes.features, focusQuake);
  renderActivity();
}

async function refreshThermal() {
  const r = await fetchThermal(2);
  state.thermalStatus = r.status;
  state.thermalReason = r.reason || '';
  state.thermal = r.fc;
  state.thermalStats = thermalStats(r.fc);
  setData('thermal', r.fc);
  UI.renderThermalSetup(r.status, r.reason);

  // Il pannello spiega il problema, ma all'avvio i cassetti sono chiusi: senza
  // un avviso a schermo si vedrebbero gli interruttori di colate e bocche
  // accesi e la mappa vuota, senza capire perché.
  if (r.status !== 'ok' && !warnedThermal) {
    warnedThermal = true;
    UI.toast(
      r.status === 'unconfigured'
        ? 'Colate e bocche non disponibili: manca la chiave NASA FIRMS. Apri “Dati” per le istruzioni.'
        : `Dati termici non disponibili: ${r.reason}`,
      7000
    );
  }
  if (r.status === 'ok') warnedThermal = false;

  recomputeLava();
  renderActivity();
}

// ------------------------------------------------------- bocche e colate

/**
 * Dai punti caldi grezzi a: incendi scartati, bocche raggruppate, livello di
 * attività, percorsi di discesa. Si può richiamare anche quando il DEM finisce
 * di caricarsi, per ricalcolare con le quote vere.
 */
function recomputeLava() {
  // Una sola finestra temporale e un solo criterio per tutta la schermata:
  // le ultime 24 h, e la quota come discriminante fra lava e incendio.
  // Con due metri diversi la scheda e la fascia di stato si contraddicevano.
  // Si classifica tutto il pacchetto, così anche la mappa può distinguere
  // una colata da un campo che brucia; i conteggi restano sulle 24 h.
  Lava.splitVolcanic(state.thermal.features, dem);
  setData('thermal', state.thermal);

  const feats = state.thermal.features.filter((f) => {
    const a = f.properties.ageH;
    return a == null || a <= 24;
  });
  const volcanic = feats.filter((f) => f.properties.origin === 'vulcanico');
  const fires = feats.filter((f) => f.properties.origin !== 'vulcanico');
  state.fires = fires.length;
  state.volcanic = volcanic.length;

  const vents = Lava.markNewVents(Lava.ventsFrom(Lava.cluster(volcanic), dem));
  const erupt = Lava.eruptionLevel(volcanic);
  const flows = Lava.flowPaths(vents, dem);

  state.vents = vents;
  state.erupt = erupt;
  state.flows = flows;

  setData('vents', Lava.ventsGeoJSON(vents));
  setData('lavaHulls', Lava.footprintGeoJSON(volcanic));
  setData('lavaFlows', Lava.flowsGeoJSON(flows));

  fx.setEruption(erupt.level);
  UI.renderEruption(erupt, fires.length);
  UI.renderVents(vents, focusVent);
  animateFlows(flows);
  renderActivity();   // la scheda dei punti caldi usa gli stessi numeri

  // Il bersaglio da guardare è cambiato: la classifica dei punti va rifatta.
  if (state.weather) refreshViewpointScores();

  const newOnes = vents.filter((v) => v.isNew).length;
  if (newOnes) UI.toast(`${newOnes} bocca/e mai vista/e nei giorni scorsi.`, 5000);
}

/** Fronte incandescente che scende lungo ciascun percorso, in ciclo. */
function animateFlows(flows) {
  cancelAnimationFrame(flowAnim);
  if (!flows.length) { setData('lavaFront', { type: 'FeatureCollection', features: [] }); return; }

  const cums = flows.map((f) => cumulativeLengths(f.coords));
  const t0 = performance.now();
  let last = 0;

  // Il canale sotto è già acceso di suo. Qui scorrono le ondate più luminose:
  // più d'una per canale, sfasate fra loro, così quando la prima esce dal
  // fondo un'altra è già a metà strada. Un solo fronte che riparte dall'alto
  // si leggeva come un avanti-indietro, non come lava che cola.
  const SURGES = 4;
  const LEN = 0.16;          // lunghezza di ogni ondata, in frazione di percorso
  const FLOW_SPEED = 0.33;   // metri per millisecondo di avanzamento apparente

  const step = (ts) => {
    flowAnim = requestAnimationFrame(step);
    // 25 fotogrammi al secondo bastano e tengono basso il costo di setData.
    if (document.hidden || !mapIsReady || ts - last < 40) return;
    last = ts;

    const features = [];
    flows.forEach((f, i) => {
      // Velocità apparente uguale su tutti i canali: il tempo di percorrenza
      // è proporzionale alla lunghezza, così una colata lunga non sfreccia.
      // Il valore è scelto per la leggibilità sullo schermo, non è una stima
      // della velocità reale di una colata — quella si misura in metri l'ora.
      const total = cums[i][cums[i].length - 1];
      const cycle = Math.min(48000, Math.max(11000, total / FLOW_SPEED));
      const base = ((ts - t0) % cycle) / cycle;

      for (let k = 0; k < SURGES; k++) {
        const head = (base + k / SURGES) % 1;
        const seg = sliceLine(f.coords, cums[i], head - LEN, head);
        if (seg.length > 1) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: seg },
            properties: { id: f.vent.id }
          });
        }
      }
    });
    map.getSource('lavaFront')?.setData({ type: 'FeatureCollection', features });
  };
  flowAnim = requestAnimationFrame(step);
}

function focusVent(v) {
  map.flyTo({ center: [v.lon, v.lat], zoom: 14.4, pitch: 74, duration: 1800 });
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '280px' })
    .setLngLat([v.lon, v.lat]).setHTML(UI.ventPopupHTML(v)).addTo(map);
}

function renderActivity() {
  if (!state.quakeStats) return;
  UI.renderActivity({
    thermal: state.thermalStats,
    thermalStatus: state.thermalStatus,
    quakes: state.quakeStats,
    lava: { volcanic: state.volcanic, fires: state.fires, erupt: state.erupt }
  });
  updateSubtitle();
}

async function refreshViewpointScores() {
  if (!state.points.length) state.points = mergeViewpoints([]);
  let local = [];
  try { local = await fetchPointsWeather(state.points); } catch { /* si usa comunque il dato di vetta */ }
  // Se c'è una colata, la classifica punta alla bocca più energetica.
  const target = state.erupt.level >= 2 && state.vents.length
    ? { lon: state.vents[0].lon, lat: state.vents[0].lat }
    : null;
  state.scored = scoreViewpoints(state.points, state.weather, local, target);
  UI.renderViews(state.scored, focusViewpoint, state.userPos, state.erupt);
  addViewpointMarkers();
  updateSubtitle();
}

async function loadOsmLayers() {
  try {
    const [trails, vps] = await Promise.allSettled([fetchTrails(), fetchOsmViewpoints()]);
    if (trails.status === 'fulfilled') {
      setData('trails', trails.value);
    } else {
      UI.toast('Sentieri OSM non disponibili adesso (Overpass occupato). Riprovo al prossimo giro.');
    }
    if (vps.status === 'fulfilled') {
      state.points = mergeViewpoints(vps.value);
      await refreshViewpointScores();
    }
  } catch (e) {
    console.warn('OSM:', e);
  }
}

// ------------------------------------------------------------- sole e scena

function updateSunAndScene() {
  const now = new Date();
  state.sun = sunPosition(now, SUMMIT.lat, SUMMIT.lon);
  state.sunTimes = sunTimes(romeNow(), SUMMIT.lat, SUMMIT.lon);
  state.scene = sceneFromConditions(state.sun.altitude, state.weather);
  applyScene(map, state.scene, state.sun, $('l-autolight').checked);
  fx.paintVignette(state.scene);
}

function updateSubtitle() {
  const best = state.scored[0];
  const hint = best ? viewingHint(best, state.scene || { night: false }, state.erupt) : '';
  UI.setStatus(hint || 'dati in aggiornamento…');
}

// ------------------------------------------------------------- scheduler

const scheduler = {
  tasks: [
    { name: 'meteo', fn: refreshWeather, every: REFRESH_MIN.weather, last: 0 },
    { name: 'sismicità', fn: refreshQuakes, every: REFRESH_MIN.quakes, last: 0 },
    { name: 'termico', fn: refreshThermal, every: REFRESH_MIN.thermal, last: 0 }
  ],
  timer: null,
  start() {
    this.timer = setInterval(() => this.tick(), 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.tick(); });
  },
  async tick() {
    const now = Date.now();
    $('clock').textContent = clockText();

    // Il sole si muove anche fra un aggiornamento e l'altro.
    if (state.weather && now % 60000 < 1000) updateSunAndScene();

    let next = Infinity;
    for (const t of this.tasks) {
      const due = t.last + t.every * 60000;
      next = Math.min(next, due - now);
      if (!document.hidden && now >= due && !t.running) run(t);
    }
    const secs = Math.max(0, Math.round(next / 1000));
    $('countdown').textContent = `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`;
  }
};

async function run(task, silent = false) {
  task.running = true;
  UI.setDot('loading');
  try {
    await task.fn();
    task.last = Date.now();
    UI.setDot('ok');
  } catch (e) {
    task.last = Date.now() - (task.every - 1) * 60000; // riprova fra un minuto
    UI.setDot('err');
    console.warn(`[${task.name}]`, e);
    if (!silent) UI.toast(`Aggiornamento ${task.name} non riuscito: ${e.message}`);
  } finally {
    task.running = false;
  }
}

async function runAll(initial = false) {
  UI.setDot('loading');
  await Promise.allSettled(scheduler.tasks.map((t) => run(t, initial)));
}

function clockText() {
  const d = romeNow();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ------------------------------------------------------------- marker

function addCraterMarkers() {
  if (!mapIsReady || state.markers.craters.length) return;
  for (const c of CRATERS) {
    state.markers.craters.push(makeMarker(map, {
      lon: c.lon, lat: c.lat, label: c.short, sub: `${c.ele} m`, cls: 'crater',
      onClick: () => map.flyTo({ center: [c.lon, c.lat], zoom: 14.6, pitch: 72, duration: 1600 })
    }));
  }
}

function addViewpointMarkers() {
  if (!mapIsReady) return;
  state.markers.views.forEach((m) => m.remove());
  state.markers.views = [];
  for (const v of state.scored.slice(0, 22)) {
    state.markers.views.push(makeMarker(map, {
      lon: v.lon, lat: v.lat, label: v.name, sub: `${v.score}`,
      cls: 'view ' + (v.score >= 55 ? 'good' : v.score >= 25 ? 'mid' : 'bad'),
      onClick: () => focusViewpoint(v)
    }));
  }
  toggleMarkerClass('views', $('l-views').checked);
  toggleMarkerClass('craters', $('l-craters').checked);
}

function toggleMarkerClass(kind, visible) {
  for (const m of state.markers[kind]) m.getElement().style.display = visible ? '' : 'none';
}

// ------------------------------------------------------------- interazioni

function wireMapInteractions() {
  const clickable = ['vent-core', 'poi-dot', 'quakes-circle', 'thermal-core', 'trails-line', 'gpx-line'];

  map.on('click', (e) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: clickable.filter((l) => map.getLayer(l)) });
    if (!hits.length) return;
    const f = hits[0];
    const html =
      f.layer.id === 'vent-core' ? UI.ventPopupHTML(f.properties)
      : f.layer.id === 'poi-dot' ? UI.poiPopupHTML(f.properties)
      : f.layer.id === 'quakes-circle' ? UI.quakePopupHTML(f.properties)
      : f.layer.id === 'thermal-core' ? UI.thermalPopupHTML(f.properties)
      : UI.trailPopupHTML(f.properties);

    popup?.remove();
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '280px' })
      .setLngLat(e.lngLat).setHTML(html).addTo(map);
  });

  for (const l of clickable) {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  }
}

function focusQuake(f) {
  const [lon, lat] = f.geometry.coordinates;
  map.flyTo({ center: [lon, lat], zoom: 13.4, pitch: 65, duration: 1500 });
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '280px' })
    .setLngLat([lon, lat]).setHTML(UI.quakePopupHTML(f.properties)).addTo(map);
}

function focusViewpoint(v) {
  // Ci si posiziona sul punto guardando verso il cratere.
  map.flyTo({ center: [v.lon, v.lat], zoom: v.dist > 20000 ? 11.5 : 13.2, pitch: 78, bearing: v.brg, duration: 2200 });
  popup?.remove();
  popup = new maplibregl.Popup({ maxWidth: '300px' })
    .setLngLat([v.lon, v.lat]).setHTML(UI.viewpointPopupHTML(v, state.userPos)).addTo(map);
}

// ------------------------------------------------------------- controlli

// Ogni interruttore e ciò che accende. Tenerlo in un posto solo evita che
// lo stato iniziale della pagina e quello dei click divergano.
const TOGGLES = {
  'l-thermal': { layers: ['thermal-glow', 'thermal-core'] },
  'l-quakes': { layers: ['quakes-circle'] },
  'l-lava': { layers: ['lava-hull', 'lava-hull-edge', 'lava-flow-path', 'lava-front', 'lava-front-glow'] },
  'l-vents': { layers: ['vent-halo', 'vent-core'] },
  'l-trails': { layers: ['trails-casing', 'trails-line'] },
  'l-gibs': { layers: ['base-gibs'] },
  'l-plume': { apply: (on) => { fx.showPlume = on; } },
  'l-craters': { apply: (on) => toggleMarkerClass('craters', on) },
  'l-views': { apply: (on) => toggleMarkerClass('views', on) },
  // I punti di interesse si scaricano solo quando servono davvero: sono una
  // query Overpass in più, inutile pagarla a chi non accende il livello.
  'l-poi': { layers: ['poi-dot'], apply: (on) => { if (on) loadPOIs(); } }
};

let poisLoaded = false;
async function loadPOIs() {
  if (poisLoaded) return;
  poisLoaded = true;
  try {
    const fc = await fetchPOIs();
    setData('pois', fc);
    UI.toast(`${fc.features.length} punti di interesse da OpenStreetMap.`);
  } catch (e) {
    poisLoaded = false;
    UI.toast('Punti di interesse non disponibili adesso (Overpass occupato).');
    console.warn('POI:', e);
  }
}

function setLayers(layerIds, on) {
  layerIds.forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  });
}

function applyToggle(id, on) {
  const t = TOGGLES[id];
  if (!t) return;
  if (t.layers) setLayers(t.layers, on);
  t.apply?.(on);
}

/** Allinea la scena agli interruttori: serve all'avvio, quando i livelli
 *  nascono visibili nello stile ma la pagina deve partire quasi spenta. */
function syncToggles() {
  for (const id of Object.keys(TOGGLES)) applyToggle(id, $(id).checked);
}

function wireControls() {
  const vis = setLayers;

  for (const id of Object.keys(TOGGLES)) {
    $(id).addEventListener('change', (e) => {
      applyToggle(id, e.target.checked);
      if (id === 'l-gibs' && e.target.checked) {
        UI.toast(`Mosaico NASA del ${isoDate(-1)} — una passata al giorno, nuvole comprese.`);
      }
    });
  }

  $('basemap').addEventListener('change', (e) => {
    const v = e.target.value;
    vis(['base-sat'], v === 'sat');
    vis(['base-topo'], v === 'topo');
    if (map.getLayer('hillshade')) {
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', v === 'dark' ? 0.75 : 0.45);
    }
  });

  $('exag').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    $('exag-out').textContent = `${v.toFixed(1)}×`;
    if (mapIsReady) map.setTerrain({ source: 'dem', exaggeration: v });
  });

  $('l-weatherfx').addEventListener('change', (e) => {
    fx.enabled = e.target.checked;
    $('vignette').style.opacity = e.target.checked ? '1' : '0';
  });
  $('l-autolight').addEventListener('change', () => updateSunAndScene());

  document.querySelectorAll('[data-fly]').forEach((b) => b.addEventListener('click', () => {
    state.orbitStop?.();
    const k = b.dataset.fly;
    if (k === 'orbit') state.orbitStop = startOrbit(map, () => { state.orbitStop = null; });
    else flyPreset(map, k === 'summit' ? 'summit' : 'wide');
  }));

  $('refresh-btn').addEventListener('click', () => { runAll(); UI.toast('Aggiornamento in corso…', 1600); });

  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${t.dataset.tab}`));
  }));

  // I pannelli stanno fuori schermo e rientrano dalla maniglia sul bordo.
  // Uno alla volta: due cassetti aperti mangerebbero tutta la mappa.
  // Lo stato di un cassetto vive in tre posti (pannello, body, maniglia) e
  // deve cambiare sempre insieme: una sola funzione lo imposta, così non può
  // capitare che il pannello si chiuda e la maniglia resti spostata.
  const setDrawer = (side, open) => {
    $(side).classList.toggle('open', open);
    document.body.classList.toggle(`${side}-open`, open);
    $(`handle-${side}`).setAttribute('aria-expanded', String(open));
  };
  const toggleDrawer = (side) => {
    const open = !$(side).classList.contains('open');
    setDrawer(side === 'left' ? 'right' : 'left', false);
    setDrawer(side, open);
  };

  $('handle-left').addEventListener('click', () => toggleDrawer('left'));
  $('handle-right').addEventListener('click', () => toggleDrawer('right'));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setDrawer('left', false); setDrawer('right', false); }
  });

  // Le sezioni ricordano se le hai lasciate aperte o chiuse.
  document.querySelectorAll('details[data-sec]').forEach((d) => {
    const key = `sec:${d.dataset.sec}`;
    const saved = localStorage.getItem(`etna-live:${key}`);
    if (saved !== null) d.open = saved === '1';
    d.addEventListener('toggle', () => localStorage.setItem(`etna-live:${key}`, d.open ? '1' : '0'));
  });

  $('gpx-input').addEventListener('change', (e) => handleGpxFiles([...e.target.files]));
  setupDropZone();

  // Posizione dell'utente, se la concede: serve solo per i link "come arrivare".
  navigator.geolocation?.getCurrentPosition(
    (p) => {
      state.userPos = { lat: p.coords.latitude, lon: p.coords.longitude };
      if (state.scored.length) UI.renderViews(state.scored, focusViewpoint, state.userPos, state.erupt);
    },
    () => {}, { timeout: 8000, maximumAge: 600000 }
  );
}

// ------------------------------------------------------------- GPX

function setupDropZone() {
  ['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
  document.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])].filter((f) => /\.gpx$/i.test(f.name));
    if (files.length) handleGpxFiles(files);
  });
}

async function handleGpxFiles(files) {
  for (const file of files) {
    try {
      const text = await file.text();
      const tracks = parseGPX(text, file.name.replace(/\.gpx$/i, ''));
      for (const t of tracks) {
        const stats = await analyze(t);
        state.gpx.push({
          id: `g${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
          name: t.name, color: colorFor(state.gpx.length), ...stats
        });
      }
      UI.toast(`${file.name}: ${tracks.length} traccia/e caricate.`);
    } catch (err) {
      UI.toast(`${file.name}: ${err.message}`);
    }
  }
  syncGpx(true);
}

function syncGpx(fly = false) {
  setData('gpx', { type: 'FeatureCollection', features: state.gpx.map(toFeature) });
  UI.renderGpxList(state.gpx, flyToTrack, removeTrack);
  save(state.gpx);
  if (fly && state.gpx.length) flyToTrack(state.gpx[state.gpx.length - 1]);
}

function flyToTrack(t) {
  const b = t.coords.reduce((acc, c) => [
    Math.min(acc[0], c[0]), Math.min(acc[1], c[1]),
    Math.max(acc[2], c[0]), Math.max(acc[3], c[1])
  ], [180, 90, -180, -90]);
  map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 90, pitch: 62, duration: 1800 });
  UI.toast(`${t.name} — ${(t.length / 1000).toFixed(1)} km, +${t.gain} m di dislivello`);
}

function removeTrack(t) {
  state.gpx = state.gpx.filter((x) => x.id !== t.id);
  syncGpx();
}

function restoreGpx() {
  state.gpx = loadSaved();
  syncGpx();
}

// Handle di ispezione dalla console del browser. Solo in locale: in
// produzione non si espone lo stato interno della pagina.
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.etna = { map, state, dem, fx, recomputeLava };
}

// Via.
boot();
