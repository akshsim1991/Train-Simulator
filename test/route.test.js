import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, PRESETS, DS } from '../src/sim/route.js';

for (const id of Object.keys(PRESETS)) {
  const r = buildRoute(id);
  test(`${id}: geometry is continuous and finite`, () => {
    for (let i = 1; i < r.N; i++) {
      const d = Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1]);
      assert.ok(Math.abs(d - DS) < 0.05, `segment ${i} length ${d}`);
      assert.ok(Number.isFinite(r.elev[i]));
    }
  });
  test(`${id}: gradients are within the preset limit (+tolerance)`, () => {
    let max = 0; for (let i = 0; i < r.N; i++) max = Math.max(max, Math.abs(r.grade[i]));
    assert.ok(max <= PRESETS[id].maxGrade * 1.25, `max grade ${max}`);
  });
  test(`${id}: minimum curve radius respected`, () => {
    let mk = 0; for (let i = 0; i < r.N; i++) mk = Math.max(mk, Math.abs(r.curv[i]));
    assert.ok(1 / mk >= 1 / PRESETS[id].maxCurv - 1);
  });
  test(`${id}: stations are ordered, spaced, and level`, () => {
    for (let i = 1; i < r.stations.length; i++) assert.ok(r.stations[i].s - r.stations[i - 1].s > 1500);
    for (const st of r.stations) {
      for (let d = -90; d <= 90; d += 10) assert.ok(Math.abs(r.at(st.s + d).grade) < 0.004, `grade ${r.at(st.s + d).grade} at station ${st.name}`);
    }
  });
  test(`${id}: timetable is strictly increasing and plausible`, () => {
    for (let i = 1; i < r.stops.length; i++) {
      assert.ok(r.stops[i].arr > r.stops[i - 1].dep, 'arrival after previous departure');
      assert.ok(r.stops[i].dep >= r.stops[i].arr);
      const v = (r.stops[i].s - r.stops[i - 1].s) / r.stops[i].run;
      assert.ok(v > 8 && v < 50, `average ${v} m/s`);
    }
  });
  test(`${id}: speed limits are positive multiples of 10 and signals are outside tunnels`, () => {
    for (const l of r.limits) assert.ok(l.kmh >= 40 && l.kmh % 10 === 0);
    for (const s of r.signals) assert.ok(!r.inTunnel(s.s), `signal at ${s.s} in a tunnel`);
  });
  test(`${id}: every station has a starter beyond the stop mark and a home well before it`, () => {
    for (const st of r.stops) {
      const sig = r.signals.filter((q) => q.stationId === st.id);
      for (const q of sig) {
        if (q.kind === 'starter') assert.ok(q.s >= st.stopS + 25, `starter ${q.s} vs stop ${st.stopS}`);
        if (q.kind === 'home') assert.ok(q.s <= st.stopS - 300);
      }
    }
    for (let i = 1; i < r.signals.length; i++) assert.ok(r.signals[i].s - r.signals[i - 1].s >= 750, 'signal spacing');
  });
  test(`${id}: nearest() recovers the centreline point and terrain is flat on the formation`, () => {
    for (const s of [100, r.length / 2, r.length - 100]) {
      const p = r.at(s); const n = r.nearest(p.x + p.nx * 3, p.z + p.nz * 3);
      assert.ok(Math.abs(n.s - s) < 2, `s ${n.s} vs ${s}`); assert.ok(Math.abs(n.d - 3) < 0.2);
      if (!r.inTunnel(s) && !r.onBridge(s)) assert.ok(Math.abs(r.terrainHeight(p.x, p.z) - p.y) < 0.6, `terrain ${r.terrainHeight(p.x, p.z)} vs track ${p.y}`);
    }
  });
  test(`${id}: deterministic`, () => {
    const r2 = buildRoute(id); assert.deepEqual(Array.from(r2.elev.slice(0, 50)), Array.from(r.elev.slice(0, 50)));
  });
}

test('presets report their features', () => {
  for (const id of Object.keys(PRESETS)) {
    const r = buildRoute(id);
    console.log(id, 'tunnels', r.tunnels.length, 'bridges', r.bridges.length, 'signals', r.signals.length,
      'limits', r.limits.length, 'tsr', r.tsrs.length, 'elev', Math.min(...r.elev).toFixed(0), Math.max(...r.elev).toFixed(0),
      'times', r.stops.map((s) => s.arr).join(','));
  }
});
