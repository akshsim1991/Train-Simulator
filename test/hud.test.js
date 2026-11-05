import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute } from '../src/sim/route.js';
import { Game } from '../src/sim/game.js';
import { computeHint, scheduleDelta } from '../src/ui/hud.js';

test('hints walk the driver through a station stop', () => {
  const r = buildRoute('valley'); const g = new Game(r);
  assert.match(computeHint(g), /open the doors/i);
  g.toggleDoors(); assert.match(computeHint(g), /boarding/i);
  g.advance(40); assert.match(computeHint(g), /close the doors/i);
  g.toggleDoors(); assert.match(computeHint(g), /wait/i);
  g.advance(30);
  const h = computeHint(g); assert.ok(h === null || /signal|power/i.test(h), h);
});

test('hint warns about a red signal ahead and AWS acknowledgement', () => {
  const r = buildRoute('valley'); const g = new Game(r);
  const sg = g.signals.find((q) => q.kind === 'block'); sg.held = true; sg.armed = true; sg.releaseAt = 1e9; g._updateAspects();
  g.placeAt(sg.s - 800, 25); g.setLever(0); g.advance(0.2);
  assert.match(computeHint(g), /red signal/i);
});

test('schedule delta is ~0 for a train exactly on the timetable and positive when late', () => {
  const r = buildRoute('coastal'); const g = new Game(r);
  g.stationIdx = 1; const a = r.stops[0], b = r.stops[1];
  g.placeAt((a.stopS + b.stopS) / 2, 20); g.t = (a.dep + b.arr) / 2;
  assert.ok(Math.abs(scheduleDelta(g)) < 1, 'on time');
  g.t += 60; assert.ok(scheduleDelta(g) > 59);
  g.stationIdx = 0; assert.equal(scheduleDelta(g), null);
});
