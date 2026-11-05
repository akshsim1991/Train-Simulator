import { TrainModel } from './trainmodel.js';
import { makeUnit } from '../sim/consist.js';
import { TRACK_SPACING } from '../sim/route.js';
import { mulberry32 } from '../sim/noise.js';

/** Ambient opposing trains on the adjacent (right-hand) line. Purely visual: they never interact with the player's track. */
export class Traffic {
  constructor(scene, route, seed = 1) {
    this.scene = scene; this.route = route; this.rnd = mulberry32(seed * 131 + 7); this.cur = null; this.next = 18 + this.rnd() * 25; this.models = new Map(); this.passEvent = false;
  }
  _model(id) { let m = this.models.get(id); if (!m) { m = new TrainModel(this.scene, this.route, makeUnit(id), { lateral: TRACK_SPACING, dir: -1, tail: true }); m.setVisible(false); this.models.set(id, m); } return m; }

  update(dt, playerS, playerV, night, tunnel, active = true) {
    this.passEvent = false; const R = this.route;
    if (!this.cur) {
      this.next -= dt;
      if (this.next <= 0 && active && playerV > 8) {
        const ids = ['shatabdi', 'mail', 'diesel', 'gatimaan']; const id = ids[Math.floor(this.rnd() * ids.length)]; const model = this._model(id);
        const ahead = 2300 + this.rnd() * 500, s = Math.min(R.length - 400, playerS + ahead);
        if (R.stations.some((st) => Math.abs(st.s - s) < 900)) { this.next = 8; return; }
        this.cur = { id, model, s, v: 24 + this.rnd() * 10, passed: false }; model.setVisible(true);
      }
      return;
    }
    const c = this.cur; c.s -= c.v * dt;
    c.model.update(c.s, night, tunnel);
    const rel = c.s - playerS;                                         // opposing: front is at c.s, body extends to larger s
    if (!c.passed && rel < 30) { c.passed = true; this.passEvent = true; }
    if (c.s + c.model.length < playerS - 900 || c.s < 200) { c.model.setVisible(false); this.cur = null; this.next = 30 + this.rnd() * 70; }
  }
  dispose() { for (const m of this.models.values()) m.dispose(); this.models.clear(); }
}
