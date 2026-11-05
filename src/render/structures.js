import * as THREE from './three.js';
import { stripGeometry, trackMatrix, frameAt, hashRand } from './geom.js';
import { concreteTexture, glowTexture, textTexture, speedSignTexture, houseTexture, stationBoardTexture } from './textures.js';
import { TRACK_SPACING as TS } from '../sim/route.js';

const concrete = () => new THREE.MeshLambertMaterial({ map: concreteTexture('#b4b3ad', 4), side: THREE.DoubleSide });
const PASTELS = [0xf2d6a8, 0xe9b8c4, 0xb9d7e8, 0xc8e0b0, 0xf0c27a, 0xe8e2cf, 0xd9a7a0, 0xa9c8c0];

/** Everything built once per journey: stations, signals, signs, bridges, rivers, buffers and station towns (India: left-hand running). */
export class Structures {
  constructor(scene, route, quality) {
    this.scene = scene; this.route = route; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.glow = glowTexture(); this.lamps = []; this.signals = []; this.platforms = [];
    this._stations(); this._signals(); this._signs(); this._bridges(); this._rivers(); this._buffers(); this._towns();
  }

  _lampMat(color = 0xffe2a8) { const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0.4 }); this.lamps.push(m); return m; }
  add(obj) { this.group.add(obj); return obj; }
  place(obj, s, off, dy, opts) { obj.matrixAutoUpdate = false; obj.matrix.copy(trackMatrix(this.route, s, off, dy, opts)); obj.matrixWorldNeedsUpdate = true; return obj; }
  face(obj, ry) { obj.matrix.multiply(new THREE.Matrix4().makeRotationY(ry)); }     // rotate a placed object about its own vertical axis

  // ------------------------------------------------------------------ stations (platform on the LEFT, island platform beyond the other line)
  _stations() {
    const R = this.route, conc = concrete();
    const yellow = new THREE.MeshLambertMaterial({ color: 0xf2c200 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x5b6572, side: THREE.DoubleSide });
    const steel = new THREE.MeshLambertMaterial({ color: 0x59606a });
    const wall = new THREE.MeshLambertMaterial({ color: 0xe9d6a6 }), band = new THREE.MeshLambertMaterial({ color: 0x9a3b2e });
    const postGeo = new THREE.BoxGeometry(0.26, 4.2, 0.26); postGeo.translate(0, 2.1, 0);
    const lampGeo = new THREE.BoxGeometry(0.5, 0.12, 0.5);
    const personGeo = (() => { const b = new THREE.CapsuleGeometry(0.22, 0.85, 2, 5); b.translate(0, 0.9, 0); const h = new THREE.SphereGeometry(0.17, 6, 5); h.translate(0, 1.72, 0); return THREE.mergeGeometries([b.toNonIndexed(), h.toNonIndexed()]); })();
    R.stops.forEach((st, si) => {
      const PL = st.platformLength, s0 = st.s - PL / 2, s1 = st.s + PL / 2, top = 0.92;
      // main platform (left) and island platform beyond the adjacent line (right)
      const pf = stripGeometry(R, s0, s1, 10, [[-9.8, -1.6, 0], [-9.8, top, 0.1], [-1.65, top, 0.8], [-1.65, -0.2, 1]], { vScale: 8 });
      this.add(new THREE.Mesh(pf, conc));
      const pf2 = stripGeometry(R, s0, s1, 10, [[TS + 1.65, -0.2, 0], [TS + 1.65, top, 0.1], [TS + 8.5, top, 0.8], [TS + 8.5, -1.6, 1]], { vScale: 8 });
      this.add(new THREE.Mesh(pf2, conc));
      for (const [a, b] of [[-2.3, -1.7], [TS + 1.7, TS + 2.3]]) this.add(new THREE.Mesh(stripGeometry(R, s0, s1, 10, [[a, top + 0.01, 0], [b, top + 0.01, 1]]), yellow));
      // long canopy over the main platform
      const cs0 = st.s - 220, cs1 = st.s + 220;
      const roof = stripGeometry(R, cs0, cs1, 10, [[-9.6, 4.15, 0], [-2.7, 4.75, 1]]), roofU = stripGeometry(R, cs0, cs1, 10, [[-9.6, 4.0, 0], [-2.7, 4.6, 1]]);
      const rm = new THREE.Mesh(roof, roofMat); rm.castShadow = true; this.add(rm); this.add(new THREE.Mesh(roofU, roofMat));
      const n = Math.floor((cs1 - cs0) / 14);
      const posts = new THREE.InstancedMesh(postGeo, steel, n + 1), lamps = new THREE.InstancedMesh(lampGeo, this._lampMat(), n + 1);
      for (let i = 0; i <= n; i++) { posts.setMatrixAt(i, trackMatrix(R, cs0 + i * 14, -5.6, top)); lamps.setMatrixAt(i, trackMatrix(R, cs0 + i * 14 + 7, -4.4, top + 3.9)); }
      posts.computeBoundingSphere(); lamps.computeBoundingSphere(); this.add(posts); this.add(lamps);
      // name boards: yellow with English + local script
      const tex = stationBoardTexture(st.name, st.local, st.short);
      for (const k of [-0.34, -0.05, 0.26]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.05), new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a2400, emissiveMap: tex }));
        this.place(board, st.s + PL * k, -2.15, top + 2.55, {}); this.face(board, Math.PI / 2); this.add(board);
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.7, 0.14), steel); this.place(stand, st.s + PL * k, -2.1, top, {}); stand.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 1.35, 0)); this.add(stand);
      }
      // station building behind the platform
      const bl = 52, bw = 9;
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, 4.6, bl), wall); this.place(body, st.s - 40, -15, 2.3 + top - 0.9, {}); this.add(body);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.2, 0.7, bl + 0.2), band); this.place(stripe, st.s - 40, -15, 4.6 + top - 0.9, {}); this.add(stripe);
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.6, 0.5, bl + 0.6), wall); this.place(parapet, st.s - 40, -15, 5.3 + top - 0.9, {}); this.add(parapet);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshLambertMaterial({ map: stationBoardTexture(st.name, st.local, ''), emissive: 0x2a2400, emissiveMap: stationBoardTexture(st.name, st.local, '') }));
      this.place(front, st.s - 40, -10.45, top + 3.1, {}); this.face(front, Math.PI / 2); this.add(front);
      // covered foot overbridge across both lines and both platforms
      const fob = st.s + 130, fy = 7.6, fx0 = -8.6, fx1 = TS + 7.4, cx = (fx0 + fx1) / 2, len = fx1 - fx0;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(len, 0.4, 3.2), steel); this.place(deck, fob, cx, fy, {}); this.add(deck);
      const roofF = new THREE.Mesh(new THREE.BoxGeometry(len + 0.6, 0.18, 3.8), new THREE.MeshLambertMaterial({ color: 0x8a949e })); this.place(roofF, fob, cx, fy + 2.5, {}); this.add(roofF);
      const side = new THREE.Mesh(new THREE.BoxGeometry(len, 1.5, 0.08), new THREE.MeshLambertMaterial({ color: 0xaab4be })); for (const dz of [-1.5, 1.5]) { const sd = side.clone(); this.place(sd, fob + dz, cx, fy + 0.9, {}); this.add(sd); }
      for (const x of [-8.0, TS + 6.8]) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, fy, 0.5), steel); this.place(col, fob, x, top, {}); col.matrix.multiply(new THREE.Matrix4().makeTranslation(0, fy / 2, 0)); this.add(col); }
      // stop marker for the driver (engine stops here)
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 0.12), new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.3 }));
      this.place(marker, st.stopS, -2.0, top, {}); marker.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 1.0, 0)); this.add(marker);
      const stopTex = textTexture(['LOCO STOP'], { w: 256, h: 128, bg: '#ffcc00', fg: '#111', font: 'bold 40px system-ui, sans-serif', border: '#111' });
      const stopSign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.65), new THREE.MeshStandardMaterial({ map: stopTex, emissive: 0x332200, emissiveMap: stopTex, emissiveIntensity: 0.6 }));
      this.place(stopSign, st.stopS + 0.1, -2.0, top + 2.15, {}); this.add(stopSign);
      // passengers on the main platform
      const crowd = new THREE.InstancedMesh(personGeo, new THREE.MeshLambertMaterial({}), 90), col = new THREE.Color();
      for (let i = 0; i < 90; i++) {
        const a = hashRand(si, i, 11), b = hashRand(si, i, 12);
        crowd.setMatrixAt(i, trackMatrix(R, s0 + 12 + a * (PL - 24), -(2.6 + b * 6.2), top + 0.02, { yaw: hashRand(si, i, 13) * 6.28, scale: 0.88 + hashRand(si, i, 14) * 0.24 }));
        col.setHSL(hashRand(si, i, 15), 0.45 + hashRand(si, i, 16) * 0.35, 0.3 + hashRand(si, i, 17) * 0.3); crowd.setColorAt(i, col);
      }
      crowd.computeBoundingSphere(); this.add(crowd); this.platforms.push({ crowd, count: 90 });
    });
  }

  setBoarding(i, f) { const p = this.platforms[i]; if (!p) return; const c = Math.round(p.count * (1 - 0.8 * f)); if (p.crowd.count !== c) p.crowd.count = c; }

  // ------------------------------------------------------------------ colour-light signals (LEFT of the line)
  _signals() {
    const R = this.route, steel = new THREE.MeshLambertMaterial({ color: 0x3b3f45 }), headMat = new THREE.MeshLambertMaterial({ color: 0x15171a });
    const lampGeo = new THREE.SphereGeometry(0.17, 10, 8);
    for (const sg of R.signals) {
      const grp = new THREE.Group(); this.place(grp, sg.s, -3.4, 0, { yaw: 0 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.4, 8), steel); pole.position.y = 2.7; grp.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.7, 0.36), headMat); head.position.set(0, 5.5, 0); grp.add(head);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: textTexture(`${sg.kind === 'home' ? 'H' : sg.kind === 'starter' ? 'S' : 'B'}${sg.id + 1}`, { w: 128, h: 64, bg: '#f4f4f4', fg: '#111', border: '#111', font: 'bold 38px system-ui' }) })); plate.position.set(0, 4.3, 0.15); grp.add(plate);
      const lamps = {};
      [['R', 0xff2418, 6.1], ['Y', 0xffb300, 5.5], ['G', 0x1fff6a, 4.9]].forEach(([k, color, y]) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0 }); const m = new THREE.Mesh(lampGeo, mat); m.position.set(0, y, 0.2); grp.add(m);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })); sp.position.set(0, y, 0.3); sp.scale.setScalar(1.2); grp.add(sp);
        lamps[k] = { mat, sprite: sp, color };
      });
      this.add(grp); this.signals.push({ id: sg.id, s: sg.s, lamps, grp, aspect: null, world: new THREE.Vector3().setFromMatrixPosition(grp.matrix).add(new THREE.Vector3(0, 5.5, 0)) });
    }
  }
  setAspect(id, aspect) {
    const sg = this.signals[id]; if (!sg || sg.aspect === aspect) return; sg.aspect = aspect;
    for (const k of ['R', 'Y', 'G']) { const on = k === aspect; sg.lamps[k].mat.emissiveIntensity = on ? 6 : 0; sg.lamps[k].sprite.material.opacity = on ? 1 : 0; }
  }

  // ------------------------------------------------------------------ speed boards (yellow, left of the line)
  _signs() {
    const R = this.route, pole = new THREE.MeshLambertMaterial({ color: 0x888d94 });
    R.limits.forEach((l, i) => {
      if (l.s < 5) return;
      const g = new THREE.Group(); this.place(g, l.s, -3.0, 0, {});
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6), pole); p.position.y = 1.35; g.add(p);
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshLambertMaterial({ map: speedSignTexture(l.kmh, l.tsr) })); b.position.set(0, 2.9, 0.06); g.add(b);
      const back = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshLambertMaterial({ color: 0x666b72 })); back.rotation.y = Math.PI; back.position.set(0, 2.9, 0.04); g.add(back);
      this.add(g);
    });
  }

  // ------------------------------------------------------------------ bridges over both lines, with piers down to the (river) bed
  _bridges() {
    const R = this.route, conc = concrete(), steel = new THREE.MeshLambertMaterial({ color: 0x77808a, side: THREE.DoubleSide });
    for (const b of R.bridges) {
      this.add(new THREE.Mesh(stripGeometry(R, b.s0, b.s1, 6, [[-4.2, -0.6, 0], [TS + 4.2, -0.6, 0.5], [TS + 4.3, -1.9, 1], [-4.3, -1.9, 0.5]], { closeLoop: true }), conc));
      for (const [x0, x1] of [[-4.15, -3.9], [TS + 3.9, TS + 4.15]]) this.add(new THREE.Mesh(stripGeometry(R, b.s0, b.s1, 6, [[x0, -0.5, 0], [x0, 1.1, 0.5], [x1, 1.1, 1], [x1, -0.5, 0.5]], { closeLoop: true }), steel));   // railings
      const L = b.s1 - b.s0, n = Math.max(2, Math.round(L / 30));
      for (let i = 0; i <= n; i++) {
        const s = b.s0 + 8 + (L - 16) * i / n, f = frameAt(R, s, TS / 2, -1.9), ground = Math.min(R.natural(f.x, f.z), f.y - 1.5), h = f.y - ground + 1; if (h < 2) continue;
        for (const dx of [0, TS]) { const g = frameAt(R, s, dx, -1.9); const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.5 + h * 0.02, h, 8), conc); pier.position.set(g.x, ground + h / 2 - 1, g.z); this.add(pier); }
        const cap = new THREE.Mesh(new THREE.BoxGeometry(TS + 8.6, 0.8, 2.4), conc); this.place(cap, s, TS / 2, -2.3, {}); this.add(cap);
      }
    }
  }

  // ------------------------------------------------------------------ river water ribbons
  _rivers() {
    const R = this.route; if (!R.rivers) return;
    const mat = new THREE.MeshPhongMaterial({ color: 0x5c6b4a, shininess: 60, specular: 0x8a9a86 });
    for (const rv of R.rivers) {
      const pts = [], step = 30;
      for (let u = -1900; u <= 1900; u += step) { const v = rv.amp * (Math.sin(u / rv.lam + rv.ph) - Math.sin(rv.ph)); pts.push([rv.px + rv.ax * u - rv.az * v, rv.pz + rv.az * u + rv.ax * v, u]); }
      const pos = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const w = rv.width * 0.5 * (0.9 + 0.2 * Math.sin(pts[i][2] * 0.011)), nx = -dz, nz = dx;
        pos.push(pts[i][0] + nx * w, rv.level, pts[i][1] + nz * w, pts[i][0] - nx * w, rv.level, pts[i][1] - nz * w);
        if (i > 0) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      for (let i = 0; i < g.attributes.normal.count; i++) { g.attributes.normal.setXYZ(i, 0, 1, 0); }
      const m = new THREE.Mesh(g, mat); m.material.side = THREE.DoubleSide; this.add(m);
    }
  }

  // ------------------------------------------------------------------ buffer stops at the end of the line (both lines)
  _buffers() {
    const R = this.route, red = new THREE.MeshLambertMaterial({ color: 0xb01818 }), steel = new THREE.MeshLambertMaterial({ color: 0x2e3136 });
    for (const lat of [0, TS]) {
      const g = new THREE.Group(); this.place(g, R.length - 12, lat, 0, {});
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 0.9), steel); beam.position.set(0, 1.1, 0); g.add(beam);
      for (const x of [-1.1, 1.1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.8, 10), red); b.rotation.x = Math.PI / 2; b.position.set(x, 1.1, 0.75); g.add(b); }
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 3 })); lamp.position.set(0, 2.3, 0.2); g.add(lamp);
      this.add(g);
    }
  }

  // ------------------------------------------------------------------ towns around stations (flat concrete roofs and red-tile pitched roofs)
  _towns() {
    const R = this.route;
    const wallGeo = new THREE.BoxGeometry(1, 1, 1); wallGeo.translate(0, 0.5, 0);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-0.62, 0); roofShape.lineTo(0.62, 0); roofShape.lineTo(0, 0.5); roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1.15, bevelEnabled: false }); roofGeo.translate(0, 0, -0.575);
    const tankGeo = new THREE.CylinderGeometry(0.9, 0.9, 1.3, 8); tankGeo.translate(0, 0.65, 0);
    const homes = [];
    R.stops.forEach((st, si) => {
      for (let i = 0; i < 90 && homes.length < 520; i++) {
        const a = hashRand(si, i, 31), b = hashRand(si, i, 32), s = st.s - 500 + a * 1000, side = hashRand(si, i, 33) < 0.5 ? -1 : 1, off = side * (30 + b * 190);
        const f = frameAt(R, s, off, 0); const n = R.nearest(f.x, f.z, 60); if (n && n.d < 28) continue;
        const h = R.terrainHeight(f.x, f.z); if (R.natural(f.x, f.z) < R.landscape(f.x, f.z) - 0.8) continue;      // not in a river channel
        const e = 4, sl = Math.max(Math.abs(R.terrainHeight(f.x + e, f.z) - h), Math.abs(R.terrainHeight(f.x, f.z + e) - h)) / e; if (sl > 0.18) continue;
        const w = 6 + hashRand(si, i, 34) * 6, d = 7 + hashRand(si, i, 35) * 6, floors = 1 + Math.floor(hashRand(si, i, 36) * 3), ht = 3.1 * floors + 0.3;
        homes.push({ x: f.x, y: h, z: f.z, w, d, ht, yaw: -f.p.heading + (hashRand(si, i, 37) < 0.5 ? 0 : Math.PI / 2) + (hashRand(si, i, 38) - 0.5) * 0.2, c: PASTELS[Math.floor(hashRand(si, i, 39) * PASTELS.length)], pitched: R.region === 'karnataka' ? hashRand(si, i, 40) < 0.45 : hashRand(si, i, 40) < 0.08, tank: hashRand(si, i, 41) < 0.4 });
      }
    });
    if (!homes.length) return;
    const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshLambertMaterial({ map: houseTexture() }), homes.length);
    const pitched = homes.filter((h) => h.pitched), tanks = homes.filter((h) => !h.pitched && h.tank);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xa04a34 }), Math.max(1, pitched.length));
    const tk = new THREE.InstancedMesh(tankGeo, new THREE.MeshLambertMaterial({ color: 0x222831 }), Math.max(1, tanks.length));
    const col = new THREE.Color(); let ri = 0, ti = 0;
    homes.forEach((h, i) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h.yaw, 0));
      walls.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(h.x, h.y - 0.4, h.z), q, new THREE.Vector3(h.w, h.ht, h.d))); col.setHex(h.c); walls.setColorAt(i, col);
      if (h.pitched) roofs.setMatrixAt(ri++, new THREE.Matrix4().compose(new THREE.Vector3(h.x, h.y - 0.4 + h.ht, h.z), q, new THREE.Vector3(h.w, h.ht * 0.35 + 1.6, h.d / 1.15)));
      else if (h.tank) tk.setMatrixAt(ti++, new THREE.Matrix4().compose(new THREE.Vector3(h.x + Math.cos(h.yaw) * h.w * 0.25, h.y - 0.4 + h.ht, h.z - Math.sin(h.yaw) * h.w * 0.25), q, new THREE.Vector3(1, 1, 1)));
    });
    roofs.count = pitched.length; tk.count = tanks.length;
    for (const m of [walls, roofs, tk]) { m.frustumCulled = true; if (m.count) m.computeBoundingSphere(); this.add(m); }
  }

  // ------------------------------------------------------------------ per-frame
  update(camPos, night) {
    const k = 0.35 + 3.0 * night; for (const m of this.lamps) m.emissiveIntensity = k;
    for (const sg of this.signals) {
      const d = camPos.distanceTo(sg.world);
      for (const key of ['R', 'Y', 'G']) { const sp = sg.lamps[key].sprite; sp.scale.setScalar(THREE.MathUtils.clamp(0.9 + d * 0.0032, 0.9, 5)); sp.material.opacity = sg.aspect === key ? (0.55 + 0.45 * Math.min(1, d / 200)) : 0; }
    }
  }
}
