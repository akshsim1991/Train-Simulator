const test = require('node:test');
const assert = require('node:assert');
const Sim = require('../src/sim.js');

function run(s, secs, dt = 1 / 60) { for (let t = 0; t < secs; t += dt) Sim.step(s, dt); return s; }

test('train accelerates under throttle and stays below top speed sanity', () => {
  Sim.resetRoute();
  const s = Sim.newState();
  s.throttle = 1;
  run(s, 20);
  assert.ok(s.speed > 5 && s.speed < 40, `speed ${s.speed}`);
});

test('service brake stops the train and speed never goes negative', () => {
  const s = Sim.newState();
  s.speed = 25; s.brake = 1;
  run(s, 60);
  assert.strictEqual(s.speed, 0);
});

test('emergency brake stops in shorter distance than service', () => {
  const a = Sim.newState(); a.speed = 30; a.brake = 1;
  const b = Sim.newState(); b.speed = 30; b.emergency = true;
  const p0 = a.pos;
  run(a, 60); run(b, 60);
  assert.ok(b.pos < a.pos, `emergency ${b.pos - p0} vs service ${a.pos - p0}`);
});

test('uphill slows coasting more than downhill', () => {
  const up = Sim.newState(); up.pos = 1500; up.speed = 20;   // +8 permille
  const down = Sim.newState(); down.pos = 3600; down.speed = 20; // -12 permille
  run(up, 5); run(down, 5);
  assert.ok(up.speed < down.speed);
});

test('stopping at a station scores points and advances', () => {
  Sim.resetRoute();
  const s = Sim.newState();
  s.pos = Sim.ROUTE.stations[1].pos - 0.5;
  run(s, 3);
  assert.strictEqual(s.nextStation, 2);
  assert.ok(s.score > 90);
});

test('missing a station is penalised', () => {
  Sim.resetRoute();
  const s = Sim.newState();
  s.pos = Sim.ROUTE.stations[1].pos + 41; s.speed = 10;
  run(s, 1);
  assert.ok(s.score <= -100);
});
