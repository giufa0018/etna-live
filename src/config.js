// Configurazione centrale. Tutto ciò che è "sintonizzabile" sta qui.

export const SUMMIT = { lon: 14.9934, lat: 37.7510, ele: 3357 };

// Riquadro di interesse: [ovest, sud, est, nord]
export const BBOX = [14.72, 37.52, 15.36, 38.00];
// Riquadro stretto attorno all'edificio vulcanico, per le query pesanti (sentieri)
export const BBOX_CORE = [14.88, 37.65, 15.13, 37.87];

// Crateri sommitali. Coordinate approssimate: la morfologia sommitale
// cambia a ogni fase eruttiva, quindi vanno intese come indicative.
export const CRATERS = [
  { name: 'Cratere di Nord-Est', short: 'NEC', lon: 14.9954, lat: 37.7548, ele: 3357 },
  { name: 'Voragine',            short: 'VOR', lon: 14.9932, lat: 37.7515, ele: 3280 },
  { name: 'Bocca Nuova',         short: 'BN',  lon: 14.9917, lat: 37.7508, ele: 3250 },
  { name: 'Cratere di Sud-Est',  short: 'SEC', lon: 15.0000, lat: 37.7472, ele: 3300 }
];

// Punti di osservazione curati. `ele` è la quota indicativa in metri.
// A questi si aggiungono in automatico i tourism=viewpoint di OpenStreetMap.
export const VIEWPOINTS = [
  { name: 'Rifugio Sapienza',        lon: 14.9994, lat: 37.6997, ele: 1910, side: 'Sud',   note: 'Base sud, funivia e bus 4x4. Parcheggio ampio.' },
  { name: 'Piano Provenzana',        lon: 15.0435, lat: 37.7967, ele: 1800, side: 'Nord',  note: 'Base nord da Linguaglossa. Colate del 2002 vicinissime.' },
  { name: 'Torre del Filosofo',      lon: 14.9986, lat: 37.7386, ele: 2920, side: 'Sud',   note: 'Solo con guida alpina autorizzata. Vista ravvicinata sui crateri.' },
  { name: 'Schiena dell’Asino', lon: 15.0128, lat: 37.7167, ele: 1900, side: 'SE',    note: 'Sentiero panoramico sulla Valle del Bove. Il balcone classico.' },
  { name: 'Monte Zoccolaro',         lon: 15.0561, lat: 37.7061, ele: 1739, side: 'SE',    note: 'Affaccio a picco sulla Valle del Bove. Sentiero breve e ripido.' },
  { name: 'Monte Nero degli Zappini',lon: 14.9800, lat: 37.7050, ele: 1750, side: 'SO',    note: 'Sentiero natura ad anello, poco affollato.' },
  { name: 'Piano Vetore',            lon: 14.9600, lat: 37.6900, ele: 1750, side: 'SO',    note: 'Radura con vista libera sul versante sud-ovest.' },
  { name: 'Belvedere di Milo',       lon: 15.1233, lat: 37.7233, ele: 720,  side: 'Est',   note: 'Vista frontale sulla Valle del Bove dal paese.' },
  { name: 'Zafferana Etnea',         lon: 15.1050, lat: 37.6903, ele: 574,  side: 'SE',    note: 'Facile da raggiungere, buona prospettiva serale.' },
  { name: 'Nicolosi',                lon: 15.0270, lat: 37.6150, ele: 700,  side: 'Sud',   note: 'Porta del versante sud, vista completa del cono.' },
  { name: 'Bronte',                  lon: 14.8320, lat: 37.7870, ele: 760,  side: 'Ovest', note: 'Versante occidentale, luce migliore al mattino.' },
  { name: 'Randazzo',                lon: 14.9500, lat: 37.8780, ele: 765,  side: 'Nord',  note: 'Vista da nord, spesso libera quando il sud è coperto.' },
  { name: 'Taormina',                lon: 15.2917, lat: 37.8519, ele: 200,  side: 'NE',    note: 'La cartolina classica: Etna oltre la costa. ~30 km.' },
  { name: 'Acireale',                lon: 15.1660, lat: 37.6120, ele: 160,  side: 'SE',    note: 'Vista da costa, ottima per i tramonti dietro il cono.' },
  { name: 'Catania — Piazza Duomo',  lon: 15.0873, lat: 37.5024, ele: 20,   side: 'Sud',   note: 'Città: si vede in fondo a via Etnea nelle giornate limpide.' }
];

// Indirizzo pubblico del sito. Serve al pulsante di condivisione: da
// localhost un link a localhost non lo aprirebbe nessuno, quindi si
// condivide questo, conservando la posizione della camera.
export const SITE_URL = 'https://giufa0018.github.io/etna-live/';

// Limiti della scena. Fuori di qui non si va: il soggetto è il vulcano, e
// lasciar vagare la camera per la Sicilia significa solo scaricare tile che
// non interessano a nessuno. Il riquadro è più largo del cono perché con la
// vista inclinata l'orizzonte deve restare pieno.
export const CAMERA_BOUNDS = [[14.55, 37.36], [15.60, 38.14]];
export const ZOOM_RANGE = { min: 10.4, max: 17.5 };

// Riquadro e zoom del modello altimetrico caricato per simulare le colate.
// z13 = circa 19 m per pixel su 25 tile: abbastanza fine da far infilare la
// colata nelle forre della Valle del Bove invece di scavalcarle.
// Oltre non si va: le tile terrarium a z15 sono vuote, z14 è il vero limite.
export const LAVA_DEM = {
  zoom: 13,
  bbox: [14.93, 37.69, 15.09, 37.81]
};

// Ogni quanti minuti si aggiorna ciascuna fonte.
export const REFRESH_MIN = {
  weather: 10,
  quakes: 5,
  thermal: 12,
  osm: 60 * 24
};

export const SOURCES = {
  // DEM terrarium (AWS Open Data / Mapzen). Nessuna chiave, CORS aperto.
  dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  demMaxZoom: 14,
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  // Mosaico giornaliero NASA GIBS (VIIRS true color) — nessuna chiave.
  gibs: (date) =>
    `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  ingv: 'https://webservices.ingv.it/fdsnws/event/1/query',
  openMeteo: 'https://api.open-meteo.com/v1/forecast',
  elevation: 'https://api.open-meteo.com/v1/elevation',
  overpass: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ],
  // Punti caldi FIRMS, due strade in ordine di preferenza:
  //  1. il proxy serverless, che interroga FIRMS in diretta (locale, Vercel,
  //     Cloudflare) e tiene la chiave lato server;
  //  2. un file statico depositato da GitHub Actions ogni quarto d'ora, che
  //     è l'unico modo di avere i dati su GitHub Pages, dove non gira nulla.
  // I percorsi sono relativi perché su Pages il sito vive in una sottocartella.
  firmsProxy: 'api/firms',
  firmsStatic: 'data/firms.json'
};

export const ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · ' +
  'Esri World Imagery · ' +
  '<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a> · ' +
  '<a href="https://terremoti.ingv.it/">INGV</a> · ' +
  '<a href="https://open-meteo.com/">Open-Meteo</a> · ' +
  '<a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>';
