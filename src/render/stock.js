// Procedural Indian Railways rolling stock: WAP-7 / WAP-7HS electric locomotives, WDP-4D diesel, LHB and ICF coaches.
// Everything is built from a few merged geometries that share one texture atlas each (livery, windows, doors,
// louvres painted on canvas) so a whole 16-coach rake is drawn with a handful of draw calls via instancing.
import * as THREE from './three.js';

const ATLAS_W = 2048, ATLAS_H = 512;
export const SIDE_W = 1800, SIDE_H = 384;           // livery strip region of the atlas (px)
const px = (x, y) => [x / ATLAS_W, 1 - y / ATLAS_H];  // canvas pixel -> uv (flipY)

// Solid colour swatches live in a strip below the livery so flat parts can sample a single texel.
const SWATCH = { roof: 0, under: 1, rubber: 2, steel: 3, white: 4, blue: 5, red: 6, glass: 7, black: 8, yellow: 9, silver: 10 };
const SW_COLORS = ['#8a9099', '#1b1e23', '#15171a', '#9aa1aa', '#f1f3f5', '#1c4f9c', '#b3201a', '#0c141c', '#0a0a0a', '#f0b400', '#b9bec6'];
const swUV = (name) => px(16 + SWATCH[name] * 40 + 20, 460 + 20);
function drawSwatches(ctx) { SW_COLORS.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(16 + i * 40, 460, 40, 40); }); }

function makeAtlas(draw, emissiveDraw) {
  const mk = (fn, black) => {
    const c = document.createElement('canvas'); c.width = ATLAS_W; c.height = ATLAS_H; const ctx = c.getContext('2d');
    if (black) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H); } fn(ctx);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
  };
  return { map: mk((ctx) => { draw(ctx); drawSwatches(ctx); }, false), emissive: mk(emissiveDraw, true) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry builder: lofted cross-section with per-segment UVs, smooth normals where the profile is smooth.
class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.idx = []; }
  quad(a, b, c, d, na, nb, nc, nd, uvA, uvB, uvC, uvD) {     // a,b along one edge, c,d the opposite edge (a-c, b-d connect)
    const i = this.pos.length / 3;
    for (const [p, n, t] of [[a, na, uvA], [b, nb, uvB], [c, nc, uvC], [d, nd, uvD]]) { this.pos.push(...p); this.nor.push(...n); this.uv.push(...t); }
    this.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  /** Axis-aligned box [x0,x1]x[y0,y1]x[z0,z1] with every face mapped to one swatch texel (or a uv rect function). */
  box(x0, x1, y0, y1, z0, z1, swatch, faces) {
    const t = swUV(swatch), P = (x, y, z) => [x, y, z];
    const F = [
      [[x1, y0, z1], [x1, y0, z0], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], 'px'], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], 'nx'],
      [[x0, y1, z1], [x1, y1, z1], [x0, y1, z0], [x1, y1, z0], [0, 1, 0], 'py'], [[x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1], [0, -1, 0], 'ny'],
      [[x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], 'pz'], [[x1, y0, z0], [x0, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], 'nz'],
    ];
    for (const [a, b, c, d, n, key] of F) { const uv = faces && faces[key]; if (uv === false) continue; const q = uv || [t, t, t, t]; this.quad(a, b, c, d, n, n, n, n, q[0], q[1], q[2], q[3]); }
  }
  cyl(cx, cy, cz, r, len, axis, swatch, seg = 10) {   // cylinder along x or z
    const t = swUV(swatch);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), h = len / 2;
      const pt = (c, s, k) => (axis === 'x' ? [cx + k * h, cy + c * r, cz + s * r] : [cx + c * r, cy + s * r, cz + k * h]);
      const nn = (c, s) => (axis === 'x' ? [0, c, s] : [c, s, 0]);
      this.quad(pt(c0, s0, -1), pt(c1, s1, -1), pt(c0, s0, 1), pt(c1, s1, 1), nn(c0, s0), nn(c1, s1), nn(c0, s0), nn(c1, s1), t, t, t, t);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx); g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
}

/** Loft a closed profile along z in [-L/2, L/2]. seg(j) -> {kind:'side'|'swatch', swatch, side:+1/-1} ; side walls get livery UVs. */
function loft(builder, profile, L, side0, sideRect, swatchFor, taperFront = null) {
  const n = profile.length; const norms = [];
  for (let j = 0; j < n; j++) { const a = profile[j], b = profile[(j + 1) % n]; const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; norms.push([dy / l, -dx / l]); }
  const vn = (j, end) => {   // smoothed normal at the start (end=0) or end (end=1) of segment j
    const nj = norms[j], nb = norms[(j + (end ? 1 : n - 1)) % n]; const dot = nj[0] * nb[0] + nj[1] * nb[1];
    if (dot > 0.82) { const x = nj[0] + nb[0], y = nj[1] + nb[1], l = Math.hypot(x, y); return [x / l, y / l, 0]; } return [nj[0], nj[1], 0];
  };
  for (let j = 0; j < n; j++) {
    const a = profile[j], b = profile[(j + 1) % n]; const s = swatchFor(j, a, b);
    const n0 = vn(j, 0), n1 = vn(j, 1); const z0 = -L / 2, z1 = L / 2;
    let uvs;
    if (s.livery) {   // vertical wall: u along the body, v along height
      const { x0, y0, x1, y1 } = sideRect; const flip = s.livery < 0;
      const vA = (a[1] - s.y0) / (s.y1 - s.y0), vB = (b[1] - s.y0) / (s.y1 - s.y0);
      const uz0 = flip ? x1 : x0, uz1 = flip ? x0 : x1;
      const P = (u, v) => px(u, y1 - v * (y1 - y0));
      uvs = [P(uz0, vA), P(uz0, vB), P(uz1, vA), P(uz1, vB)];
    } else { const t = swUV(s.swatch); uvs = [t, t, t, t]; }
    builder.quad([a[0], a[1], z0], [b[0], b[1], z0], [a[0], a[1], z1], [b[0], b[1], z1], [...n0.slice(0, 2), 0], [...n1.slice(0, 2), 0], [...n0.slice(0, 2), 0], [...n1.slice(0, 2), 0], ...uvs);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// COACHES
function coachProfile(w, shoulder, roof) {
  const hw = w / 2, pts = [[-hw + 0.25, 0.55], [hw - 0.25, 0.55], [hw, 0.8], [hw, shoulder]];
  for (let i = 1; i <= 7; i++) { const a = (Math.PI / 2) * (i / 7); pts.push([hw - (hw - 0.55) * (1 - Math.cos(a)), shoulder + (roof - shoulder) * Math.sin(a)]); }
  pts.push([0, roof]);
  for (let i = 7; i >= 1; i--) { const a = (Math.PI / 2) * (i / 7); pts.push([-(hw - (hw - 0.55) * (1 - Math.cos(a))), shoulder + (roof - shoulder) * Math.sin(a)]); }
  pts.push([-hw, shoulder], [-hw, 0.8]);
  return pts;
}

function drawCoachSide(ctx, kind, L) {
  const W = SIDE_W, H = SIDE_H, mx = (m) => (m / L) * W;       // metres along the body -> px
  const wallY0 = 0.8, wallY1 = 3.2, my = (y) => H - ((y - wallY0) / (wallY1 - wallY0)) * H;   // rail-relative height -> px
  const body = kind === 'icf' ? '#1f58a8' : '#1c4f9c';
  ctx.fillStyle = body; ctx.fillRect(0, 0, W, H);
  // lower skirt panel
  ctx.fillStyle = '#16396f'; ctx.fillRect(0, my(1.05), W, my(0.8) - my(1.05));
  // white and yellow stripes (Indian Railways passenger livery)
  ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0, my(1.62), W, my(1.5) - my(1.62));
  ctx.fillStyle = kind === 'icf' ? '#f2f4f6' : '#f0b400'; ctx.fillRect(0, my(3.14), W, my(3.07) - my(3.14));
  if (kind === 'icf') { ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0, my(2.86), W, my(2.78) - my(2.86)); }
  // windows
  const pitch = kind === 'icf' ? 1.55 : 1.52, winW = kind === 'icf' ? 0.95 : 1.12, y0 = 1.9, y1 = 2.92; let n = Math.floor((L - 4.4) / pitch);
  const startX = (L - (n - 1) * pitch) / 2;
  for (let i = 0; i < n; i++) {
    const cx = mx(startX + i * pitch), ww = mx(winW) / 2;
    ctx.fillStyle = '#e9edf2'; ctx.fillRect(cx - ww - 5, my(y1) - 5, ww * 2 + 10, my(y0) - my(y1) + 10);          // frame
    ctx.fillStyle = '#0c141c'; ctx.fillRect(cx - ww, my(y1), ww * 2, my(y0) - my(y1));                         // glass
    ctx.fillStyle = 'rgba(120,150,180,0.28)'; ctx.fillRect(cx - ww, my(y1), ww * 2, (my(y0) - my(y1)) * 0.35); // reflection
    if (kind === 'icf') { ctx.fillStyle = '#9aa1aa'; for (let b = 1; b < 4; b++) ctx.fillRect(cx - ww + b * (ww * 2 / 4) - 1.5, my(y1), 3, my(y0) - my(y1)); }   // window bars
  }
  // doors at both ends
  for (const dx of [1.05, L - 1.05]) {
    const cx = mx(dx), ww = mx(0.55); ctx.fillStyle = '#d8dde3'; ctx.fillRect(cx - ww - 4, my(2.95) - 4, ww * 2 + 8, my(0.95) - my(2.95) + 8);
    ctx.fillStyle = '#1a4a8e'; ctx.fillRect(cx - ww, my(2.9), ww * 2, my(1.0) - my(2.9)); ctx.fillStyle = '#0c141c'; ctx.fillRect(cx - ww * 0.55, my(2.7), ww * 1.1, my(2.05) - my(2.7));
    ctx.fillStyle = '#c9ced4'; ctx.fillRect(cx + ww * 0.6, my(1.9), 5, 26);                                   // handle
  }
  // IR monogram + class marker
  ctx.fillStyle = '#f2f4f6'; ctx.font = 'bold 22px system-ui, Arial, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('INDIAN RAILWAYS', W / 2, my(1.17)); ctx.font = 'bold 28px system-ui, Arial, sans-serif'; ctx.fillText(kind === 'icf' ? 'S L R' : 'B 2', W * 0.18, my(1.17));
}
function drawCoachEmissive(ctx, kind, L) {
  const W = SIDE_W, H = SIDE_H, mx = (m) => (m / L) * W, wallY0 = 0.8, wallY1 = 3.2, my = (y) => H - ((y - wallY0) / (wallY1 - wallY0)) * H;
  const pitch = kind === 'icf' ? 1.55 : 1.52, winW = kind === 'icf' ? 0.95 : 1.12, n = Math.floor((L - 4.4) / pitch), startX = (L - (n - 1) * pitch) / 2;
  ctx.fillStyle = '#ffd89a'; for (let i = 0; i < n; i++) { const cx = mx(startX + i * pitch), ww = mx(winW) / 2; ctx.fillRect(cx - ww, my(2.92), ww * 2, my(1.9) - my(2.92)); }
}

const coachCache = {};
export function getCoachAsset(kind) {
  if (coachCache[kind]) return coachCache[kind];
  const L = kind === 'icf' ? 21.77 : 23.54, width = kind === 'icf' ? 3.25 : 3.24, roof = kind === 'icf' ? 3.9 : 3.95;
  const atlas = makeAtlas((ctx) => { ctx.fillStyle = '#888'; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H); ctx.save(); drawCoachSide(ctx, kind, L); ctx.restore(); }, (ctx) => drawCoachEmissive(ctx, kind, L));
  const b = new Builder(); const prof = coachProfile(width, 3.2, roof);
  const sideRectR = { x0: 0, y0: 0, x1: SIDE_W, y1: SIDE_H };
  loft(b, prof, L, 0, sideRectR, (j, a, c) => {
    const vertical = Math.abs(a[0] - c[0]) < 1e-6 && Math.abs(a[1] - c[1]) > 0.5;
    if (vertical && a[0] > 0) return { livery: -1, y0: 0.8, y1: 3.2 };
    if (vertical && a[0] < 0) return { livery: 1, y0: 0.8, y1: 3.2 };
    const low = a[1] < 0.9 && c[1] < 0.9; return { swatch: low ? 'under' : 'roof' };
  });
  // end caps (dark, with a gangway diaphragm)
  const hw = width / 2;
  for (const zs of [-1, 1]) {
    const z = zs * L / 2, t = swUV('rubber'), nrm = [0, 0, zs];
    const ring = prof.map((p) => [p[0], p[1], z]);
    for (let j = 1; j < ring.length - 1; j++) { const A = ring[0], B = ring[j], C = ring[j + 1]; if (zs > 0) b.quad(A, B, A, C, nrm, nrm, nrm, nrm, t, t, t, t); else b.quad(A, C, A, B, nrm, nrm, nrm, nrm, t, t, t, t); }
    b.box(-1.1, 1.1, 0.9, 3.35, z + zs * 0.0, z + zs * 0.55, 'rubber');            // gangway bellows
    b.box(-0.95, -0.85, 0.7, 0.95, z + zs * 0.0, z + zs * 0.5, 'black'); b.box(0.85, 0.95, 0.7, 0.95, z + zs * 0.0, z + zs * 0.5, 'black');   // buffer stems
  }
  // roof equipment: AC package units + vents
  if (kind === 'lhb') { b.box(-0.8, 0.8, roof - 0.12, roof + 0.2, -L / 2 + 2.6, -L / 2 + 5.6, 'silver'); b.box(-0.8, 0.8, roof - 0.12, roof + 0.2, L / 2 - 5.6, L / 2 - 2.6, 'silver'); }
  else { for (const z of [-5, -1, 3, 7]) b.cyl(0, roof + 0.05, z, 0.25, 0.3, 'z', 'steel', 8); }
  // underframe equipment (tanks, brake gear)
  b.box(-1.0, 1.0, 0.35, 0.8, -L / 2 + 5, -L / 2 + 8, 'under'); b.box(-1.0, 1.0, 0.35, 0.8, L / 2 - 8, L / 2 - 5, 'under'); b.box(-0.8, 0.8, 0.45, 0.8, -2, 2, 'under');
  const geo = b.geometry();
  const mat = new THREE.MeshStandardMaterial({ map: atlas.map, emissiveMap: atlas.emissive, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.42, metalness: 0.35 });
  coachCache[kind] = { geo, mat, length: L, width };
  return coachCache[kind];
}

// ---------------------------------------------------------------------------------------------------------------------------
// BOGIES (shared, instanced)
let bogieCache = null;
export function getBogieAssets() {
  if (bogieCache) return bogieCache;
  const mk = (long, axles) => {
    const b = new Builder(); const wb = axles > 2 ? 1.85 : 1.3;
    b.box(-0.95, 0.95, 0.42, 0.62, -long / 2, long / 2, 'steel'); b.box(-0.55, 0.55, 0.62, 0.8, -long / 2 + 0.3, long / 2 - 0.3, 'under');
    for (let a = 0; a < axles; a++) {
      const z = (a - (axles - 1) / 2) * wb; b.cyl(0, 0.46, z, 0.04, 1.9, 'x', 'steel', 6);
      for (const x of [-0.7175, 0.7175]) b.cyl(x, 0.46, z, 0.46, 0.1, 'x', 'black', 14);
      b.box(-0.95, -0.8, 0.35, 0.58, z - 0.18, z + 0.18, 'under'); b.box(0.8, 0.95, 0.35, 0.58, z - 0.18, z + 0.18, 'under');
    }
    b.box(-0.9, 0.9, 0.5, 0.64, -long / 2 + 0.2, -long / 2 + 0.5, 'silver'); b.box(-0.9, 0.9, 0.5, 0.64, long / 2 - 0.5, long / 2 - 0.2, 'silver');
    return b.geometry();
  };
  const atlas = makeAtlas((ctx) => { ctx.fillStyle = '#777'; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H); }, () => {});
  bogieCache = { coach: mk(2.6, 2), loco: mk(4.2, 3), mat: new THREE.MeshStandardMaterial({ map: atlas.map, roughness: 0.6, metalness: 0.5 }) };
  return bogieCache;
}

// ---------------------------------------------------------------------------------------------------------------------------
// LOCOMOTIVES
function drawLocoSide(ctx, spec, L) {
  const W = SIDE_W, H = SIDE_H, mx = (m) => (m / L) * W, wallY0 = 0.7, wallY1 = 3.6, my = (y) => H - ((y - wallY0) / (wallY1 - wallY0)) * H;
  const diesel = spec.kind === 'diesel';
  ctx.fillStyle = '#1c4f9c'; ctx.fillRect(0, 0, W, H);                         // blue body
  ctx.fillStyle = '#f2f4f6'; ctx.fillRect(0, my(2.55), W, my(2.1) - my(2.55));    // broad white band
  ctx.fillStyle = '#f0b400'; ctx.fillRect(0, my(2.06), W, my(2.0) - my(2.06));    // yellow pin-stripe
  ctx.fillStyle = '#15325f'; ctx.fillRect(0, my(1.1), W, my(0.7) - my(1.1));      // lower skirt
  // louvres (cooling grilles) in blocks
  const blocks = diesel ? [[3.0, 6.0], [7.0, 10.0], [11.2, 14.2]] : [[3.4, 6.4], [7.2, 10.2], [10.6, 13.6], [14.2, 17.0]];
  for (const [a, b2] of blocks) {
    ctx.fillStyle = '#0d1b33'; ctx.fillRect(mx(a), my(3.35), mx(b2) - mx(a), my(1.2) - my(3.35));
    ctx.fillStyle = '#2c4f86'; for (let y = 1.3; y < 3.3; y += 0.085) ctx.fillRect(mx(a) + 3, my(y), mx(b2) - mx(a) - 6, 3);
  }
  // cab side windows and doors at both ends
  for (const e of [0, 1]) {
    const x0 = e ? L - 2.5 : 0.35, wx = mx(x0), ww = mx(1.0);
    ctx.fillStyle = '#e9edf2'; ctx.fillRect(wx - 5, my(3.45) - 5, ww + 10, my(2.5) - my(3.45) + 10); ctx.fillStyle = '#0c141c'; ctx.fillRect(wx, my(3.45), ww, my(2.5) - my(3.45));
    const dx = mx(e ? L - 1.25 : 1.25) - 0; ctx.fillStyle = '#16396f'; ctx.fillRect(mx(e ? L - 1.15 : 0.15) , my(2.9), mx(0.95), my(1.15) - my(2.9));
  }
  // identity
  ctx.fillStyle = '#f2f4f6'; ctx.font = 'bold 34px system-ui, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(diesel ? 'WDP 4D' : (spec.id === 'wap7hs' ? 'WAP 7HS' : 'WAP 7'), W * 0.5, my(0.95));
  ctx.font = 'bold 26px system-ui, Arial, sans-serif'; ctx.fillText(diesel ? '40213' : '30239', W * 0.28, my(0.95)); ctx.fillText('INDIAN RAILWAYS', W * 0.74, my(0.95));
}
function drawLocoFront(ctx, spec) {   // front face art in the right-hand part of the atlas
  const x0 = 1840, y0 = 6, w = 200, h = 350;
  ctx.fillStyle = '#f2f4f6'; ctx.fillRect(x0, y0, w, h);                       // white nose
  ctx.fillStyle = '#1c4f9c'; ctx.fillRect(x0, y0 + h * 0.62, w, h * 0.38);     // blue lower face
  ctx.fillStyle = '#f0b400'; ctx.fillRect(x0, y0 + h * 0.60, w, 7);
  for (const wx of [x0 + 18, x0 + w / 2 + 8]) { ctx.fillStyle = '#e9edf2'; ctx.fillRect(wx - 4, y0 + 36, 72, 90); ctx.fillStyle = '#0c141c'; ctx.fillRect(wx, y0 + 40, 64, 82); ctx.fillStyle = 'rgba(120,150,180,0.3)'; ctx.fillRect(wx, y0 + 40, 64, 26); }
  ctx.fillStyle = '#15325f'; ctx.fillRect(x0 + 8, y0 + h * 0.70, w - 16, 20);   // number board
  ctx.fillStyle = '#f2f4f6'; ctx.font = 'bold 15px system-ui'; ctx.textAlign = 'center'; ctx.fillText(spec.kind === 'diesel' ? '40213' : '30239', x0 + w / 2, y0 + h * 0.70 + 16);
  ctx.fillStyle = '#1b1e23'; ctx.beginPath(); ctx.arc(x0 + w / 2, y0 + 18, 12, 0, 7); ctx.fill();   // headlight housing (the lamp itself is a separate emissive mesh)
}
function drawLocoEmissive() {}

const locoCache = {};
export function getLocoAsset(spec) {
  if (locoCache[spec.id]) return locoCache[spec.id];
  const L = spec.length, W = spec.width, diesel = spec.kind === 'diesel';
  const atlas = makeAtlas((ctx) => { ctx.fillStyle = '#888'; ctx.fillRect(0, 0, ATLAS_W, ATLAS_H); drawLocoSide(ctx, spec, L); drawLocoFront(ctx, spec); }, drawLocoEmissive);
  const b = new Builder(), hw = W / 2, H = diesel ? 4.1 : 4.25;
  const prof = [[-hw + 0.2, 0.7], [hw - 0.2, 0.7], [hw, 0.95], [hw, 3.55], [hw - 0.25, H - 0.3], [hw - 0.65, H], [-hw + 0.65, H], [-hw + 0.25, H - 0.3], [-hw, 3.55], [-hw, 0.95]];
  const sideRect = { x0: 0, y0: 0, x1: SIDE_W, y1: SIDE_H };
  loft(b, prof, L, 0, sideRect, (j, a, c) => {
    const vertical = Math.abs(a[0] - c[0]) < 1e-6 && Math.abs(a[1] - c[1]) > 0.5;
    if (vertical && a[0] > 0) return { livery: -1, y0: 0.7, y1: 3.6 }; if (vertical && a[0] < 0) return { livery: 1, y0: 0.7, y1: 3.6 };
    return { swatch: a[1] > 3.9 ? 'roof' : 'blue' };
  });
  // raked front/rear faces: windows and headlight art mapped from the atlas
  const front = (zs) => {
    const z = zs * L / 2, zTop = z - zs * 0.55, n = [0, 0.22 * -zs, -zs * 0.97].map((v) => v);
    const uvA = px(1840, 356), uvB = px(2040, 356), uvC = px(1840, 6), uvD = px(2040, 6);
    const nrm = [0, 0.1, zs]; const ex = zs > 0 ? [[-hw, 0.7, z], [hw, 0.7, z], [-hw, H - 0.2, zTop], [hw, H - 0.2, zTop]] : [[hw, 0.7, z], [-hw, 0.7, z], [hw, H - 0.2, zTop], [-hw, H - 0.2, zTop]];
    b.quad(ex[0], ex[1], ex[2], ex[3], nrm, nrm, nrm, nrm, uvA, uvB, uvC, uvD);
    b.box(-hw + 0.3, hw - 0.3, H - 0.25, H, Math.min(zTop, z) - (zs > 0 ? 0 : 0), Math.max(zTop, z), 'roof');
  };
  front(-1); front(1);
  // end details: buffers, coupler, cowcatcher plates, sand boxes
  for (const zs of [-1, 1]) {
    const z = zs * (L / 2 + 0.22);
    for (const x of [-0.95, 0.95]) { b.cyl(x, 0.95, z, 0.19, 0.5, 'z', 'steel', 10); b.box(x - 0.27, x + 0.27, 0.68, 1.22, zs * (L / 2 - 0.05), zs * (L / 2 + 0.02), 'black'); }
    b.box(-0.18, 0.18, 0.78, 1.02, zs * (L / 2 - 0.1), zs * (L / 2 + 0.35), 'black');
    b.box(-hw + 0.1, hw - 0.1, 0.45, 0.7, zs * (L / 2 - 0.3), zs * (L / 2 + 0.05), 'under');
  }
  // roof: pantographs (electric) / exhaust and radiator fans (diesel)
  const panto = (z) => {
    b.box(-0.9, 0.9, H, H + 0.14, z - 0.9, z + 0.9, 'black'); for (const x of [-0.8, 0.8]) b.box(x - 0.05, x + 0.05, H + 0.1, H + 0.35, z - 0.05, z + 0.05, 'silver');
    b.box(-0.04, 0.04, H + 0.3, H + 1.45, z - 0.5, z - 0.46, 'steel'); b.box(-0.04, 0.04, H + 0.3, H + 1.45, z + 0.46, z + 0.5, 'steel');
    b.box(-0.04, 0.04, H + 1.4, H + 1.5, z - 0.5, z + 0.5, 'steel'); b.box(-1.0, 1.0, H + 1.42, H + 1.52, z - 0.09, z + 0.09, 'black');
  };
  if (!diesel) { panto(-L * 0.25); panto(L * 0.25); b.box(-0.5, 0.5, H, H + 0.25, -2, 2, 'steel'); for (const z of [-L * 0.1, L * 0.1]) b.cyl(0, H + 0.1, z, 0.18, 0.5, 'x', 'silver', 8); }
  else { for (const z of [-6, 0, 5.5]) { b.cyl(0, H + 0.05, z, 0.8, 0.12, 'z', 'steel', 14); } b.box(-0.4, 0.4, H, H + 0.4, 7.5, 8.7, 'silver'); }
  const geo = b.geometry();
  const mat = new THREE.MeshStandardMaterial({ map: atlas.map, roughness: 0.42, metalness: 0.3 });
  locoCache[spec.id] = { geo, mat, length: L, width: W, height: H };
  return locoCache[spec.id];
}
