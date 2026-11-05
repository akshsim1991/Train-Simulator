import * as THREE from './three.js';
import { stripGeometry, trackMatrix, frameAt, hashRand } from './geom.js';
import { concreteTexture, glowTexture, textTexture, speedSignTexture } from './textures.js';

const concrete = () => new THREE.MeshStandardMaterial({ map: concreteTexture('#b4b3ad', 4), roughness: 0.92, side: THREE.DoubleSide });

export class Structures {
  constructor(scene, route, quality) {
    this.scene = scene; this.route = route; this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.glow = glowTexture();
    this.lamps = [];            // emissive materials scaled at night
    this.signals = [];
    this.platforms = [];
    this.tunnelLights = [];
    this.builtAt = performance.now();
    this._stations(); this._signals(); this._signs(); this._tunnels(); this._bridges(); this._buffers(); this._towns();
  }

  _lampMat(color = 0xffe2a8) {
    const m = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: color, emissiveIntensity: 0.4 });
    this.lamps.push(m); return m;
  }

  add(obj) { this.group.add(obj); return obj; }
  place(obj, s, off, dy, opts) { obj.matrixAutoUpdate = false; obj.matrix.copy(trackMatrix(this.route, s, off, dy, opts)); obj.matrixWorldNeedsUpdate = true; return obj; }

  // ------------------------------------------------------------------ stations
  _stations() {
    const R = this.route; const conc = concrete();
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3d4b5c, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
    const steel = new THREE.MeshStandardMaterial({ color: 0x59606a, roughness: 0.5, metalness: 0.7 });
    const wall = new THREE.MeshStandardMaterial({ color: 0xcfc3ae, roughness: 0.9 });
    const roofTile = new THREE.MeshStandardMaterial({ color: 0x7a3b2e, roughness: 0.85 });
    const postGeo = new THREE.BoxGeometry(0.22, 4.4, 0.22); postGeo.translate(0, 2.2, 0);
    const lampGeo = new THREE.BoxGeometry(0.5, 0.12, 0.5);
    const personGeo = (() => { const b = new THREE.CapsuleGeometry(0.22, 0.85, 3, 6); b.translate(0, 0.9, 0); const h = new THREE.SphereGeometry(0.17, 8, 6); h.translate(0, 1.72, 0); return THREE.mergeGeometries([b.toNonIndexed(), h.toNonIndexed()]); })();
    R.stops.forEach((st, si) => {
      const s0 = st.s - st.platformLength / 2, s1 = st.s + st.platformLength / 2;
      const top = 0.92;
      const pf = stripGeometry(R, s0, s1, 6, [[1.65, 0, 0], [1.65, top, 0.1], [7.4, top, 0.8], [7.4, 0, 1]], { vScale: 6 });
      const pm = new THREE.Mesh(pf, conc); pm.receiveShadow = true; pm.castShadow = true; this.add(pm);
      const line = stripGeometry(R, s0, s1, 6, [[1.7, top + 0.01, 0], [2.3, top + 0.01, 1]]);
      this.add(new THREE.Mesh(line, yellow));
      // canopy
      const cs0 = s0 + 24, cs1 = s1 - 24;
      const roof = stripGeometry(R, cs0, cs1, 6, [[2.4, 4.6, 0], [7.8, 4.1, 1]]);
      const rm = new THREE.Mesh(roof, roofMat); rm.castShadow = true; this.add(rm);
      const roofU = stripGeometry(R, cs0, cs1, 6, [[2.4, 4.45, 0], [7.8, 3.95, 1]]); this.add(new THREE.Mesh(roofU, roofMat));
      const n = Math.floor((cs1 - cs0) / 12);
      const posts = new THREE.InstancedMesh(postGeo, steel, n + 1); const lamps = new THREE.InstancedMesh(lampGeo, this._lampMat(), n + 1);
      for (let i = 0; i <= n; i++) {
        posts.setMatrixAt(i, trackMatrix(R, cs0 + i * 12, 5.2, top)); lamps.setMatrixAt(i, trackMatrix(R, cs0 + i * 12 + 6, 4.0, top + 3.95));
      }
      posts.castShadow = true; this.add(posts); this.add(lamps);
      // name boards along the platform
      for (const k of [-0.32, 0.0, 0.32]) {
        const tex = textTexture(st.name.toUpperCase(), { w: 512, h: 112, bg: '#0f3d6e', font: 'bold 52px system-ui, sans-serif' });
        const board = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: 0x112244, emissiveMap: tex, emissiveIntensity: 0.25 }));
        this.place(board, st.s + st.platformLength * k, 2.05, top + 2.5, { yaw: 0 });
        // rotate board to face the track (its normal +z -> world: align to -x relative). plane faces +z (backwards); turn to face left
        board.matrix.multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)); this.add(board);
        const stand = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), steel); this.place(stand, st.s + st.platformLength * k, 1.98, top, {}); stand.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 1.3, 0)); this.add(stand);
      }
      // station building (rear of platform)
      const bw = 8.5, bl = 26;
      const body = new THREE.Mesh(new THREE.BoxGeometry(bw, 3.8, bl), wall); this.place(body, st.s - 30, 12.0, 1.9 + top - 0.9, {}); body.castShadow = true; body.receiveShadow = true; this.add(body);
      const roofShape = new THREE.Shape(); roofShape.moveTo(-bw / 2 - 0.6, 0); roofShape.lineTo(bw / 2 + 0.6, 0); roofShape.lineTo(0, 2.2); roofShape.closePath();
      const rg = new THREE.ExtrudeGeometry(roofShape, { depth: bl + 1.2, bevelEnabled: false }); rg.translate(0, 0, -(bl + 1.2) / 2);
      const roofM = new THREE.Mesh(rg, roofTile); this.place(roofM, st.s - 30, 12.0, 3.8 + top - 0.9, {}); roofM.castShadow = true; this.add(roofM);
      const nameTex = textTexture(st.name, { w: 512, h: 96, bg: '#efe7d4', fg: '#1b2a3a', border: null, font: 'bold 52px Georgia, serif' });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.8 }));
      this.place(sign, st.s - 30, 7.76, top + 2.7, {}); sign.matrix.multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)); this.add(sign);
      // stop marker
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.1, 0.1), new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 0.3 }));
      this.place(marker, st.stopS, 2.0, top, {}); marker.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 1.05, 0)); this.add(marker);
      const stopTex = textTexture(['STOP', '8 CARS'], { w: 256, h: 160, bg: '#ffcc00', fg: '#111', font: 'bold 52px system-ui, sans-serif', border: '#111' });
      const stopSign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshStandardMaterial({ map: stopTex, emissive: 0x332200, emissiveMap: stopTex, emissiveIntensity: 0.6 }));
      this.place(stopSign, st.stopS + 0.16, 2.0, top + 2.2, {}); stopSign.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2 - Math.PI / 2 * 0)); this.add(stopSign);
      // passengers
      const crowd = new THREE.InstancedMesh(personGeo, new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: false }), 42);
      const col = new THREE.Color();
      for (let i = 0; i < 42; i++) {
        const a = hashRand(si, i, 11), b = hashRand(si, i, 12);
        const m = trackMatrix(R, s0 + 10 + a * (st.platformLength - 20), 2.6 + b * 3.6, top + 0.02, { yaw: hashRand(si, i, 13) * 6.28, scale: 0.9 + hashRand(si, i, 14) * 0.2 });
        crowd.setMatrixAt(i, m);
        col.setHSL(hashRand(si, i, 15), 0.35 + hashRand(si, i, 16) * 0.3, 0.3 + hashRand(si, i, 17) * 0.3); crowd.setColorAt(i, col);
      }
      crowd.castShadow = true; crowd.frustumCulled = false; this.add(crowd); this.platforms.push({ crowd, count: 42 });
    });
  }

  setBoarding(stationIdx, fraction) { // fraction 0..1 boarded
    const p = this.platforms[stationIdx]; if (!p) return;
    const c = Math.round(p.count * (1 - 0.8 * fraction)); if (p.crowd.count !== c) p.crowd.count = c;
  }

  // ------------------------------------------------------------------ signals
  _signals() {
    const R = this.route; const steel = new THREE.MeshStandardMaterial({ color: 0x3b3f45, roughness: 0.6, metalness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
    const lampGeo = new THREE.SphereGeometry(0.17, 12, 10);
    for (const sg of R.signals) {
      const off = 3.3;
      const grp = new THREE.Group(); this.place(grp, sg.s, off, 0, { yaw: 0 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 5.4, 8), steel); pole.position.y = 2.7; grp.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.7, 0.36), headMat); head.position.set(0, 5.5, 0); grp.add(head);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: textTexture(String(sg.id + 1), { w: 128, h: 64, bg: '#f4f4f4', fg: '#111', border: '#111', font: 'bold 40px system-ui' }) })); plate.position.set(0, 4.3, 0.15); grp.add(plate);
      const lamps = {};
      [['R', 0xff2418, 6.1], ['Y', 0xffb300, 5.5], ['G', 0x1fff6a, 4.9]].forEach(([k, color, y]) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0 });
        const m = new THREE.Mesh(lampGeo, mat); m.position.set(0, y - 0.0, 0.2); grp.add(m);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
        sp.position.set(0, y, 0.3); sp.scale.setScalar(1.2); grp.add(sp);
        lamps[k] = { mat, sprite: sp, color };
      });
      // face the approaching driver: object +z must point against the direction of travel (toward -s)
      grp.matrix.multiply(new THREE.Matrix4().makeRotationY(0)); // local +z already points backward along the track
      pole.castShadow = true;
      this.add(grp); this.signals.push({ id: sg.id, s: sg.s, lamps, grp, aspect: null, world: new THREE.Vector3().setFromMatrixPosition(grp.matrix).add(new THREE.Vector3(0, 5.5, 0)) });
    }
  }

  setAspect(id, aspect) {
    const sg = this.signals[id]; if (!sg || sg.aspect === aspect) return; sg.aspect = aspect;
    for (const k of ['R', 'Y', 'G']) { const on = k === aspect; sg.lamps[k].mat.emissiveIntensity = on ? 6 : 0.0; sg.lamps[k].sprite.material.opacity = on ? 1 : 0; }
  }

  // ------------------------------------------------------------------ signs
  _signs() {
    const R = this.route; const pole = new THREE.MeshStandardMaterial({ color: 0x888d94, roughness: 0.5, metalness: 0.6 });
    R.limits.forEach((l, i) => {
      if (i === 0 && l.s < 1) return;
      const g = new THREE.Group(); this.place(g, Math.max(2, l.s), 3.0, 0, {});
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6), pole); p.position.y = 1.35; g.add(p);
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshStandardMaterial({ map: speedSignTexture(l.kmh, l.tsr), roughness: 0.5, emissive: 0x111111, emissiveMap: null }));
      b.position.set(0, 2.9, 0.06); g.add(b);
      const back = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), new THREE.MeshStandardMaterial({ color: 0x666b72 })); back.rotation.y = Math.PI; back.position.set(0, 2.9, 0.04); g.add(back);
      this.add(g);
    });
  }

  // ------------------------------------------------------------------ tunnels
  _tunnels() {
    const R = this.route; const mat = new THREE.MeshStandardMaterial({ map: concreteTexture('#8f8e8a', 8), roughness: 0.95, side: THREE.DoubleSide });
    const portalMat = concrete();
    const lampMat = this._lampMat(0xfff0d0);
    const lampGeo = new THREE.BoxGeometry(0.18, 0.1, 1.8);
    for (const t of R.tunnels) {
      const prof = []; const rad = 4.3, cy = 3.0;
      prof.push([-rad, -0.5, 0], [-rad, cy, 3.5 / 4]);
      for (let a = 0; a <= 16; a++) { const th = Math.PI - Math.PI * a / 16; prof.push([rad * Math.cos(th), cy + rad * Math.sin(th) * 0.95, (3.5 + 13.2 * a / 16) / 4]); }
      prof.push([rad, cy, 16.7 / 4], [rad, -0.5, 20.2 / 4]);
      const geo = stripGeometry(R, t.s0, t.s1, 4, prof, { vScale: 6 });
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; this.add(m);
      const n = Math.floor((t.s1 - t.s0) / 10);
      const lamps = new THREE.InstancedMesh(lampGeo, lampMat, n * 2);
      for (let i = 0; i < n; i++) { lamps.setMatrixAt(i * 2, trackMatrix(R, t.s0 + 6 + i * 10, -2.1, 7.0)); lamps.setMatrixAt(i * 2 + 1, trackMatrix(R, t.s0 + 6 + i * 10, 2.1, 7.0)); }
      lamps.frustumCulled = false; this.add(lamps);
      // portals
      for (const [s, flip] of [[t.s0, false], [t.s1, true]]) {
        const sh = new THREE.Shape(); sh.moveTo(-8.5, -2); sh.lineTo(8.5, -2); sh.lineTo(7.2, 8.2); sh.lineTo(-7.2, 8.2); sh.closePath();
        const hole = new THREE.Path(); hole.moveTo(-rad - 0.05, -2);
        hole.lineTo(-rad - 0.05, cy);
        for (let a = 0; a <= 20; a++) { const th = Math.PI - Math.PI * a / 20; hole.lineTo((rad + 0.05) * Math.cos(th), cy + (rad + 0.05) * Math.sin(th) * 0.95); }
        hole.lineTo(rad + 0.05, -2); hole.closePath(); sh.holes.push(hole);
        const pg = new THREE.ExtrudeGeometry(sh, { depth: 3.0, bevelEnabled: false });
        const pm = new THREE.Mesh(pg, portalMat); pm.castShadow = true; pm.receiveShadow = true;
        this.place(pm, s, 0, 0, { yaw: flip ? Math.PI : 0 });
        if (flip) pm.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0));
        this.add(pm);
      }
    }
  }

  // ------------------------------------------------------------------ bridges
  _bridges() {
    const R = this.route; const conc = concrete();
    const steel = new THREE.MeshStandardMaterial({ color: 0x6c727b, roughness: 0.45, metalness: 0.75, side: THREE.DoubleSide });
    for (const b of R.bridges) {
      const deck = stripGeometry(R, b.s0, b.s1, 4, [[-3.6, -0.6, 0], [3.6, -0.6, 0.5], [3.6, -1.9, 1], [-3.6, -1.9, 0.5]], { closeLoop: true });
      const dm = new THREE.Mesh(deck, conc); dm.castShadow = true; dm.receiveShadow = true; this.add(dm);
      for (const side of [-1, 1]) {
        const rail = stripGeometry(R, b.s0, b.s1, 4, side < 0 ? [[-3.55, -0.5, 0], [-3.55, 1.1, 0.5], [-3.35, 1.1, 1], [-3.35, -0.5, 0.5]] : [[3.35, -0.5, 0], [3.35, 1.1, 0.5], [3.55, 1.1, 1], [3.55, -0.5, 0.5]], { closeLoop: true });
        const rm = new THREE.Mesh(rail, conc); rm.castShadow = true; this.add(rm);
      }
      const L = b.s1 - b.s0; const n = Math.max(2, Math.round(L / 38));
      for (let i = 0; i <= n; i++) {
        const s = b.s0 + 14 + (L - 28) * i / n; const f = frameAt(R, s, 0, -1.9);
        const ground = Math.min(R.natural(f.x, f.z), f.y - 1.5);
        const h = f.y - ground + 1; if (h < 2) continue;
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.7 + h * 0.03, h, 10), conc); pier.position.set(f.x, ground + h / 2 - 1, f.z); pier.castShadow = true; pier.receiveShadow = true; this.add(pier);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.8, 2.6), conc); this.place(cap, s, 0, -2.3, {}); cap.castShadow = true; this.add(cap);
      }
    }
  }

  // ------------------------------------------------------------------ buffers
  _buffers() {
    const R = this.route; const red = new THREE.MeshStandardMaterial({ color: 0xb01818, roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2e3136, roughness: 0.5, metalness: 0.7 });
    const g = new THREE.Group(); this.place(g, R.length - 12, 0, 0, {});
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 0.9), steel); beam.position.set(0, 1.1, 0); g.add(beam);
    for (const x of [-1.1, 1.1]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.8, 12), red); b.rotation.x = Math.PI / 2; b.position.set(x, 1.1, 0.75); g.add(b); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 3 })); lamp.position.set(0, 2.3, 0.2); g.add(lamp);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.2), steel); post.position.set(0, 1.1, 0); g.add(post);
    this.add(g);
  }

  // ------------------------------------------------------------------ towns
  _towns() {
    const R = this.route; const wallGeo = new THREE.BoxGeometry(1, 1, 1); wallGeo.translate(0, 0.5, 0);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-0.62, 0); roofShape.lineTo(0.62, 0); roofShape.lineTo(0, 0.5); roofShape.closePath();
    const roofGeo = new THREE.ExtrudeGeometry(roofShape, { depth: 1.15, bevelEnabled: false }); roofGeo.translate(0, 0, -0.575);
    const homes = [];
    R.stops.forEach((st, si) => {
      for (let i = 0; i < 70 && homes.length < 400; i++) {
        const a = hashRand(si, i, 31), b = hashRand(si, i, 32);
        const s = st.s - 300 + a * 600; const side = hashRand(si, i, 33) < 0.5 ? -1 : 1; const off = side * (26 + b * 150);
        const f = frameAt(R, s, off, 0); const n = R.nearest(f.x, f.z, 60);
        if (n && n.d < 22) continue;
        const h = R.terrainHeight(f.x, f.z);
        if (h < R.seaLevel + 3) continue;
        const e = 4; const sl = Math.max(Math.abs(R.terrainHeight(f.x + e, f.z) - h), Math.abs(R.terrainHeight(f.x, f.z + e) - h)) / e; if (sl > 0.18) continue;
        const w = 7 + hashRand(si, i, 34) * 5, d = 8 + hashRand(si, i, 35) * 6, ht = 4.2 + hashRand(si, i, 36) * 2.4;
        homes.push({ x: f.x, y: h, z: f.z, w, d, ht, yaw: -f.p.heading + (hashRand(si, i, 37) < 0.5 ? 0 : Math.PI / 2) + (hashRand(si, i, 38) - 0.5) * 0.15, hue: hashRand(si, i, 39) });
      }
    });
    if (!homes.length) return;
    const walls = new THREE.InstancedMesh(wallGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), homes.length);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ roughness: 0.85 }), homes.length);
    const c = new THREE.Color();
    homes.forEach((h, i) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h.yaw, 0));
      walls.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(h.x, h.y - 0.4, h.z), q, new THREE.Vector3(h.w, h.ht, h.d)));
      roofs.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(h.x, h.y - 0.4 + h.ht, h.z), q, new THREE.Vector3(h.w, h.ht * 0.55 + 2, h.d / 1.15 * 1.0)));
      c.setHSL(0.08 + h.hue * 0.1, 0.25, 0.7 + h.hue * 0.15); walls.setColorAt(i, c);
      c.setHSL(0.02 + h.hue * 0.06, 0.45, 0.28 + h.hue * 0.1); roofs.setColorAt(i, c);
    });
    walls.castShadow = roofs.castShadow = true; walls.receiveShadow = true; walls.frustumCulled = roofs.frustumCulled = false;
    this.add(walls); this.add(roofs);
  }

  // ------------------------------------------------------------------ per-frame
  update(camPos, night, tunnelFactor) {
    const k = 0.35 + 3.0 * night + 5.0 * tunnelFactor;
    for (const m of this.lamps) m.emissiveIntensity = k;
    for (const sg of this.signals) {
      const d = camPos.distanceTo(sg.world);
      for (const key of ['R', 'Y', 'G']) {
        const sp = sg.lamps[key].sprite; sp.scale.setScalar(THREE.MathUtils.clamp(0.9 + d * 0.0032, 0.9, 5));
        sp.material.opacity = sg.aspect === key ? (0.55 + 0.45 * Math.min(1, d / 200)) : 0;
      }
    }
  }
}
