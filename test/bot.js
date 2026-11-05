// A simple automatic driver used by the tests to prove the game is winnable.
import { Game } from '../src/sim/game.js';

export function driveWithBot(route, opts = {}, maxSeconds = 4000) {
  const g = new Game(route, opts);
  const dt = 1 / 60; const T = g.train; let doorsTimer = 0;
  const brakeA = 0.62;
  for (let n = 0; n < maxSeconds / dt && g.phase === 'running'; n++) {
    g.drainEvents();
    if (g.alert.aws > 0 && g.t > 0.5) g.acknowledge();
    if (g.alert.aws === 0 && T.emergency && T.v === 0) { g.acknowledge(); }
    const st = route.stops[g.stationIdx]; const rec = g.stopRec[g.stationIdx];
    const G0 = g.guidance();
    let vTarget = G0.limit * 0.96;
    // braking curve to everything ahead
    const sg = g.nextSignal();
    const stopAt = [];
    if (sg && sg.aspect === 'R') stopAt.push(sg.s - 12);
    if (st && g.stationIdx > 0 && !rec.served) stopAt.push(st.stopS - 0.5);
    for (const d of stopAt) { const dist = Math.max(0, d - T.s); vTarget = Math.min(vTarget, Math.sqrt(2 * brakeA * Math.max(0, dist - 2))); }
    for (const l of route.limits) { if (l.s > T.s && l.s < T.s + 3000) { const vl = l.kmh / 3.6 * 0.96; vTarget = Math.min(vTarget, Math.sqrt(vl * vl + 2 * brakeA * (l.s - T.s - 5))); } }
    // station handling
    if (Math.abs(T.v) < 0.05 && rec) {
      if (!g.doors.open && !rec.served) { if (n % 30 === 0) g.toggleDoors(); }
      else if (g.doors.open && g.doors.boardDone) { g.toggleDoors(); }
    }
    // controller
    const err = vTarget - T.v;
    let lever;
    const waiting = rec && rec.served && (g.nextSignal()?.aspect === 'R');
    if (g.doors.open || (Math.abs(T.v) < 0.05 && stopAt.length && T.s >= stopAt[0] - 1)) lever = -0.5;
    else if (err > 1.2) lever = Math.min(1, 0.3 + err * 0.15);
    else if (err > -0.5) lever = 0;
    else lever = Math.max(-1, err * 0.35 - 0.1);
    if (waiting && Math.abs(T.v) < 2 && T.s > (g.nextSignal().s - 40)) lever = -0.5;
    if (T.v < 0.5 && lever < 0 && err > 0) lever = 0;
    // smooth lever
    const cur = T.lever; const maxD = 0.9 * dt;
    g.setLever(cur + Math.max(-maxD, Math.min(maxD, lever - cur)));
    g.update(dt);
  }
  return g;
}
