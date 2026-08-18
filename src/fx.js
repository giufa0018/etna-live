// Effetti animati su canvas, tutti guidati da dati reali.
//
//   pioggia / neve   dal meteo Open-Meteo
//   pennacchio       dal vento reale in quota, ancorato al cratere
//   braci            dal livello di attività ricavato dai punti caldi FIRMS
//   stelle, bagliore dall'ora e dalla posizione del sole
//
// Il pennacchio sta in aria e non a terra: una nube disegnata sul terreno si
// legge come una cicatrice, non come fumo. L'ancoraggio arriva da un marker
// invisibile, perché i marker di MapLibre seguono la quota del rilievo mentre
// map.project() lavorerebbe a quota zero.

import { clamp } from './util.js';

export class WeatherFX {
  constructor(canvas, map) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = map;
    this.enabled = true;
    this.showPlume = true;

    this.parts = [];      // pioggia o neve
    this.smoke = [];      // pennacchio
    this.embers = [];     // braci in eruzione
    this.stars = [];

    this.state = { mode: 'none', intensity: 0, windDeg: 0, windKmh: 0, night: false, cloud: 0, fogAmount: 0 };
    this.eruption = 0;    // 0–3
    this.getAnchor = null;
    this.lastEmit = 0;

    // L'attività esplosiva va a getti separati da pause, non a flusso
    // continuo: un pennacchio costante non somiglia a un vulcano.
    this.burst = { start: 0, end: 0, next: 0, peak: 0, power: 0 };

    this._resize = this.resize.bind(this);
    window.addEventListener('resize', this._resize);
    this.resize();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  /** @param {() => ({x:number,y:number}|null)} fn posizione a schermo del cratere */
  setAnchor(fn) { this.getAnchor = fn; }

  /** @param {number} level 0 quiete … 3 eruzione */
  setEruption(level) { this.eruption = clamp(level, 0, 3); }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.c.width = this.w * dpr;
    this.c.height = this.h * dpr;
    this.c.style.width = this.w + 'px';
    this.c.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.seedStars();
  }

  seedStars() {
    this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random() * this.w,
      y: Math.random() * this.h * 0.55,
      r: Math.random() * 1.1 + 0.25,
      p: Math.random() * Math.PI * 2
    }));
  }

  /** Aggiorna il tipo e l'intensità delle precipitazioni dalle condizioni correnti. */
  apply(weather, scene, summitFreezing) {
    const precip = weather?.precipitation ?? 0;
    const code = weather?.weather_code ?? 0;
    const snowing = (code >= 71 && code <= 77) || code === 85 || code === 86 ||
      (precip > 0 && (weather?.temperature_2m ?? 5) <= 1) || (precip > 0 && summitFreezing);

    let mode = 'none';
    if (precip > 0.02 || (code >= 51 && code <= 99)) mode = snowing ? 'snow' : 'rain';

    this.state = {
      mode,
      intensity: clamp(precip / 3, 0.12, 1),
      windDeg: weather?.wind_direction_10m ?? 0,
      windKmh: weather?.wind_speed_10m ?? 0,
      night: scene.night,
      cloud: scene.cloud,
      fogAmount: scene.fogAmount
    };
    this.seedParticles();
    this.paintVignette(scene);
  }

  seedParticles() {
    const { mode, intensity } = this.state;
    if (mode === 'none') { this.parts = []; return; }
    const n = Math.round((mode === 'snow' ? 130 : 260) * intensity) + 30;
    this.parts = Array.from({ length: n }, () => this.newPart(true));
  }

  newPart(spread = false) {
    const snow = this.state.mode === 'snow';
    return {
      x: Math.random() * (this.w + 300) - 150,
      y: spread ? Math.random() * this.h : -20,
      len: snow ? Math.random() * 2 + 1.4 : Math.random() * 14 + 8,
      spd: (snow ? 0.6 + Math.random() * 0.7 : 6 + Math.random() * 7) * (0.6 + this.state.intensity * 0.8),
      sway: Math.random() * Math.PI * 2,
      a: snow ? 0.45 + Math.random() * 0.45 : 0.18 + Math.random() * 0.3
    };
  }

  /** Direzione di deriva a schermo, ruotata con la bussola della mappa. */
  windVector() {
    const travel = (this.state.windDeg + 180) % 360;
    const screen = ((travel - (this.map?.getBearing?.() ?? 0)) * Math.PI) / 180;
    const strength = clamp(this.state.windKmh / 55, 0, 1.5);
    return {
      dx: Math.sin(screen) * strength,
      dy: -Math.cos(screen) * strength * 0.45,   // scorcio prospettico
      tiltPx: Math.sin(screen) * strength * 12,
      strength
    };
  }

  paintVignette(scene) {
    const v = document.getElementById('vignette');
    if (!v) return;
    const haze = clamp(scene.cloud * 0.5 + scene.fogAmount * 0.3, 0, 0.7);
    // In eruzione e di notte, il cielo sopra il cratere si arrossa davvero.
    const glow = this.eruption >= 2 && scene.night
      ? (this.eruption - 1) * 0.12 + this.burst.power * 0.14
      : 0;
    v.style.background =
      (glow ? `radial-gradient(50% 32% at 50% 34%, rgba(255,72,0,${glow.toFixed(3)}) 0%, transparent 70%),` : '') +
      `radial-gradient(120% 90% at 50% 8%, ${hexA(scene.horizon, haze * 0.5)} 0%, transparent 45%),` +
      `radial-gradient(130% 100% at 50% 100%, ${hexA(scene.fogColor, haze * 0.75)} 0%, transparent 60%),` +
      `radial-gradient(120% 90% at 50% 10%, transparent 38%, rgba(0,0,0,${scene.night ? 0.62 : 0.42}) 100%)`;
  }

  // ------------------------------------------------------------- emissione

  /**
   * Inviluppo del getto: salita rapida, coda che si spegne, poi pausa.
   * Più l'attività è alta, più i getti sono frequenti e ravvicinati.
   */
  updateBurst(ts) {
    const b = this.burst;
    if (this.eruption < 2) { b.power = 0; return; }

    if (ts >= b.end && ts >= b.next) {
      const strong = this.eruption >= 3;
      b.start = ts;
      b.end = ts + (strong ? 900 + Math.random() * 1500 : 600 + Math.random() * 900);
      b.next = b.end + (strong ? 600 + Math.random() * 2400 : 2200 + Math.random() * 4600);
      b.peak = 0.55 + Math.random() * 0.75;
    }

    if (ts >= b.start && ts < b.end) {
      const t = (ts - b.start) / (b.end - b.start);
      b.power = b.peak * Math.min(1, t / 0.12) * Math.pow(1 - t, 0.9);
    } else {
      b.power = 0;
    }
  }

  emit(anchor, wind, dt) {
    // Il pennacchio c'è sempre: l'Etna degassa anche da fermo. In eruzione
    // diventa più denso, più scuro e più veloce.
    if (this.showPlume) {
      const rate = 0.9 + this.eruption * 0.8 + this.burst.power * 4;
      if (Math.random() < rate * dt * 12) {
        const ash = this.eruption >= 2 ? Math.random() * 0.5 : 0;
        this.smoke.push({
          x: anchor.x + (Math.random() - 0.5) * 14,
          y: anchor.y + (Math.random() - 0.5) * 6,
          vx: wind.dx * (1.4 + Math.random()),
          vy: -(0.55 + Math.random() * 0.5) - this.eruption * 0.22,
          r: 6 + Math.random() * 8,
          grow: 0.22 + Math.random() * 0.3,
          life: 1,
          decay: 0.0022 + Math.random() * 0.0026,
          ash
        });
      }
    }

    // Le braci escono solo dentro un getto: fra un getto e l'altro il cratere
    // resta scuro, ed è proprio quell'alternanza a renderlo credibile.
    if (this.burst.power > 0.02) {
      const rate = this.burst.power * (this.eruption >= 3 ? 9 : 4);
      if (Math.random() < rate * dt * 30) {
        const spread = 0.5 + Math.random() * 1.6;
        this.embers.push({
          x: anchor.x + (Math.random() - 0.5) * 10,
          y: anchor.y,
          vx: (Math.random() - 0.5) * spread + wind.dx * 0.7,
          vy: -(1.6 + Math.random() * 2.6) * (0.7 + this.burst.power * 1.5),
          r: 0.9 + Math.random() * 1.7,
          life: 1,
          decay: 0.008 + Math.random() * 0.012
        });
      }
    }
  }

  // ------------------------------------------------------------- disegno

  loop(ts) {
    this.raf = requestAnimationFrame(this.loop);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.enabled || document.hidden) return;

    const dt = Math.min(0.05, (ts - this.lastEmit) / 1000 || 0.016);
    this.lastEmit = ts;
    const wind = this.windVector();
    const now = ts / 1000;

    if (this.state.night) this.drawStars(now);

    this.updateBurst(ts);
    const anchor = this.getAnchor?.();
    if (anchor && anchor.y > -200 && anchor.y < this.h + 200) this.emit(anchor, wind, dt);

    this.drawSmoke(ctx);
    this.drawEmbers(ctx);
    this.drawPrecip(ctx, wind, now);
  }

  drawStars(now) {
    const ctx = this.ctx;
    ctx.save();
    for (const s of this.stars) {
      ctx.globalAlpha = (0.45 + 0.55 * Math.sin(now * 1.4 + s.p)) * (1 - this.state.cloud) * 0.8;
      ctx.fillStyle = '#dce8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawSmoke(ctx) {
    ctx.save();
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const p = this.smoke[i];
      p.x += p.vx; p.y += p.vy; p.r += p.grow; p.life -= p.decay;
      p.vy *= 0.995;
      if (p.life <= 0) { this.smoke.splice(i, 1); continue; }

      const a = p.life * 0.3 * (1 - this.state.cloud * 0.35);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      const tone = p.ash ? `${Math.round(90 - p.ash * 50)}` : '225';
      g.addColorStop(0, `rgba(${tone},${tone},${p.ash ? tone : '235'},${a})`);
      g.addColorStop(1, `rgba(${tone},${tone},${tone},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (this.smoke.length > 400) this.smoke.splice(0, this.smoke.length - 400);
  }

  drawEmbers(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.embers.length - 1; i >= 0; i--) {
      const p = this.embers[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.075;              // ricadono
      p.vx *= 0.99;
      p.life -= p.decay;
      if (p.life <= 0) { this.embers.splice(i, 1); continue; }

      const a = clamp(p.life, 0, 1);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
      g.addColorStop(0, `rgba(255,246,214,${a})`);
      g.addColorStop(0.35, `rgba(255,138,0,${a * 0.8})`);
      g.addColorStop(1, 'rgba(255,61,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (this.embers.length > 300) this.embers.splice(0, this.embers.length - 300);
  }

  drawPrecip(ctx, wind, now) {
    const { mode } = this.state;
    if (mode === 'none' || !this.parts.length) return;
    const snow = mode === 'snow';
    ctx.save();
    ctx.lineCap = 'round';

    for (const p of this.parts) {
      p.y += p.spd * (snow ? 1.1 : 2.2);
      p.x += wind.dx * (snow ? 1.6 : 3.2) + (snow ? Math.sin(now * 1.2 + p.sway) * 0.5 : 0);

      if (p.y > this.h + 20 || p.x < -180 || p.x > this.w + 180) {
        Object.assign(p, this.newPart(false));
        continue;
      }

      ctx.globalAlpha = p.a;
      if (snow) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.len * 0.7, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = '#cfe2ff';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - wind.tiltPx * 0.55, p.y - p.len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this._resize);
  }
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
