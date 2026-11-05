import test from 'node:test';
import assert from 'node:assert/strict';
import { newTrainState, stepTrain, UNIT, tractiveEnvelope } from '../src/sim/physics.js';
import { makeUnit, CONSISTS } from '../src/sim/consist.js';

const DT = 1 / 120;
function run(t, secs, env = {}, unit = UNIT) { for (let i = 0; i < secs / DT; i++) stepTrain(t, DT, env, unit); return t; }

test('consists use published specs: WAP-7 123 t, 20.56 m; LHB 23.54 m; lengths and masses add up', () => {
  const u = makeUnit('shatabdi');
  assert.equal(u.loco.mass, 123000); assert.equal(u.loco.length, 20.56); assert.equal(u.coach.length, 23.54);
  assert.ok(u.length > 400 && u.length < 420, `length ${u.length}`);
  assert.ok(u.mass > 900000 && u.mass < 1100000);
  for (const id of Object.keys(CONSISTS)) { const x = makeUnit(id); assert.ok(x.topSpeed >= 38 && x.topSpeed <= 45); assert.ok(x.driveMassFraction > 0.05 && x.driveMassFraction < 0.3); }
});

test('a heavy rake accelerates slowly and smoothly (bounded acceleration)', () => {
  const t = newTrainState(); t.lever = 1; let maxA = 0;
  for (let i = 0; i < 60 / DT; i++) { stepTrain(t, DT, {}); maxA = Math.max(maxA, t.a); }
  assert.ok(t.v > 9 && t.v < 22, `v=${t.v}`); assert.ok(maxA < 0.45, `peak accel ${maxA}`);
});

test('traction is power-limited above the corner speed', () => {
  const corner = UNIT.power / UNIT.maxTractive;
  assert.equal(tractiveEnvelope(corner / 2), UNIT.maxTractive);
  assert.ok(tractiveEnvelope(corner * 3) < UNIT.maxTractive / 2);
});

test('top speed never exceeds the locomotive limit', () => {
  const t = newTrainState(); t.lever = 1; run(t, 1500);
  assert.ok(t.v <= UNIT.topSpeed + 1e-9, `v=${t.v}`); assert.ok(t.v > 30);
});

test('full service brake stops near v^2/2a (plus brake-lag distance) and never reverses', () => {
  const t = newTrainState(); t.v = 30; t.lever = -1; const s0 = t.s; let minV = 0;
  for (let i = 0; i < 120 / DT; i++) { stepTrain(t, DT, {}); minV = Math.min(minV, t.v); }
  assert.equal(t.v, 0); assert.ok(minV >= 0);
  const d = t.s - s0, ideal = 900 / (2 * UNIT.brakeService);
  assert.ok(d > ideal && d < ideal * 1.5, `stopping distance ${d} vs ideal ${ideal}`);
});

test('emergency brake stops shorter than service', () => {
  const a = newTrainState(); a.v = 35; a.lever = -1; const b = newTrainState(); b.v = 35; b.emergency = true;
  run(a, 120); run(b, 120); assert.ok(b.s < a.s);
});

test('a parked train on level track stays put', () => { const t = newTrainState(); run(t, 60); assert.equal(t.v, 0); assert.equal(t.s, 0); });

test('brakes hold a train on a steep gradient; releasing lets it roll back downhill', () => {
  const env = { grade: 0.02 };
  const t = newTrainState(); t.lever = -1; run(t, 30, env); assert.equal(t.v, 0);
  t.lever = 0; run(t, 80, env); assert.ok(t.v < 0, `expected rollback, v=${t.v}`); assert.ok(t.s < 0);
});

test('a train coasts to a halt uphill and does not creep forwards afterwards', () => { const t = newTrainState(); t.v = 10; run(t, 200, { grade: 0.01 }); assert.ok(t.v <= 0.2); });

test('downhill coasting accelerates, uphill decelerates', () => {
  const up = newTrainState(); up.v = 20; const dn = newTrainState(); dn.v = 20;
  run(up, 10, { grade: 0.02 }); run(dn, 10, { grade: -0.02 }); assert.ok(up.v < 20 && dn.v > 20);
});

test('wheelslip occurs on low adhesion (with the light adhesive weight of a loco) and cuts tractive effort', () => {
  const t = newTrainState(); t.lever = 1; run(t, 6, { adhesion: 0.05 }); assert.ok(t.cumulativeSlip > 0);
  const d = newTrainState(); d.lever = 1; run(d, 6, { adhesion: 0.3 }); assert.ok(d.v > t.v);
});

test('traction cut removes power', () => { const t = newTrainState(); t.lever = 1; t.tractionCut = true; run(t, 5); assert.equal(t.v, 0); });

test('brake pressure builds with the long-train lag (no instant stop)', () => { const t = newTrainState(); t.v = 30; t.lever = -1; run(t, 0.5); assert.ok(t.brakeCyl < 0.2 && t.brakeCyl > 0); });

test('integration is stable across timestep sizes', () => {
  const a = newTrainState(); a.lever = 1; const b = newTrainState(); b.lever = 1;
  for (let i = 0; i < 20 / (1 / 60); i++) stepTrain(a, 1 / 60, {});
  for (let i = 0; i < 20 / (1 / 240); i++) stepTrain(b, 1 / 240, {});
  assert.ok(Math.abs(a.v - b.v) < 0.2, `${a.v} vs ${b.v}`);
});

test('different consists behave differently: the diesel has less power, the light rake accelerates harder', () => {
  const g = makeUnit('gatimaan'), m = makeUnit('mail');
  const a = newTrainState(); a.lever = 1; run(a, 90, {}, g); const b = newTrainState(); b.lever = 1; run(b, 90, {}, m);
  assert.ok(a.v > b.v, `${a.v} vs ${b.v}`);
});
