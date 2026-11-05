// Procedural, fully deterministic railway routes based on real Indian main lines.
// A route is: a plan-view centreline (steered along the real bearing between stations, plus gentle meanders),
// a grade-limited elevation profile derived from the terrain, stations with real chainages, colour-light signals,
// speed limits (curve-derived + posted zones + temporary restrictions) and river crossings with bridges.
// India runs on the LEFT and main lines are double track: our track is the left-hand one, the other is at +4.5 m.
import { mulberry32, fbm, ridged } from './noise.js';

export const DS = 4;                    // sample spacing in metres
export const TRACK_SPACING = 4.5;       // centre-to-centre distance of the adjacent (up/down) line, to the right
export const PLATFORM = 600;            // typical main-line platform length
const KMH = 1 / 3.6;
const LEAD = 700;                       // metres of line before the first station / after the last one

export const bankOf = (k) => Math.max(-0.07, Math.min(0.07, k * 45));

// Approximate real coordinates (decimal degrees) are used ONLY to derive the general bearing of the line.
export const PRESETS = {
  bengaluru_mysuru: {
    id: 'bengaluru_mysuru', name: 'Bengaluru – Mysuru', region: 'karnataka', blurb: 'Electrified double line across the Deccan plateau: granite hills, paddy, coconut groves, the Shimsha and Cauvery rivers.',
    difficulty: 2, seed: 11, lineSpeed: 110, defaultTime: 9.0, maxGrade: 0.012, maxCurv: 1 / 600, meander: 0.9,
    terrain: { base: 760, roll: 18, rollScale: 2200, hill: 95, hillScale: 2600 },
    haze: { far: 2000, tint: [0.80, 0.74, 0.62] }, snow: false, tsrCount: 3,
    stations: [
      { km: 0, name: 'Bengaluru City', short: 'SBC', local: 'ಬೆಂಗಳೂರು', lat: 12.978, lon: 77.572, express: true, major: true },
      { km: 13, name: 'Kengeri', short: 'KGI', local: 'ಕೆಂಗೇರಿ', lat: 12.918, lon: 77.483 },
      { km: 30, name: 'Bidadi', short: 'BID', local: 'ಬಿಡದಿ', lat: 12.797, lon: 77.387 },
      { km: 45, name: 'Ramanagara', short: 'RMGM', local: 'ರಾಮನಗರ', lat: 12.722, lon: 77.282, express: true },
      { km: 56, name: 'Channapatna', short: 'CPT', local: 'ಚನ್ನಪಟ್ಟಣ', lat: 12.652, lon: 77.207 },
      { km: 74, name: 'Maddur', short: 'MAD', local: 'ಮದ್ದೂರು', lat: 12.581, lon: 77.046 },
      { km: 93, name: 'Mandya', short: 'MYA', local: 'ಮಂಡ್ಯ', lat: 12.524, lon: 76.896, express: true },
      { km: 124, name: 'Srirangapatna', short: 'SRP', local: 'ಶ್ರೀರಂಗಪಟ್ಟಣ', lat: 12.421, lon: 76.682 },
      { km: 139, name: 'Mysuru', short: 'MYS', local: 'ಮೈಸೂರು', lat: 12.313, lon: 76.643, express: true, major: true },
    ],
    zones: [{ from: 0, to: 9, kmh: 75 }, { from: 9, to: 24, kmh: 90 }, { from: 133, to: 139, kmh: 75 }],
    rivers: [{ km: 71.4, name: 'Shimsha River', width: 70, depth: 3.2 }, { km: 121.0, name: 'Cauvery River', width: 130, depth: 4.2 }],
  },
  delhi_agra: {
    id: 'delhi_agra', name: 'Delhi – Agra', region: 'gangetic', blurb: 'Flat, fast Golden-Quadrilateral corridor across the Gangetic plain. 130–160 km/h running through mustard fields and dust haze.',
    difficulty: 1, seed: 23, lineSpeed: 130, defaultTime: 7.5, maxGrade: 0.004, maxCurv: 1 / 1400, meander: 0.35,
    terrain: { base: 205, roll: 5, rollScale: 3800, hill: 0, hillScale: 3000 },
    haze: { far: 1700, tint: [0.84, 0.76, 0.62] }, snow: false, tsrCount: 2,
    stations: [
      { km: 0, name: 'Hazrat Nizamuddin', short: 'NZM', local: 'हज़रत निज़ामुद्दीन', lat: 28.588, lon: 77.254, express: true, major: true },
      { km: 24, name: 'Faridabad', short: 'FDB', local: 'फ़रीदाबाद', lat: 28.403, lon: 77.314 },
      { km: 55, name: 'Palwal', short: 'PWL', local: 'पलवल', lat: 28.145, lon: 77.327 },
      { km: 100, name: 'Kosi Kalan', short: 'KSV', local: 'कोसी कलाँ', lat: 27.800, lon: 77.435 },
      { km: 139, name: 'Mathura Jn', short: 'MTJ', local: 'मथुरा जं.', lat: 27.480, lon: 77.670, express: true, major: true },
      { km: 188, name: 'Agra Cantt', short: 'AGC', local: 'आगरा कैंट', lat: 27.158, lon: 77.990, express: true, major: true },
    ],
    zones: [{ from: 0, to: 14, kmh: 90 }, { from: 14, to: 30, kmh: 110 }, { from: 30, to: 176, kmh: 160 }, { from: 176, to: 188, kmh: 100 }],
    rivers: [{ km: 17.5, name: 'Agra Canal', width: 38, depth: 2.2 }, { km: 126.5, name: 'Yamuna Branch', width: 90, depth: 3.0 }],
  },
};

function smooth(arr, radius, passes = 1) {
  const n = arr.length; let a = arr.slice();
  for (let p = 0; p < passes; p++) {
    const out = new Float64Array(n), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - radius), hi = Math.min(n - 1, i + radius); out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); }
    a = out;
  }
  return a;
}
const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Bearing (radians, 0 = north, clockwise) between two lat/lon points (equirectangular is plenty at this scale). */
function bearing(a, b) {
  const dx = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), dy = b.lat - a.lat; return Math.atan2(dx, dy);
}

export function buildRoute(preset) {
  const P = typeof preset === 'string' ? PRESETS[preset] : preset;
  const rnd = mulberry32(P.seed * 7919 + 13);
  const lastKm = P.stations[P.stations.length - 1].km;
  const length = LEAD + lastKm * 1000 + LEAD;
  const N = Math.floor(length / DS) + 1;
  const T = P.terrain;

  // ---- stations (chainages measured from the first station) ---------------------------------------
  const stations = P.stations.map((st, id) => ({
    id, name: st.name, short: st.short, local: st.local, express: !!st.express, major: !!st.major,
    s: LEAD + st.km * 1000, platformLength: PLATFORM, km: st.km,
  }));
  for (const st of stations) st.stopS = st.s + st.platformLength / 2 - 12;       // front of the locomotive stops here

  // ---- plan view: follow the real bearing, add gentle meanders --------------------------------------
  const targetHeading = (s) => {                                                  // piecewise-smooth bearing profile
    const km = (s - LEAD) / 1000; let i = 0;
    while (i < P.stations.length - 2 && km > P.stations[i + 1].km) i++;
    const a = P.stations[i], b = P.stations[i + 1];
    const b0 = bearing(a, b);
    const prev = i > 0 ? bearing(P.stations[i - 1], a) : b0, next = i < P.stations.length - 2 ? bearing(b, P.stations[i + 2]) : b0;
    const u = sstep(0, 1, (km - a.km) / (b.km - a.km));
    // blend toward the neighbouring bearings near the stations so the line bends smoothly
    const wPrev = (1 - u) * 0.5, wNext = u * 0.5;
    return b0 + wrapAngle(prev - b0) * wPrev + wrapAngle(next - b0) * wNext;
  };
  const x = new Float64Array(N), z = new Float64Array(N), th = new Float64Array(N), k = new Float64Array(N);
  const ph1 = rnd() * 100, ph2 = rnd() * 100;
  th[0] = targetHeading(0);
  for (let i = 0; i < N; i++) {
    const s = i * DS;
    const n1 = fbm(s / 2400 + ph1, 3.3, P.seed + 7, 3) - 0.5, n2 = fbm(s / 900 + ph2, 9.1, P.seed + 9, 2) - 0.5;
    let kn = (n1 * 2.0 + n2 * 0.8) * P.maxCurv * 2.2 * P.meander;
    kn = Math.sign(kn) * Math.max(0, Math.abs(kn) - P.maxCurv * 0.12);            // dead-zone → real straights
    const steer = wrapAngle(targetHeading(s) - th[i]) / 2600;                       // pull toward the real bearing
    k[i] = Math.max(-P.maxCurv, Math.min(P.maxCurv, kn + steer));
    if (i + 1 < N) {
      th[i + 1] = th[i] + k[i] * DS;
      const hm = (th[i] + th[i + 1]) / 2;
      x[i + 1] = x[i] + Math.sin(hm) * DS; z[i + 1] = z[i] - Math.cos(hm) * DS;
    }
  }
  { const ks = smooth(k, 10, 2); for (let i = 0; i < N; i++) k[i] = Math.max(-P.maxCurv, Math.min(P.maxCurv, ks[i])); }
  // re-integrate with the smoothed curvature so geometry and curvature agree exactly
  for (let i = 0; i + 1 < N; i++) { th[i + 1] = th[i] + k[i] * DS; const hm = (th[i] + th[i + 1]) / 2; x[i + 1] = x[i] + Math.sin(hm) * DS; z[i + 1] = z[i] - Math.cos(hm) * DS; }

  // ---- terrain (dry land; rivers are added afterwards so the track profile ignores them) ----------------
  const naturalDry = (px, pz) => {
    const f = fbm(px / T.rollScale, pz / T.rollScale, P.seed, 5);
    let h = T.base + (f - 0.5) * 2 * T.roll;
    if (T.hill > 0) {                                                             // scattered granite hills
      const m = Math.max(0, fbm(px / T.hillScale, pz / T.hillScale, P.seed + 3, 3) - 0.56) * 4.2;
      h += Math.pow(Math.min(1.3, m), 1.5) * T.hill * (0.55 + 0.9 * ridged(px / 700, pz / 700, P.seed + 40, 3));
    }
    return h;
  };

  // ---- elevation profile ------------------------------------------------------------------------------------
  const nat = new Float64Array(N);
  for (let i = 0; i < N; i++) nat[i] = naturalDry(x[i], z[i]);
  let h = smooth(nat, Math.round(260 / DS), 2);
  const gmaxStep = P.maxGrade * DS;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 1; i < N; i++) h[i] = Math.max(h[i - 1] - gmaxStep, Math.min(h[i - 1] + gmaxStep, h[i]));
    for (let i = N - 2; i >= 0; i--) h[i] = Math.max(h[i + 1] - gmaxStep, Math.min(h[i + 1] + gmaxStep, h[i]));
    h = smooth(h, Math.round(120 / DS), 2);
  }
  const fixed = new Uint8Array(N);
  const flat = Math.round((PLATFORM / 2 + 120) / DS), blend = Math.round(600 / DS);
  for (const st of stations) {                                                    // level platforms
    const ci = Math.round(st.s / DS); let lvl = 0, cnt = 0;
    for (let i = Math.max(0, ci - flat); i <= Math.min(N - 1, ci + flat); i++) { lvl += h[i]; cnt++; }
    lvl /= cnt;
    for (let i = Math.max(0, ci - flat - blend); i <= Math.min(N - 1, ci + flat + blend); i++) {
      const d = Math.abs(i - ci), w = d <= flat ? 1 : 1 - (d - flat) / blend, e = w * w * (3 - 2 * w);
      h[i] = h[i] * (1 - e) + lvl * e; if (d <= flat) { h[i] = lvl; fixed[i] = 1; }
    }
    st.elev = lvl;
  }
  h = smooth(h, 8, 1);
  for (const st of stations) { const ci = Math.round(st.s / DS); for (let i = Math.max(0, ci - flat); i <= Math.min(N - 1, ci + flat); i++) h[i] = st.elev; }
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < N; i++) if (!fixed[i]) h[i] = Math.max(h[i - 1] - gmaxStep, Math.min(h[i - 1] + gmaxStep, h[i]));
    for (let i = N - 2; i >= 0; i--) if (!fixed[i]) h[i] = Math.max(h[i + 1] - gmaxStep, Math.min(h[i + 1] + gmaxStep, h[i]));
  }
  const grade = new Float64Array(N);
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1); grade[i] = (h[b] - h[a]) / ((b - a) * DS); }

  // ---- speed limits ----------------------------------------------------------------------------------------------
  const curveLimit = new Float64Array(N);
  for (let i = 0; i < N; i++) { const kk = Math.abs(k[i]); curveLimit[i] = kk < 1e-7 ? 999 : Math.sqrt((0.62 + 9.81 * Math.abs(bankOf(k[i]))) / kk); }
  const cl2 = new Float64Array(N), win = Math.round(220 / DS);                      // the whole train must clear the curve
  for (let i = 0; i < N; i++) { let m = 999; for (let j = Math.max(0, i - win); j <= Math.min(N - 1, i + win); j++) m = Math.min(m, curveLimit[j]); cl2[i] = m; }
  const limitKmh = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const km = (i * DS - LEAD) / 1000; let line = P.lineSpeed;
    for (const zn of P.zones || []) if (km >= zn.from && km < zn.to) line = zn.kmh;
    limitKmh[i] = Math.max(30, Math.floor(Math.min(line * KMH, cl2[i]) * 3.6 / 10) * 10);
  }
  for (const st of stations) for (let i = 0; i < N; i++) {                          // station approach / through-platform limits
    const d = i * DS - st.s;
    if (d > -1400 && d < 800) limitKmh[i] = Math.min(limitKmh[i], d > -PLATFORM / 2 - 100 && d < PLATFORM / 2 + 200 ? 30 : d > -900 ? 60 : 80);
  }
  const tsrs = [];
  for (let t = 0; t < P.tsrCount; t++) for (let attempt = 0; attempt < 40; attempt++) {
    const s0 = (0.1 + rnd() * 0.8) * length, len = 400 + rnd() * 300;
    if (stations.some((st) => Math.abs(st.s - s0) < 2500 || Math.abs(st.s - (s0 + len)) < 2500)) continue;
    if (tsrs.some((q) => Math.abs(q.s0 - s0) < 8000)) continue;
    tsrs.push({ s0, s1: s0 + len, kmh: rnd() < 0.5 ? 30 : 50 }); break;
  }
  for (const q of tsrs) for (let i = 0; i < N; i++) { const s = i * DS; if (s >= q.s0 && s <= q.s1) limitKmh[i] = Math.min(limitKmh[i], q.kmh); }
  const zones = [];
  for (let i = 0; i < N; i++) { const kmh = limitKmh[i]; if (!zones.length || zones[zones.length - 1].kmh !== kmh) zones.push({ s: i * DS, kmh }); }
  const MINZ = 400;
  for (let pass = 0; pass < 14; pass++) {
    let changed = false;
    for (let i = 1; i < zones.length; i++) {
      const len = (i + 1 < zones.length ? zones[i + 1].s : length) - zones[i].s; if (len >= MINZ) continue;
      const nb = [zones[i - 1].kmh]; if (i + 1 < zones.length) nb.push(zones[i + 1].kmh);
      const lower = Math.min(...nb); if (zones[i].kmh > lower) { zones[i].kmh = lower; changed = true; }
    }
    for (let i = zones.length - 1; i >= 1; i--) if (zones[i].kmh === zones[i - 1].kmh) { zones.splice(i, 1); changed = true; }
    if (!changed) break;
  }
  const limits = zones.map((z0) => ({ s: z0.s, kmh: z0.kmh, tsr: tsrs.some((q) => Math.abs(q.s0 - z0.s) < 8 && z0.kmh <= 50) }));

  // ---- rivers + bridges -----------------------------------------------------------------------------------------
  const rivers = (P.rivers || []).map((rv, i) => {
    const s = LEAD + rv.km * 1000; const f = frame(s);
    const ang = (i % 2 ? 0.42 : -0.35);                                          // river axis ~ perpendicular to the line, skewed
    const ax = f.nx * Math.cos(ang) + f.tx * Math.sin(ang), az = f.nz * Math.cos(ang) + f.tz * Math.sin(ang);
    let lvl = 1e9; for (let u = -1800; u <= 1800; u += 100) lvl = Math.min(lvl, naturalDry(f.x + ax * u, f.z + az * u));
    return { ...rv, s, px: f.x, pz: f.z, ax, az, amp: 60 + rnd() * 50, lam: 400 + rnd() * 300, ph: rnd() * 6.28, level: lvl - 1.5 - rv.depth * 0.3, bed: lvl - 1.5 - rv.depth };
  });
  function frame(s) {
    const fi = Math.max(0, Math.min(N - 2, s / DS)), i = Math.floor(fi), u = fi - i, L = (a) => a[i] + (a[i + 1] - a[i]) * u, hd = L(th);
    return { x: L(x), z: L(z), tx: Math.sin(hd), tz: -Math.cos(hd), nx: Math.cos(hd), nz: Math.sin(hd) };
  }
  const riverV0 = (rv, u) => rv.amp * (Math.sin(u / rv.lam + rv.ph) - Math.sin(rv.ph));   // centreline passes exactly through the crossing
  const natural = (px, pz) => {
    let hh = naturalDry(px, pz);
    for (const rv of rivers) {
      const dx = px - rv.px, dz = pz - rv.pz; const u = dx * rv.ax + dz * rv.az; if (Math.abs(u) > 2000) continue;
      const v = -dx * rv.az + dz * rv.ax; const d = Math.abs(v - riverV0(rv, u)); const reach = rv.width * 1.5 + rv.width * 0.5;
      if (d < reach) { const w = 1 - sstep(rv.width * 0.5, reach, d); hh = hh * (1 - w) + Math.min(hh, rv.bed) * w; }
    }
    return hh;
  };
  const bridges = rivers.map((rv) => ({ s0: rv.s - 70 - rv.width, s1: rv.s + 70 + rv.width, river: rv.name }));
  const tunnels = [];

  // ---- signals (colour-light, on the LEFT-hand side of our track) ---------------------------------------------------
  const signals = [];
  const addSignal = (s, kind, stationId = null) => {
    if (s < 150 || s > length - 150) return;
    if (bridges.some((b) => s > b.s0 && s < b.s1)) return;
    if (signals.some((q) => Math.abs(q.s - s) < 900)) return;
    signals.push({ id: 0, s, kind, stationId });
  };
  for (const st of stations) {
    addSignal(st.s - st.platformLength / 2 - 450, 'home', st.id);                // outer/home signal before the platform
    addSignal(st.s + st.platformLength / 2 + 40, 'starter', st.id);              // starter just beyond the platform
  }
  // (a station's starter/home are forced even if a block signal is near: block signals fill the gaps afterwards)
  for (let s = 1500; s < length - 900; s += 1400 + Math.floor(rnd() * 400)) addSignal(s, 'block');
  signals.sort((a, b) => a.s - b.s); signals.forEach((q, i) => { q.id = i; });

  const route = {
    preset: P, id: P.id, name: P.name, length, N, DS, x, z, theta: th, curv: k, elev: h, grade, limits, tsrs, tunnels, bridges,
    stations, stops: stations, signals, rivers, natural, naturalDry, region: P.region, haze: P.haze, snow: false,
    seaLevel: -1e4, palette: P.region, left: true, doubleTrack: true, LEAD,
  };
  buildQuery(route);
  return route;
}

function buildQuery(route) {
  const { N, DS } = route;
  route.at = (s) => {
    const f = Math.max(0, Math.min(route.length - DS * 1.01, s)) / DS;
    const i = Math.min(N - 2, Math.floor(f)), u = f - i, L = (a) => a[i] + (a[i + 1] - a[i]) * u;
    const heading = L(route.theta), kk = L(route.curv), tx = Math.sin(heading), tz = -Math.cos(heading);
    return { s, x: L(route.x), z: L(route.z), y: L(route.elev), heading, tx, tz, nx: -tz, nz: tx, k: kk, grade: L(route.grade), bank: bankOf(kk) };
  };
  route.gradeAt = (s) => route.at(s).grade;
  route.radiusAt = (s) => { const k = Math.abs(route.at(s).k); return k < 1e-6 ? Infinity : 1 / k; };
  route.inTunnel = (s) => route.tunnels.some((t) => s >= t.s0 && s <= t.s1);
  route.onBridge = (s) => route.bridges.some((t) => s >= t.s0 && s <= t.s1);
  route.limitAt = (s) => { let v = route.limits[0].kmh; for (const l of route.limits) { if (l.s <= s) v = l.kmh; else break; } return v * KMH; };

  const CELL = 64, grid = new Map(), key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
  for (let i = 0; i < N; i++) { const kk = key(Math.floor(route.x[i] / CELL), Math.floor(route.z[i] / CELL)); let a = grid.get(kk); if (!a) { a = []; grid.set(kk, a); } a.push(i); }
  /** Nearest point on the centreline of OUR track. Returns {s, d, side (+ right), y} or null beyond maxD. */
  route.nearest = (px, pz, maxD = 200) => {
    const r = Math.ceil(maxD / CELL), cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    let best = Infinity, bi = -1;
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const a = grid.get(key(ix, iz)); if (!a) continue;
      for (const i of a) { const dx = route.x[i] - px, dz = route.z[i] - pz, d2 = dx * dx + dz * dz; if (d2 < best) { best = d2; bi = i; } }
    }
    if (bi < 0 || best > maxD * maxD) return null;
    let s = bi * DS, bd = Math.sqrt(best);
    for (const j of [bi - 1, bi + 1]) {
      const i0 = Math.min(bi, j); if (i0 < 0 || i0 + 1 >= N) continue; const i1 = i0 + 1;
      const ax = route.x[i0], az = route.z[i0], abx = route.x[i1] - ax, abz = route.z[i1] - az;
      const u = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)));
      const d = Math.hypot(ax + abx * u - px, az + abz * u - pz); if (d < bd) { bd = d; s = (i0 + u) * DS; }
    }
    const p = route.at(s); const side = ((px - p.x) * p.nx + (pz - p.z) * p.nz) >= 0 ? 1 : -1;
    return { s, d: bd, side, y: p.y };
  };

  /** Terrain height at world (x,z), blended into the double-track formation (asymmetric: the 2nd line is on the right). */
  route.terrainHeight = (px, pz) => {
    const nat = route.natural(px, pz);
    const n = route.nearest(px, pz, 110); if (!n) return nat;
    const diff = nat - n.y;
    // distance from the formation edge: left edge at -10.5 m, right edge at +15 m (second line + platform)
    const edge = n.side > 0 ? 15.5 : 11.5, dist = Math.max(0, n.d - edge);
    const run = Math.max(8, Math.abs(diff) * 2.0);
    let wgt = n.d <= edge ? 1 : Math.max(0, 1 - dist / run); wgt = wgt * wgt * (3 - 2 * wgt);
    wgt *= (1 - bridgeness(route, n.s));
    return nat * (1 - wgt) + n.y * wgt - (n.d < edge ? 0.35 * wgt : 0);
  };
}

function bridgeness(route, s) {
  let m = 0;
  for (const t of route.bridges) { const a = Math.min(1, Math.max(0, (s - t.s0) / 30)) * Math.min(1, Math.max(0, (t.s1 - s) / 30)); if (a > m) m = a; }
  return m;
}
