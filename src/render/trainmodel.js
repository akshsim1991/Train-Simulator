import * as THREE from './three.js';
import { frameAt } from './geom.js';
import { glowTexture } from './textures.js';

const CAR_LEN = 20, BODY_LEN = 19.4, NOSE = 4.2, HALF_W = 1.4, ROOF = 3.85, FLOOR = 0.55;

/** Cross-section outline of the car body (x lateral, y up), counter-clockwise. */
function profilePoints() {
  const pts = [];
  pts.push([-HALF_W + 0.18, FLOOR], [HALF_W - 0.18, FLOOR], [HALF_W, FLOOR + 0.25]);
  pts.push([HALF_W, 2.9]);
  for (let i = 1; i <= 8; i++) { const a = (Math.PI / 2) * (i / 8); pts.push([HALF_W - 0.95 * (1 - Math.cos(a)), 2.9 + (ROOF - 2.9) * Math.sin(a)]); }
  for (let i = 7; i >= 0; i--) { const a = (Math.PI / 2) * (i / 8); pts.push([-(HALF_W - 0.95 * (1 - Math.cos(a))), 2.9 + (ROOF - 2.9) * Math.sin(a)]); }
  pts.push([-HALF_W, FLOOR + 0.25]);
  return pts;
}

function bodyGeometry(len) {
  const pts = profilePoints(); const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -len / 2); return g;
}

/** Lofted nose: rings of the profile that taper and rake backwards toward the tip (-z is forward). */
function noseGeometry() {
  const pts = profilePoints(); const K = 10, M = pts.length;
  const pos = [], idx = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    for (let j = 0; j < M; j++) {
      let [x, y] = pts[j]; const hi = Math.max(0, y - FLOOR) / (ROOF - FLOOR);
      const sx = 1 - 0.42 * Math.pow(t, 2.1), sy = 1 - 0.34 * Math.pow(t, 1.5) * hi;
      const yy = FLOOR + (y - FLOOR) * (1 - 0.3 * Math.pow(t, 1.6) * hi) ;
      const z = -t * NOSE + hi * 1.6 * Math.pow(t, 1.3);  // windscreen rake: upper points sit further back
      pos.push(x * sx, yy - (1 - sy) * 0.0, z);
    }
  }
  for (let k = 0; k < K; k++) for (let j = 0; j < M; j++) {
    const a = k * M + j, b = k * M + (j + 1) % M, c = (k + 1) * M + j, d = (k + 1) * M + (j + 1) % M;
    idx.push(a, c, b, b, c, d);
  }
  // front cap
  const cIdx = pos.length / 3; let cx = 0, cy = 0, cz = 0;
  for (let j = 0; j < M; j++) { const i = (K * M + j) * 3; cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
  pos.push(cx / M, cy / M, cz / M / 1);
  for (let j = 0; j < M; j++) idx.push(cIdx, K * M + (j + 1) % M, K * M + j);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export class TrainModel {
  constructor(scene, route, unit) {
    this.scene = scene; this.route = route; this.unit = unit;
    this.group = new THREE.Group(); scene.add(this.group);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0xeef0f3, roughness: 0.32, metalness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.7, metalness: 0.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b1016, roughness: 0.06, metalness: 0.9, clearcoat: 1 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0x1457b0, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide });
    const door = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x9aa1aa, roughness: 0.6, metalness: 0.4 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x666b72, roughness: 0.4, metalness: 0.9 });
    const bogieMat = new THREE.MeshStandardMaterial({ color: 0x1e2126, roughness: 0.6, metalness: 0.6 });
    this.cars = []; this.wheels = [];
    const nCars = unit.cars;
    const midBody = bodyGeometry(BODY_LEN), endBody = bodyGeometry(BODY_LEN - NOSE), nose = noseGeometry();
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.12, 20); wheelGeo.rotateZ(Math.PI / 2);
    const axleGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.9, 8); axleGeo.rotateZ(Math.PI / 2);
    const bogieGeo = new THREE.BoxGeometry(2.0, 0.28, 2.6);
    const glowTex = glowTexture();
    this.headlights = [];

    for (let i = 0; i < nCars; i++) {
      const car = new THREE.Group(); const end = i === 0 ? 'front' : i === nCars - 1 ? 'rear' : null;
      const blen = end ? BODY_LEN - NOSE : BODY_LEN;
      const body = new THREE.Mesh(end ? endBody : midBody, paint); body.castShadow = true; body.receiveShadow = true;
      if (end) body.position.z = (end === 'front' ? 1 : -1) * NOSE / 2; // body spans the rest of the car
      car.add(body);
      // livery pieces on both sides
      for (const side of [-1, 1]) {
        const zc = end ? (end === 'front' ? NOSE / 2 : -NOSE / 2) : 0;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(blen - 2.2, 0.95), glass); win.position.set(side * (HALF_W + 0.01), 2.4, zc); win.rotation.y = side * Math.PI / 2; car.add(win);
        const st = new THREE.Mesh(new THREE.PlaneGeometry(blen - 0.4, 0.28), stripe); st.position.set(side * (HALF_W + 0.012), 1.5, zc); st.rotation.y = side * Math.PI / 2; car.add(st);
        for (const dz of [-blen * 0.27, blen * 0.27]) {
          const d = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 2.05), door); d.position.set(side * (HALF_W + 0.014), 1.55, zc + dz); d.rotation.y = side * Math.PI / 2; car.add(d);
          const dw = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.0), glass); dw.position.set(side * (HALF_W + 0.02), 2.2, zc + dz); dw.rotation.y = side * Math.PI / 2; car.add(dw);
        }
      }
      // skirt + roof equipment
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.55, blen - 1.0), dark); skirt.position.set(0, 0.42, end ? (end === 'front' ? NOSE / 2 : -NOSE / 2) : 0); car.add(skirt);
      const roofBox = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 3.2), roofMat); roofBox.position.set(0, ROOF + 0.1, end ? 0 : 2); car.add(roofBox);
      if (end) {
        const n = new THREE.Mesh(nose, paint); n.castShadow = true; n.position.z = end === 'front' ? -(BODY_LEN - NOSE) / 2 + NOSE / 2 - NOSE / 2 + 0 : 0;
        // nose attaches at the car's outer end
        const nz = (end === 'front' ? -1 : 1) * (BODY_LEN / 2 - NOSE);
        n.position.z = end === 'front' ? -BODY_LEN / 2 + NOSE : BODY_LEN / 2 - NOSE; n.position.z = end === 'front' ? -(BODY_LEN / 2) + NOSE : (BODY_LEN / 2) - NOSE;
        n.position.z += end === 'front' ? 0 : 0; n.rotation.y = end === 'front' ? 0 : Math.PI;
        n.position.z = end === 'front' ? -BODY_LEN / 2 + NOSE : BODY_LEN / 2 - NOSE;
        car.add(n);
        // windscreen
        const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.0), glass);
        const sgn = end === 'front' ? 1 : -1;
        ws.position.set(0, 3.0, n.position.z - sgn * (NOSE * 0.62) + sgn * 0.0); ws.rotation.set(-0.5 * sgn, end === 'front' ? Math.PI : 0, 0);
        ws.position.z = n.position.z - sgn * 1.9; ws.position.y = 3.05; ws.rotation.x = sgn * -0.0;
        ws.scale.set(1, 1, 1); car.add(ws);
        // lights
        const front = end === 'front';
        for (const sx of [-0.85, 0.85]) {
          const col = front ? 0xfff3d6 : 0xff2a1a;
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: col, emissiveIntensity: front ? 0.6 : 1.2 }));
          lamp.position.set(sx, 1.15, front ? -BODY_LEN / 2 - 0.1 + 0.0 : BODY_LEN / 2 + 0.1); car.add(lamp);
          lamp.userData.front = front; this.headlights.push(lamp);
        }
        if (front) {
          // the beam lives at the scene root so it still lights the track when the train mesh is hidden (cab view)
          this.beam = new THREE.SpotLight(0xfff0d8, 0, 320, 0.42, 0.6, 1.2); this.beamTarget = new THREE.Object3D();
          scene.add(this.beam); scene.add(this.beamTarget); this.beam.target = this.beamTarget;
        }
      }
      // pantograph on the 2nd and 6th car
      if (i === 1 || i === Math.min(5, nCars - 2)) car.add(this._pantograph(roofMat));
      // bogies
      for (const bz of [-6.6, 6.6]) {
        const bg = new THREE.Group(); bg.position.set(0, 0.46, bz);
        const frame = new THREE.Mesh(bogieGeo, bogieMat); bg.add(frame);
        for (const az of [-0.95, 0.95]) {
          const ax = new THREE.Mesh(axleGeo, wheelMat); ax.position.z = az; bg.add(ax);
          for (const wx of [-0.7175, 0.7175]) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(wx, 0, az); w.add(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.5, 0.06), bogieMat)); bg.add(w); this.wheels.push(w); }
        }
        car.add(bg);
      }
      car.userData.index = i; this.group.add(car); this.cars.push(car);
    }
  }

  _pantograph(mat) {
    const g = new THREE.Group(); g.position.set(0, ROOF + 0.2, -1.5);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.7), mat); g.add(base);
    const arm = (rotZ, y, h) => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), mat); a.position.set(0, y, 0); a.rotation.x = rotZ; return a; };
    const a1 = arm(0.42, 0.75, 1.7), a2 = arm(-0.42, 1.55, 1.7); a1.position.z = 0.3; a2.position.z = 0.3; g.add(a1, a2);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.05, 0.12), mat); bar.position.set(0, 1.28, 0.0); bar.position.y = 1.5; g.add(bar);
    return g;
  }

  /** Place each car by its bogie positions on the curved track. sFront: front of the lead car. */
  update(sFront, night, tunnelFactor, vel) {
    const R = this.route; const tmpA = {}, tmpB = {};
    for (let i = 0; i < this.cars.length; i++) {
      const sc = sFront - (i + 0.5) * CAR_LEN;
      const a = frameAt(R, sc + 6.6, 0, 0, tmpA), b = frameAt(R, sc - 6.6, 0, 0, tmpB);
      const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y; const hd = Math.hypot(dx, dz) || 1;
      const car = this.cars[i]; const p = R.at(sc);
      car.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      car.rotation.set(Math.atan2(dy, hd), Math.atan2(-dx, -dz), -p.bank * 0.9, 'YXZ');
    }
    const on = Math.max(night, tunnelFactor);
    if (this.beam) {
      const f = frameAt(R, sFront + 1.5, 0, 1.5, tmpA), g = frameAt(R, sFront + 70, 0, 0.6, tmpB);
      this.beam.position.set(f.x, f.y, f.z); this.beamTarget.position.set(g.x, g.y, g.z); this.beamTarget.updateMatrixWorld();
      this.beam.intensity = on * 520;
    }
    for (const l of this.headlights) l.material.emissiveIntensity = l.userData.front ? 0.5 + on * 6 : 1.0 + on * 3;
  }

  spin(dist) { const r = dist / 0.46; for (const w of this.wheels) w.rotation.x -= r; }
}
