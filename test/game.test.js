import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute } from '../src/sim/route.js';
import { Game } from '../src/sim/game.js';
import { driveWithBot } from './bot.js';

for (const id of ['coastal', 'valley', 'alpine']) {
  test(`${id}: a competent driver can complete the journey with no SPADs`, () => {
    const r = buildRoute(id);
    const g = driveWithBot(r, { weather: id === 'alpine' ? 'snow' : 'clear', seed: 3 });
    const sc = g.scores();
    console.log(id, g.phase, g.failReason, 't=' + g.t.toFixed(0), JSON.stringify({ ...sc, stops: undefined }),
      g.stopRec.map((s) => `${s.e == null ? '-' : s.e.toFixed(1)}m/${s.late == null ? '-' : Math.round(s.late)}s`).join(' '),
      'spads', g.cat.spads, 'atp', g.cat.atp, 'aws', g.cat.awsFails);
    assert.equal(g.phase, 'finished', g.failReason);
    assert.equal(g.cat.spads, 0);
    assert.ok(sc.total > 55, `score ${sc.total}`);
  });
}

test('a driver who does nothing cannot pass: starter signal and timetable hold the train', () => {
  const g = new Game(buildRoute('valley'));
  g.advance(60);
  assert.equal(g.train.s, buildRoute('valley').stops[0].stopS);
  assert.equal(g.phase, 'running');
});

test('doors interlock: no traction with doors open and doors cannot open while moving', () => {
  const r = buildRoute('valley'); const g = new Game(r);
  g.toggleDoors(); assert.ok(g.doors.open);
  g.setLever(1); g.advance(5); assert.equal(g.train.v, 0);
  g.train.v = 5; g.doors.open = false; g.toggleDoors(); assert.equal(g.doors.open, false);
});

test('passing a red signal triggers an emergency stop and counts as a SPAD', () => {
  const r = buildRoute('valley'); const g = new Game(r);
  const sg = g.signals.find((q) => q.kind === 'block') || g.signals[0];
  sg.held = true; sg.armed = true; sg.releaseAt = 1e9; g._updateAspects();
  g.placeAt(sg.s - 30, 20); g.setLever(0.5);
  g.advance(3);
  assert.equal(g.cat.spads, 1); assert.ok(g.train.emergency);
});

test('AWS: unacknowledged warning applies the emergency brake; acknowledging avoids it', () => {
  const r = buildRoute('valley');
  const make = () => { const g = new Game(r); const sg = g.signals[1]; sg.held = true; sg.armed = true; sg.releaseAt = 1e9; g._updateAspects(); g.placeAt(sg.s - 260, 20); g.setLever(0); return { g, sg }; };
  let { g } = make(); g.advance(4); assert.ok(g.alert.aws > 0, 'warning sounding'); g.acknowledge(); g.advance(6);
  assert.equal(g.cat.awsFails, 0);
  ({ g } = make()); g.advance(12); assert.equal(g.cat.awsFails, 1); assert.ok(g.train.emergency);
});

test('ATP intervenes when more than 15 km/h over the limit', () => {
  const r = buildRoute('coastal'); const g = new Game(r);
  g.placeAt(3000, 0); g.train.v = g.effectiveLimit() + 6; g.setLever(0); g.advance(1);
  assert.ok(g.train.emergency); assert.equal(g.cat.atp, 1);
});

test('overrun of the buffers fails the run; gentle contact does not', () => {
  const r = buildRoute('coastal');
  let g = new Game(r); g.placeAt(r.length - 40, 12); g.setLever(0); g.advance(3);
  assert.equal(g.phase, 'failed');
  g = new Game(r); g.placeAt(r.length - 30, 1.5); g.setLever(0); g.advance(10);
  assert.equal(g.phase, 'running');
});

test('running through a station without stopping is penalised', () => {
  const r = buildRoute('valley'); const g = new Game(r);
  g.stationIdx = 1; g.placeAt(r.stops[1].stopS + 70, 15); g.setLever(0); g.advance(1);
  assert.ok(g.stopRec[1].missed); assert.equal(g.stationIdx, 2);
});

test('scores: perfect-ish run grades well and an unfinished run grades F', () => {
  const g = new Game(buildRoute('valley'));
  assert.equal(g.scores().grade, 'F');
});
