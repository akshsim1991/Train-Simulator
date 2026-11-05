import * as THREE from './three.js';

function dialTexture(label, unit, max, ticks, colorZones = []) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#0b0e12'; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill(); g.strokeStyle = '#2e353f'; g.lineWidth = 6; g.stroke();
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
  for (const [from, to, col] of colorZones) { g.strokeStyle = col; g.lineWidth = 8; g.beginPath(); g.arc(128, 128, 104, a0 + span * from / max, a0 + span * to / max); g.stroke(); }
  g.fillStyle = '#e9eef4'; g.strokeStyle = '#e9eef4'; g.font = 'bold 20px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = 0; i <= ticks; i++) { const a = a0 + span * i / ticks, v = Math.round(max * i / ticks); g.lineWidth = 3; g.beginPath(); g.moveTo(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112); g.lineTo(128 + Math.cos(a) * 98, 128 + Math.sin(a) * 98); g.stroke(); g.fillText(String(v), 128 + Math.cos(a) * 76, 128 + Math.sin(a) * 76); }
  g.font = 'bold 22px system-ui'; g.fillStyle = '#ffb43a'; g.fillText(label, 128, 170); g.font = '16px system-ui'; g.fillStyle = '#9fb0c3'; g.fillText(unit, 128, 194);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Driver's cab shell of an Indian electric loco. Child of the camera; origin = driver's eyes (seated on the left), -z forward. */
export class Cab {
  constructor() {
    this.group = new THREE.Group();
    const trim = new THREE.MeshLambertMaterial({ color: 0x1d2530 }), blue = new THREE.MeshLambertMaterial({ color: 0x1c4f9c }), light = new THREE.MeshLambertMaterial({ color: 0xc9d1d9 });
    const dash = new THREE.MeshLambertMaterial({ color: 0x27303b }), black = new THREE.MeshLambertMaterial({ color: 0x0b0d10 }), metal = new THREE.MeshStandardMaterial({ color: 0xaab2bb, metalness: 0.8, roughness: 0.35 });
    const box = (w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); this.group.add(o); return o; };

    // windscreen frame: two panes with a centre pillar (the driver sits left of it)
    box(0.15, 1.6, 0.18, trim, -1.12, 0.12, -0.95, 0, 0, -0.12); box(0.15, 1.6, 0.18, trim, 1.28, 0.12, -0.95, 0, 0, 0.12);
    box(0.13, 1.5, 0.16, trim, 0.62, 0.12, -1.0);                                   // centre pillar
    box(2.5, 0.2, 0.7, trim, 0.1, 0.78, -0.8, 0.18);                                // header
    box(3.0, 0.1, 2.4, light, 0.1, 0.95, 0.3);                                       // ceiling
    box(0.1, 1.7, 2.4, trim, -1.5, 0.1, 0.4); box(0.1, 1.7, 2.4, trim, 1.7, 0.1, 0.4);       // side walls
    box(0.2, 0.2, 2.3, blue, -1.42, -0.3, 0.4); box(0.2, 0.2, 2.3, blue, 1.62, -0.3, 0.4);   // sills (blue like the shell)
    box(3.2, 0.08, 3.0, black, 0.1, -1.6, 0.0);                                       // floor
    // main desk
    box(2.8, 0.9, 0.55, trim, 0.1, -1.1, -0.8);
    box(2.8, 0.1, 0.9, dash, 0.1, -0.68, -0.78, -0.3);                                // desk top (sloped)
    box(2.8, 0.22, 0.12, blue, 0.1, -0.52, -1.18, -0.15);                             // blue cowl under the glass
    // monitors / panels (dark glass) on the desk
    box(0.6, 0.3, 0.03, black, 0.62, -0.52, -0.95, -0.55); box(0.5, 0.3, 0.03, black, -0.1, -0.52, -0.95, -0.55);
    // analog dials: brake cylinder (left) and traction current (right)
    const mkDial = (tex, x, y, z) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.075, 28), new THREE.MeshBasicMaterial({ map: tex })); m.position.set(x, y, z); m.rotation.x = -0.55; this.group.add(m);
      const n = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.06, 0.004), new THREE.MeshBasicMaterial({ color: 0xff7a1a })); const pv = new THREE.Group(); pv.position.set(x, y, z + 0.004); pv.rotation.x = -0.55; n.position.y = 0.027; pv.add(n); this.group.add(pv); return pv; };
    this.dialBrake = mkDial(dialTexture('BC', 'kg/cm²', 5, 5, [[3.4, 5, '#c33']]), -1.0, -0.46, -0.92);
    this.dialAmps = mkDial(dialTexture('TE', 'kA', 1, 5, [[0.85, 1, '#c33']]), 1.36, -0.46, -0.92);
    this.dialSpeed = { rotation: { z: 0 } };
    // power handle (right) and brake handle (left): both are the single master controller shown on two quadrants
    const handle = (x, col) => { const p = new THREE.Group(); p.position.set(x, -0.64, -0.5); const st = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.26, 8), metal); st.position.y = 0.13; p.add(st);
      const kn = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 })); kn.position.y = 0.28; p.add(kn); this.group.add(p); return p; };
    this.powerHandle = handle(1.0, 0x20a05a); this.brakeHandle = handle(-0.95, 0xd9822b);
    box(0.34, 0.016, 0.34, black, 1.0, -0.655, -0.5, -0.1); box(0.34, 0.016, 0.34, black, -0.95, -0.655, -0.5, -0.1);
    // wipers
    this.wipers = [];
    for (const x of [-0.5, 0.95]) { const p = new THREE.Group(); p.position.set(x, -0.42, -1.1); const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.5, 0.014), trim); arm.position.y = 0.25; p.add(arm); const bl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.42, 0.014), black); bl.position.set(0, 0.27, 0); p.add(bl); this.group.add(p); this.wipers.push(p); }
    this.light = new THREE.PointLight(0xffd9a0, 0, 3, 2); this.light.position.set(0.1, -0.2, -0.2); this.group.add(this.light);
    this.group.renderOrder = 5;
  }

  update(lever, night, raining, t, state) {
    this.powerHandle.rotation.x = -Math.max(0, lever) * 0.9; this.brakeHandle.rotation.x = -Math.max(0, -lever) * 0.9;
    this.light.intensity = 0.05 + night * 0.8;
    this.wipers.forEach((w, i) => { const park = (i ? -1 : 1) * 1.42, sw = Math.sin(t * 4.2 + i * 0.5) * 0.5 + 0.5; w.rotation.z = raining ? park * (1 - sw * 1.55) : park; });
    if (state) {
      const a0 = Math.PI * 0.75, span = Math.PI * 1.5, ang = (f) => -(a0 + span * Math.max(0, Math.min(1, f))) + Math.PI * 0.5 + Math.PI;   // dial needle pivot
      const set = (pv, f) => { pv.rotation.z = -(a0 + span * Math.max(0, Math.min(1, f)) - Math.PI * 0.5) ; };
      set(this.dialBrake, state.brakeCyl); set(this.dialAmps, state.traction); set(this.dialSpeed, state.speedKmh / 160);
    }
  }
}
