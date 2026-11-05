import * as THREE from './three.js';
import { stripGeometry, trackMatrix, frameAt } from './geom.js';
import { ballastTexture, concreteTexture } from './textures.js';
import { TRACK_SPACING as TS } from '../sim/route.js';

const CHUNK = 200;
const GAUGE = 1.435;

export class TrackBuilder {
  constructor(scene, route, quality) {
    this.scene = scene; this.route = route; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.chunks = new Map();
    const bt = ballastTexture(); bt.repeat.set(1, 1);
    this.ballastMat = new THREE.MeshLambertMaterial({ map: bt, color: 0xcfcac4 });
    this.railMat = new THREE.MeshLambertMaterial({ color: 0xa9adb3, side: THREE.DoubleSide });
    this.sleeperMat = new THREE.MeshLambertMaterial({ map: concreteTexture('#a9a8a2', 11) });
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x2a2d31 });
    this.mastMat = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
    this.sleeperGeo = new THREE.BoxGeometry(2.6, 0.2, 0.26); this.sleeperGeo.translate(0, -0.1, 0);
    this.mastGeo = this._mastGeometry(-1); this.mastGeoL = this._mastGeometry(1);
    this.wet = 0;
  }

  setWet(w) { this.wet = w; this.ballastMat.color.setScalar(0.81 - 0.25 * w); }

  _mastGeometry(armDir) {   // armDir: -1 = arm reaches to -x (mast on the right of its track), +1 = to +x (mast on the left)
    const pole = new THREE.BoxGeometry(0.26, 7.4, 0.26); pole.translate(0, 3.7, 0);
    const arm = new THREE.BoxGeometry(4.6, 0.1, 0.1); arm.translate(armDir * 2.1, 6.4, 0);
    const base = new THREE.BoxGeometry(0.7, 0.5, 0.7); base.translate(0, 0.25, 0);
    return THREE.mergeGeometries([pole, arm, base]);
  }

  _build(ci) {
    const R = this.route; const s0 = ci * CHUNK, s1 = Math.min(R.length, s0 + CHUNK);
    const g = new THREE.Group();
    // ballast bed
    const bed = stripGeometry(R, s0, s1, 4, [[-4.2, -0.62, 0], [-2.35, -0.08, 0.1], [-1.75, 0.0, 0.14], [TS + 1.75, 0.0, 0.86], [TS + 2.35, -0.08, 0.9], [TS + 4.2, -0.62, 1]], { vScale: 3 });
    const bm = new THREE.Mesh(bed, this.ballastMat); bm.receiveShadow = true; g.add(bm);
    // rails: head + web as extruded loop
    const rl = (c) => [[c - 0.055, 0.17, 0], [c + 0.055, 0.17, 0], [c + 0.055, 0.1, 0], [c + 0.02, 0.1, 0], [c + 0.02, 0.03, 0], [c + 0.09, 0.03, 0], [c + 0.09, 0.0, 0], [c - 0.09, 0.0, 0], [c - 0.09, 0.03, 0], [c - 0.02, 0.03, 0], [c - 0.02, 0.1, 0], [c - 0.055, 0.1, 0]];
    const half = GAUGE / 2 + 0.035;
    for (const c of [-half, half, TS - half, TS + half]) {
      const rg = stripGeometry(R, s0, s1, 4, rl(c), { closeLoop: true });
      const rm = new THREE.Mesh(rg, this.railMat); rm.castShadow = false; g.add(rm);
    }
    // sleepers
    const n = Math.floor((s1 - s0) / 0.65);
    const inst = new THREE.InstancedMesh(this.sleeperGeo, this.sleeperMat, n * 2);
    for (let i = 0; i < n; i++) { inst.setMatrixAt(i * 2, trackMatrix(R, s0 + i * 0.65 + 0.3, 0, 0.03)); inst.setMatrixAt(i * 2 + 1, trackMatrix(R, s0 + i * 0.65 + 0.3, TS, 0.03)); }
    inst.receiveShadow = true; inst.frustumCulled = true; inst.computeBoundingSphere(); g.add(inst);
    // overhead line equipment
    if (this.quality.catenary) this._catenary(g, s0, s1);
    return g;
  }

  _catenary(g, s0, s1) {
    const R = this.route, SP = 63, first = Math.ceil(s0 / SP) * SP;
    const mastsL = [], mastsR = [], pts = [], pts2 = [], tmp = {};
    const wireAt = (s, zig, lat) => { frameAt(R, s, lat + zig, 5.35, tmp); return [tmp.x, tmp.y, tmp.z]; };
    const msgAt = (s, sag, lat) => { frameAt(R, s, lat, 6.35 - sag, tmp); return [tmp.x, tmp.y, tmp.z]; };
    for (let s = first; s < s1 + SP; s += SP) {
      if (s > R.length) break;
      mastsL.push(trackMatrix(R, s, -3.45, -0.1));            // left of our track, arm reaches over it
      mastsR.push(trackMatrix(R, s, TS + 3.45, -0.1));        // right of the adjacent track
      for (const lat of [0, TS]) {
        const z0 = ((Math.floor(s / SP) % 2) ? 0.22 : -0.22), z1 = -z0, seg = 6;
        for (let k = 0; k < seg; k++) {
          const a = s + SP * k / seg, b = s + SP * (k + 1) / seg, za = z0 + (z1 - z0) * k / seg, zb = z0 + (z1 - z0) * (k + 1) / seg;
          pts.push(...wireAt(a, za, lat), ...wireAt(b, zb, lat));
          const sagA = 0.9 * 4 * (k / seg) * (1 - k / seg), sagB = 0.9 * 4 * ((k + 1) / seg) * (1 - (k + 1) / seg);
          pts2.push(...msgAt(a, sagA, lat), ...msgAt(b, sagB, lat)); if (k > 0) pts2.push(...msgAt(a, sagA, lat), ...wireAt(a, za, lat));
        }
      }
    }
    for (const [list, geo] of [[mastsL, this.mastGeoL], [mastsR, this.mastGeo]]) {
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(geo, this.mastMat, list.length); list.forEach((m, i) => im.setMatrixAt(i, m)); im.frustumCulled = true; im.computeBoundingSphere(); g.add(im);
    }
    if (pts.length) { const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts.concat(pts2), 3)); g.add(new THREE.LineSegments(lg, this.wireMat)); }
  }

  update(s, behind = 350, ahead = 1900) {
    const R = this.route;
    const c0 = Math.max(0, Math.floor((s - behind) / CHUNK)), c1 = Math.min(Math.floor(R.length / CHUNK), Math.floor((s + ahead) / CHUNK));
    for (let ci = c0; ci <= c1; ci++) if (!this.chunks.has(ci)) { const g = this._build(ci); this.group.add(g); this.chunks.set(ci, g); break; } // one per call
    for (const [ci, g] of this.chunks) if (ci < c0 - 1 || ci > c1 + 1) { this.group.remove(g); g.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.geometry) o.geometry.dispose(); }); this.chunks.delete(ci); }
  }

  preload(s) {
    const R = this.route; const c0 = Math.max(0, Math.floor((s - 350) / CHUNK)), c1 = Math.min(Math.floor(R.length / CHUNK), Math.floor((s + 1900) / CHUNK));
    for (let ci = c0; ci <= c1; ci++) if (!this.chunks.has(ci)) { const g = this._build(ci); this.group.add(g); this.chunks.set(ci, g); }
  }
}
