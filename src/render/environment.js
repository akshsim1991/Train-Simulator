import * as THREE from './three.js';
import { cloudTexture, glowTexture } from './textures.js';
import { mulberry32 } from '../sim/noise.js';

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const WEATHER_LOOK = {
  clear: { grey: 0.0, fog: 2300, cloud: 0.32, sun: 1.0, precip: null },
  rain: { grey: 0.78, fog: 1100, cloud: 1.0, sun: 0.32, precip: 'rain' },
  fog: { grey: 0.9, fog: 380, cloud: 0.6, sun: 0.25, precip: null },
  snow: { grey: 0.7, fog: 750, cloud: 0.9, sun: 0.45, precip: 'snow' },
};

// Most of the sky is evaluated per-vertex (a 64x32 sphere) so the full-screen fragment cost is tiny.
const SKY_VS = `
varying vec3 vDir; varying vec3 vCol;
uniform vec3 zenith, horizon, warm, sunDir, sunColor;
uniform float warmAmt, sunVis, grey;
void main(){
  vDir = normalize(position);
  vec3 d = vDir; float h = d.y;
  float up = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(horizon, zenith, up);
  float band = exp(-abs(h) * 5.0);
  vec2 hd = normalize(d.xz + 1e-4), sd = normalize(sunDir.xz + 1e-4);
  float toward = pow(max(dot(hd, sd), 0.0), 2.5);
  col = mix(col, warm, warmAmt * band * (0.25 + 0.75 * toward));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * sunVis * (pow(s, 12.0) * 0.55 * (1.0 - grey * 0.8) + pow(s, 3.0) * 0.16);
  if (h < 0.0) col = mix(horizon, horizon * 0.8, clamp(-h * 3.0, 0.0, 1.0));
  vCol = col;
  vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w;
}`;
const SKY_FS = `
varying vec3 vDir; varying vec3 vCol;
uniform vec3 sunDir, sunColor; uniform float sunVis, grey;
void main(){
  vec3 col = vCol;
  float s = dot(normalize(vDir), sunDir);
  if (s > 0.9996) col += sunColor * sunVis * smoothstep(0.99965, 0.99985, s) * 14.0 * (1.0 - grey);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Environment {
  constructor(renderer, scene, camera, quality, weather, startHour) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.quality = quality;
    this.weather = weather; this.look = WEATHER_LOOK[weather] || WEATHER_LOOK.clear;
    this.hourOffset = startHour;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0; this.tunnel = 0; this.dayAmt = 1;
    this.horizonColor = new THREE.Color();

    // --- sky dome -------------------------------------------------------------------------
    this.skyUniforms = {
      zenith: { value: new THREE.Vector3() }, horizon: { value: new THREE.Vector3() }, warm: { value: new THREE.Vector3(1, 0.35, 0.1) },
      sunDir: { value: this.sunDir }, sunColor: { value: new THREE.Vector3(1, 0.9, 0.7) }, warmAmt: { value: 0 }, sunVis: { value: 1 }, grey: { value: this.look.grey },
    };
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 64, 32), new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true }));
    this.sky.frustumCulled = false; this.sky.renderOrder = -10; scene.add(this.sky);

    // --- lights ---------------------------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows;
    const sc = this.sun.shadow.camera; const R = quality.shadowRange;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 500;
    this.sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap); this.sun.shadow.bias = -0.0003; this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun); scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0x9bbce8, 0x4a4234, 0.7); scene.add(this.hemi);

    // --- fog -----------------------------------------------------------------------------
    scene.fog = new THREE.Fog(0xaaccee, 60, this.look.fog);

    // --- stars ----------------------------------------------------------------------------
    const r = mulberry32(99); const n = 1800; const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const u = r() * 2 - 1, a = r() * 6.283, q = Math.sqrt(1 - u * u); pos[i * 3] = q * Math.cos(a) * 4800; pos[i * 3 + 1] = Math.abs(u) * 4800; pos[i * 3 + 2] = q * Math.sin(a) * 4800; }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 3.4, map: glowTexture(), sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.stars.renderOrder = -9; scene.add(this.stars);

    // --- clouds ---------------------------------------------------------------------------
    this.clouds = []; const tex = cloudTexture(4); const rr = mulberry32(5);
    const count = Math.max(3, Math.round(quality.clouds * (0.6 + 0.5 * this.look.cloud)));
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.5 * this.look.cloud + 0.2 });
      const sp = new THREE.Sprite(m); const ang = rr() * 6.283, dist = 1500 + rr() * 2600;
      sp.userData = { x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, y: 380 + rr() * 520 + (1 - this.look.cloud) * 150, speed: 3 + rr() * 4 };
      const sz = 700 + rr() * 900; sp.scale.set(sz, sz * 0.4, 1);
      sp.renderOrder = -8; scene.add(sp); this.clouds.push(sp);
    }

    // --- precipitation --------------------------------------------------------------------
    this.precip = null;
    if (this.look.precip && quality.precip) this._makePrecip(this.look.precip);

    // --- image based lighting from the sky ------------------------------------------------
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, this.sky.material); this.envScene.add(this.envSky);
    this.lastEnv = -1e9;
    this.wet = (weather === 'rain') ? 1 : (weather === 'snow' ? 0.5 : 0);
  }

  _makePrecip(kind) {
    const n = kind === 'rain' ? 3200 : 4200, W = 70, H = 40;
    const r = mulberry32(7); const pos = new Float32Array(n * (kind === 'rain' ? 6 : 3));
    this.precipData = { kind, n, W, H, p: new Float32Array(n * 3) };
    for (let i = 0; i < n; i++) { this.precipData.p[i * 3] = (r() - 0.5) * W; this.precipData.p[i * 3 + 1] = (r() - 0.2) * H; this.precipData.p[i * 3 + 2] = (r() - 0.5) * W; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.precip = kind === 'rain'
      ? new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.32, depthWrite: false }))
      : new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
    this.precip.frustumCulled = false; this.scene.add(this.precip);
  }

  _updatePrecip(dt, cam, vel) {
    const d = this.precipData; if (!d) return;
    const pos = this.precip.geometry.attributes.position.array; const t = performance.now() / 1000;
    const fall = d.kind === 'rain' ? 24 : 1.4;
    for (let i = 0; i < d.n; i++) {
      let x = d.p[i * 3], y = d.p[i * 3 + 1], z = d.p[i * 3 + 2];
      x += (-vel.x + (d.kind === 'snow' ? Math.sin(t + i) * 0.4 : 1.5)) * dt; z += (-vel.z) * dt; y -= (fall + (-vel.y)) * dt;
      if (y < -8) y += d.H; if (y > d.H - 8) y -= d.H;
      if (x > d.W / 2) x -= d.W; if (x < -d.W / 2) x += d.W; if (z > d.W / 2) z -= d.W; if (z < -d.W / 2) z += d.W;
      d.p[i * 3] = x; d.p[i * 3 + 1] = y; d.p[i * 3 + 2] = z;
      if (d.kind === 'rain') {
        const L = 0.55; const k = i * 6;
        pos[k] = cam.x + x; pos[k + 1] = cam.y + y; pos[k + 2] = cam.z + z;
        pos[k + 3] = cam.x + x + vel.x * 0.012 * -1 * 0.6; pos[k + 4] = cam.y + y + L; pos[k + 5] = cam.z + z + vel.z * 0.012 * -1 * 0.6;
      } else { const k = i * 3; pos[k] = cam.x + x; pos[k + 1] = cam.y + y; pos[k + 2] = cam.z + z; }
    }
    this.precip.geometry.attributes.position.needsUpdate = true;
  }

  /** hour: fractional hour of day; tunnel: 0..1; vel: camera velocity (m/s) */
  update(clockSec, cam, dt, tunnelTarget, vel) {
    const hour = (clockSec / 3600) % 24;
    this.tunnel += (tunnelTarget - this.tunnel) * Math.min(1, dt * 4);
    // sun position (latitude 45, mild summer declination)
    const lat = 45 * Math.PI / 180, dec = 12 * Math.PI / 180, H = (hour - 12) * 15 * Math.PI / 180;
    const sinE = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
    const e = Math.asin(sinE); const eDeg = e * 180 / Math.PI;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat));
    this.sunDir.set(-Math.sin(az) * Math.cos(e), sinE, Math.cos(az) * Math.cos(e)).normalize();

    const grey = this.look.grey;
    const tDay = sstep(-5, 14, eDeg);
    this.dayAmt = tDay; this.night = 1 - sstep(-9, 2, eDeg);
    const warmAmt = Math.exp(-Math.pow((eDeg - 1) / 9, 2)) * (1 - grey * 0.7);

    let zen = mix3([0.002, 0.004, 0.014], [0.10, 0.26, 0.58], tDay);
    let hor = mix3([0.008, 0.012, 0.03], [0.50, 0.68, 0.86], tDay);
    zen = mix3(zen, [0.14, 0.12, 0.26], warmAmt * 0.45 * tDay);
    const lum = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const gz = lum(zen) * 1.15, gh = lum(hor) * 1.1;
    zen = mix3(zen, [gz, gz, gz * 1.04], grey); hor = mix3(hor, [gh, gh, gh * 1.03], grey);
    this.skyUniforms.zenith.value.set(...zen); this.skyUniforms.horizon.value.set(...hor);
    this.skyUniforms.warmAmt.value = warmAmt; this.skyUniforms.sunVis.value = sstep(-4, 1, eDeg);
    const sunCol = mix3([1.0, 0.45, 0.16], [1.0, 0.95, 0.86], sstep(0, 22, eDeg));
    this.skyUniforms.sunColor.value.set(...sunCol);
    this.sky.position.copy(cam); this.envSky.position.set(0, 0, 0);

    // fog follows the horizon colour, warmed near sunset
    const fogC = mix3(hor, [0.85, 0.42, 0.22], warmAmt * 0.3);
    const insideC = [0.012, 0.012, 0.014];
    const fc = mix3(fogC, insideC, this.tunnel);
    this.scene.fog.color.setRGB(...fc);
    this.scene.fog.far = this.look.fog * (1 - this.tunnel) + 180 * this.tunnel;
    this.scene.fog.near = 40 * (1 - this.tunnel) + 20 * this.tunnel + (grey > 0.8 ? -20 : 0);
    if (this.weather === 'fog') this.scene.fog.near = 5;

    // lights
    const open = 1 - this.tunnel;
    const sunI = sstep(-3, 12, eDeg) * 2.5 * this.look.sun * open;
    this.sun.intensity = sunI; this.sun.color.setRGB(...sunCol);
    this.sun.position.copy(cam).addScaledVector(this.sunDir, 250); this.sun.target.position.copy(cam);
    this.sun.castShadow = this.quality.shadows && sunI > 0.05;
    this.hemi.intensity = (0.75 + 0.55 * tDay * (1 - 0.35 * grey)) * (0.12 + 0.88 * open) + this.tunnel * 1.7;
    this.hemi.color.setRGB(0.28 + zen[0] * 2.2, 0.36 + zen[1] * 2.0, 0.58 + zen[2] * 1.6); this.hemi.groundColor.setRGB(0.16, 0.14, 0.12);
    this.scene.environmentIntensity = (0.12 + 0.5 * tDay * (1 - 0.3 * grey)) * (0.05 + 0.95 * open);
    // eye adaptation: brighten the image as the world darkens (never inside tunnels, which are lit artificially)
    this.renderer.toneMappingExposure = (1.0 + 2.3 * this.night * (1 - grey * 0.3)) * (1 - 0.35 * this.tunnel) * (this.weather === 'fog' ? 1.1 : 1);
    this.stars.material.opacity = Math.max(0, this.night * (1 - grey)); this.stars.position.copy(cam);

    // clouds
    const lit = mix3([0.03, 0.035, 0.05], [1, 1, 1], tDay); const wc = mix3(lit, [lit[0] * 0.55, lit[1] * 0.57, lit[2] * 0.6], grey);
    const sunsetTint = warmAmt * 0.6;
    const t = performance.now() / 1000;
    for (const c of this.clouds) {
      const u = c.userData;
      let x = u.x + u.speed * t, z = u.z; x = ((x + 4500) % 9000 + 9000) % 9000 - 4500;
      c.position.set(cam.x + x, u.y, cam.z + z);
      c.material.color.setRGB(wc[0] * (1 + sunsetTint * 0.2), wc[1] * (1 - sunsetTint * 0.2), wc[2] * (1 - sunsetTint * 0.55));
      c.visible = open > 0.5;
    }
    // IBL refresh from the sky when lighting changed enough
    if (clockSec - this.lastEnv > 45 || this.lastEnv < 0) { this._refreshEnv(); this.lastEnv = clockSec; }
    this._updatePrecip(dt, cam, vel || new THREE.Vector3());
    if (this.precip) this.precip.visible = open > 0.3;
  }

  _refreshEnv() {
    const rt = this.pmrem.fromScene(this.envScene, 0.0, 0.1, 100);
    if (this.scene.environment && this.scene.environment !== rt.texture) this._lastRT?.dispose();
    this.scene.environment = rt.texture; this._lastRT = rt;
  }
}
