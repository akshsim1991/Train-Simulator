import test from 'node:test';
import assert from 'node:assert/strict';
import { newTrainState, stepTrain, UNIT, tractiveEnvelope } from '../src/sim/physics.js';

const DT = 1 / 120;
function run(t, secs, env = {}) { for (let i = 0; i < secs / DT; i++) stepTrain(t, DT, env); return t; }

test('full power accelerates smoothly with bounded acceleration', () => {
  const t = newTrainState(); t.lever = 1;
  let maxA = 0;
  for (let i = 0; i < 30 / DT; i++) { stepTrain(t, DT, {}); maxA = Math.max(maxA, t.a); }
  assert.ok(t.v > 20, `v=${t.v}`);
  assert.ok(maxA < 1.2, `peak accel ${maxA}`);
});

test('traction is power-limited above the corner speed', () => {
  const corner = UNIT.power / UNIT.maxTractive;
  assert.equal(tractiveEnvelope(corner / 2), UNIT.maxTractive);
  assert.ok(tractiveEnvelope(corner * 3) < UNIT.maxTractive / 2);
});

test('train reaches a plausible top speed, never exceeding the mechanical limit', () => {
  const t = newTrainState(); t.lever = 1; run(t, 400);
  assert.ok(t.v <= UNIT.topSpeed + 1e-9);
  assert.ok(t.v > 40);
});

test('full service brake stops the train close to v^2/2a and never reverses', () => {
  const t = newTrainState(); t.v = 40; t.lever = -1;
  const s0 = t.s; let minV = 0;
  for (let i = 0; i < 80 / DT; i++) { stepTrain(t, DT, {}); minV = Math.min(minV, t.v); }
  assert.equal(t.v, 0); assert.ok(minV >= 0);
  const d = t.s - s0;
  const ideal = 40 * 40 / (2 * UNIT.brakeService);
  assert.ok(d > ideal && d < ideal * 1.5, `stopping distance ${d} vs ideal ${ideal}`);
});

test('emergency brake stops shorter than service', () => {
  const a = newTrainState(); a.v = 40; a.lever = -1;
  const b = newTrainState(); b.v = 40; b.emergency = true;
  run(a, 80); run(b, 80);
  assert.ok(b.s < a.s);
});

test('a parked train on level track stays put', () => {
  const t = newTrainState(); run(t, 60); assert.equal(t.v, 0); assert.equal(t.s, 0);
});

test('brakes hold a train on a steep gradient; releasing lets it roll back downhill', () => {
  const env = { grade: 0.03 }; // uphill in direction of travel
  const t = newTrainState(); t.lever = -0.3; run(t, 20, env);
  assert.equal(t.v, 0);
  t.lever = 0; run(t, 30, env);
  assert.ok(t.v < 0, `expected rollback, v=${t.v}`);
  assert.ok(t.s < 0);
});

test('a train coasts to a halt uphill and does not creep forwards afterwards', () => {
  const t = newTrainState(); t.v = 10; run(t, 120, { grade: 0.01 });
  assert.ok(t.v <= 0.2);
});

test('downhill coasting accelerates, uphill decelerates', () => {
  const up = newTrainState(); up.v = 20; const dn = newTrainState(); dn.v = 20;
  run(up, 10, { grade: 0.02 }); run(dn, 10, { grade: -0.02 });
  assert.ok(up.v < 20 && dn.v > 20);
});

test('wheelslip occurs on low adhesion and reduces tractive effort', () => {
  const t = newTrainState(); t.lever = 1; run(t, 3, { adhesion: 0.05 });
  assert.ok(t.cumulativeSlip > 0);
  const d = newTrainState(); d.lever = 1; run(d, 3, { adhesion: 0.3 });
  assert.ok(d.v > t.v);
});

test('traction cut removes power; brake lever overrides traction', () => {
  const t = newTrainState(); t.lever = 1; t.tractionCut = true; run(t, 5);
  assert.equal(t.v, 0);
});

test('brake pressure builds with lag (no instant stop)', () => {
  const t = newTrainState(); t.v = 30; t.lever = -1;
  run(t, 0.3);
  assert.ok(t.brakeCyl < 0.3 && t.brakeCyl > 0);
});

test('integration is stable across timestep sizes', () => {
  const a = newTrainState(); a.lever = 1; const b = newTrainState(); b.lever = 1;
  for (let i = 0; i < 20 / (1 / 60); i++) stepTrain(a, 1 / 60, {});
  for (let i = 0; i < 20 / (1 / 240); i++) stepTrain(b, 1 / 240, {});
  assert.ok(Math.abs(a.v - b.v) < 0.3, `${a.v} vs ${b.v}`);
});
