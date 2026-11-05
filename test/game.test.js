import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute } from '../src/sim/route.js';
import { Game } from '../src/sim/game.js';
import { driveWithBot } from './bot.js';

const SECTION = { from: 3, to: 6, pattern: 'all' };    // Ramanagara → Mandya on Bengaluru–Mysuru (3 intermediate legs)

test('a competent driver completes a Bengaluru–Mysuru section with every consist', () => {
  const r = buildRoute('bengaluru_mysuru');
  for (const consist of ['shatabdi', 'gatimaan', 'mail', 'diesel']) {
    const g = driveWithBot(r, { ...SECTION, consist, seed: 3 });
    const sc = g.scores();
    console.log('BLR-MYS', consist, g.phase, g.failReason, 't=' + g.t.toFixed(0), 'grade', sc.grade, Math.round(sc.total), 'stops', g.stopRec.map((s) => `${s.e == null ? '-' : s.e.toFixed(1)}m/${s.late == null ? '-' : Math.round(s.late)}s`).join(' '), 'spads', g.cat.spads, 'atp', g.cat.atp);
    assert.equal(g.phase, 'finished', `${consist}: ${g.failReason}`); assert.equal(g.cat.spads, 0); assert.ok(sc.total > 55, `${consist} score ${sc.total}`);
  }
});

test('a competent driver completes a Delhi–Agra section in rain', () => {
  const r = buildRoute('delhi_agra');
  const g = driveWithBot(r, { from: 1, to: 3, pattern: 'all', consist: 'gatimaan', weather: 'rain', seed: 4 });
  console.log('DEL-AGR', g.phase, g.failReason, 't=' + g.t.toFixed(0), JSON.stringify({ ...g.scores(), stops: undefined }));
  assert.equal(g.phase, 'finished', g.failReason); assert.equal(g.cat.spads, 0);
});

test('a driver who does nothing cannot pass: starter signal and timetable hold the train', () => {
  const g = new Game(buildRoute('bengaluru_mysuru')); const s0 = g.train.s; g.advance(120);
  assert.equal(g.train.s, s0); assert.equal(g.phase, 'running');
});

test('doors interlock: no traction with doors open and doors cannot open while moving', () => {
  const g = new Game(buildRoute('bengaluru_mysuru')); g.toggleDoors(); assert.ok(g.doors.open);
  g.setLever(1); g.advance(5); assert.equal(g.train.v, 0);
  g.train.v = 5; g.doors.open = false; g.toggleDoors(); assert.equal(g.doors.open, false);
});

test('passing a red signal triggers an emergency stop and counts as a SPAD', () => {
  const g = new Game(buildRoute('bengaluru_mysuru')); const sg = g.signals.find((q) => q.kind === 'block');
  sg.held = true; sg.armed = true; sg.releaseAt = 1e9; g._updateAspects();
  g.placeAt(sg.s - 30, 20); g.setLever(0.5); g.advance(3);
  assert.equal(g.cat.spads, 1); assert.ok(g.train.emergency);
});

test('AWS: unacknowledged warning applies the emergency brake; acknowledging avoids it', () => {
  const r = buildRoute('bengaluru_mysuru');
  const make = () => { const g = new Game(r); const sg = g.signals.find((q) => q.kind === 'block'); sg.held = true; sg.armed = true; sg.releaseAt = 1e9; g._updateAspects(); g.placeAt(sg.s - 260, 20); g.setLever(0); return g; };
  let g = make(); g.advance(4); assert.ok(g.alert.aws > 0, 'warning sounding'); g.acknowledge(); g.advance(6); assert.equal(g.cat.awsFails, 0);
  g = make(); g.advance(12); assert.equal(g.cat.awsFails, 1); assert.ok(g.train.emergency);
});

test('ATP intervenes when more than 15 km/h over the limit', () => {
  const g = new Game(buildRoute('delhi_agra')); g.placeAt(9000, 0); g.train.v = g.effectiveLimit() + 6; g.setLever(0); g.advance(1);
  assert.ok(g.train.emergency); assert.equal(g.cat.atp, 1);
});

test('overrunning the buffers at the end of the line fails the run; gentle contact does not', () => {
  const r = buildRoute('bengaluru_mysuru');
  let g = new Game(r); g.placeAt(r.length - 40, 12); g.setLever(0); g.advance(3); assert.equal(g.phase, 'failed');
  g = new Game(r); g.placeAt(r.length - 30, 1.5); g.setLever(0); g.advance(10); assert.equal(g.phase, 'running');
});

test('a section that ends mid-line has no buffers', () => {
  const r = buildRoute('bengaluru_mysuru'); const g = new Game(r, { from: 0, to: 3 });
  assert.equal(g.route.bufferS, Infinity);
});

test('running through a station without stopping is penalised', () => {
  const g = new Game(buildRoute('bengaluru_mysuru')); g.stationIdx = 1; g.placeAt(g.route.stops[1].stopS + 70, 15); g.setLever(0); g.advance(1);
  assert.ok(g.stopRec[1].missed); assert.equal(g.stationIdx, 2);
});

test('scores: an unfinished run grades F', () => assert.equal(new Game(buildRoute('delhi_agra')).scores().grade, 'F'));

test('the journey length affects the physics: a longer rake needs more distance to stop', () => {
  const r = buildRoute('delhi_agra');
  const stop = (consist) => { const g = new Game(r, { consist }); g.placeAt(9000, 36); g.setLever(-1); const s0 = g.train.s; g.advance(160); return g.train.s - s0; };
  assert.ok(stop('mail') > stop('gatimaan'), 'heavy ICF rake stops later');
});
