// Modello altimetrico locale, scaricato una volta e tenuto in memoria.
//
// Serve per una cosa che nessuna API pubblica offre: sapere dove scorrerebbe
// la lava. La lava non si inventa un percorso, segue la pendenza — quindi con
// le quote reali si può calcolare la linea di massima discesa da una bocca.
//
// Le tile sono in codifica "terrarium": quota = (R*256 + G + B/256) - 32768.

import { SOURCES, LAVA_DEM } from './config.js';

const TILE = 256;

export class DEM {
  constructor({ zoom = LAVA_DEM.zoom, bbox = LAVA_DEM.bbox } = {}) {
    this.zoom = zoom;
    this.bbox = bbox;
    this.tiles = new Map();   // "x,y" -> Float32Array(256*256)
    this.ready = false;
  }

  /** Scarica e decodifica le tile che coprono il riquadro. */
  async load() {
    const n = 2 ** this.zoom;
    const [w, s, e, nLat] = this.bbox;
    const x0 = Math.floor(lon2t(w, n)), x1 = Math.floor(lon2t(e, n));
    const y0 = Math.floor(lat2t(nLat, n)), y1 = Math.floor(lat2t(s, n));

    const jobs = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) jobs.push(this.#loadTile(x, y));
    }
    const done = await Promise.allSettled(jobs);
    this.ready = done.some((d) => d.status === 'fulfilled');
    return { tiles: this.tiles.size, failed: done.filter((d) => d.status === 'rejected').length };
  }

  async #loadTile(x, y) {
    const url = SOURCES.dem
      .replace('{z}', this.zoom).replace('{x}', x).replace('{y}', y);

    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';   // le tile AWS mandano Access-Control-Allow-Origin
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`tile DEM ${x}/${y}`));
      i.src = url;
    });

    const cv = document.createElement('canvas');
    cv.width = cv.height = TILE;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, TILE, TILE).data;

    const grid = new Float32Array(TILE * TILE);
    for (let i = 0, p = 0; i < grid.length; i++, p += 4) {
      grid[i] = px[p] * 256 + px[p + 1] + px[p + 2] / 256 - 32768;
    }
    this.tiles.set(`${x},${y}`, grid);
  }

  /** Quota in metri, o NaN se fuori dalle tile caricate. */
  elevationAt(lon, lat) {
    const n = 2 ** this.zoom;
    const fx = lon2t(lon, n), fy = lat2t(lat, n);
    const tx = Math.floor(fx), ty = Math.floor(fy);
    const grid = this.tiles.get(`${tx},${ty}`);
    if (!grid) return NaN;
    const px = Math.min(TILE - 1, Math.floor((fx - tx) * TILE));
    const py = Math.min(TILE - 1, Math.floor((fy - ty) * TILE));
    return grid[py * TILE + px];
  }

  /** Quota da coordinate pixel globali della piramide di tile. */
  elevationAtPx(px, py) {
    const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
    const grid = this.tiles.get(`${tx},${ty}`);
    if (!grid) return NaN;
    return grid[(py - ty * TILE) * TILE + (px - tx * TILE)];
  }

  /**
   * Percorso che seguirebbe una colata guidata dalla sola topografia:
   * discesa ripida sulla griglia, e riempimento con tracimazione ogni volta
   * che incontra una conca.
   *
   * @returns {[number,number][]} coordinate [lon,lat], vuoto se non calcolabile
   */
  descentPath(lon, lat, { maxMeters = 9000, pond = 60, floodCells = 120000 } = {}) {
    if (!this.ready) return [];
    const n = 2 ** this.zoom;
    const mPerPx = (40075016.686 * Math.cos(lat * rad)) / (TILE * n);

    let px = Math.floor(lon2t(lon, n) * TILE);
    let py = Math.floor(lat2t(lat, n) * TILE);
    let ele = this.elevationAtPx(px, py);
    if (!Number.isFinite(ele)) return [];

    const pathPx = [[px, py]];
    let travelled = 0;

    while (travelled < maxMeters) {
      // Discesa ripida sugli otto vicini.
      let bx = px, by = py, bEle = ele, diag = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const e = this.elevationAtPx(px + dx, py + dy);
          if (!Number.isFinite(e) || e >= bEle) continue;
          bEle = e; bx = px + dx; by = py + dy; diag = dx !== 0 && dy !== 0;
        }
      }

      if (bx !== px || by !== py) {
        travelled += mPerPx * (diag ? Math.SQRT2 : 1);
        px = bx; py = by; ele = bEle;
        pathPx.push([px, py]);
        continue;
      }

      // Nessun vicino più basso: si è in una conca. Una colata vera la riempie
      // e trabocca dal punto di sfioro. Cercarlo passo per passo non funziona
      // (il fronte finisce per girare in tondo nel catino): serve espandere il
      // "lago" partendo sempre dalla cella di bordo più bassa, finché non se
      // ne trova una sotto il livello del fondo. È lì che la colata esce.
      const spill = this.#findSpill(px, py, ele, pond, floodCells);
      if (!spill) break;

      for (const [sx, sy] of spill.path) {
        const prev = pathPx[pathPx.length - 1];
        travelled += mPerPx * ((sx !== prev[0] && sy !== prev[1]) ? Math.SQRT2 : 1);
        pathPx.push([sx, sy]);
      }
      px = spill.px; py = spill.py; ele = spill.ele;
    }

    if (pathPx.length < 3) return [];
    return pathPx.map(([x, y]) => [pxToLon(x, n), pyToLat(y, n)]);
  }

  /**
   * Punto di sfioro di una conca (priority flood): si allarga il fronte
   * partendo sempre dalla cella più bassa vista finora. La prima cella
   * più bassa del fondo è lo sfioro; se il livello sale oltre `pond` metri
   * sopra il fondo, la conca è troppo profonda e la colata si ferma lì.
   */
  #findSpill(px, py, pitEle, pond, maxCells) {
    const heap = new MinHeap();
    const parent = new Map();
    const key = (x, y) => x * 1e7 + y;

    heap.push({ x: px, y: py, ele: pitEle });
    parent.set(key(px, py), null);

    while (heap.size() && parent.size < maxCells) {
      const c = heap.pop();

      if (c.ele < pitEle - 0.05) {
        // Ricostruzione del cammino dal fondo fino allo sfioro.
        const path = [];
        let k = key(c.x, c.y), cx = c.x, cy = c.y;
        while (parent.get(k) !== null && parent.get(k) !== undefined) {
          path.push([cx, cy]);
          const p = parent.get(k);
          cx = p[0]; cy = p[1]; k = key(cx, cy);
        }
        path.reverse();
        return { px: c.x, py: c.y, ele: c.ele, path };
      }
      if (c.ele > pitEle + pond) return null;

      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const nx = c.x + dx, ny = c.y + dy, nk = key(nx, ny);
          if (parent.has(nk)) continue;
          const e = this.elevationAtPx(nx, ny);
          if (!Number.isFinite(e)) continue;
          parent.set(nk, [c.x, c.y]);
          heap.push({ x: nx, y: ny, ele: e });
        }
      }
    }
    return null;
  }
}

// --------------------------------------------------------------- geometria
const rad = Math.PI / 180, deg = 180 / Math.PI;

const lon2t = (lon, n) => ((lon + 180) / 360) * n;
const lat2t = (lat, n) => {
  const r = lat * rad;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};
const pxToLon = (px, n) => (px / (TILE * n)) * 360 - 180;
const pyToLat = (py, n) => {
  const t = Math.PI * (1 - 2 * (py / (TILE * n)));
  return deg * Math.atan(Math.sinh(t));
};

/** Coda di priorità minima: il flood deve sempre ripartire dalla cella più bassa. */
class MinHeap {
  constructor() { this.a = []; }
  size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].ele <= a[i].ele) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (!a.length) return top;
    a[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < a.length && a[l].ele < a[m].ele) m = l;
      if (r < a.length && a[r].ele < a[m].ele) m = r;
      if (m === i) break;
      [a[m], a[i]] = [a[i], a[m]]; i = m;
    }
    return top;
  }
}


