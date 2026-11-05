// A simple automatic driver used by the tests to prove the game is winnable.
import { Game } from '../src/sim/game.js';

export function driveWithBot(route, opts = {}, maxSeconds = 12000) {
  const g = new Game(route, opts); const R = g.route; const U = g.unit;
  const dt = 1 / 60; const T = g.train;
  const brakeA = U.brakeService * 0.6, lagD = U.brakeApplyTime * 0.45;           // conservative planning decel + brake lag
  for (let n = 0; n < maxSeconds / dt && g.phase === 'running'; n++) {
    g.drainEvents();
    if (g.alert.aws > 0 && g.t > 0.5) g.acknowledge();
    if (T.emergency && T.v === 0) g.acknowledge();
    const st = R.stops[g.stationIdx], rec = g.stopRec[g.stationIdx];
    const vLim = Math.min(g.effectiveLimit() * 0.965, U.topSpeed * 0.98);
    let vTarget = vLim;
    const sg = g.nextSignal(); const stopAt = [];
    if (sg && sg.aspect === 'R') stopAt.push(sg.s - 14);
    if (st && g.stationIdx > 0 && !rec.served) stopAt.push(st.stopS - 0.5);
    for (const d of stopAt) { const dist = Math.max(0, d - T.s - Math.max(0, T.v) * lagD); vTarget = Math.min(vTarget, Math.sqrt(2 * brakeA * Math.max(0, dist))); }
    for (const l of R.limits) if (l.s > T.s && l.s < T.s + 4500) { const vl = Math.min(l.kmh / 3.6 * 0.96, 999); const dist = Math.max(0, l.s - T.s - Math.max(0, T.v) * lagD); vTarget = Math.min(vTarget, Math.sqrt(vl * vl + 2 * brakeA * dist)); }
    if (Math.abs(T.v) < 0.05 && rec) {
      if (!g.doors.open && !rec.served) { if (n % 30 === 0) g.toggleDoors(); }
      else if (g.doors.open && g.doors.boardDone) g.toggleDoors();
    }
    const err = vTarget - T.v; let lever;
    const waiting = rec && rec.served && sg?.aspect === 'R';
    if (g.doors.open || (Math.abs(T.v) < 0.05 && stopAt.length && T.s >= stopAt[0] - 1)) lever = -0.6;
    else if (err > 0.8) lever = 1;
    else if (err > -0.4) lever = 0;
    else lever = Math.max(-1, err * 0.25 - 0.15);
    if (waiting && Math.abs(T.v) < 2 && T.s > sg.s - 45) lever = -0.6;
    if (T.v < 0.3 && lever < 0 && err > 0) lever = 0;
    const cur = T.lever, maxD = 0.9 * dt;
    g.setLever(cur + Math.max(-maxD, Math.min(maxD, lever - cur)));
    g.update(dt);
  }
  return g;
}
