// Scena 3D: terreno, basi cartografiche, livelli dati, cielo e luce.
import { SOURCES, SUMMIT, ATTRIBUTION, CAMERA_BOUNDS, ZOOM_RANGE } from './config.js';
import { mixHex, clamp, lerp, isoDate } from './util.js';

const EMPTY = { type: 'FeatureCollection', features: [] };

export function createMap(container) {
  const map = new maplibregl.Map({
    container,
    hash: 'v',
    maxPitch: 85,
    // La camera resta sull'Etna: niente gite in Calabria, niente tile sprecate.
    maxBounds: CAMERA_BOUNDS,
    minZoom: ZOOM_RANGE.min,
    maxZoom: ZOOM_RANGE.max,
    // Vista d'apertura: tutto l'edificio visto da sud, inclinato.
    center: [SUMMIT.lon + 0.008, SUMMIT.lat - 0.105],
    zoom: 11.7,
    pitch: 73,
    bearing: -6,
    antialias: true,
    attributionControl: { compact: true, customAttribution: ATTRIBUTION },
    style: {
      version: 8,
      sources: {
        dem: {
          type: 'raster-dem',
          tiles: [SOURCES.dem],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: SOURCES.demMaxZoom,
          attribution: 'Terrain Tiles (AWS Open Data)'
        },
        // Stesse tile del terreno ma sorgente distinta: MapLibre sconsiglia di
        // condividere una raster-dem fra rilievo 3D e ombreggiatura.
        demShade: {
          type: 'raster-dem',
          tiles: [SOURCES.dem],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: SOURCES.demMaxZoom
        },
        sat: { type: 'raster', tiles: [SOURCES.satellite], tileSize: 256, maxzoom: 18, attribution: 'Esri, Maxar, Earthstar Geographics' },
        topo: { type: 'raster', tiles: [SOURCES.topo], tileSize: 256, maxzoom: 18, attribution: 'Esri' },
        gibs: { type: 'raster', tiles: [SOURCES.gibs(isoDate(-1))], tileSize: 256, maxzoom: 9, attribution: 'NASA GIBS / VIIRS' },
        trails: { type: 'geojson', data: EMPTY },
        gpx: { type: 'geojson', data: EMPTY },
        thermal: { type: 'geojson', data: EMPTY },
        quakes: { type: 'geojson', data: EMPTY },
        lavaHulls: { type: 'geojson', data: EMPTY },
        lavaFlows: { type: 'geojson', data: EMPTY, lineMetrics: true },
        // lineMetrics abilita line-progress, cioè il gradiente incandescente
        // lungo il fronte che avanza.
        lavaFront: { type: 'geojson', data: EMPTY, lineMetrics: true },
        vents: { type: 'geojson', data: EMPTY },
        pois: { type: 'geojson', data: EMPTY }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#070a10' } },
        { id: 'base-sat', type: 'raster', source: 'sat', paint: { 'raster-saturation': -0.12, 'raster-contrast': 0.06 } },
        { id: 'base-topo', type: 'raster', source: 'topo', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.95 } },
        { id: 'base-gibs', type: 'raster', source: 'gibs', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } },
        {
          id: 'hillshade', type: 'hillshade', source: 'demShade',
          paint: {
            'hillshade-exaggeration': 0.45,
            'hillshade-shadow-color': '#000814',
            'hillshade-highlight-color': '#fff2d8',
            'hillshade-accent-color': '#1b2233',
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'map'
          }
        },

        // --- sentieri
        {
          id: 'trails-casing', type: 'line', source: 'trails',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#04120a', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 15, 5.5], 'line-opacity': 0.55 }
        },
        {
          id: 'trails-line', type: 'line', source: 'trails',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['case', ['==', ['get', 'kind'], 'route'], '#8ef0a0', '#63c98a'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.9, 15, 2.6],
            'line-opacity': 0.9
          }
        },

        // --- tracce GPX caricate dall'utente
        {
          id: 'gpx-casing', type: 'line', source: 'gpx',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#000', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 8], 'line-opacity': 0.5 }
        },
        {
          id: 'gpx-line', type: 'line', source: 'gpx',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['coalesce', ['get', 'color'], '#ffd166'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 15, 4.5]
          }
        },

        // --- punti di interesse (grotte, rifugi, alberi monumentali…)
        {
          id: 'poi-dot', type: 'circle', source: 'pois',
          layout: { visibility: 'none' },
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 7],
            'circle-color': ['match', ['get', 'kind'],
              'grotta', '#b28dff',
              'rifugio', '#7cffb2',
              'albero monumentale', '#5fd97a',
              'sorgente', '#5ec8ff',
              'cratere', '#ff8a00',
              'area sosta', '#9aa7b8',
              'ristoro', '#ffd166',
              '#c9a7ff'],
            'circle-stroke-width': 1.2,
            'circle-stroke-color': 'rgba(6,9,14,.85)',
            'circle-opacity': 0.95
          }
        },

        // --- sismicità
        {
          id: 'quakes-circle', type: 'circle', source: 'quakes',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'mag'], 0, 3, 1.5, 6, 3, 13, 4.5, 24],
            'circle-color': ['interpolate', ['linear'], ['get', 'depth'],
              0, '#ff7a4d', 4, '#ffc766', 10, '#7ee0ff', 25, '#5ec8ff', 40, '#8f9bff'],
            'circle-opacity': ['interpolate', ['linear'], ['get', 'ageH'], 0, 0.9, 24, 0.55, 168, 0.16],
            'circle-stroke-width': 1,
            'circle-stroke-color': '#eaf6ff',
            'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 'ageH'], 0, 0.75, 24, 0.3, 168, 0.06]
          }
        },

        // --- impronta dei pixel caldi: un disco per ogni rilevazione, del
        //     raggio effettivo del sensore. Niente area inventata fra i punti.
        {
          id: 'lava-hull', type: 'fill', source: 'lavaHulls',
          paint: {
            'fill-color': ['interpolate', ['linear'], ['get', 'bright_ti4'],
              300, '#c2410c', 340, '#ff5a00', 367, '#ffb347'],
            'fill-opacity': 0.42
          }
        },
        {
          id: 'lava-hull-edge', type: 'line', source: 'lavaHulls',
          paint: { 'line-color': '#ffd6a5', 'line-width': 0.8, 'line-opacity': 0.4 }
        },

        // --- il canale di colata resta acceso di suo: una colata vera è
        //     incandescente per tutta la sua lunghezza, e si raffredda verso
        //     il fronte. Il percorso è simulato sul rilievo, non osservato.
        {
          id: 'lava-flow-halo', type: 'line', source: 'lavaFlows',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ff3d00',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 18],
            'line-opacity': 0.2,
            'line-blur': 6
          }
        },
        {
          id: 'lava-flow-path', type: 'line', source: 'lavaFlows',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-gradient': ['interpolate', ['linear'], ['line-progress'],
              0, '#ffd166', 0.25, '#ff8a00', 0.6, '#e03a00', 1, '#5e1500'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.8, 15, 4.5],
            'line-opacity': 0.85
          }
        },
        // --- fronte incandescente che avanza lungo il percorso
        {
          id: 'lava-front-glow', type: 'line', source: 'lavaFront',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': '#ff3d00',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 15, 22],
            'line-opacity': 0.28,
            'line-blur': 8
          }
        },
        {
          id: 'lava-front', type: 'line', source: 'lavaFront',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-color': ['interpolate', ['linear'], ['line-progress'],
              0, '#8c1900', 0.55, '#ff4d00', 0.85, '#ffb347', 1, '#fff6d8'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.4, 15, 6]
          }
        },

        // --- anomalie termiche: alone morbido + nucleo caldo
        {
          id: 'thermal-glow', type: 'circle', source: 'thermal',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              9, ['interpolate', ['linear'], ['get', 'frp'], 0, 10, 50, 22],
              15, ['interpolate', ['linear'], ['get', 'frp'], 0, 26, 50, 64]],
            'circle-color': '#ff5a00',
            // L'alone incandescente spetta solo alla lava: un incendio non
            // deve somigliare a una colata.
            'circle-opacity': ['case', ['==', ['get', 'origin'], 'vulcanico'], 0.16, 0],
            'circle-blur': 1.1
          }
        },
        {
          id: 'thermal-core', type: 'circle', source: 'thermal',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              9, ['interpolate', ['linear'], ['get', 'frp'], 0, 3, 30, 7],
              15, ['interpolate', ['linear'], ['get', 'frp'], 0, 7, 30, 17]],
            'circle-color': ['case',
              ['!=', ['get', 'origin'], 'vulcanico'], '#8a4a3a',
              ['interpolate', ['linear'], ['get', 'bright_ti4'],
                300, '#ff3d00', 330, '#ff8a00', 360, '#ffd166', 380, '#fffbe6']],
            'circle-opacity': ['interpolate', ['linear'], ['coalesce', ['get', 'ageH'], 0], 0, 1, 24, 0.75, 48, 0.4],
            'circle-stroke-width': ['case', ['==', ['get', 'origin'], 'vulcanico'], 1.2, 0],
            'circle-stroke-color': '#fff6d8',
            'circle-stroke-opacity': 0.5
          }
        },

        // --- bocche: nucleo pulsante, anello per quelle mai viste prima
        {
          id: 'vent-halo', type: 'circle', source: 'vents',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'frp'], 0, 14, 200, 42],
            'circle-color': '#ff2a00',
            'circle-opacity': 0.22,
            'circle-blur': 1
          }
        },
        {
          id: 'vent-core', type: 'circle', source: 'vents',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['get', 'frp'], 0, 5, 200, 12],
            'circle-color': '#fff3c4',
            'circle-stroke-width': ['case', ['==', ['get', 'isNew'], true], 3, 1.5],
            'circle-stroke-color': ['case', ['==', ['get', 'isNew'], true], '#7cffb2', '#ff6a1f']
          }
        }
      ]
    }
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true, showUserLocation: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-right');
  map.touchZoomRotate.enableRotation();

  map.on('load', () => {
    map.setTerrain({ source: 'dem', exaggeration: 1.5 });
  });

  return map;
}

// ------------------------------------------------------------- cielo e luce

/**
 * Colori del cielo e nebbia in funzione dell'altezza del sole e del meteo.
 * Restituisce anche i parametri usati dagli effetti su canvas.
 */
export function sceneFromConditions(sunAlt, weather) {
  const cloud = (weather?.cloud_cover ?? 40) / 100;
  const rain = weather?.precipitation ?? 0;

  // t: 0 = notte piena, 0.5 = crepuscolo, 1 = pieno giorno
  const t = clamp((sunAlt + 8) / 20, 0, 1);
  const golden = clamp(1 - Math.abs(sunAlt - 4) / 10, 0, 1);

  let skyTop = mixHex('#050a18', '#2b6bd6', t);
  let horizon = mixHex('#0b1020', '#bcd6f5', t);
  horizon = mixHex(horizon, '#ff9a4d', golden * 0.7);
  skyTop = mixHex(skyTop, '#4a3f6b', golden * 0.35);

  // Con il cielo coperto tutto vira al grigio e si appiattisce.
  const grey = cloud * 0.75;
  skyTop = mixHex(skyTop, mixHex('#161a22', '#95a3b8', t), grey);
  horizon = mixHex(horizon, mixHex('#1b2029', '#c4ccd8', t), grey);

  const fogColor = mixHex(horizon, '#0a0e16', 0.25);
  const fogAmount = clamp(0.12 + cloud * 0.45 + Math.min(rain, 3) * 0.12, 0, 0.85);

  return {
    skyTop, horizon, fogColor, fogAmount,
    night: sunAlt < -6,
    twilight: sunAlt >= -6 && sunAlt < 6,
    dayFactor: t,
    cloud, rain
  };
}

export function applyScene(map, scene, sun, followSun = true) {
  if (!map.style || !map.isStyleLoaded()) return;

  map.setSky({
    'sky-color': scene.skyTop,
    'sky-horizon-blend': lerp(0.5, 0.85, scene.cloud),
    'horizon-color': scene.horizon,
    'horizon-fog-blend': lerp(0.4, 0.85, scene.fogAmount),
    'fog-color': scene.fogColor,
    'fog-ground-blend': lerp(0.55, 0.9, scene.fogAmount),
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.8, 12, lerp(0.35, 0.75, scene.fogAmount), 16, 0]
  });

  if (map.getLayer('hillshade')) {
    const dir = followSun && sun.altitude > -4 ? (sun.azimuth + 180) % 360 : 315;
    map.setPaintProperty('hillshade', 'hillshade-illumination-direction', dir);
    // Col cielo coperto le ombre si ammorbidiscono, ma il rilievo deve restare
    // leggibile: senza un minimo il terreno diventa una macchia piatta.
    map.setPaintProperty('hillshade', 'hillshade-exaggeration', lerp(0.62, 0.42, scene.cloud));
    map.setPaintProperty('hillshade', 'hillshade-highlight-color',
      mixHex('#2a3550', '#fff2d8', clamp(scene.dayFactor * (1 - scene.cloud * 0.6), 0, 1)));
  }

  // Di notte la base satellitare viene scurita e le anomalie termiche risaltano.
  if (map.getLayer('base-sat')) {
    map.setPaintProperty('base-sat', 'raster-brightness-max', lerp(0.32, 1, scene.dayFactor));
    map.setPaintProperty('base-sat', 'raster-saturation', lerp(-0.5, -0.1, scene.dayFactor));
  }
  if (map.getLayer('thermal-glow')) {
    map.setPaintProperty('thermal-glow', 'circle-opacity', scene.night ? 0.3 : 0.16);
  }
}

// ------------------------------------------------------------- camera

export const CAMERAS = {
  summit: { center: [SUMMIT.lon + 0.004, SUMMIT.lat - 0.026], zoom: 14.1, pitch: 74, bearing: -12 },
  wide:   { center: [SUMMIT.lon + 0.008, SUMMIT.lat - 0.105], zoom: 11.7, pitch: 73, bearing: -6 },
  valle:  { center: [15.045, 37.725], zoom: 12.9, pitch: 76, bearing: 285 }
};

export function flyPreset(map, name) {
  const c = CAMERAS[name] || CAMERAS.wide;
  map.flyTo({ ...c, duration: 2600, essential: true });
}

/** Orbita lenta attorno alla vetta. Ritorna la funzione per fermarla. */
export function startOrbit(map, onStop) {
  let raf, stopped = false;
  map.flyTo({ center: [SUMMIT.lon, SUMMIT.lat], zoom: 13.2, pitch: 72, duration: 1800 });
  const step = () => {
    if (stopped) return;
    map.setBearing((map.getBearing() + 0.12) % 360);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  const stop = () => { stopped = true; cancelAnimationFrame(raf); onStop?.(); };
  ['mousedown', 'touchstart', 'wheel'].forEach((ev) => map.getCanvas().addEventListener(ev, stop, { once: true }));
  return stop;
}

// ------------------------------------------------------------- marker HTML

/** Marker leggero e senza dipendenza dai glyph di MapLibre. */
export function makeMarker(map, { lon, lat, label, sub, cls, onClick }) {
  const el = document.createElement('div');
  el.className = `mk ${cls || ''}`;
  el.innerHTML = `<i></i><b>${label}</b>${sub ? `<u>${sub}</u>` : ''}`;
  if (onClick) el.addEventListener('click', onClick);
  return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).addTo(map);
}

