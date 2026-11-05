import * as THREE from './three.js';
import { frameAt } from './geom.js';
import { Terrain } from './terrain.js';
import { TrackBuilder } from './track.js';
import { Structures } from './structures.js';
import { Environment } from './environment.js';
import { TrainModel } from './trainmodel.js';
import { Traffic } from './traffic.js';
import { Cab } from './cab.js';
import { fbm } from '../sim/noise.js';

const dpr = () => (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);
// Presets are deliberately conservative: the adaptive resolution scaler below can only lower cost, never raise it
// past what the preset allows. "post" = full-screen bloom/grade pipeline (high only).
export const QUALITY = {
  low:    { pixelRatio: 1, shadows: false, shadowMap: 1024, shadowRange: 50, radius: 1300, trees: true,  treeScale: 0.45, bloom: false, post: false, clouds: 4,  precip: true, catenary: true, msaa: 0 },
  medium: { pixelRatio: Math.min(1, dpr()), shadows: true, shadowMap: 1024, shadowRange: 55, radius: 1700, trees: true,  treeScale: 0.8, bloom: false, post: false, clouds: 6,  precip: true, catenary: true, msaa: 0 },
  high:   { pixelRatio: Math.min(1.5, dpr()), shadows: true, shadowMap: 2048, shadowRange: 70, radius: 2100, trees: true, treeScale: 1.0, bloom: true,  post: true,  clouds: 9,  precip: true, catenary: true, msaa: 2 },
};

/** Choose a preset from the GPU name (integrated / software GPUs get Low). */
export function detectQuality() {
  try {
    const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info'); const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) return 'low';
    if (/apple m[2-9]|rtx|rx [5-9]\d{3}|radeon pro|geforce (gtx )?(10[6-9]|16|20|30|40)/i.test(name)) return 'high';
    if (/intel|uhd|iris|mali|adreno|vega [0-9]|radeon\(tm\) graphics|gtx (9|10[0-5])|mx\d/i.test(name)) return 'low';
    return 'medium';
  } catch (e) { return 'low'; }
}

const GRADE_SHADER = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.35 }, grain: { value: 0.025 }, time: { value: 0 }, tunnel: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float vignette, grain, time, tunnel; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * vignette * 2.2; c.rgb *= v;
      c.rgb += (rnd(vUv * 900.0 + time) - 0.5) * grain;
      // gentle contrast / saturation grade
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114)); c.rgb = mix(vec3(l), c.rgb, 1.08);
      c.rgb = c.rgb * 1.03 + (c.rgb - 0.5) * 0.04;
      gl_FragColor = c;
    }`,
};

export class View {
  constructor(canvas, route, opts) {
    this.canvas = canvas; this.route = route; this.opts = opts;
    this.q = { ...(QUALITY[opts.quality] || QUALITY.low) }; this.baseRatio = this.q.pixelRatio; this.scale = 1; this.ema = 16; this.slowT = 0; this.fastT = 0; this.degradeLevel = 0;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.msaa === 0, powerPreference: 'high-performance' });
    r.info.autoReset = false;
    r.setPixelRatio(this.q.pixelRatio); r.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
    r.shadowMap.enabled = this.q.shadows; r.shadowMap.type = THREE.PCFShadowMap; r.shadowMap.autoUpdate = false; this._shadowTick = 0;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.12, 6500);
    this.scene.add(this.camera);
    this.env = new Environment(r, this.scene, this.camera, this.q, opts.weather, opts.startHour, route.haze);
    this.terrain = new Terrain(this.scene, route, this.q, opts.weather);
    this.track = new TrackBuilder(this.scene, route, this.q);
    this.structs = new Structures(this.scene, route, this.q);
    this.train = new TrainModel(this.scene, route, opts.unit, { beam: true });
    this.traffic = new Traffic(this.scene, route, opts.seed || 1);
    this.cab = new Cab(); this.camera.add(this.cab.group);
    this.mode = 'cab'; this.modeBlend = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.prevPos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.lineside = { s: -1 };
    this.shake = { x: 0, y: 0, roll: 0 };
    this.fov = 62; this._time = 0; this.snap = true;
    if (this.q.post) this._setupComposer();
    this.track.setWet(this.env.wet);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _setupComposer() {
    const r = this.renderer; const size = r.getSize(new THREE.Vector2());
    const pr = r.getPixelRatio();
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: this.q.msaa });
    this.composer = new THREE.EffectComposer(r, target);
    this.composer.addPass(new THREE.RenderPass(this.scene, this.camera));
    if (this.q.bloom) { this.bloom = new THREE.UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.38, 0.7, 0.92); this.composer.addPass(this.bloom); }
    this.composer.addPass(new THREE.OutputPass());
    this.grade = new THREE.ShaderPass(GRADE_SHADER); this.composer.addPass(this.grade);
  }

  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false); this.composer?.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setMode(m) { this.mode = m; this.lineside.s = -1; this.snap = true; }

  async preload(s, onProgress) {
    const p = frameAt(this.route, s, 0, 0).p;
    this.track.preload(s);
    await this.terrain.preload({ x: p.x, z: p.z }, p.heading, onProgress);
  }

  applyState(game) {
    // lights & signals
    for (const sg of game.signals) this.structs.setAspect(sg.id, sg.aspect);
    const rec = game.stopRec;
    for (let i = 0; i < rec.length; i++) {
      if (rec[i].served && i === game.stationIdx) this.structs.setBoarding(i, game.doors.boardDone ? 1 : Math.min(1, game.doors.boarding / Math.max(1, game.doors.boardTime)));
      else if (rec[i].served) this.structs.setBoarding(i, 1);
    }
  }

  update(game, dt) {
    const R = this.route, T = game.train; this._time += dt;
    const sFront = T.s;
    // --- camera pose -------------------------------------------------------------------
    const mode = this.mode; const fovBase = 60 + Math.min(14, Math.abs(T.v) * 0.22);
    let target = new THREE.Vector3(), lookAt = null, roll = 0, pitch = 0, yaw = 0;
    const p0 = R.at(sFront);
    if (mode === 'cab') {
      const se = sFront - 2.6;
      const f = frameAt(R, se, -0.55, 3.15);
      const rough = Math.min(1, Math.abs(T.v) / 30);
      const t = this._time;
      const jx = (fbm(t * 5.1, 1.7, 3, 2) - 0.5) * 0.014 * rough, jy = (fbm(t * 6.3, 9.2, 4, 2) - 0.5) * 0.02 * rough;
      this.shake.roll += ((-game.lat * 0.012) - this.shake.roll) * Math.min(1, dt * 3);
      const bob = Math.sin(Math.abs(T.s) * 1.55) * 0.0035 * rough;
      target.set(f.x + f.p.nx * jx, f.y + jy + bob, f.z + f.p.nz * jx);
      yaw = -f.p.heading; pitch = Math.atan(f.p.grade) - Math.max(-0.02, Math.min(0.02, T.a * 0.012)); roll = -f.p.bank * 0.7 + this.shake.roll + (fbm(t * 3.3, 5.5, 7, 2) - 0.5) * 0.006 * rough;
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(pitch, yaw, roll);
    } else if (mode === 'follow') {
      const f = frameAt(R, sFront - 34, -1.5, 9.5); const g = frameAt(R, sFront + 70, 0, 2.5);
      target.set(f.x, f.y, f.z); lookAt = new THREE.Vector3(g.x, g.y, g.z);
    } else { // lineside TV camera
      if (this.lineside.s < 0 || sFront - this.lineside.s > 40 || this.lineside.s - sFront > 520) {
        const ahead = 60 + Math.min(160, Math.abs(T.v) * 2.2); const ss = Math.min(R.length - 30, sFront + ahead);
        this.lineside.s = ss; const side = (Math.floor(ss / 400) % 2) ? 1 : -1; this.lineside.side = side;
        const f = frameAt(R, ss, side * (6.5 + (Math.floor(ss) % 4)), 0); const gy = Math.max(R.terrainHeight(f.x, f.z), f.y - 0.5) + 1.6;
        this.lineside.pos = new THREE.Vector3(f.x, Math.min(gy, f.y + 3.2), f.z);
      }
      target.copy(this.lineside.pos); const aim = Math.max(sFront - 25, Math.min(sFront - 5, this.lineside.s - 6)); const g = frameAt(R, aim, 0, 2); lookAt = new THREE.Vector3(g.x, g.y, g.z);
    }
    if (this.freeCam) { target.copy(this.freeCam.pos); lookAt = this.freeCam.look.clone(); }
    if (mode !== 'cab') { if (this.snap) this.camera.position.copy(target); else this.camera.position.lerp(target, 1 - Math.exp(-dt * (mode === 'follow' ? 8 : 20))); this.camera.lookAt(lookAt); }
    else this.camera.position.copy(target);
    const fov = mode === 'cab' ? fovBase : (mode === 'follow' ? 58 : 38);
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 4); this.camera.updateProjectionMatrix();
    this.snap = false;
    this.cab.group.visible = mode === 'cab';
    this.camera.updateMatrixWorld(true);

    // velocity (for rain)
    this.vel.copy(this.camera.position).sub(this.prevPos).divideScalar(Math.max(dt, 1e-3)); this.prevPos.copy(this.camera.position);

    // --- world ---------------------------------------------------------------------------
    const camP = this.camera.position;
    const inTunnel = R.inTunnel(mode === 'cab' ? sFront - 2.6 : (R.nearest(camP.x, camP.z, 50)?.s ?? sFront)) ? 1 : 0;
    this.env.update(game.clock, camP, dt, inTunnel, this.vel.clone());
    const heading = p0.heading;
    this.terrain.update({ x: camP.x, z: camP.z }, heading, 5);
    this.track.update(sFront);
    this.terrain.animate(this._time, camP);
    this.structs.update(camP, this.env.night, this.env.tunnel);
    this.train.setVisible(mode !== 'cab');
    this.train.update(sFront, this.env.night, this.env.tunnel);
    this.traffic.update(dt, sFront, Math.abs(T.v), this.env.night, this.env.tunnel);
    this.applyState(game);
    const raining = this.env.weather === 'rain' || this.env.weather === 'snow';
    this.cab.update(T.lever, this.env.night, this.env.weather === 'rain', this._time, { brakeCyl: T.brakeCyl, traction: T.traction, speedKmh: Math.abs(T.v) * 3.6 });
    if (this.grade) { this.grade.uniforms.time.value = this._time % 10; this.grade.uniforms.tunnel.value = this.env.tunnel; }
    if (this.bloom) this.bloom.strength = 0.3 + 0.45 * this.env.night + 0.2 * this.env.tunnel;
    this.renderer.info.reset();
    if (this.q.shadows && (this._shadowTick++ & 1) === 0) this.renderer.shadowMap.needsUpdate = true;   // shadows every 2nd frame
    if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this._adapt(dt);
  }

  /** Adaptive resolution: keep the frame time near 60 fps by scaling the render resolution, then shed features. */
  _adapt(dt) {
    if (dt <= 0 || dt > 0.5) return;
    this.ema += (dt * 1000 - this.ema) * 0.05;
    if (this.ema > 22) { this.slowT += dt; this.fastT = 0; } else if (this.ema < 14.5) { this.fastT += dt; this.slowT = 0; } else { this.slowT = 0; this.fastT = 0; }
    if (this.slowT > 1.2) {
      this.slowT = 0;
      if (this.scale > 0.55) this._setScale(this.scale * 0.86);
      else if (this.ema > 30) this._degrade();
    } else if (this.fastT > 5 && this.scale < 1) { this.fastT = 0; this._setScale(Math.min(1, this.scale * 1.08)); }
  }
  _setScale(sc) {
    this.scale = sc; const pr = this.baseRatio * sc; this.renderer.setPixelRatio(pr); this.composer?.setPixelRatio?.(pr);
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight; this.renderer.setSize(w, h, false); this.composer?.setSize(w, h);
  }
  _degrade() {
    this.degradeLevel++;
    if (this.degradeLevel === 1) { this.q.shadows = false; this.renderer.shadowMap.enabled = false; this.env.sun.castShadow = false; this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
    else if (this.degradeLevel === 2) { this.terrain.maxRadius = Math.max(900, this.terrain.maxRadius * 0.7); this.scene.fog.far = Math.min(this.scene.fog.far, this.terrain.maxRadius); }
    this.ema = 16; this.onDegrade?.(this.degradeLevel);
  }

  dispose() {
    this.composer?.dispose?.();
    this.terrain.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss();      // release all GPU resources; the next journey gets a fresh canvas
  }
}
