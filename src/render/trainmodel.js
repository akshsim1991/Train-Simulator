import * as THREE from './three.js';
import { frameAt } from './geom.js';
import { getCoachAsset, getBogieAssets, getLocoAsset } from './stock.js';

const GAP = 0.6;                      // coupled-vehicle gap (m)
const dummy = new THREE.Object3D();

/** An Indian Railways consist: one locomotive + N instanced coaches, drawn with a handful of draw calls. */
export class TrainModel {
  constructor(scene, route, unit, { lateral = 0, dir = 1, tail = true, beam = false } = {}) {
    this.scene = scene; this.route = route; this.unit = unit; this.lateral = lateral; this.dir = dir;
    const loco = getLocoAsset(unit.loco), coach = getCoachAsset(unit.coach.id), bog = getBogieAssets();
    this.Ll = loco.length; this.Lc = coach.length; this.n = unit.cars;
    this.group = new THREE.Group(); scene.add(this.group);
    this.locoMesh = new THREE.Mesh(loco.geo, loco.mat); this.locoMesh.frustumCulled = false; this.locoMesh.castShadow = true; this.group.add(this.locoMesh);
    this.coaches = new THREE.InstancedMesh(coach.geo, coach.mat, this.n); this.coaches.frustumCulled = false; this.coaches.castShadow = true; this.group.add(this.coaches);
    this.cBog = new THREE.InstancedMesh(bog.coach, bog.mat, this.n * 2); this.cBog.frustumCulled = false; this.group.add(this.cBog);
    this.lBog = new THREE.InstancedMesh(bog.loco, bog.mat, 2); this.lBog.frustumCulled = false; this.group.add(this.lBog);
    this.coachMat = coach.mat;
    // headlight (front of the loco) and marker lamps; tail lamps on the last coach
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2d0 });
    const H = loco.height, zf = -this.Ll / 2 + 0.55 * ((H - 0.45) - 0.7) / (H - 0.9) - 0.03;
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.17, 14), this.lampMat); lamp.position.set(0, H - 0.45, zf); lamp.rotation.y = Math.PI; this.locoMesh.add(lamp);
    for (const x of [-1.1, 1.1]) { const m = new THREE.Mesh(new THREE.CircleGeometry(0.09, 10), this.lampMat); m.position.set(x, 1.15, -this.Ll / 2 - 0.0); m.rotation.y = Math.PI; this.locoMesh.add(m); }
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0xaa1510 });
    if (tail) { this.tails = [-0.9, 0.9].map((x) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.11, 10), this.tailMat); m.position.set(x, 1.1, this.Lc / 2 + 0.58); this.group.add(m); return m; }); }
    if (beam) {   // headlight beam lives at the scene root so it still lights the track when the mesh is hidden (cab view)
      this.beam = new THREE.SpotLight(0xfff0d8, 0, 340, 0.45, 0.65, 1.2); this.beamTarget = new THREE.Object3D(); scene.add(this.beam); scene.add(this.beamTarget); this.beam.target = this.beamTarget;
    }
    this.length = unit.length; this._a = {}; this._b = {};
  }

  /** Orient `obj`/instance between two track points; returns the matrix. */
  _pose(sCenter, half, lift = 0) {
    const R = this.route, d = this.dir, a = frameAt(R, sCenter + d * half, this.lateral, 0, this._a), b = frameAt(R, sCenter - d * half, this.lateral, 0, this._b);
    const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y, hd = Math.hypot(dx, dz) || 1, bank = a.p.bank;
    dummy.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2);
    dummy.rotation.set(Math.atan2(dy, hd), Math.atan2(-dx, -dz), -d * bank * 0.9, 'YXZ'); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
    return dummy.matrix;
  }

  /** sFront: chainage of the FRONT of the locomotive. */
  update(sFront, night, tunnel) {
    const d = this.dir; let off = this.Ll / 2;
    const m = this._pose(sFront - d * off, 5.4); this.locoMesh.matrixAutoUpdate = false; this.locoMesh.matrix.copy(m); this.locoMesh.matrixWorldNeedsUpdate = true;
    // locomotive bogies sit under each end bogie centre
    this.lBog.setMatrixAt(0, this._pose(sFront - d * (off - 5.4), 1.0)); this.lBog.setMatrixAt(1, this._pose(sFront - d * (off + 5.4), 1.0)); this.lBog.instanceMatrix.needsUpdate = true;
    off = this.Ll + GAP;
    for (let i = 0; i < this.n; i++) {
      const c = sFront - d * (off + this.Lc / 2); const pitch = this.Lc * 0.32;
      this.coaches.setMatrixAt(i, this._pose(c, pitch));
      this.cBog.setMatrixAt(i * 2, this._pose(c - d * -pitch, 1.0)); this.cBog.setMatrixAt(i * 2 + 1, this._pose(c - d * pitch, 1.0));
      off += this.Lc + GAP;
    }
    this.coaches.instanceMatrix.needsUpdate = true; this.cBog.instanceMatrix.needsUpdate = true;
    if (this.tails) { const lastC = sFront - d * (this.Ll + GAP + (this.n - 1) * (this.Lc + GAP) + this.Lc / 2); const mt = this._pose(lastC, this.Lc * 0.32); this.tails.forEach((t) => { t.matrixAutoUpdate = false; t.matrix.copy(mt).multiply(new THREE.Matrix4().makeTranslation(t.position.x, t.position.y, t.position.z)); t.matrixWorldNeedsUpdate = true; }); }
    // lights: the headlight is always on in India; brighter at night / in tunnels
    const on = Math.max(night, tunnel);
    this.lampMat.color.setScalar(0.9 + on * 2.2).multiply(new THREE.Color(1, 0.95, 0.82));
    this.tailMat.color.setRGB(0.5 + on * 1.5, 0.05, 0.03);
    this.coachMat.emissiveIntensity = 0.04 + on * 1.4;
    if (this.beam) {
      const R = this.route, f = frameAt(R, sFront + d * 1.5, this.lateral, 1.6, this._a), g = frameAt(R, sFront + d * 80, this.lateral, 0.6, this._b);
      this.beam.position.set(f.x, f.y, f.z); this.beamTarget.position.set(g.x, g.y, g.z); this.beamTarget.updateMatrixWorld(); this.beam.intensity = on * 520; this.beam.visible = on > 0.02;
    }
  }

  setVisible(v) { this.group.visible = v; }
  dispose() { this.scene.remove(this.group); this.coaches.dispose(); this.cBog.dispose(); this.lBog.dispose(); if (this.beam) { this.scene.remove(this.beam); this.scene.remove(this.beamTarget); } }
  spin() {}
}
