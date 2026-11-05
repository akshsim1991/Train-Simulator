import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, PRESETS, DS, PLATFORM } from '../src/sim/route.js';
import { makeUnit } from '../src/sim/consist.js';
import { makeSession, segmentTime } from '../src/sim/timetable.js';

for (const id of Object.keys(PRESETS)) {
  const r = buildRoute(id), P = PRESETS[id];
  test(`${id}: geometry is continuous and finite`, () => {
    for (let i = 1; i < r.N; i++) { const d = Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1]); assert.ok(Math.abs(d - DS) < 0.05, `segment ${i} length ${d}`); assert.ok(Number.isFinite(r.elev[i])); }
  });
  test(`${id}: gradients and curve radii respect the line standards`, () => {
    let mg = 0, mk = 0; for (let i = 0; i < r.N; i++) { mg = Math.max(mg, Math.abs(r.grade[i])); mk = Math.max(mk, Math.abs(r.curv[i])); }
    assert.ok(mg <= P.maxGrade * 1.25, `max grade ${mg}`); assert.ok(1 / mk >= 1 / P.maxCurv - 1);
  });
  test(`${id}: station chainages match the published distances`, () => {
    P.stations.forEach((st, i) => assert.ok(Math.abs(r.stations[i].km - st.km) < 1e-9 && Math.abs((r.stations[i].s - r.LEAD) / 1000 - st.km) < 1e-6));
    for (let i = 1; i < r.stations.length; i++) assert.ok(r.stations[i].s - r.stations[i - 1].s > 8000);
  });
  test(`${id}: platforms are level and long enough for the longest consist`, () => {
    for (const st of r.stations) {
      assert.equal(st.platformLength, PLATFORM); assert.ok(st.platformLength > makeUnit('mail').length + 60, 'platform too short');
      for (let d = -250; d <= 250; d += 25) assert.ok(Math.abs(r.at(st.s + d).grade) < 0.004, `grade ${r.at(st.s + d).grade} at ${st.name}`);
    }
  });
  test(`${id}: each station has a starter beyond the stop mark and a home signal well before the platform`, () => {
    for (const st of r.stations) for (const q of r.signals.filter((x) => x.stationId === st.id)) {
      if (q.kind === 'starter') assert.ok(q.s >= st.stopS + 25, `starter ${q.s} vs stop ${st.stopS}`);
      if (q.kind === 'home') assert.ok(q.s <= st.s - PLATFORM / 2 - 300);
    }
    for (let i = 1; i < r.signals.length; i++) assert.ok(r.signals[i].s - r.signals[i - 1].s >= 880, 'signal spacing');
  });
  test(`${id}: limits are multiples of 10 km/h, >= 30, in zones of at least 400 m`, () => {
    for (const l of r.limits) assert.ok(l.kmh >= 30 && l.kmh % 10 === 0);
    for (let i = 1; i < r.limits.length - 1; i++) assert.ok(r.limits[i + 1].s - r.limits[i].s >= 390, `short zone ${r.limits[i + 1].s - r.limits[i].s}`);
  });
  test(`${id}: rivers produce bridges and the terrain under the bridge is below the deck`, () => {
    assert.equal(r.rivers.length, P.rivers.length); assert.equal(r.bridges.length, P.rivers.length);
    for (const rv of r.rivers) { const p = r.at(rv.s); assert.ok(r.terrainHeight(rv.px, rv.pz) < p.y - 1, 'riverbed below track'); assert.ok(rv.level < p.y); }
  });
  test(`${id}: nearest() recovers the centreline and terrain is flat on the formation`, () => {
    for (const s of [800, r.length / 2, r.length - 800]) {
      const p = r.at(s), n = r.nearest(p.x + p.nx * 3, p.z + p.nz * 3);
      assert.ok(Math.abs(n.s - s) < 2 && Math.abs(n.d - 3) < 0.2);
      if (!r.onBridge(s)) assert.ok(Math.abs(r.terrainHeight(p.x, p.z) - p.y) < 0.6);
    }
  });
  test(`${id}: timetable run-times are plausible and consist-dependent`, () => {
    for (const c of ['shatabdi', 'mail', 'gatimaan']) {
      const u = makeUnit(c), ses = makeSession(r, u, { pattern: 'all' });
      for (let i = 1; i < ses.stops.length; i++) {
        assert.ok(ses.stops[i].arr > ses.stops[i - 1].dep); const v = (ses.stops[i].s - ses.stops[i - 1].s) / ses.stops[i].run; assert.ok(v > 8 && v < 46, `${c} avg ${v} m/s`);
      }
    }
    const a = segmentTime(r, makeUnit('gatimaan'), r.stations[0], r.stations[1]), b = segmentTime(r, makeUnit('diesel'), r.stations[0], r.stations[1]);
    assert.ok(a < b, 'lighter electric rake is faster than the diesel');
  });
  test(`${id}: deterministic`, () => { const r2 = buildRoute(id); assert.deepEqual(Array.from(r2.elev.slice(0, 80)), Array.from(r.elev.slice(0, 80))); assert.deepEqual(r2.limits, r.limits); });
}

test('session selects the requested stations and renumbers signals', () => {
  const r = buildRoute('bengaluru_mysuru'), u = makeUnit('shatabdi');
  const ex = makeSession(r, u, { pattern: 'express' }), all = makeSession(r, u, { pattern: 'all' }), sec = makeSession(r, u, { from: 3, to: 6, pattern: 'all' });
  assert.deepEqual(ex.stops.map((s) => s.short), ['SBC', 'RMGM', 'MYA', 'MYS']);
  assert.equal(all.stops.length, 9); assert.deepEqual(sec.stops.map((s) => s.short), ['RMGM', 'CPT', 'MAD', 'MYA']);
  assert.ok(sec.signals.length < r.signals.length); sec.signals.forEach((q, i) => assert.equal(q.id, i));
  assert.equal(sec.bufferS, Infinity); assert.equal(ex.bufferS, r.length - 25);
  sec.stops.forEach((st, i) => assert.equal(st.id, i));
});
