import * as THREE from './three.js';
import { stripGeometry, trackMatrix, frameAt } from './geom.js';
import { ballastTexture, concreteTexture } from './textures.js';

const CHUNK = 200;
const GAUGE = 1.435;

export class TrackBuilder {
  constructor(scene, route, quality) {
    this.scene = scene; this.route = route; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.chunks = new Map();
    const bt = ballastTexture(); bt.repeat.set(1, 1);
    this.ballastMat = new THREE.MeshStandardMaterial({ map: bt, roughness: 1, color: 0xcfcac4 });
    this.railMat = new THREE.MeshStandardMaterial({ color: 0x8d9096, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide });
    this.sleeperMat = new THREE.MeshStandardMaterial({ map: concreteTexture('#a9a8a2', 11), roughness: 0.9 });
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x2a2d31 });
    this.mastMat = new THREE.MeshStandardMaterial({ color: 0x7c8087, roughness: 0.6, metalness: 0.6 });
    this.sleeperGeo = new THREE.BoxGeometry(2.6, 0.2, 0.26); this.sleeperGeo.translate(0, -0.1, 0);
    this.mastGeo = this._mastGeometry();
    this.wet = 0;
  }

  setWet(w) { this.wet = w; this.railMat.roughness = 0.35 - 0.2 * w; this.ballastMat.color.setScalar(0.81 - 0.25 * w); }

  _mastGeometry() {
    const pole = new THREE.BoxGeometry(0.26, 7.4, 0.26); pole.translate(0, 3.7, 0);
    const arm = new THREE.BoxGeometry(4.6, 0.1, 0.1); arm.translate(-2.1, 6.4, 0);
    const base = new THREE.BoxGeometry(0.7, 0.5, 0.7); base.translate(0, 0.25, 0);
    return THREE.mergeGeometries([pole, arm, base]);
  }

  _build(ci) {
    const R = this.route; const s0 = ci * CHUNK, s1 = Math.min(R.length, s0 + CHUNK);
    const g = new THREE.Group();
    // ballast bed
    const bed = stripGeometry(R, s0, s1, 4, [[-4.2, -0.62, 0], [-2.35, -0.08, 0.22], [-1.75, 0.0, 0.34], [1.75, 0.0, 0.66], [2.35, -0.08, 0.78], [4.2, -0.62, 1]], { vScale: 3 });
    const bm = new THREE.Mesh(bed, this.ballastMat); bm.receiveShadow = true; g.add(bm);
    // rails: head + web as extruded loop
    const rl = (c) => [[c - 0.055, 0.17, 0], [c + 0.055, 0.17, 0], [c + 0.055, 0.1, 0], [c + 0.02, 0.1, 0], [c + 0.02, 0.03, 0], [c + 0.09, 0.03, 0], [c + 0.09, 0.0, 0], [c - 0.09, 0.0, 0], [c - 0.09, 0.03, 0], [c - 0.02, 0.03, 0], [c - 0.02, 0.1, 0], [c - 0.055, 0.1, 0]];
    const half = GAUGE / 2 + 0.035;
    for (const c of [-half, half]) {
      const rg = stripGeometry(R, s0, s1, 4, rl(c), { closeLoop: true });
      const rm = new THREE.Mesh(rg, this.railMat); rm.castShadow = false; g.add(rm);
    }
    // sleepers
    const n = Math.floor((s1 - s0) / 0.65);
    const inst = new THREE.InstancedMesh(this.sleeperGeo, this.sleeperMat, n);
    for (let i = 0; i < n; i++) inst.setMatrixAt(i, trackMatrix(R, s0 + i * 0.65 + 0.3, 0, 0.03));
    inst.receiveShadow = true; inst.frustumCulled = true; inst.computeBoundingSphere(); g.add(inst);
    // overhead line equipment
    if (this.quality.catenary) this._catenary(g, s0, s1);
    return g;
  }

  _catenary(g, s0, s1) {
    const R = this.route; const SP = 54;
    const first = Math.ceil(s0 / SP) * SP;
    const masts = [];
    const pts = [], pts2 = [];
    const tmp = {};
    const wireAt = (s, zig) => { frameAt(R, s, zig, 5.35, tmp); return [tmp.x, tmp.y, tmp.z]; };
    const msgAt = (s, sag) => { frameAt(R, s, 0, 6.35 - sag, tmp); return [tmp.x, tmp.y, tmp.z]; };
    for (let s = first; s < s1 + SP; s += SP) {
      if (s > R.length) break;
      const inT = R.inTunnel(s) || R.inTunnel(s + SP / 2);
      if (inT) continue;
      const side = 1; // masts on the right-hand side
      const m = trackMatrix(R, s, side * 3.45, -0.1);
      masts.push(m);
      // wires to the next mast
      const z0 = ((Math.floor(s / SP) % 2) ? 0.22 : -0.22), z1 = -z0;
      const seg = 6;
      for (let k = 0; k < seg; k++) {
        const a = s + SP * k / seg, b = s + SP * (k + 1) / seg;
        const za = z0 + (z1 - z0) * k / seg, zb = z0 + (z1 - z0) * (k + 1) / seg;
        pts.push(...wireAt(a, za), ...wireAt(b, zb));
        const sagA = 0.9 * 4 * (k / seg) * (1 - k / seg), sagB = 0.9 * 4 * ((k + 1) / seg) * (1 - (k + 1) / seg);
        pts2.push(...msgAt(a, sagA), ...msgAt(b, sagB));
        if (k > 0) pts2.push(...msgAt(a, sagA), ...wireAt(a, za)); // dropper
      }
    }
    if (masts.length) {
      const im = new THREE.InstancedMesh(this.mastGeo, this.mastMat, masts.length);
      masts.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = false; im.frustumCulled = true; im.computeBoundingSphere(); g.add(im);
    }
    if (pts.length) {
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts.concat(pts2), 3));
      g.add(new THREE.LineSegments(lg, this.wireMat));
    }
  }

  update(s, behind = 500, ahead = 2400) {
    const R = this.route;
    const c0 = Math.max(0, Math.floor((s - behind) / CHUNK)), c1 = Math.min(Math.floor(R.length / CHUNK), Math.floor((s + ahead) / CHUNK));
    for (let ci = c0; ci <= c1; ci++) if (!this.chunks.has(ci)) { const g = this._build(ci); this.group.add(g); this.chunks.set(ci, g); break; } // one per call
    for (const [ci, g] of this.chunks) if (ci < c0 - 1 || ci > c1 + 1) { this.group.remove(g); g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.geometry) o.geometry.dispose(); }); this.chunks.delete(ci); }
  }

  preload(s) {
    const R = this.route; const c0 = Math.max(0, Math.floor((s - 500) / CHUNK)), c1 = Math.min(Math.floor(R.length / CHUNK), Math.floor((s + 2400) / CHUNK));
    for (let ci = c0; ci <= c1; ci++) if (!this.chunks.has(ci)) { const g = this._build(ci); this.group.add(g); this.chunks.set(ci, g); }
  }
}
