import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute } from '../src/sim/route.js';
import { Game } from '../src/sim/game.js';
import { mulberry32 } from '../src/sim/noise.js';
import { driveWithBot } from './bot.js';

function checkInvariants(g, where) {
  const T = g.train;
  for (const k of ['s', 'v', 'a', 'traction', 'brakeCyl', 'lever']) assert.ok(Number.isFinite(T[k]), `${where}: ${k} is ${T[k]}`);
  assert.ok(T.brakeCyl >= 0 && T.brakeCyl <= 1.0001, `${where}: brake cylinder ${T.brakeCyl}`);
  assert.ok(T.traction >= 0 && T.traction <= 1.0001, `${where}: traction ${T.traction}`);
  assert.ok(Math.abs(T.v) <= 62.001, `${where}: speed ${T.v}`);
  if (g.doors.open) assert.ok(Math.abs(T.v) < 0.05 || g.phase !== 'running', `${where}: doors open at speed ${T.v}`);
  if (g.doors.open) assert.equal(T.traction, 0, `${where}: traction with doors open`);
  assert.ok(g.stationIdx >= 0 && g.stationIdx < g.route.stops.length, `${where}: stationIdx ${g.stationIdx}`);
  assert.ok(Number.isFinite(g.cat.overspeed) && Number.isFinite(g.cat.harsh) && Number.isFinite(g.cat.lateral));
}

for (const [id, weather] of [['bengaluru_mysuru', 'rain'], ['delhi_agra', 'fog'], ['bengaluru_mysuru', 'clear'], ['delhi_agra', 'clear']]) {
  test(`fuzz: random inputs for ${id}/${weather} never break invariants`, () => {
    const route = buildRoute(id);
    for (let seed = 1; seed <= 4; seed++) {
      const rnd = mulberry32(seed * 977 + id.length); const g = new Game(route, { weather, seed, alerter: seed % 2 === 0 });
      for (let step = 0; step < 4000 && g.phase === 'running'; step++) {         // 4000 * 0.1 s = 400 s
        const r = rnd();
        if (r < 0.10) g.setLever(rnd() * 2 - 1); else if (r < 0.12) g.toggleDoors(); else if (r < 0.14) g.acknowledge();
        else if (r < 0.145) g.emergencyBrake(); else if (r < 0.16) g.setHorn(rnd() < 0.5); else if (r < 0.2) g.setLever(1);
        g.advance(0.1); g.drainEvents();
        checkInvariants(g, `${id}/${weather}/seed${seed}/step${step}`);
      }
    }
  });
}

for (const [id, weather, consist] of [['bengaluru_mysuru', 'rain', 'mail'], ['delhi_agra', 'fog', 'gatimaan'], ['bengaluru_mysuru', 'clear', 'diesel']]) {
  test(`bot completes a section of ${id} in ${weather} with the ${consist} and invariants hold`, () => {
    const route = buildRoute(id);
    const g = driveWithBot(route, { weather, consist, from: 1, to: 3, pattern: 'all', seed: 5 });
    checkInvariants(g, `${id}/${weather}`);
    assert.equal(g.phase, 'finished', g.failReason); assert.equal(g.cat.spads, 0); assert.ok(g.stopRec.every((r) => r.served), 'every station served');
  });
}

test('a second journey on the same route object behaves identically (no hidden shared state)', () => {
  const route = buildRoute('bengaluru_mysuru');
  const a = driveWithBot(route, { seed: 2, from: 3, to: 5, pattern: 'all' }), b = driveWithBot(route, { seed: 2, from: 3, to: 5, pattern: 'all' });
  assert.equal(a.phase, b.phase); assert.ok(Math.abs(a.t - b.t) < 1e-6, `${a.t} vs ${b.t}`);
});

test('timetable is achievable: the bot is never more than 120 s late at any stop', () => {
  const g = driveWithBot(buildRoute('bengaluru_mysuru'), { seed: 9, from: 3, to: 6, pattern: 'all' });
  for (const r of g.stopRec) if (r.late != null) assert.ok(r.late < 120, `${r.late}s late`);
});
