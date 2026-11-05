import * as THREE from './three.js';

/** Driver's cab shell. Child of the camera; origin = driver's eyes, -z forward. */
export class Cab {
  constructor() {
    this.group = new THREE.Group();
    const trim = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.75, metalness: 0.2 });
    const dashMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.55, metalness: 0.3 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2c313a, roughness: 0.5, metalness: 0.4 });
    const panelMat = new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.3, metalness: 0.5 });
    const led = (c) => new THREE.MeshStandardMaterial({ color: 0x050505, emissive: c, emissiveIntensity: 1.8 });
    const box = (w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); this.group.add(o); return o; };

    // pillars & roof edge (framing the windscreen)
    box(0.16, 1.55, 0.18, trim, -1.02, 0.15, -0.95, 0, 0, -0.1);
    box(0.16, 1.55, 0.18, trim, 1.02, 0.15, -0.95, 0, 0, 0.1);
    box(2.3, 0.2, 0.7, trim, 0, 0.78, -0.75, 0.18);
    box(2.8, 0.12, 2.2, trim, 0, 0.92, 0.2);
    // side windows
    box(0.1, 1.6, 2.2, trim, -1.45, 0.1, 0.4); box(0.1, 1.6, 2.2, trim, 1.45, 0.1, 0.4);
    box(0.18, 0.2, 2.2, accent, -1.38, -0.28, 0.4); box(0.18, 0.2, 2.2, accent, 1.38, -0.28, 0.4);
    // floor and sub-dash
    box(2.9, 0.08, 3.0, trim, 0, -1.55, 0.0);
    box(2.4, 0.9, 0.5, trim, 0, -1.05, -0.78);
    // dash (angled top) with instrument hood
    const dash = box(2.35, 0.14, 0.85, dashMat, 0, -0.64, -0.72, -0.32);
    box(2.35, 0.24, 0.1, accent, 0, -0.5, -1.1, -0.1);
    this.screenPanel = box(0.95, 0.34, 0.03, panelMat, 0, -0.5, -0.9, -0.55);   // cluster sits here (HUD overlays it)
    this.screenPanel.visible = true;
    this.leds = null;
    // side console + master controller
    box(0.55, 0.12, 0.55, accent, 0.82, -0.7, -0.45, -0.1);
    this.leverPivot = new THREE.Group(); this.leverPivot.position.set(0.82, -0.66, -0.4);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.24, 10), accent); stalk.position.y = 0.12; this.leverPivot.add(stalk);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.3, metalness: 0.6 })); knob.position.y = 0.26; this.leverPivot.add(knob);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 14), new THREE.MeshStandardMaterial({ color: 0xff6a00 })); ring.position.y = 0.2; ring.rotation.x = Math.PI / 2; this.leverPivot.add(ring);
    this.group.add(this.leverPivot);
    // quadrant plate
    box(0.3, 0.012, 0.36, panelMat, 0.82, -0.63, -0.4, -0.1);
    // wipers
    this.wipers = [];
    for (const x of [-0.45, 0.35]) {
      const p = new THREE.Group(); p.position.set(x, -0.42, -1.06);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.5, 0.014), trim); arm.position.y = 0.25; p.add(arm);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.42, 0.014), panelMat); blade.position.set(0, 0.27, 0.0); p.add(blade);
      p.rotation.z = 0.0; this.group.add(p); this.wipers.push(p);
    }
    // warm dash glow so the cab is readable at night
    this.light = new THREE.PointLight(0xffd9a0, 0, 3, 2); this.light.position.set(0, -0.3, -0.2); this.group.add(this.light);
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.group.renderOrder = 5;
  }

  update(lever, night, raining, t, flags) {
    this.leverPivot.rotation.x = -lever * 0.62;                // forward = power
    this.light.intensity = 0.05 + night * 0.8;
    this.wipers.forEach((w, i) => {
      const park = (i ? -1 : 1) * 1.42;                      // lying along the scuttle
      const sweep = (Math.sin(t * 4.2 + i * 0.5) * 0.5 + 0.5);
      w.rotation.z = raining ? park * (1 - sweep * 1.55) : park;
    });
  }
}
