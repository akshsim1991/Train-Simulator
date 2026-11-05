// Game rules on top of physics + route: signals, safety systems, doors, timetable, scoring.
import { newTrainState, stepTrain, UNIT, G } from './physics.js';
import { mulberry32 } from './noise.js';

export const FIXED_DT = 1 / 120;
const TRAIN_LEN = UNIT.cars * UNIT.carLength; // 160 m
const KMH = 3.6;

export const WEATHER = {
  clear: { adhesion: 0.30, label: 'Clear' },
  rain: { adhesion: 0.19, label: 'Rain' },
  fog: { adhesion: 0.26, label: 'Fog' },
  snow: { adhesion: 0.11, label: 'Snow' },
};

export class Game {
  constructor(route, opts = {}) {
    this.route = route;
    this.opts = { weather: 'clear', startHour: route.preset.defaultTime, alerter: false, seed: 1, ...opts };
    this.weather = WEATHER[this.opts.weather] ? this.opts.weather : 'clear';
    this.rnd = mulberry32(this.opts.seed * 31 + route.preset.seed);
    this.train = newTrainState(route.stops[0].stopS);
    this.t = 0; this.acc = 0;
    this.phase = 'running'; // running | finished | failed
    this.failReason = '';
    this.events = [];       // consumed by UI/audio
    this.log = [];          // persistent message log
    this.stationIdx = 0;    // index of the station we're at / heading to next
    this.stopRec = route.stops.map(() => ({ served: false, arrival: null, accuracy: null, punctual: null, departed: null, depDelay: null, e: null, missed: false, boarded: false }));
    this.doors = { open: false, boarding: 0, boardTime: 0, boardDone: false, openedAt: 0 };
    this.stoppedFor = 0;
    this.alert = { aws: 0, awsAck: true, tpws: false, atp: false, alerterTimer: 0, alerterAlarm: false };
    this.horn = false;
    this.emerg = { latched: false, reason: '' };
    this.leverLock = false;
    this.cat = { // scoring accumulators
      overspeed: 0, harsh: 0, lateral: 0, slip: 0, spads: 0, emergencies: 0, atp: 0, awsFails: 0, early: 0,
      distanceDriven: 0, maxSpeed: 0,
    };
    this.signals = route.signals.map((sg) => ({ ...sg, held: false, releaseAt: null, armed: false, passed: false, aspect: 'G', released: false }));
    this._initSignals();
    for (const sg of this.signals) if (sg.s <= this.train.s) { sg.passed = true; sg.awsDone = true; }
    this._updateAspects();
    this.passedLimits = new Set();
    this.lastInput = 0;
    this.env = { grade: 0, radius: Infinity, tunnel: false, adhesion: WEATHER[this.weather].adhesion };
    this.lat = 0;
    this.prevSafetyMsgT = -99;
    this.msg(`Welcome aboard. ${route.stops[0].name} to ${route.stops[route.stops.length - 1].name}.`, 'info');
    this.msg('Open doors (T) to load passengers, then wait for the starter signal.', 'info');
  }

  // ---------- helpers -----------------------------------------------------------
  msg(text, kind = 'info') { const m = { t: this.t, text, kind }; this.log.push(m); this.events.push({ type: 'msg', ...m }); }
  emit(type, data = {}) { this.events.push({ type, ...data }); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  get clock() { return this.opts.startHour * 3600 + this.t; }

  _initSignals() {
    const diff = this.route.preset.difficulty;
    for (const sg of this.signals) {
      if (sg.kind === 'starter') { sg.held = true; continue; }
      const p = sg.kind === 'home' ? 0.45 : 0.28 + 0.06 * diff;
      sg.held = this.rnd() < p;
      sg.hold = 10 + this.rnd() * 30;
    }
  }

  _starterClear(sg) {
    const rec = this.stopRec[sg.stationId];
    const st = this.route.stops[sg.stationId];
    if (this.t < st.dep) return false;
    if (!rec.served) return this.t >= st.dep + 10; // skipped stop: don't deadlock
    return rec.boarded;
  }

  _updateAspects() {
    const sg = this.signals;
    const red = sg.map((q) => {
      if (q.kind === 'starter') { if (!q.released && this._starterClear(q)) q.released = true; return !q.released && !q.passed; }
      return q.held && !q.passed;
    });
    for (let i = 0; i < sg.length; i++) {
      const next = sg[i + 1];
      const nextRed = next && red[i + 1] && !next.passed;
      const a = red[i] ? 'R' : nextRed ? 'Y' : 'G';
      if (a !== sg[i].aspect) { sg[i].aspect = a; this.emit('aspect', { id: i, aspect: a }); }
    }
  }

  // ---------- inputs ------------------------------------------------------------
  setLever(v) {
    const nv = Math.max(-1, Math.min(1, v));
    if (Math.abs(nv - this.train.lever) > 1e-4) this._touch();
    this.train.lever = nv;
    if (this.leverLock && nv <= 0.02) this.leverLock = false;
  }
  _touch() { this.alert.alerterTimer = 0; this.alert.alerterAlarm = false; }
  emergencyBrake() {
    if (this.phase !== 'running') return;
    if (!this.train.emergency) { this.train.emergency = true; this.emerg.latched = true; this.emerg.reason = 'Driver'; this.cat.emergencies++; this.emit('emergency', { reason: 'driver' }); this.msg('Emergency brake applied.', 'warn'); }
    this._touch();
  }
  acknowledge() {
    this._touch();
    if (this.alert.aws > 0) { this.alert.aws = 0; this.alert.awsAck = true; this.emit('aws-ack'); }
    if (this.train.emergency && this.train.v === 0 && this.emerg.latched) {
      this.train.emergency = false; this.emerg.latched = false; this.alert.tpws = false; this.alert.atp = false;
      this.leverLock = this.train.lever > 0.02; this.emit('reset'); this.msg('Brakes reset. Move the controller to neutral to continue.', 'info');
    }
  }
  setHorn(on) { if (on !== this.horn) { this.horn = on; this._touch(); this.emit(on ? 'horn-on' : 'horn-off'); } }

  toggleDoors() {
    this._touch();
    const t = this.train; const st = this.route.stops[this.stationIdx]; const rec = this.stopRec[this.stationIdx];
    if (this.doors.open) {
      if (!this.doors.boardDone) { this.msg('Passengers still boarding.', 'warn'); this.emit('deny'); return; }
      this.doors.open = false; this.stopRec[this.stationIdx].boarded = true;
      this.emit('doors-close'); this.msg('Doors closed.', 'info');
      return;
    }
    if (Math.abs(t.v) > 0.05) { this.msg('Doors cannot be opened while moving.', 'warn'); this.emit('deny'); return; }
    if (!st) return;
    const e = t.s - st.stopS; // + = overran
    if (e < -110 || e > 45) { this.msg(e < 0 ? 'Not at the platform: too far short.' : 'Not at the platform: overran.', 'warn'); this.emit('deny'); return; }
    if (rec.served && this.doors.boardDone) { this.msg('Boarding already complete. Wait for the starter signal.', 'info'); this.emit('deny'); return; }
    this.doors.open = true; this.doors.boardDone = rec.served ? this.doors.boardDone : false;
    this.emit('doors-open');
    if (!rec.served) this._serveStop(e);
  }

  // ---------- stop / station handling ---------------------------------------------
  _serveStop(e) {
    const idx = this.stationIdx, st = this.route.stops[idx], rec = this.stopRec[idx];
    rec.served = true; rec.e = e;
    const ae = Math.abs(e);
    rec.accuracy = ae <= 3 ? 100 : ae <= 10 ? 100 - (ae - 3) * 4 : Math.max(0, 72 - (ae - 10) * 2.2);
    if (e > 20) { this.msg(`Overran the platform by ${e.toFixed(0)} m; passengers walked back.`, 'warn'); }
    else this.msg(`${st.name}: stopped ${ae.toFixed(1)} m ${e < 0 ? 'short of' : 'past'} the mark (${Math.round(rec.accuracy)}%).`, rec.accuracy > 80 ? 'good' : 'info');
    if (rec.arrival == null) rec.arrival = this.t;
    const late = rec.arrival - st.arr;
    rec.late = late;
    rec.punctual = idx === 0 ? 100 : late <= 15 && late >= -30 ? 100 : late > 15 ? Math.max(0, 100 - (late - 15) * 0.55) : Math.max(60, 100 - (-late - 30) * 0.8);
    if (idx > 0) this.msg(late > 15 ? `${Math.round(late)} s late.` : late < -15 ? `${Math.round(-late)} s early.` : 'On time.', late > 45 ? 'warn' : 'good');
    this.doors.boardTime = 14 + this.rnd() * 10; this.doors.boarding = 0; this.doors.boardDone = idx === this.route.stops.length - 1;
    if (idx === this.route.stops.length - 1) this._finish();
  }

  _finish() {
    this.phase = 'finished'; this.emit('finished');
    this.msg('Journey complete!', 'good');
  }
  _fail(reason) {
    if (this.phase !== 'running') return;
    this.phase = 'failed'; this.failReason = reason; this.emit('failed', { reason }); this.msg(reason, 'bad');
  }

  // ---------- core update -----------------------------------------------------------
  update(dt) {
    this.acc += Math.min(dt, 0.25);
    while (this.acc >= FIXED_DT) { this._tick(FIXED_DT); this.acc -= FIXED_DT; }
  }

  /** Step an exact number of simulated seconds (tests, fast-forward). No frame-spike clamp. */
  advance(seconds) { const n = Math.round(seconds / FIXED_DT); for (let i = 0; i < n; i++) this._tick(FIXED_DT); }

  /** Teleport the train (tests / debug): signals behind the new position count as passed. */
  placeAt(s, v = 0) {
    this.train.s = s; this.train.v = v;
    for (const sg of this.signals) if (sg.s < s) { sg.passed = true; sg.awsDone = true; }
    this._updateAspects();
  }

  _tick(dt) {
    if (this.phase === 'failed') { this.train.lever = -1; }
    const R = this.route, t = this.train;
    const centre = t.s - TRAIN_LEN / 2;

    // environment from track geometry under the train
    const g0 = R.gradeAt(t.s), g1 = R.gradeAt(centre), g2 = R.gradeAt(t.s - TRAIN_LEN);
    this.env.grade = (g0 + g1 + g2) / 3;
    this.env.radius = R.radiusAt(centre);
    this.env.tunnel = R.inTunnel(centre);

    // interlocks
    t.tractionCut = this.doors.open || this.leverLock || this.alert.tpws || this.alert.atp || this.phase !== 'running';
    if (this.phase === 'finished') { t.lever = -0.6; }

    stepTrain(t, dt, this.env);
    this.t += dt;
    const v = Math.abs(t.v);
    this.cat.distanceDriven += v * dt; this.cat.maxSpeed = Math.max(this.cat.maxSpeed, v);

    // lateral acceleration felt in the cab (v^2 k - g*cant)
    const p = R.at(centre);
    this.lat = t.v * t.v * p.k - G * p.bank * (Math.abs(t.v) > 0.1 ? 1 : 0);
    if (this.phase === 'running') {
      if (Math.abs(this.lat) > 1.0) this.cat.lateral += (Math.abs(this.lat) - 1.0) * dt;
      if (Math.abs(t.a) > 0.98 && v > 1) this.cat.harsh += (Math.abs(t.a) - 0.98) * dt;
      if (t.slip) this.cat.slip += dt;
      if (Math.abs(this.lat) > 2.6 && v > 5) this._fail('Derailed on a curve: far too fast.');
    }

    if (this.phase !== 'running') { this._updateAspects(); return; }

    this._boarding(dt);
    this._speedSupervision(dt);
    this._signalsStep(dt);
    this._stationStep(dt);
    this._alerter(dt);
    this._buffers();
    if (Math.floor(this.t * 4) !== Math.floor((this.t - dt) * 4)) this._updateAspects();
  }

  _boarding(dt) {
    const d = this.doors;
    if (d.open && !d.boardDone) {
      d.boarding += dt;
      if (d.boarding >= d.boardTime) { d.boardDone = true; this.emit('boarding-done'); this.msg('Boarding complete. Close the doors (T).', 'info'); }
    }
  }

  effectiveLimit() {
    const R = this.route;
    return Math.min(R.limitAt(this.train.s), R.limitAt(this.train.s - TRAIN_LEN));
  }

  _speedSupervision(dt) {
    const t = this.train, v = Math.abs(t.v), lim = this.effectiveLimit();
    const over = v - lim;
    if (over > 0.8) this.cat.overspeed += over * dt; // weighted by excess
    if (over > 0.8 && !this._wasOver) { this.emit('overspeed'); }
    this._wasOver = over > 0.8;
    if (over > 4.17 && !t.emergency) {  // 15 km/h over: ATP intervention
      t.emergency = true; this.emerg.latched = true; this.alert.atp = true; this.cat.atp++; this.cat.emergencies++;
      this.emit('emergency', { reason: 'atp' }); this.msg('Overspeed protection: emergency brake applied.', 'bad');
    }
  }

  _signalsStep(dt) {
    const t = this.train;
    for (const sg of this.signals) {
      const ahead = sg.s - t.s;
      // arming: dispatcher "traffic ahead clears" timer starts when we get close
      if (sg.held && !sg.armed && ahead < 700 && ahead > -10) { sg.armed = true; sg.releaseAt = this.t + sg.hold; }
      if (sg.held && sg.armed && this.t >= sg.releaseAt && !sg.passed) { sg.held = false; this._updateAspects(); this.emit('signal-clear', { id: sg.id }); }
      // AWS: warning magnet 200 m before a signal that currently shows yellow or red
      if (!sg.awsDone && ahead < 200 && ahead > 195 - Math.max(0, t.v) * dt * 2 && t.v > 0) {
        sg.awsDone = true;
        if (sg.aspect !== 'G') { this.alert.aws = 4.2; this.alert.awsAck = false; this.emit('aws-warning', { aspect: sg.aspect }); }
        else this.emit('aws-clear');
      }
      if (!sg.awsDone && ahead <= 195 && t.v > 0) sg.awsDone = true;
      // passing the signal
      if (!sg.passed && t.s >= sg.s && t.v > 0) {
        sg.passed = true;
        if (sg.aspect === 'R') {
          this.cat.spads++; this.cat.emergencies++; t.emergency = true; this.emerg.latched = true; this.alert.tpws = true;
          this.emit('spad', { id: sg.id }); this.msg('SIGNAL PASSED AT DANGER! Train stop applied.', 'bad');
          if (this.cat.spads >= 3) this._fail('Removed from driving duties after three signals passed at danger.');
        }
      }
    }
    // AWS countdown
    if (this.alert.aws > 0) {
      this.alert.aws -= dt;
      if (this.alert.aws <= 0 && !this.alert.awsAck) {
        this.alert.aws = 0; this.cat.awsFails++; this.cat.emergencies++;
        t.emergency = true; this.emerg.latched = true; this.emit('emergency', { reason: 'aws' });
        this.msg('Warning not acknowledged: emergency brake applied.', 'bad');
      }
    }
  }

  _stationStep(dt) {
    const t = this.train, R = this.route;
    const st = R.stops[this.stationIdx]; if (!st) return;
    const rec = this.stopRec[this.stationIdx];
    // departure: boarded, doors closed, and the front has passed the starter signal (or left the platform)
    if (rec.served && rec.boarded && !this.doors.open && rec.departed == null && this.stationIdx < R.stops.length - 1) {
      const starter = this.signals.find((q) => q.kind === 'starter' && q.stationId === this.stationIdx);
      const left = starter ? starter.passed : t.s > st.stopS + 30;
      if (left) {
        rec.departed = this.t; rec.depDelay = this.t - st.dep;
        this.emit('depart'); this.msg(`Departed ${st.name}${rec.depDelay > 20 ? ` (${Math.round(rec.depDelay)} s late)` : ''}.`, 'info');
        this.stationIdx++; this.doors = { open: false, boarding: 0, boardTime: 0, boardDone: false, openedAt: 0 };
      }
    }
    // missed stop: front >60 m past the mark with the station never served
    const cur = R.stops[this.stationIdx];
    if (cur && this.stationIdx > 0 && !this.stopRec[this.stationIdx].served && t.s > cur.stopS + 60 && t.v > 1) {
      const r = this.stopRec[this.stationIdx]; r.missed = true; r.served = true; r.accuracy = 0; r.punctual = 0; r.departed = this.t;
      this.msg(`You ran through ${cur.name} without stopping!`, 'bad'); this.emit('missed-stop');
      if (this.stationIdx < R.stops.length - 1) this.stationIdx++; else this._fail('Missed the terminus.');
      this.doors = { open: false, boarding: 0, boardTime: 0, boardDone: false, openedAt: 0 };
    }
    // announce next stop
    const nx = R.stops[this.stationIdx];
    if (nx && this.stationIdx > 0 && !this._ann?.[this.stationIdx] && nx.stopS - t.s < 1800) {
      (this._ann ||= {})[this.stationIdx] = true; this.emit('announce', { name: nx.name });
    }
  }

  _alerter(dt) {
    if (!this.opts.alerter) return;
    const a = this.alert;
    if (Math.abs(this.train.v) > 3) a.alerterTimer += dt; else a.alerterTimer = 0;
    if (a.alerterTimer > 60 && !a.alerterAlarm) { a.alerterAlarm = true; this.emit('alerter'); }
    if (a.alerterTimer > 70 && !this.train.emergency) {
      this.train.emergency = true; this.emerg.latched = true; this.cat.emergencies++; this.emit('emergency', { reason: 'alerter' });
      this.msg('Driver vigilance: emergency brake applied.', 'bad');
    }
  }

  _buffers() {
    const t = this.train, R = this.route;
    const endS = R.length - 25;
    if (t.s > endS) {
      if (t.v > 3) { this._fail('Collided with the buffers at the end of the line.'); }
      else if (t.s > endS + 4) { t.s = endS + 4; t.v = Math.min(t.v, 0); }
    }
    if (t.s < R.stops[0].stopS - TRAIN_LEN - 15 && t.v < 0) { t.s = R.stops[0].stopS - TRAIN_LEN - 15; t.v = 0; }
  }

  // ---------- queries for the UI -----------------------------------------------------------
  nextSignal() {
    for (const sg of this.signals) if (!sg.passed && sg.s > this.train.s) return sg;
    return null;
  }

  /** Allowed-speed guidance (m/s) at the front of the train, incl. braking curve to targets. */
  guidance() {
    const t = this.train, R = this.route; const B = 0.55;
    const lim = this.effectiveLimit();
    let ceil = lim, target = null;
    const consider = (dist, vT, label, kind) => {
      if (dist < 0) return;
      const c = Math.sqrt(vT * vT + 2 * B * dist);
      if (c < ceil + 0.01 || !target) { if (c <= ceil) { ceil = c; } }
      if (!target || dist < target.dist || (vT < target.v && dist < target.dist + 400)) target = { dist, v: vT, label, kind };
    };
    // lower limits ahead
    let lastL = lim;
    for (const l of R.limits) {
      if (l.s <= t.s || l.s > t.s + 2500) continue;
      const vl = l.kmh / KMH; if (vl < lastL) consider(l.s - t.s, vl, `${l.kmh}`, 'limit'); lastL = vl;
    }
    const sg = this.nextSignal();
    if (sg && sg.aspect === 'R' && sg.s - t.s < 3000) consider(Math.max(0, sg.s - t.s - 15), 0, 'Signal', 'signal');
    const st = R.stops[this.stationIdx];
    if (st && !this.stopRec[this.stationIdx].served && this.stationIdx > 0) consider(Math.max(0, st.stopS - t.s), 0, st.name, 'station');
    else if (st && this.stationIdx === 0 && !this.stopRec[0].served) { /* start station */ }
    return { ceiling: ceil, limit: lim, target };
  }

  upcoming(range = 3000) {
    const R = this.route, s = this.train.s, out = [];
    for (const sg of this.signals) if (!sg.passed && sg.s > s && sg.s < s + range) out.push({ type: 'signal', s: sg.s, d: sg.s - s, aspect: sg.aspect, kind: sg.kind });
    let prev = R.limitAt(s);
    for (const l of R.limits) if (l.s > s && l.s < s + range) { out.push({ type: 'limit', s: l.s, d: l.s - s, kmh: l.kmh, tsr: l.tsr, lower: l.kmh / KMH < prev }); prev = l.kmh / KMH; }
    R.stops.forEach((st, i) => { if (i >= this.stationIdx && st.stopS > s - 5 && st.stopS < s + range && !this.stopRec[i].served) out.push({ type: 'station', s: st.stopS, d: st.stopS - s, name: st.name, i }); });
    for (const tn of R.tunnels) if (tn.s1 > s && tn.s0 < s + range) out.push({ type: 'tunnel', s: tn.s0, d: tn.s0 - s, len: tn.s1 - tn.s0, inside: tn.s0 < s });
    return out.sort((a, b) => a.d - b.d);
  }

  // ---------- scoring -----------------------------------------------------------------
  scores() {
    const R = this.route, rec = this.stopRec;
    const stops = rec.map((r, i) => ({ i, ...r, name: R.stops[i].name })).filter((r) => r.i > 0);
    const acc = stops.length ? stops.reduce((a, r) => a + (r.accuracy ?? 0), 0) / stops.length : 100;
    const pun = stops.length ? stops.reduce((a, r) => a + (r.punctual ?? 0), 0) / stops.length : 100;
    const departPenalty = rec.reduce((a, r, i) => a + (r.depDelay != null && r.depDelay > 40 ? Math.min(10, (r.depDelay - 40) * 0.1) : 0), 0);
    const safety = Math.max(0, 100 - this.cat.spads * 35 - this.cat.atp * 12 - this.cat.awsFails * 15 - Math.max(0, this.cat.emergencies - this.cat.spads - this.cat.atp - this.cat.awsFails) * 8);
    const speed = Math.max(0, 100 - this.cat.overspeed * 1.1);
    const comfort = Math.max(0, 100 - this.cat.harsh * 20 - this.cat.lateral * 30 - this.cat.slip * 2);
    const total = acc * 0.2 + Math.max(0, pun - departPenalty) * 0.25 + safety * 0.25 + speed * 0.15 + comfort * 0.15;
    const pass = this.phase === 'finished';
    const grade = !pass ? 'F' : total >= 92 ? 'S' : total >= 82 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';
    return { accuracy: acc, punctuality: Math.max(0, pun - departPenalty), safety, speed, comfort, total: pass ? total : Math.min(total, 40), grade, stops, finished: pass };
  }
}
