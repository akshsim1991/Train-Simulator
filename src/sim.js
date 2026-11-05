// Pure simulation core: no DOM, no Electron. Works in browser and Node.
(function (root) {
  const G = 9.81;

  const TRAIN = {
    mass: 220000,        // kg (loaded EMU)
    maxTractive: 280000, // N (low-speed limit)
    power: 2.4e6,        // W
    serviceBrake: 0.9,   // m/s2 at full service
    emergencyBrake: 1.4, // m/s2
    davisA: 2500,        // N, rolling
    davisB: 60,          // N per m/s
    davisC: 6.5,         // N per (m/s)^2, aero
    length: 120,         // m
  };

  // Route: stations (m), gradient segments (from, permille), speed limits (from, km/h)
  const ROUTE = {
    length: 9000,
    stations: [
      { name: 'Central', pos: 0 },
      { name: 'Riverside', pos: 2600 },
      { name: 'Hillcrest', pos: 5600 },
      { name: 'Harbour', pos: 9000 },
    ],
    gradients: [
      { from: 0, permille: 0 },
      { from: 1200, permille: 8 },
      { from: 2000, permille: 0 },
      { from: 3400, permille: -12 },
      { from: 4600, permille: 0 },
      { from: 6200, permille: 15 },
      { from: 7000, permille: -6 },
      { from: 8200, permille: 0 },
    ],
    limits: [
      { from: 0, kmh: 60 },
      { from: 600, kmh: 100 },
      { from: 2200, kmh: 60 },
      { from: 2800, kmh: 120 },
      { from: 3900, kmh: 80 },
      { from: 5200, kmh: 60 },
      { from: 5800, kmh: 120 },
      { from: 8300, kmh: 60 },
    ],
  };

  function lookup(table, pos, key) {
    let v = table[0][key];
    for (const row of table) { if (row.from <= pos) v = row[key]; else break; }
    return v;
  }
  const gradientAt = (pos) => lookup(ROUTE.gradients, pos, 'permille') / 1000;
  const limitAt = (pos) => lookup(ROUTE.limits, pos, 'kmh') / 3.6; // m/s

  function newState() {
    return {
      pos: TRAIN.length, // front of train; start with train in platform
      speed: 0,
      throttle: 0,     // 0..1
      brake: 0,        // 0..1
      emergency: false,
      time: 0,
      nextStation: 1,
      dwell: 0,        // seconds stopped at station
      score: 0,
      log: [],         // event messages
      overspeedTime: 0,
      finished: false,
      stopsMade: 0,
    };
  }

  function tractiveForce(throttle, v) {
    const f = Math.min(TRAIN.maxTractive, TRAIN.power / Math.max(v, 0.1));
    return throttle * f;
  }
  function resistance(v) {
    return TRAIN.davisA + TRAIN.davisB * v + TRAIN.davisC * v * v;
  }

  function step(s, dt) {
    if (s.finished) return s;
    const v = s.speed;
    const grade = gradientAt(s.pos);
    let throttle = s.emergency || s.brake > 0.05 ? 0 : s.throttle;
    const fT = tractiveForce(throttle, v);
    const fG = -TRAIN.mass * G * grade; // uphill (+grade) opposes
    const fR = v > 0 ? resistance(v) : 0;
    const decel = s.emergency ? TRAIN.emergencyBrake : s.brake * TRAIN.serviceBrake;
    const fB = TRAIN.mass * decel;

    let a = (fT + fG - fR - (v > 0 ? fB : 0)) / TRAIN.mass;
    let nv = v + a * dt;
    if (v > 0 && nv < 0) nv = 0; // brakes/resistance can't reverse the train
    if (v === 0) {
      // standing: hold only if net force can't overcome static brake/resistance
      const hold = s.brake > 0.05 || s.emergency;
      const net = fT + fG;
      if (hold && net <= fB) nv = 0;
      else if (!hold && Math.abs(fG) < TRAIN.davisA && fT === 0) nv = 0;
      else if (net > 0) nv = Math.max(0, net / TRAIN.mass * dt);
      else nv = 0; // no rolling backwards in this version
    }
    s.pos += ((v + nv) / 2) * dt;
    s.speed = nv;
    s.time += dt;

    // speed limit
    const lim = limitAt(s.pos);
    if (nv > lim + 1.0) {
      s.overspeedTime += dt;
      s.score -= dt * (1 + (nv - lim));
    }

    // station handling
    const st = ROUTE.stations[s.nextStation];
    if (st) {
      const err = st.pos - s.pos; // + = short of mark
      if (nv < 0.1 && Math.abs(err) < 40) {
        s.dwell += dt;
        if (!st.done && s.dwell > 2) {
          st.done = true;
          const pts = Math.max(0, Math.round(100 - Math.abs(err) * 4));
          s.score += pts;
          s.stopsMade++;
          s.log.push(`${st.name}: stopped ${err >= 0 ? err.toFixed(1) + ' m short' : (-err).toFixed(1) + ' m past'} (+${pts})`);
          s.nextStation++;
          s.dwell = 0;
          if (s.nextStation >= ROUTE.stations.length) {
            s.finished = true;
            s.log.push('Journey complete');
          }
        }
      } else if (nv >= 0.1) s.dwell = 0;
      if (s.pos > st.pos + 40 && !st.done) {
        st.done = true;
        s.score -= 100;
        s.log.push(`Missed ${st.name} (-100)`);
        s.nextStation++;
        if (s.nextStation >= ROUTE.stations.length) { s.finished = true; s.log.push('Journey complete'); }
      }
    }
    return s;
  }

  function resetRoute() { ROUTE.stations.forEach((st) => { delete st.done; }); }

  const api = { TRAIN, ROUTE, G, gradientAt, limitAt, newState, step, tractiveForce, resistance, resetRoute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Sim = api;
})(typeof window !== 'undefined' ? window : globalThis);
