// Fully synthesised audio (no asset files): traction whine, rolling noise, rail clatter, brakes, horn, safety alarms.
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

export class AudioEngine {
  constructor() {
    this.ctx = null; this.enabled = false; this.volume = 0.7; this.lastBrake = 0; this.dist = 0; this.nextClack = 0;
    this.hornOn = false; this.beepT = 0; this.t = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.2;
      this.master.connect(comp); comp.connect(ctx.destination);
      // dry / tunnel-reverb buses
      this.dry = ctx.createGain(); this.dry.connect(this.master);
      this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(2.4, 2.2); this.wet = ctx.createGain(); this.wet.gain.value = 0; this.reverb.connect(this.wet); this.wet.connect(this.master);
      this.bus = ctx.createGain(); this.bus.connect(this.dry); this.bus.connect(this.reverb);
      this._build();
      this.enabled = true;
    } catch (e) { console.warn('audio init failed', e); }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _noiseBuffer(sec = 3, color = 'white') {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    return b;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
    return b;
  }

  _loopNoise(color, filterType, freq, q = 0.7) {
    const ctx = this.ctx; const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(3, color); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0; src.connect(f); f.connect(g); g.connect(this.bus); src.start();
    return { src, f, g };
  }

  _osc(type, freq) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq; const g = this.ctx.createGain(); g.gain.value = 0; o.connect(g); o.start(); return { o, g }; }

  _build() {
    const ctx = this.ctx;
    this.roll = this._loopNoise('pink', 'bandpass', 500, 0.5);
    this.rumble = this._loopNoise('pink', 'lowpass', 90, 0.7);
    this.wind = this._loopNoise('pink', 'lowpass', 600, 0.5);
    this.rain = this._loopNoise('white', 'highpass', 2500, 0.5);
    this.hiss = this._loopNoise('white', 'highpass', 4200, 0.6);
    this.squeal = this._loopNoise('white', 'bandpass', 3900, 14);
    this.ambient = this._loopNoise('pink', 'bandpass', 900, 0.3);
    // traction whine: stepped inverter harmonics + motor hum
    this.w1 = this._osc('sawtooth', 200); this.w2 = this._osc('square', 400); this.w3 = this._osc('sine', 120);
    for (const w of [this.w1, this.w2, this.w3]) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200; w.g.disconnect(); w.g.connect(lp); lp.connect(this.bus); }
    // horn (two-tone)
    this.h1 = this._osc('sawtooth', 370); this.h2 = this._osc('sawtooth', 466);
    const hl = ctx.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 1800; const hg = ctx.createGain(); hg.gain.value = 0.5;
    for (const h of [this.h1, this.h2]) { h.g.disconnect(); h.g.connect(hl); } hl.connect(hg); hg.connect(this.bus);
    // alarm tone (AWS / alerter)
    this.alarm = this._osc('square', 1000); const al = ctx.createBiquadFilter(); al.type = 'lowpass'; al.frequency.value = 2600; this.alarm.g.disconnect(); this.alarm.g.connect(al); al.connect(this.dry);
    this.clickBuf = this._clickBuffer();
  }

  _clickBuffer() {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * 0.12), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / ctx.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.9 + Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t * 45) * 0.8; }
    return b;
  }

  _click(vol, rate = 1) {
    const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this.clickBuf; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 0.8;
    s.connect(f); f.connect(g); g.connect(this.bus); s.start();
  }

  _tone(freq, dur, vol = 0.3, type = 'sine', delay = 0, dest) {
    if (!this.ctx) return; const ctx = this.ctx; const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.frequency.value = freq;
    const t0 = ctx.currentTime + delay; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(dest || this.dry); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  _burst(dur, vol, freq = 5000) { // pneumatic hiss
    const ctx = this.ctx; const s = ctx.createBufferSource(); s.buffer = this._noiseBuffer(1); const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
    const g = ctx.createGain(); const t0 = ctx.currentTime; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.bus); s.start(t0); s.stop(t0 + dur + 0.1);
  }

  /** Handle one-shot game events. */
  event(e) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    switch (e.type) {
      case 'horn-on': this.hornOn = true; break;
      case 'horn-off': this.hornOn = false; break;
      case 'aws-clear': this._tone(1568, 0.5, 0.18, 'sine'); this._tone(1175, 0.7, 0.14, 'sine', 0.08); break;       // bell
      case 'aws-ack': this._tone(880, 0.25, 0.14, 'triangle'); break;
      case 'doors-open': this._burst(0.9, 0.3, 3000); this._tone(740, 0.5, 0.16, 'sine'); this._tone(988, 0.7, 0.16, 'sine', 0.22); break;
      case 'doors-close': for (let i = 0; i < 3; i++) this._tone(988, 0.12, 0.14, 'square', i * 0.2); this._burst(0.8, 0.3, 3500); break;
      case 'boarding-done': this._tone(1320, 0.5, 0.14, 'sine'); break;
      case 'deny': this._tone(180, 0.22, 0.2, 'square'); break;
      case 'emergency': this._burst(2.2, 0.8, 1800); this._tone(300, 0.6, 0.18, 'sawtooth'); break;
      case 'spad': for (let i = 0; i < 6; i++) this._tone(1200, 0.14, 0.2, 'square', i * 0.22); break;
      case 'overspeed': this._tone(1400, 0.2, 0.14, 'triangle'); this._tone(1400, 0.2, 0.14, 'triangle', 0.25); break;
      case 'depart': this._tone(660, 0.3, 0.12, 'sine'); break;
      case 'signal-clear': this._tone(1046, 0.2, 0.08, 'sine'); break;
      case 'announce': this._tone(784, 0.6, 0.12, 'sine'); this._tone(659, 0.8, 0.12, 'sine', 0.3); this._speak(`Next station: ${e.name}`); break;
      case 'finished': [523, 659, 784, 1047].forEach((f, i) => this._tone(f, 0.9, 0.16, 'triangle', i * 0.16)); break;
      case 'failed': [392, 330, 262].forEach((f, i) => this._tone(f, 0.9, 0.18, 'sawtooth', i * 0.25)); break;
      case 'reset': this._tone(880, 0.2, 0.1, 'sine'); break;
    }
  }

  _speak(text) {
    try { if (!this.voice || !window.speechSynthesis) return; const u = new SpeechSynthesisUtterance(text); u.rate = 0.95; u.volume = 0.7 * this.volume; window.speechSynthesis.speak(u); } catch (e) { /* optional */ }
  }

  /** per-frame mix update */
  update(game, dt, env) {
    if (!this.enabled || this.ctx.state !== 'running') return;
    const ctx = this.ctx, now = ctx.currentTime, T = game.train; const v = Math.abs(T.v); this.t += dt;
    const sp = clamp(v / 45), set = (p, val, tc = 0.08) => p.setTargetAtTime(val, now, tc);
    const tun = env.tunnel || 0, rainK = env.weather === 'rain' ? 1 : env.weather === 'snow' ? 0.2 : 0;
    const cabMuffle = env.cab ? 1 : 0.65;   // exterior views are less enclosed
    set(this.wet.gain, tun * 0.55 + 0.05, 0.3);
    // rolling noise
    set(this.roll.g.gain, Math.pow(sp, 1.15) * 0.55 * (1 + tun * 0.9), 0.1); set(this.roll.f.frequency, 220 + sp * 900, 0.15);
    set(this.rumble.g.gain, Math.pow(sp, 0.8) * 0.9 * (1 + tun * 0.6), 0.1);
    set(this.wind.g.gain, Math.pow(sp, 2) * 0.35 * (1 - tun * 0.5) * (env.cab ? 0.6 : 1.4), 0.15); set(this.wind.f.frequency, 300 + sp * 900, 0.2);
    set(this.rain.g.gain, rainK * (0.1 + 0.12 * sp) * (1 - tun * 0.8) * (env.cab ? 1 : 0.6), 0.3);
    set(this.ambient.g.gain, (1 - sp) * 0.05 * (1 - tun), 0.5);
    // rail clatter every ~21 m with a double-click per bogie
    if (v > 0.8) {
      this.dist += v * dt;
      let k = 0; while (this.dist >= 21 && k++ < 3) {
        this.dist -= 21; const vol = clamp(sp * 1.1 + 0.05) * 0.45 * (1 + tun * 0.6);
        this._click(vol, 0.9 + Math.random() * 0.25); setTimeout(() => this.ctx && this._click(vol * 0.8, 1.0 + Math.random() * 0.2), 38 + 20 / (0.2 + sp));
      }
    } else this.dist = 0;
    // traction whine: pitch steps with speed (inverter gear shifts)
    const gate = T.traction * (T.slip ? 0.5 : 1);
    const step = Math.floor(v / 4.5), base = 150 + step * 55 + (v % 4.5) * 5;
    const coast = v > 4 && T.traction < 0.02 && T.brakeCyl < 0.05 ? 0.1 : 0;
    set(this.w1.o.frequency, base, 0.05); set(this.w2.o.frequency, base * 2.01, 0.05); set(this.w3.o.frequency, 95 + v * 2.2, 0.1);
    set(this.w1.g.gain, (gate * 0.07 + coast * 0.3) * cabMuffle, 0.12); set(this.w2.g.gain, (gate * 0.045) * cabMuffle, 0.12); set(this.w3.g.gain, (gate * 0.12 + (v > 1 ? 0.02 : 0)) * cabMuffle, 0.15);
    if (T.slip) set(this.w1.o.frequency, base * 0.6 + Math.sin(this.t * 40) * 40, 0.01);
    // brakes: hiss with application, squeal at low speed, release 'psssh'
    const dB = (T.brakeCyl - this.lastBrake) / Math.max(dt, 1e-3); this.lastBrake = T.brakeCyl;
    set(this.hiss.g.gain, clamp(Math.abs(dB) * 0.6) * 0.5 + (T.emergency ? 0.25 : 0), 0.05);
    const sq = T.brakeCyl > 0.15 && v > 0.6 && v < 14 ? clamp(T.brakeCyl) * (1 - v / 14) * (0.55 + 0.45 * Math.sin(this.t * 17)) : 0;
    set(this.squeal.g.gain, sq * 0.14, 0.04); set(this.squeal.f.frequency, 3000 + v * 130 + Math.sin(this.t * 3) * 200, 0.1);
    // horn
    const hv = this.hornOn ? 0.5 : 0; set(this.h1.g.gain, hv, 0.03); set(this.h2.g.gain, hv, 0.03);
    this.h1.o.frequency.value = 370 + Math.sin(this.t * 6) * 1.2; this.h2.o.frequency.value = 466 + Math.sin(this.t * 6.3) * 1.2;
    // alarms
    let alarm = 0;
    if (game.alert.aws > 0) alarm = Math.floor(this.t * 5) % 2 ? 0.16 : 0.0;
    if (game.alert.alerterAlarm) alarm = Math.floor(this.t * 3) % 2 ? 0.16 : 0.0;
    set(this.alarm.g.gain, alarm, 0.01); this.alarm.o.frequency.value = game.alert.aws > 0 ? 1000 : 1500;
  }

  suspend() { this.ctx?.suspend?.(); } resume() { this.ctx?.resume?.(); }
  silenceAll() { if (!this.enabled) return; const n = this.ctx.currentTime; for (const k of ['roll', 'rumble', 'wind', 'rain', 'hiss', 'squeal', 'ambient']) this[k].g.gain.setTargetAtTime(0, n, 0.05); for (const w of [this.w1, this.w2, this.w3, this.h1, this.h2, this.alarm]) w.g.gain.setTargetAtTime(0, n, 0.05); }
}
