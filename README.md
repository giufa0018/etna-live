# Etna Live

Mappa 3D dell'Etna che si aggiorna da sola: rilievo reale, anomalie termiche
(lava), sismicità INGV, pennacchio orientato dal vento vero, sentieri, punti da
cui guardarla e come arrivarci. Nessun framework, nessun passo di build: sono
file statici più una funzione serverless da venti righe.

```bash
git clone https://github.com/<utente>/etna-live.git
cd etna-live
node dev-proxy.mjs
# → http://localhost:5173
```

Nessuna dipendenza da installare: `npm install` non serve, il progetto non ne ha.
Serve solo Node 18 o superiore.

Serve un server perché la pagina usa i moduli ES: aprendo `index.html` con
`file://` il browser blocca gli import.

---

## Cosa mostra, e da dove viene ogni dato

| Livello | Fonte | Chiave | Aggiornamento |
|---|---|---|---|
| Rilievo 3D | Terrain Tiles (AWS Open Data), codifica terrarium | no | statico |
| Satellite | Esri World Imagery | no | statico |
| Mosaico giornaliero | NASA GIBS, VIIRS true color | no | 1 volta al giorno |
| Sismicità | INGV, servizio FDSN | no | 5 min |
| Meteo e vento | Open-Meteo | no | 10 min |
| Sentieri e punti panoramici | OpenStreetMap via Overpass | no | 24 h (in cache) |
| Anomalie termiche / lava | NASA FIRMS (VIIRS + MODIS) | **sì, gratuita** | 12 min |
| Grotte, rifugi, alberi monumentali | OpenStreetMap via Overpass | no | su richiesta |

Tutto tranne l'ultima riga funziona senza registrarsi da nessuna parte.

### Perché FIRMS ha bisogno di un passaggio in più

NASA FIRMS non manda gli header CORS, quindi il browser rifiuta la risposta
anche con una chiave valida. La soluzione non è aggirare il browser: è mettere
venti righe di proxy fra i due, che è anche il modo giusto di tenere la chiave
fuori dal codice pubblico.

La chiave si chiede qui — arriva per email in un minuto, è gratuita e senza
limiti pratici per un uso come questo:
<https://firms.modaps.eosdis.nasa.gov/api/map_key/>

In locale:

```bash
echo "FIRMS_MAP_KEY=la_tua_chiave" > .env
node dev-proxy.mjs
```

Senza chiave la pagina resta pienamente funzionante: il pannello Attività
spiega che il livello termico è spento, tutto il resto continua a girare.

---

## Metterla online

### Vercel (la via più corta)

`api/firms.mjs` è già una funzione serverless nel formato che Vercel si aspetta.

```bash
npx vercel
npx vercel env add FIRMS_MAP_KEY   # incolla la chiave, scegli tutti gli ambienti
npx vercel --prod
```

### Cloudflare Workers

```bash
npx wrangler secret put FIRMS_MAP_KEY
npx wrangler deploy
```

`wrangler.toml` serve i file statici tramite il binding `ASSETS` e instrada
`/api/firms` a `worker.mjs`.

### Netlify

Sposta `api/firms.mjs` in `netlify/functions/firms.mjs` adattando la firma alle
Netlify Functions, oppure tienilo com'è e usa un redirect verso un Worker.

### GitHub Pages e affini

Funziona, ma solo il sito statico: senza backend non c'è `/api/firms`, quindi
niente anomalie termiche. Tutto il resto sì.

---

## Com'è fatta

```
index.html            struttura e pannelli
assets/style.css      tutto lo stile
src/
  config.js           coordinate, crateri, punti curati, intervalli, endpoint
  util.js             geometria sferica, posizione del sole, cache, fetch
  map.js              scena MapLibre: terreno, livelli, cielo, pennacchio
  fx.js               pioggia/neve/foschia/stelle su canvas, dal meteo reale
  viewpoints.js       punteggio di visibilità e link "come arrivare"
  gpx.js              lettura GPX, lunghezza, dislivello, salvataggio locale
  ui.js               rendering dei pannelli (solo DOM)
  main.js             orchestrazione, scheduler, interazioni
  sources/            weather.js · quakes.js · thermal.js · osm.js
api/_core.mjs         scarico e normalizzazione FIRMS (condiviso)
api/firms.mjs         handler Vercel
worker.mjs            handler Cloudflare
dev-proxy.mjs         server locale: statici + /api/firms
```

### Dalla misura alla lava che scorre

Nessun ente pubblica i perimetri delle colate in tempo reale. Quello che si può
avere è *dove il suolo è caldo*; il resto va ricostruito, e la pagina tiene
separate le tre cose:

| | Cosa | Da dove |
|---|---|---|
| **Misurato** | dove il terreno è caldo, quanto, quando | NASA FIRMS, pixel da 375 m |
| **Derivato** | quali punti formano una stessa bocca | raggruppamento per vicinanza |
| **Simulato** | dove scorrerebbe la colata | massima discesa sul rilievo reale |

Il passaggio che cambia tutto è la **quota**: sopra i 1900 m l'Etna è roccia e
cenere, non c'è vegetazione che possa bruciare. Ad agosto in Sicilia tre quarti
dei punti caldi nel riquadro sono incendi agricoli, e senza questo filtro la
pagina annuncerebbe eruzioni ogni volta che brucia un campo. Gli incendi
restano visibili, ma in un rosso spento e senza alone.

Il percorso della colata esce da una griglia altimetrica scaricata a parte
(`src/dem.js`, tile terrarium decodificate a mano) su cui si calcola la linea di
massima discesa, con una tolleranza per le conche: la lava vera riempie gli
avvallamenti e riparte, un algoritmo ingenuo si incastra al primo pixel basso.

Le tre cose meno ovvie:

- **Il caricamento dei dati non aspetta la mappa.** MapLibre emette `load` solo
  dopo il primo disegno WebGL, che in una scheda aperta in secondo piano non
  avviene mai. I dati partono subito e vengono messi in coda finché la scena non
  è in grado di riceverli.
- **Il pennacchio è ricostruito, non osservato.** Fumo e braci sono particelle
  su canvas, ancorate al cratere da un marker invisibile — i marker di MapLibre
  seguono la quota del rilievo, `map.project()` lavorerebbe a quota zero. La
  deriva segue il vento reale; le braci escono a getti separati da pause,
  perché l'attività esplosiva non è un flusso costante.
- **Le animazioni seguono il meteo.** Pioggia e neve compaiono solo se
  Open-Meteo le riporta, inclinate dal vento vero rispetto alla bussola della
  mappa; il cielo, la nebbia e la direzione dell'ombreggiatura seguono la
  posizione del sole calcolata per il momento presente.

- **La camera non esce dall'Etna.** `maxBounds` e `minZoom` tengono la scena sul
  vulcano: allontanandosi si finirebbe a scaricare tile di mezza Sicilia per
  guardare un puntino.

## Personalizzare

Quasi tutto si tocca in `src/config.js`: aggiungere un punto di osservazione
significa aggiungere una riga a `VIEWPOINTS`; cambiare le frequenze significa
toccare `REFRESH_MIN`. Le tracce GPX si trascinano direttamente sulla pagina.

## Limiti da tenere presenti

- Le anomalie termiche sono passaggi satellitari: qualche ora di ritardo, e le
  nubi spesse le nascondono. Assenza di anomalie non significa assenza di lava.
- Il percorso della colata dice dove la lava scorrerebbe *per pendenza*. Una
  colata vera si autoargina, si sdoppia, si ferma: la linea è un indizio, non
  una previsione.
- Il rilievo si ferma a circa 30 m per pixel: le tile terrarium a z15 sono
  vuote, z14 è il vero limite pubblico. La griglia della simulazione lavora a
  z13, circa 19 m.
- Le quote dei crateri sono indicative: la morfologia sommitale cambia a ogni
  fase eruttiva.
- L'"indice di attività" è un numero di sintesi costruito qui dentro, comodo per
  vedere se qualcosa si muove. Non è una valutazione di pericolosità.
- Per decidere se salire valgono solo i bollettini
  [INGV — Osservatorio Etneo](https://www.ct.ingv.it/) e le regole del
  [Parco dell'Etna](https://www.parcoetna.it/). Sopra i 2900 m serve una guida
  alpina autorizzata.

## Licenze dei dati

OpenStreetMap (ODbL) · Esri World Imagery (termini Esri) · NASA FIRMS e GIBS
(pubblico dominio, con attribuzione) · INGV (CC BY 4.0) · Open-Meteo (CC BY 4.0)
· Terrain Tiles (fonti miste, vedi il registro AWS Open Data).

## Contribuire

Il progetto non ha build né dipendenze: si modifica un file, si ricarica la
pagina. Le cose più facili da migliorare:

- **Punti di osservazione** — una riga in `VIEWPOINTS` dentro `src/config.js`.
  Coordinate, quota, versante e una nota su come ci si arriva.
- **Soglie dell'attività** — `eruptionLevel()` in `src/lava.js`. Sono tarate a
  occhio su una fase eruttiva: se le trovi sbagliate, discutiamone in una issue.
- **Simulazione delle colate** — `descentPath()` in `src/dem.js`. Oggi è
  discesa ripida più riempimento delle conche; tiene conto della pendenza ma
  non della viscosità né dell'autoarginamento.

Se apri una pull request, di' quale delle tre categorie tocchi — misurato,
derivato o simulato. È la distinzione su cui si regge l'onestà della pagina.

## Nota sull'accuratezza

Questa pagina è divulgativa. Non è uno strumento di monitoraggio e non
sostituisce i bollettini dell'INGV — Osservatorio Etneo né le indicazioni della
Protezione Civile. Se stai decidendo se salire sull'Etna, guarda quelli.
