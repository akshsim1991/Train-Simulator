import * as THREE from './three.js';
import { detailTexture, waterNormalTexture } from './textures.js';
import { hashRand } from './geom.js';
import { fbm } from '../sim/noise.js';

export const TILE = 200;
const LODS = [
  { max: 520, res: 40, trees: 150 },
  { max: 1200, res: 20, trees: 70 },
  { max: 2500, res: 10, trees: 0 },
];

// Authored in sRGB, converted to linear at load (vertex colours are interpreted as linear).
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const PALETTES = {
  coast: { low: lin([0.52, 0.60, 0.28]), high: lin([0.38, 0.50, 0.24]), rock: lin([0.50, 0.47, 0.43]), sand: lin([0.80, 0.74, 0.56]), snow: null, tree: 'broad' },
  valley: { low: lin([0.34, 0.50, 0.20]), high: lin([0.24, 0.38, 0.17]), rock: lin([0.46, 0.43, 0.38]), sand: lin([0.58, 0.52, 0.36]), snow: null, tree: 'mixed' },
  alpine: { low: lin([0.27, 0.40, 0.19]), high: lin([0.40, 0.41, 0.32]), rock: lin([0.50, 0.49, 0.48]), sand: lin([0.45, 0.43, 0.40]), snow: lin([0.95, 0.97, 1.0]), tree: 'conifer' },
};

function treeGeometries() {
  const mk = (parts) => {
    const gs = parts.map(([g, col, y]) => {
      const gg = g.clone(); gg.translate(0, y, 0);
      const n = gg.attributes.position.count; const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
      gg.setAttribute('color', new THREE.BufferAttribute(c, 3)); gg.deleteAttribute('uv');
      return gg.index ? gg.toNonIndexed() : gg;
    });
    return THREE.mergeGeometries(gs);
  };
  const trunk = new THREE.CylinderGeometry(0.25, 0.4, 3, 5);
  const conifer = mk([[trunk, [0.28, 0.2, 0.13], 1.5], [new THREE.ConeGeometry(2.6, 5, 7), [0.95, 0.95, 0.95], 5],
    [new THREE.ConeGeometry(2.0, 4.5, 7), [0.95, 0.95, 0.95], 7.6], [new THREE.ConeGeometry(1.3, 3.6, 7), [0.95, 0.95, 0.95], 10]]);
  const broad = mk([[trunk, [0.3, 0.22, 0.14], 1.5], [new THREE.IcosahedronGeometry(2.8, 0), [0.95, 0.95, 0.95], 5.2], [new THREE.IcosahedronGeometry(2.0, 0), [0.95, 0.95, 0.95], 7.4]]);
  return { conifer, broad };
}

export class Terrain {
  constructor(scene, route, quality, weather = 'clear') {
    this.scene = scene; this.route = route; this.quality = quality;
    this.snowAmount = weather === 'snow' ? 0.9 : 0; this.wetAmount = weather === 'rain' ? 1 : 0;
    this.pal = PALETTES[route.palette] || PALETTES.valley;
    this.tiles = new Map();
    this.queue = [];
    this.group = new THREE.Group(); scene.add(this.group);
    const tex = detailTexture(route.preset.seed, 0.14); tex.repeat.set(1, 1);
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.95, metalness: 0 });
    // world-space detail UVs scaled in geometry (uv = xz / 9)
    const tg = treeGeometries();
    this.treeGeo = tg;
    const trunkMatBase = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    this.treeMat = trunkMatBase;
    this.maxRadius = quality.radius;
    this.water = this._makeWater();
    this.lastCx = null; this.lastCz = null;
  }

  _makeWater() {
    const geo = new THREE.PlaneGeometry(8000, 8000, 1, 1); geo.rotateX(-Math.PI / 2);
    const nm = waterNormalTexture(); nm.repeat.set(120, 120);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d5a7a, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.88, normalMap: nm, normalScale: new THREE.Vector2(0.22, 0.22) });
    const m = new THREE.Mesh(geo, mat); m.position.y = this.route.seaLevel; m.receiveShadow = false; m.renderOrder = 1;
    this.scene.add(m); this.waterNormal = nm; return m;
  }

  heightAt(x, z) { return this.route.terrainHeight(x, z); }

  _color(h, slope, x, z, out) {
    const P = this.pal, R = this.route, sea = R.seaLevel;
    const n = fbm(x / 60, z / 60, 3, 3);
    let c = [0, 0, 0];
    const t = Math.max(0, Math.min(1, (h - sea) / (R.preset.amp * 1.4 + 40)));
    for (let i = 0; i < 3; i++) c[i] = P.low[i] * (1 - t) + P.high[i] * t;
    const k = 0.78 + n * 0.44; c = c.map((v) => v * k);
    if (!P.snow) { // patchwork of fields: darker pasture / paler hay
      const f = fbm(x / 240, z / 240, 31, 2), hay = Math.max(0, Math.min(1, (f - 0.54) / 0.03)), dark = Math.max(0, Math.min(1, (0.36 - f) / 0.03));
      const hayC = [0.50, 0.46, 0.18].map((v) => Math.pow(v, 2.2));
      for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - hay * 0.8) * (1 - dark * 0.3) + hayC[i] * hay * 0.8;
    }
    const rock = Math.max(0, Math.min(1, (slope - 0.55) / 0.5)); // slope in rise/run
    for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - rock) + P.rock[i] * rock * (0.85 + n * 0.3);
    const shore = Math.max(0, 1 - (h - sea) / 3.5);
    if (shore > 0) for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - shore) + P.sand[i] * shore;
    if (P.snow) {
      const snowLine = R.preset.minTrack + R.preset.amp * 0.75 + (n - 0.5) * 80;
      const sn = Math.max(0, Math.min(1, (h - snowLine) / 40)) * (1 - rock * 0.55);
      for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - sn) + P.snow[i] * sn;
    }
    if (this.snowAmount > 0) {
      const white = [0.86, 0.9, 0.96], k = this.snowAmount * (1 - rock * 0.55) * (0.85 + n * 0.3);
      for (let i = 0; i < 3; i++) c[i] = c[i] * (1 - k) + white[i] * k;
    }
    if (this.wetAmount > 0) for (let i = 0; i < 3; i++) c[i] *= 0.72;
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  }

  _buildTile(tx, tz, lod) {
    const L = LODS[lod], res = L.res, step = TILE / res;
    const x0 = tx * TILE, z0 = tz * TILE;
    const W = res + 3; // 1 cell padding on each side for normals
    const hgt = new Float32Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) hgt[j * W + i] = this.heightAt(x0 + (i - 1) * step, z0 + (j - 1) * step);
    const nv = (res + 1) * (res + 1);
    const skirt = (res + 1) * 4;
    const pos = new Float32Array((nv + skirt) * 3), nor = new Float32Array((nv + skirt) * 3), col = new Float32Array((nv + skirt) * 3), uv = new Float32Array((nv + skirt) * 2);
    const c = [0, 0, 0]; const H = (i, j) => hgt[(j + 1) * W + (i + 1)];
    for (let j = 0; j <= res; j++) for (let i = 0; i <= res; i++) {
      const v = j * (res + 1) + i; const x = x0 + i * step, z = z0 + j * step, h = H(i, j);
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step), dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const il = 1 / Math.hypot(dx, 1, dz);
      pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
      nor[v * 3] = -dx * il; nor[v * 3 + 1] = il; nor[v * 3 + 2] = -dz * il;
      this._color(h, Math.hypot(dx, dz), x, z, c); col[v * 3] = c[0]; col[v * 3 + 1] = c[1]; col[v * 3 + 2] = c[2];
      uv[v * 2] = x / 9; uv[v * 2 + 1] = z / 9;
    }
    const idx = [];
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const a = j * (res + 1) + i, b = a + 1, cc = a + res + 1, d = cc + 1;
      idx.push(a, cc, b, b, cc, d); // CCW from above
    }
    // skirts hide cracks between LODs
    let sv = nv;
    const edge = [[0, 0, 1, 0], [0, res, 1, 0], [0, 0, 0, 1], [res, 0, 0, 1]];
    for (const [ei, ej, di, dj] of edge) {
      const first = sv;
      for (let k = 0; k <= res; k++) {
        const i = ei + di * k, j = ej + dj * k; const v = j * (res + 1) + i;
        pos[sv * 3] = pos[v * 3]; pos[sv * 3 + 1] = pos[v * 3 + 1] - 14; pos[sv * 3 + 2] = pos[v * 3 + 2];
        nor[sv * 3] = nor[v * 3]; nor[sv * 3 + 1] = nor[v * 3 + 1]; nor[sv * 3 + 2] = nor[v * 3 + 2];
        col[sv * 3] = col[v * 3]; col[sv * 3 + 1] = col[v * 3 + 1]; col[sv * 3 + 2] = col[v * 3 + 2];
        uv[sv * 2] = uv[v * 2]; uv[sv * 2 + 1] = uv[v * 2 + 1]; sv++;
      }
      for (let k = 0; k < res; k++) {
        const i0 = ei + di * k, j0 = ej + dj * k, i1 = ei + di * (k + 1), j1 = ej + dj * (k + 1);
        const t0 = j0 * (res + 1) + i0, t1 = j1 * (res + 1) + i1, b0 = first + k, b1 = first + k + 1;
        idx.push(t0, b0, t1, t1, b0, b1, t0, t1, b0, t1, b1, b0); // double-sided
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeBoundingSphere(); g.computeBoundingBox();
    const mesh = new THREE.Mesh(g, this.material); mesh.receiveShadow = true; mesh.frustumCulled = true;
    const group = new THREE.Group(); group.add(mesh);
    if (L.trees > 0 && this.quality.trees) this._trees(group, tx, tz, L, hgt, W, step);
    return group;
  }

  _trees(group, tx, tz, L, hgt, W, step) {
    const R = this.route, x0 = tx * TILE, z0 = tz * TILE, pal = this.pal;
    const spacing = L.trees > 100 ? 8.5 : 13;
    const per = Math.floor(TILE / spacing);
    const mats = { conifer: [], broad: [] };
    const sea = R.seaLevel;
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const rx = hashRand(tx * 977 + i, tz * 613 + j, 1), rz = hashRand(tx * 977 + i, tz * 613 + j, 2);
      const x = x0 + (i + rx) * spacing, z = z0 + (j + rz) * spacing;
      const dens = fbm(x / 140, z / 140, 77, 3);
      if (dens < 0.46 + (R.palette === 'coast' ? 0.14 : 0)) continue;
      if (hashRand(i + tx * 31, j + tz * 17, 3) > (dens - 0.3) * 1.6) continue;
      const n = R.nearest(x, z, 26); if (n && n.d < (n.y < R.terrainHeight(x, z) - 6 ? 14 : 11)) continue;   // keep clear of track & cuttings
      const fi = (x - x0) / step + 1, fj = (z - z0) / step + 1;
      const h = hgt[Math.min(W - 1, Math.round(fj)) * W + Math.min(W - 1, Math.round(fi))];
      if (h < sea + 3) continue;
      const slopeX = (hgt[Math.round(fj) * W + Math.min(W - 1, Math.round(fi) + 1)] - hgt[Math.round(fj) * W + Math.max(0, Math.round(fi) - 1)]) / (2 * step);
      if (Math.abs(slopeX) > 0.75) continue;
      if (R.snow && h > R.preset.minTrack + R.preset.amp * 0.7) continue;
      const kind = pal.tree === 'conifer' ? 'conifer' : pal.tree === 'broad' ? 'broad' : (fbm(x / 300, z / 300, 5, 2) > 0.5 ? 'conifer' : 'broad');
      const sc = 0.7 + hashRand(i, j, tx * 5 + tz) * 0.9;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.3, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rx * 6.28, 0)), new THREE.Vector3(sc, sc * (0.9 + rz * 0.35), sc));
      mats[kind].push([m, rx]);
    }
    for (const kind of ['conifer', 'broad']) {
      const arr = mats[kind]; if (!arr.length) continue;
      const im = new THREE.InstancedMesh(this.treeGeo[kind], this.treeMat, arr.length);
      const col = new THREE.Color();
      arr.forEach(([m, r], k) => {
        im.setMatrixAt(k, m);
        if (kind === 'conifer') col.setRGB(0.07 + r * 0.05, 0.20 + r * 0.08, 0.11 + r * 0.04, THREE.SRGBColorSpace); else col.setRGB(0.16 + r * 0.16, 0.30 + r * 0.12, 0.09 + r * 0.05, THREE.SRGBColorSpace);
        if (R.snow || this.snowAmount > 0) col.lerp(new THREE.Color().setRGB(0.85, 0.9, 0.95, THREE.SRGBColorSpace), this.snowAmount > 0 ? 0.55 : 0.22);
        im.setColorAt(k, col);
      });
      im.castShadow = L.trees > 100; im.frustumCulled = false; im.computeBoundingSphere?.();
      group.add(im);
    }
  }

  /** Stream tiles around the focus point. budgetMs bounds the work per call. */
  update(focus, heading, budgetMs = 6) {
    const cx = Math.floor(focus.x / TILE), cz = Math.floor(focus.z / TILE);
    const R = Math.ceil(this.maxRadius / TILE);
    const want = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const tx = cx + dx, tz = cz + dz;
      const mx = (tx + 0.5) * TILE - focus.x, mz = (tz + 0.5) * TILE - focus.z;
      const d = Math.hypot(mx, mz) - TILE * 0.7;
      if (d > this.maxRadius) continue;
      const lod = d < LODS[0].max ? 0 : d < LODS[1].max ? 1 : 2;
      const fwd = (mx * Math.sin(heading) - mz * Math.cos(heading)) / (Math.hypot(mx, mz) + 1);
      want.push({ tx, tz, lod, d, pri: d - fwd * 250 });
    }
    const keep = new Set();
    const todo = [];
    for (const w of want) {
      const key = w.tx + ',' + w.tz; keep.add(key);
      const t = this.tiles.get(key);
      if (!t || t.lod !== w.lod) todo.push(w);
    }
    for (const [key, t] of this.tiles) if (!keep.has(key)) { this._dispose(t); this.tiles.delete(key); }
    todo.sort((a, b) => a.pri - b.pri);
    const t0 = performance.now(); let built = 0;
    for (const w of todo) {
      if (performance.now() - t0 > budgetMs && built > 0) break;
      const key = w.tx + ',' + w.tz; const old = this.tiles.get(key);
      const group = this._buildTile(w.tx, w.tz, w.lod);
      this.group.add(group); if (old) { this._dispose(old); }
      this.tiles.set(key, { group, lod: w.lod }); built++;
    }
    return todo.length - built; // remaining
  }

  _dispose(t) {
    this.group.remove(t.group);
    t.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.geometry && !(o.geometry === this.treeGeo.conifer || o.geometry === this.treeGeo.broad)) o.geometry.dispose(); });
  }

  /** Build everything near the focus synchronously (loading screen). */
  preload(focus, heading, onProgress) {
    let rem = Infinity;
    const total = () => this.tiles.size;
    return new Promise((resolve) => {
      const tick = () => {
        rem = this.update(focus, heading, 40);
        onProgress?.(total(), total() + rem);
        if (rem > 0) setTimeout(tick, 0); else resolve();
      };
      tick();
    });
  }

  animate(t, cam) {
    // keep the wave pattern anchored in world space while the plane follows the camera
    const k = 120 / 8000;
    this.waterNormal.offset.set(cam.x * k + t * 0.004, -cam.z * k + t * 0.0025);
    this.water.position.x = cam.x; this.water.position.z = cam.z;
  }
}
