import * as THREE from './three.js';
import { frameAt } from './geom.js';
import { Terrain } from './terrain.js';
import { TrackBuilder } from './track.js';
import { Structures } from './structures.js';
import { Environment } from './environment.js';
import { TrainModel } from './trainmodel.js';
import { Cab } from './cab.js';
import { UNIT } from '../sim/physics.js';
import { fbm } from '../sim/noise.js';

export const QUALITY = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 1024, shadowRange: 70, radius: 1500, trees: false, bloom: false, clouds: 8, precip: true, catenary: false, msaa: 0 },
  medium: { pixelRatio: 1, shadows: true, shadowMap: 2048, shadowRange: 90, radius: 2000, trees: true, bloom: true, clouds: 14, precip: true, catenary: true, msaa: 2 },
  high: { pixelRatio: Math.min(2, (typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1)), shadows: true, shadowMap: 4096, shadowRange: 110, radius: 2500, trees: true, bloom: true, clouds: 22, precip: true, catenary: true, msaa: 4 },
};

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
    this.q = QUALITY[opts.quality] || QUALITY.medium;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.msaa === 0, powerPreference: 'high-performance' });
    r.info.autoReset = false;
    r.setPixelRatio(this.q.pixelRatio); r.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
    r.shadowMap.enabled = this.q.shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.12, 6500);
    this.scene.add(this.camera);
    this.env = new Environment(r, this.scene, this.camera, this.q, opts.weather, opts.startHour);
    this.terrain = new Terrain(this.scene, route, this.q, opts.weather);
    this.track = new TrackBuilder(this.scene, route, this.q);
    this.structs = new Structures(this.scene, route, this.q);
    this.train = new TrainModel(this.scene, route, UNIT);
    this.cab = new Cab(); this.camera.add(this.cab.group);
    this.mode = 'cab'; this.modeBlend = 0;
    this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.prevPos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.lineside = { s: -1 };
    this.shake = { x: 0, y: 0, roll: 0 };
    this.fov = 62; this._time = 0; this.snap = true;
    this._setupComposer();
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
    this.renderer.setSize(w, h, false); this.composer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
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
      const se = sFront - 2.4;
      const f = frameAt(R, se, 0, 2.85);
      const rough = Math.min(1, Math.abs(T.v) / 30);
      const t = this._time;
      const jx = (fbm(t * 5.1, 1.7, 3, 2) - 0.5) * 0.014 * rough, jy = (fbm(t * 6.3, 9.2, 4, 2) - 0.5) * 0.02 * rough;
      this.shake.roll += ((-game.lat * 0.012) - this.shake.roll) * Math.min(1, dt * 3);
      const bob = Math.sin(Math.abs(T.s) * 1.55) * 0.0035 * rough;
      target.set(f.x + f.p.nx * jx, f.y + jy + bob, f.z + f.p.nz * jx);
      yaw = -f.p.heading; pitch = Math.atan(f.p.grade) - Math.max(-0.02, Math.min(0.02, T.a * 0.012)); roll = -f.p.bank * 0.7 + this.shake.roll + (fbm(t * 3.3, 5.5, 7, 2) - 0.5) * 0.006 * rough;
      this.camera.rotation.order = 'YXZ'; this.camera.rotation.set(pitch, yaw, roll);
    } else if (mode === 'follow') {
      const f = frameAt(R, sFront - 30, 0, 9.5); const g = frameAt(R, sFront + 60, 0, 1.5);
      target.set(f.x, f.y, f.z); lookAt = new THREE.Vector3(g.x, g.y, g.z);
    } else { // lineside TV camera
      if (this.lineside.s < 0 || sFront - this.lineside.s > 40 || this.lineside.s - sFront > 520) {
        const ahead = 140 + Math.min(260, Math.abs(T.v) * 5); const ss = Math.min(R.length - 30, sFront + ahead);
        this.lineside.s = ss; const side = (Math.floor(ss / 400) % 2) ? 1 : -1; this.lineside.side = side;
        const f = frameAt(R, ss, side * (9 + (Math.floor(ss) % 5)), 0); const gy = Math.max(R.terrainHeight(f.x, f.z), f.y - 1) + 1.7;
        this.lineside.pos = new THREE.Vector3(f.x, Math.min(gy, f.y + 4), f.z);
      }
      target.copy(this.lineside.pos); const g = frameAt(R, sFront - 20, 0, 2); lookAt = new THREE.Vector3(g.x, g.y, g.z);
    }
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
    const inTunnel = R.inTunnel(mode === 'cab' ? sFront - 2.4 : (R.nearest(camP.x, camP.z, 50)?.s ?? sFront)) ? 1 : 0;
    this.env.update(game.clock, camP, dt, inTunnel, this.vel.clone());
    const heading = p0.heading;
    this.terrain.update({ x: camP.x, z: camP.z }, heading, 5);
    this.track.update(sFront);
    this.terrain.animate(this._time, camP);
    this.structs.update(camP, this.env.night, this.env.tunnel);
    this.train.group.visible = mode !== 'cab';
    this.train.update(sFront, this.env.night, this.env.tunnel, T.v);
    this.train.spin(T.v * dt);
    if (this.train.beam) this.train.beam.visible = true;
    this.applyState(game);
    const raining = this.env.weather === 'rain' || this.env.weather === 'snow';
    this.cab.update(T.lever, this.env.night, this.env.weather === 'rain', this._time, { aws: game.alert.aws > 0, doorsOpen: game.doors.open, slip: T.slip });
    this.grade.uniforms.time.value = this._time % 10; this.grade.uniforms.tunnel.value = this.env.tunnel;
    if (this.bloom) this.bloom.strength = 0.3 + 0.45 * this.env.night + 0.2 * this.env.tunnel;
    this.renderer.info.reset();
    this.composer.render();
  }

  dispose() { this.renderer.dispose(); }
}
