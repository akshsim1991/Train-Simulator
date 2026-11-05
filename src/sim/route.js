// Procedural, fully deterministic railway routes.
// A route is: a plan-view centreline (integrated from a curvature profile), a
// grade-limited elevation profile derived from the terrain, stations, signals,
// speed limits (curve-derived + posted + temporary restrictions), tunnels/bridges.
import { mulberry32, fbm, ridged } from './noise.js';

export const DS = 4; // sample spacing in metres
const KMH = 1 / 3.6;

export const PRESETS = {
  coastal: {
    id: 'coastal', name: 'Coastal Express', blurb: 'Fast seaside main line. Long straights, sweeping curves, tight timekeeping.',
    difficulty: 1, seed: 7, length: 15000, amp: 70, scale: 2600, seaLevel: 0, minTrack: 34, maxGrade: 0.016,
    maxCurv: 1 / 650, curvNoise: 0.0011, lineSpeed: 160, snow: false, palette: 'coast',
    stations: [
      { at: 0.0, name: 'Marlow Bay' }, { at: 0.34, name: 'Port Haven' },
      { at: 0.68, name: 'St Elmswick' }, { at: 1.0, name: 'Dunmere Sands' },
    ],
    tsrCount: 1, defaultTime: 17.5,
  },
  valley: {
    id: 'valley', name: 'Valley Local', blurb: 'Stopping service through rolling hills. Five stations, frequent signals.',
    difficulty: 2, seed: 21, length: 12500, amp: 120, scale: 1800, seaLevel: -50, minTrack: 40, maxGrade: 0.024,
    maxCurv: 1 / 450, curvNoise: 0.0016, lineSpeed: 120, snow: false, palette: 'valley',
    stations: [
      { at: 0.0, name: 'Alderbrook' }, { at: 0.22, name: 'Westcombe' }, { at: 0.5, name: 'Harrowgate' },
      { at: 0.76, name: 'Thornley' }, { at: 1.0, name: 'Kingsford' },
    ],
    tsrCount: 2, defaultTime: 8.5,
  },
  alpine: {
    id: 'alpine', name: 'Alpine Pass', blurb: 'Steep gradients, tunnels and viaducts. Heavy braking and low adhesion.',
    difficulty: 3, seed: 5, length: 13500, amp: 380, scale: 1500, seaLevel: -200, minTrack: 600, maxGrade: 0.032,
    maxCurv: 1 / 380, curvNoise: 0.0022, lineSpeed: 140, snow: true, palette: 'alpine',
    stations: [
      { at: 0.0, name: 'Talbrücke' }, { at: 0.42, name: 'Sankt Moritzen' }, { at: 1.0, name: 'Grauhorn' },
    ],
    tsrCount: 2, defaultTime: 12.0,
  },
};

export const bankOf = (k) => Math.max(-0.07, Math.min(0.07, k * 45));

function smooth(arr, radius, passes = 1) {
  const n = arr.length;
  let a = arr.slice();
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(n);
    const pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius);
      out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
    }
    a = out;
  }
  return a;
}

export function buildRoute(preset) {
  const P = typeof preset === 'string' ? PRESETS[preset] : preset;
  const rnd = mulberry32(P.seed * 7919 + 13);
  const N = Math.floor(P.length / DS) + 1;

  // ---- terrain (natural height) ---------------------------------------------------
  const terrainSeed = P.seed;
  const natural = (x, z) => {
    const f = fbm(x / P.scale, z / P.scale, terrainSeed, 5);
    const r = ridged(x / (P.scale * 1.7), z / (P.scale * 1.7), terrainSeed + 40, 4);
    const base = (f - 0.5) * 2 * P.amp + (r - 0.35) * P.amp * 0.9;
    return P.minTrack + base + P.amp * 0.15;
  };

  // ---- plan view: integrate curvature (smooth band-limited noise) --------------------
  const x = new Float64Array(N), z = new Float64Array(N), th = new Float64Array(N), k = new Float64Array(N);
  let ph1 = rnd() * 100, ph2 = rnd() * 100;
  const raw = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const s = i * DS;
    // low-frequency curvature from two noise octaves, clamped to the minimum radius
    const n1 = fbm(s / 1800 + ph1, 3.3, P.seed + 7, 3) - 0.5;
    const n2 = fbm(s / 700 + ph2, 9.1, P.seed + 9, 2) - 0.5;
    raw[i] = (n1 * 2.2 + n2 * 0.9) * (P.maxCurv * 2.4);
    // flatten curvature to exactly straight with a soft dead-zone so there are real straights
    const dz = P.curvNoise * 0.15;
    raw[i] = Math.sign(raw[i]) * Math.max(0, Math.abs(raw[i]) - dz);
    raw[i] = Math.max(-P.maxCurv, Math.min(P.maxCurv, raw[i]));
  }
  const ks = smooth(raw, 12, 2);
  th[0] = (rnd() - 0.5) * 6.28; x[0] = 0; z[0] = 0;
  for (let i = 0; i < N; i++) {
    k[i] = Math.max(-P.maxCurv, Math.min(P.maxCurv, ks[i]));
    if (i > 0) {
      th[i] = th[i - 1] + k[i - 1] * DS;
      const hm = (th[i] + th[i - 1]) / 2;
      x[i] = x[i - 1] + Math.sin(hm) * DS;
      z[i] = z[i - 1] - Math.cos(hm) * DS; // heading 0 = -z (north), increasing = clockwise (right turn)
    }
  }

  // ---- stations (positions along route) ----------------------------------------------
  const PLATFORM = 180;
  const stations = P.stations.map((st, idx) => {
    let s = st.at * P.length;
    s = Math.min(P.length - 260, Math.max(260, s));
    return { id: idx, name: st.name, s, platformLength: PLATFORM };
  });

  // ---- elevation profile: terrain along path -> smooth -> grade-limit -> level stations -
  const nat = new Float64Array(N);
  for (let i = 0; i < N; i++) nat[i] = natural(x[i], z[i]);
  let h = smooth(nat, Math.round(220 / DS), 2);
  const gmaxStep = P.maxGrade * DS;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N; i++) h[i] = Math.max(h[i - 1] - gmaxStep, Math.min(h[i - 1] + gmaxStep, h[i]));
    for (let i = N - 2; i >= 0; i--) h[i] = Math.max(h[i + 1] - gmaxStep, Math.min(h[i + 1] + gmaxStep, h[i]));
    h = smooth(h, Math.round(120 / DS), 2);
  }
  // coastal lines must stay above the sea
  if (P.id === 'coastal') for (let i = 0; i < N; i++) h[i] = Math.max(h[i], P.seaLevel + 7);
  // level the stations: platform zones are fixed constraints from here on
  const fixed = new Uint8Array(N);
  const flat = Math.round(260 / DS), blend = Math.round(520 / DS);
  for (const st of stations) {
    const ci = Math.round(st.s / DS);
    let lvl = 0, cnt = 0;
    for (let i = Math.max(0, ci - flat); i <= Math.min(N - 1, ci + flat); i++) { lvl += h[i]; cnt++; }
    lvl /= cnt;
    for (let i = Math.max(0, ci - flat - blend); i <= Math.min(N - 1, ci + flat + blend); i++) {
      const d = Math.abs(i - ci);
      const w = d <= flat ? 1 : 1 - (d - flat) / blend;
      const e = w * w * (3 - 2 * w);
      h[i] = h[i] * (1 - e) + lvl * e;
      if (d <= flat) { h[i] = lvl; fixed[i] = 1; }
    }
    st.elev = lvl;
  }
  h = smooth(h, 8, 1);
  for (const st of stations) {
    const ci = Math.round(st.s / DS);
    for (let i = Math.max(0, ci - flat); i <= Math.min(N - 1, ci + flat); i++) h[i] = st.elev;
  }
  // final grade limiter that never moves the fixed platform nodes
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < N; i++) if (!fixed[i]) h[i] = Math.max(h[i - 1] - gmaxStep, Math.min(h[i - 1] + gmaxStep, h[i]));
    for (let i = N - 2; i >= 0; i--) if (!fixed[i]) h[i] = Math.max(h[i + 1] - gmaxStep, Math.min(h[i + 1] + gmaxStep, h[i]));
  }
  const grade = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
    grade[i] = (h[b] - h[a]) / ((b - a) * DS);
  }

  // ---- speed limits ---------------------------------------------------------------------
  // Curve-derived max speed (equilibrium + cant deficit), quantised down to 10 km/h
  const curveLimit = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const kk = Math.abs(k[i]);
    const R = kk < 1e-7 ? Infinity : 1 / kk;
    const v = isFinite(R) ? Math.sqrt((0.62 + 9.81 * Math.abs(bankOf(k[i]))) * R) : 999; // ~0.6 m/s^2 residual lateral accel
    curveLimit[i] = v;
  }
  // look ahead/behind by a train length so the whole train respects it
  const cl2 = new Float64Array(N);
  const w = Math.round(160 / DS);
  for (let i = 0; i < N; i++) {
    let m = 999;
    for (let j = Math.max(0, i - w); j <= Math.min(N - 1, i + w); j++) m = Math.min(m, curveLimit[j]);
    cl2[i] = m;
  }
  const lineMs = P.lineSpeed * KMH;
  const limitKmh = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    limitKmh[i] = Math.max(40, Math.floor(Math.min(lineMs, cl2[i]) * 3.6 / 10) * 10);
  }
  // station approach / platform limits
  for (const st of stations) {
    for (let i = 0; i < N; i++) {
      const d = i * DS - st.s;
      if (d > -700 && d < 450) limitKmh[i] = Math.min(limitKmh[i], d > -150 && d < 300 ? 60 : 80);
    }
  }
  // temporary speed restrictions (track works)
  const tsrs = [];
  for (let t = 0; t < P.tsrCount; t++) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const s0 = (0.12 + rnd() * 0.76) * P.length;
      const len = 350 + rnd() * 250;
      if (stations.some((st) => Math.abs(st.s - s0) < 1200 || Math.abs(st.s - (s0 + len)) < 1200)) continue;
      if (tsrs.some((q) => Math.abs(q.s0 - s0) < 2500)) continue;
      tsrs.push({ s0, s1: s0 + len, kmh: rnd() < 0.5 ? 40 : 60 });
      break;
    }
  }
  for (const q of tsrs) for (let i = 0; i < N; i++) { const s = i * DS; if (s >= q.s0 && s <= q.s1) limitKmh[i] = Math.min(limitKmh[i], q.kmh); }
  // Merge into posted zones; make short dips at least 250 m by pulling limits forward
  const zones = [];
  for (let i = 0; i < N; i++) {
    const kmh = limitKmh[i];
    if (!zones.length || zones[zones.length - 1].kmh !== kmh) zones.push({ s: i * DS, kmh });
  }
  // Consolidate: any zone shorter than 300 m that is not a dip is lowered to its lower neighbour
  // (removes staircases like 130/120/110 and short bumps); dips are already widened by the 160 m window.
  const MINZ = 300;
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (let i = 0; i < zones.length; i++) {
      const len = (i + 1 < zones.length ? zones[i + 1].s : P.length) - zones[i].s;
      if (len >= MINZ || i === 0) continue;
      const nb = [zones[i - 1].kmh]; if (i + 1 < zones.length) nb.push(zones[i + 1].kmh);
      const lower = Math.min(...nb);
      if (zones[i].kmh > lower) { zones[i].kmh = lower; changed = true; }
    }
    for (let i = zones.length - 1; i >= 1; i--) if (zones[i].kmh === zones[i - 1].kmh) { zones.splice(i, 1); changed = true; }
    if (!changed) break;
  }
  const limits = zones.map((z0, i) => ({ s: z0.s, kmh: z0.kmh, tsr: tsrs.some((q) => Math.abs(q.s0 - z0.s) < 8 && z0.kmh <= 60) }));

  // ---- tunnels and bridges: from the relation between terrain and track ---------------
  const depth = new Float64Array(N); // natural - track  (+ = terrain above track)
  for (let i = 0; i < N; i++) depth[i] = nat[i] - h[i];
  const findRanges = (cond, minLen, gap) => {
    const r = []; let start = -1;
    for (let i = 0; i <= N; i++) {
      const on = i < N && cond(i);
      if (on && start < 0) start = i;
      if (!on && start >= 0) { r.push([start * DS, (i - 1) * DS]); start = -1; }
    }
    const merged = [];
    for (const q of r) { if (merged.length && q[0] - merged[merged.length - 1][1] < gap) merged[merged.length - 1][1] = q[1]; else merged.push(q.slice()); }
    return merged.filter((q) => q[1] - q[0] >= minLen);
  };
  const stationNear = (s, d) => stations.some((st) => Math.abs(st.s - s) < d);
  const tunnels = findRanges((i) => depth[i] > 10, 140, 120)
    .filter((q) => !stations.some((st) => q[1] > st.s - 700 && q[0] < st.s + 500))
    .map((q) => ({ s0: Math.max(0, q[0]), s1: Math.min(P.length, q[1]) }));
  const bridges = findRanges((i) => -depth[i] > 9, 60, 60)
    .filter((q) => !tunnels.some((t) => q[1] > t.s0 && q[0] < t.s1))
    .filter((q) => q[1] - q[0] <= 700)                                       // longer crossings are embankments
    .filter((q) => !stations.some((st) => q[1] > st.s - 450 && q[0] < st.s + 450))
    .map((q) => ({ s0: q[0] - 30, s1: q[1] + 30 }));

  // ---- signals --------------------------------------------------------------------------
  const signals = [];
  const addSignal = (s, kind, stationId = null) => {
    if (s < 150 || s > P.length - 150) return;
    if (tunnels.some((t) => s > t.s0 - 40 && s < t.s1 + 40)) { // never inside a tunnel: shift out (away from stations)
      const t = tunnels.find((t2) => s > t2.s0 - 40 && s < t2.s1 + 40);
      s = s < (t.s0 + t.s1) / 2 ? t.s0 - 60 : t.s1 + 60;
    }
    if (signals.some((q) => Math.abs(q.s - s) < 800)) return;
    signals.push({ id: signals.length, s, kind, stationId });
  };
  for (const st of stations) {
    if (st.s > 400) addSignal(st.s - 520, 'home', st.id);                 // before platform
    addSignal(st.s + st.platformLength / 2 + 40, 'starter', st.id);        // after platform
  }
  for (let s = 1300; s < P.length - 800; s += 1250 + Math.floor(rnd() * 500)) addSignal(s, 'block');
  signals.sort((a, b) => a.s - b.s);
  signals.forEach((q, i) => { q.id = i; });

  // ---- timetable (idealised run-times + station dwell) ----------------------------------
  const route = {
    preset: P, id: P.id, name: P.name, length: P.length, N, DS,
    x, z, theta: th, curv: k, elev: h, grade, limits, tsrs, tunnels, bridges, stations, signals, natural,
    seaLevel: P.seaLevel, snow: P.snow, palette: P.palette,
  };
  buildQuery(route);
  buildTimetable(route);
  return route;
}

function buildQuery(route) {
  const { N, DS } = route;
  // linear sampling
  route.at = (s) => {
    const f = Math.max(0, Math.min(route.length, s)) / DS;
    const i = Math.min(N - 2, Math.floor(f)); const u = f - i;
    const L = (a) => a[i] + (a[i + 1] - a[i]) * u;
    const heading = L(route.theta);
    const k = L(route.curv);
    const tx = Math.sin(heading), tz = -Math.cos(heading);
    return {
      s, x: L(route.x), z: L(route.z), y: L(route.elev), heading, tx, tz,
      nx: -tz, nz: tx,                                  // right-hand normal (looking along +s)
      k, grade: L(route.grade), bank: bankOf(k),
    };
  };
  route.gradeAt = (s) => route.at(s).grade;
  route.radiusAt = (s) => { const k = Math.abs(route.at(s).k); return k < 1e-6 ? Infinity : 1 / k; };
  route.inTunnel = (s) => route.tunnels.some((t) => s >= t.s0 && s <= t.s1);
  route.onBridge = (s) => route.bridges.some((t) => s >= t.s0 && s <= t.s1);
  route.limitAt = (s) => {
    let v = route.limits[0].kmh;
    for (const l of route.limits) { if (l.s <= s) v = l.kmh; else break; }
    return v * KMH; // m/s
  };
  route.limitIndexAt = (s) => { let idx = 0; for (let i = 0; i < route.limits.length; i++) { if (route.limits[i].s <= s) idx = i; else break; } return idx; };

  // spatial hash for nearest-centreline queries
  const CELL = 64; const grid = new Map();
  const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < N; i++) {
    const kk = key(Math.floor(route.x[i] / CELL), Math.floor(route.z[i] / CELL));
    let a = grid.get(kk); if (!a) { a = []; grid.set(kk, a); } a.push(i);
  }
  /** Nearest point on the centreline. Returns {s, d (unsigned dist), side (+ right)} or null if > maxD. */
  route.nearest = (px, pz, maxD = 200) => {
    const r = Math.ceil(maxD / CELL);
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    let best = Infinity, bi = -1;
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const a = grid.get(key(ix, iz)); if (!a) continue;
      for (const i of a) { const dx = route.x[i] - px, dz = route.z[i] - pz; const d2 = dx * dx + dz * dz; if (d2 < best) { best = d2; bi = i; } }
    }
    if (bi < 0 || best > maxD * maxD) return null;
    // refine between neighbours
    let s = bi * DS, bd = Math.sqrt(best);
    for (const j of [bi - 1, bi + 1]) {
      if (j < 0 || j >= N - 1 + (j > bi ? 0 : 1)) continue;
      const i0 = Math.min(bi, j), i1 = i0 + 1; if (i1 >= N) continue;
      const ax = route.x[i0], az = route.z[i0], bx = route.x[i1], bz = route.z[i1];
      const abx = bx - ax, abz = bz - az; const u = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)));
      const qx = ax + abx * u - px, qz = az + abz * u - pz; const d = Math.hypot(qx, qz);
      if (d < bd) { bd = d; s = (i0 + u) * DS; }
    }
    const p = route.at(s);
    const side = ((px - p.x) * p.nx + (pz - p.z) * p.nz) >= 0 ? 1 : -1;
    return { s, d: bd, side, y: p.y };
  };

  /** Terrain height at world (x,z), blended into the railway formation. */
  route.terrainHeight = (px, pz) => {
    const nat = route.natural(px, pz);
    const n = route.nearest(px, pz, 90);
    if (!n) return nat;
    const diff = nat - n.y; // + = hill above track (cutting), - = valley below (embankment)
    const tun = tunnelness(route, n.s);
    const bed = 6.5;
    const run = Math.max(8, Math.abs(diff) * 1.8);
    let wgt = n.d <= bed ? 1 : Math.max(0, 1 - (n.d - bed) / run);
    wgt = wgt * wgt * (3 - 2 * wgt);
    // bridges: leave natural valley below a viaduct; tunnels: leave the hill untouched
    const br = bridgeness(route, n.s);
    wgt *= (1 - tun) * (1 - br);
    return nat * (1 - wgt) + n.y * wgt - (n.d < bed ? 0.35 * wgt : 0);
  };
}

function tunnelness(route, s) {
  let m = 0;
  for (const t of route.tunnels) {
    const a = Math.min(1, Math.max(0, (s - t.s0 + 6) / 22)) * Math.min(1, Math.max(0, (t.s1 + 6 - s) / 22));
    if (a > m) m = a;
  }
  return m;
}
function bridgeness(route, s) {
  let m = 0;
  for (const t of route.bridges) {
    const a = Math.min(1, Math.max(0, (s - t.s0) / 30)) * Math.min(1, Math.max(0, (t.s1 - s) / 30));
    if (a > m) m = a;
  }
  return m;
}

/** Idealised driver profile -> scheduled times (seconds from start). */
function buildTimetable(route) {
  const A = 0.55, B = 0.6, margin = 1.07;  // comfortable accel/decel for planning
  const DT = 1;
  const stops = route.stations;
  const times = [];
  let t = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i].s + 80, b = stops[i + 1].s + 80 - 0; // front-of-train stop positions
    // forward pass: speed cap from limits + accel; backward: braking into stop
    const n = Math.max(2, Math.ceil((b - a) / DS) + 1);
    const cap = new Float64Array(n);
    for (let j = 0; j < n; j++) cap[j] = route.limitAt(a + j * DS) * 0.97;
    cap[0] = 0; cap[n - 1] = 0;
    const v = new Float64Array(n);
    for (let j = 1; j < n; j++) v[j] = Math.min(cap[j], Math.sqrt(v[j - 1] * v[j - 1] + 2 * A * DS));
    for (let j = n - 2; j >= 0; j--) {
      // also respect future lower limits
      v[j] = Math.min(v[j], Math.sqrt(v[j + 1] * v[j + 1] + 2 * B * DS), cap[j]);
    }
    let run = 0;
    for (let j = 1; j < n; j++) { const vm = Math.max(0.5, (v[j] + v[j - 1]) / 2); run += DS / vm; }
    stops[i + 1].run = run * margin;
  }
  // first stop: train begins stationary in platform with a short dwell before departure
  stops[0].arr = 0; stops[0].dep = 45;
  t = 45;
  for (let i = 1; i < stops.length; i++) {
    t += stops[i].run; stops[i].arr = Math.round(t);
    stops[i].dwell = i === stops.length - 1 ? 0 : 40 + (i % 2) * 15;
    t += stops[i].dwell; stops[i].dep = Math.round(t);
    stops[i].stopS = stops[i].s + 80;
  }
  stops[0].stopS = stops[0].s + 80;
  route.stops = stops;
}
