// Timetable planner: an idealised driver is simulated with the REAL train physics, so heavy rakes get realistic
// (slow) running times. Run times per segment are cached per (route, consist).
import { newTrainState, stepTrain } from './physics.js';

const cache = new WeakMap();

function limitProfile(route, unit, a, b, DSS = 8) {
  const n = Math.max(2, Math.ceil((b - a) / DSS) + 1), v = new Float64Array(n), brake = unit.brakeService * 0.72;
  for (let j = 0; j < n; j++) { const s = a + j * DSS; v[j] = Math.min(Math.min(route.limitAt(s), route.limitAt(s - unit.length)) * 0.965, unit.topSpeed * 0.985); }
  v[0] = 0; v[n - 1] = 0;
  for (let j = n - 2; j >= 0; j--) v[j] = Math.min(v[j], Math.sqrt(v[j + 1] * v[j + 1] + 2 * brake * DSS));   // braking curves
  return { v, DSS, a };
}

/** Seconds for the ideal driver to run from stop `i` to stop `i+1` (full stop to full stop). */
export function segmentTime(route, unit, stopA, stopB) {
  let perRoute = cache.get(route); if (!perRoute) { perRoute = new Map(); cache.set(route, perRoute); }
  const key = unit.id + ':' + stopA.id + '>' + stopB.id; if (perRoute.has(key)) return perRoute.get(key);
  const a = stopA.stopS, b = stopB.stopS, prof = limitProfile(route, unit, a, b);
  const t = newTrainState(a), dt = 0.25; let time = 0, steps = 0;
  const env = { grade: 0, radius: Infinity, tunnel: false, adhesion: 0.3 };
  while (steps++ < 60000) {
    const j = Math.min(prof.v.length - 1, Math.max(0, (t.s - a) / prof.DSS)), j0 = Math.floor(j), j1 = Math.min(prof.v.length - 1, j0 + 1);
    const vT = prof.v[j0] + (prof.v[j1] - prof.v[j0]) * (j - j0);
    const dist = b - t.s;
    const vTarget = t.s < a + 60 ? Math.max(vT, 4) : vT;                           // the curve is 0 at the platform: pull away anyway
    let lever = (vTarget - t.v) * 0.6; lever = Math.max(-1, Math.min(1, lever));
    if (dist < 120 && t.v < 1.2) lever = dist > 3 ? 0.25 : -0.5;                    // creep up to the mark
    t.lever = lever;
    env.grade = (route.gradeAt(t.s) + route.gradeAt(t.s - unit.length / 2) + route.gradeAt(t.s - unit.length)) / 3; env.radius = route.radiusAt(t.s - unit.length / 2);
    stepTrain(t, dt, env, unit); time += dt;
    if (t.s >= b - 1.0 && t.v < 0.3) break;
    if (t.s > b + 40) break;                                                         // overshoot guard
  }
  const res = time * 1.045;                                                          // small margin for the human driver
  perRoute.set(key, res); return res;
}

/**
 * Build a game session view of a route: the chosen stations only (renumbered), with arr/dep times for this consist.
 * The returned object inherits everything else (geometry, limits, queries) from the full route.
 */
export function makeSession(route, unit, { from = 0, to = route.stations.length - 1, pattern = 'express' } = {}) {
  const all = route.stations; from = Math.max(0, Math.min(from, all.length - 2)); to = Math.max(from + 1, Math.min(to, all.length - 1));
  const picked = all.filter((st, i) => i === from || i === to || (i > from && i < to && (pattern === 'all' || st.express)));
  const stops = picked.map((st, id) => ({ ...st, id, fullId: st.id }));
  // times
  let t = 45; stops[0].arr = 0; stops[0].dep = 45;
  for (let i = 1; i < stops.length; i++) {
    t += segmentTime(route, unit, stops[i - 1], stops[i]); stops[i].run = segmentTime(route, unit, stops[i - 1], stops[i]);
    stops[i].arr = Math.round(t); stops[i].dwell = i === stops.length - 1 ? 0 : (stops[i].major ? 120 : 75);
    t += stops[i].dwell; stops[i].dep = Math.round(t);
  }
  const lo = stops[0].stopS - 600, hi = stops[stops.length - 1].s + stops[stops.length - 1].platformLength / 2 + 1500;
  const remap = new Map(stops.map((st) => [st.fullId, st.id]));
  const signals = route.signals.filter((sg) => sg.s > lo && sg.s < hi).map((sg, i) => ({ ...sg, id: i, stationId: remap.has(sg.stationId) ? remap.get(sg.stationId) : null,
    kind: sg.stationId != null && !remap.has(sg.stationId) ? 'block' : sg.kind }));
  const limits = route.limits.filter((l, i, arr) => (arr[i + 1] ? arr[i + 1].s : Infinity) > lo && l.s < hi);
  const session = Object.create(route);
  Object.assign(session, { stops, stationsAll: all, signals, limits, bufferS: to === all.length - 1 ? route.length - 25 : Infinity, startS: stops[0].stopS });
  return session;
}
