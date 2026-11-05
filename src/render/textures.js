import * as THREE from './three.js';
import { mulberry32, fbm } from '../sim/noise.js';

function canvasTex(w, h, draw, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// Seamlessly tiling value noise: lattice coordinates wrap at `period`.
function hash2(ix, iy, seed) { let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function tileNoise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y); const fx = x - x0, fy = y - y0; const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const w = (i) => ((i % period) + period) % period;
  const a = hash2(w(x0), w(y0), seed), b = hash2(w(x0 + 1), w(y0), seed), c = hash2(w(x0), w(y0 + 1), seed), d = hash2(w(x0 + 1), w(y0 + 1), seed);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}

/** Neutral (near-white) tileable noise texture, tinted by vertex colours. */
export function detailTexture(seed = 1, strength = 0.22) {
  return canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let n = 0, amp = 0.5, norm = 0;
      for (const per of [8, 16, 32, 64, 128]) { n += amp * tileNoise(x / w * per, y / h * per, per, seed + per); norm += amp; amp *= 0.62; }
      n /= norm;
      const v = 1 - strength + (n - 0.5) * strength * 2.6;
      const i = (y * w + x) * 4; const c = Math.max(0, Math.min(255, v * 255));
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}

export function ballastTexture() {
  return canvasTex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#6d6a66'; ctx.fillRect(0, 0, w, h);
    const r = mulberry32(5);
    for (let i = 0; i < 5200; i++) {
      const x = r() * w, y = r() * h, s = 1 + r() * 2.6, v = 70 + r() * 110;
      ctx.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
      ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.7, r() * 3, 0, 7); ctx.fill();
    }
  });
}

export function concreteTexture(base = '#b9b8b3', seed = 3) {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    const r = mulberry32(seed);
    for (let i = 0; i < 1400; i++) { const v = r() * 40 - 20; ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 120})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
  });
}

export function waterNormalTexture() {
  const size = 256;
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const a = (x / size) * Math.PI * 2, b = (y / size) * Math.PI * 2;
    hgt[y * size + x] = fbm(Math.cos(a) * 3 + 5, Math.sin(a) * 3 + Math.cos(b) * 3, 9, 4) + 0.5 * fbm(Math.sin(b) * 6, Math.cos(a) * 6 + Math.cos(b) * 6, 12, 3);
  }
  const t = canvasTex(size, size, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const h = (xx, yy) => hgt[((yy + size) % size) * size + ((xx + size) % size)];
      const dx = (h(x + 1, y) - h(x - 1, y)) * 4, dy = (h(x, y + 1) - h(x, y - 1)) * 4;
      const l = Math.hypot(dx, dy, 1); const i = (y * w + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { srgb: false });
  return t;
}

export function glowTexture() {
  return canvasTex(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, { repeat: false });
}

export function cloudTexture(seed = 4) {
  return canvasTex(256, 256, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / (w / 2), dy = (y - h / 2) / (h / 2); const d = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(x / 38, y / 38, seed, 5);
      const a = Math.max(0, Math.min(1, (1 - d) * 1.6 - 0.35 + (n - 0.5) * 1.2));
      const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * a * 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { repeat: false });
}

export function textTexture(lines, { w = 512, h = 128, bg = '#12315f', fg = '#fff', font = 'bold 56px system-ui, sans-serif', border = '#fff' } = {}) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (border) { ctx.strokeStyle = border; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12); }
    ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const arr = Array.isArray(lines) ? lines : [lines];
    arr.forEach((t, i) => ctx.fillText(t, w / 2, h * (i + 1) / (arr.length + 1)));
  }, { repeat: false });
}

export function speedSignTexture(kmh, tsr = false) {
  return canvasTex(128, 128, (ctx) => {
    ctx.fillStyle = tsr ? '#ffd400' : '#fff'; ctx.beginPath(); ctx.arc(64, 64, 62, 0, 7); ctx.fill();
    ctx.strokeStyle = '#d4141c'; ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(64, 64, 54, 0, 7); ctx.stroke();
    ctx.fillStyle = '#111'; ctx.font = `bold ${kmh >= 100 ? 54 : 64}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(kmh), 64, 68);
  }, { repeat: false });
}

export function houseTexture() {
  return canvasTex(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#3a4b5e';
    for (const x of [18, 80]) { ctx.fillRect(x, 22, 30, 36); ctx.fillStyle = '#c9d6e3'; ctx.fillRect(x + 2, 24, 26, 15); ctx.fillStyle = '#3a4b5e'; ctx.fillRect(x + 14, 22, 2, 36); }
    ctx.fillStyle = '#5a3d28'; ctx.fillRect(52, 70, 24, 58);
    ctx.fillStyle = '#9aa0a8'; ctx.fillRect(0, 118, w, 10);
  });
}
