// Keyboard, mouse-wheel and gamepad control.
export class Controls {
  constructor(game, hooks) {
    this.game = game; this.hooks = hooks; this.keys = new Set(); this.target = 0; this.fps = 60; this.settings = hooks.settings;
    this.pad = { lastButtons: [] }; this.horning = false;
    this._kd = (e) => this.keydown(e); this._ku = (e) => this.keyup(e); this._wh = (e) => this.wheel(e);
    addEventListener('keydown', this._kd); addEventListener('keyup', this._ku); addEventListener('wheel', this._wh, { passive: true });
  }
  dispose() { removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku); removeEventListener('wheel', this._wh); }
  setLever(v) { this.target = v; this.game.setLever(v); this._direct = true; }
  horn(on) { this.game.setHorn(on); }
  action(a) { if (a === 'doors') this.game.toggleDoors(); if (a === 'ack') this.game.acknowledge(); if (a === 'emerg') this.game.emergencyBrake(); }
  keydown(e) {
    if (e.repeat) { if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); return; }
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Space': e.preventDefault(); this.game.emergencyBrake(); break;
      case 'KeyE': case 'Enter': this.game.acknowledge(); break;
      case 'KeyT': this.game.toggleDoors(); break;
      case 'KeyH': this.game.setHorn(true); break;
      case 'KeyX': this.setLever(0); break;
      case 'KeyZ': this.setLever(-1); break;
      case 'KeyC': this.hooks.cycleCamera(); break;
      case 'Digit1': this.hooks.setCamera('cab'); break; case 'Digit2': this.hooks.setCamera('follow'); break; case 'Digit3': this.hooks.setCamera('lineside'); break;
      case 'KeyP': case 'Escape': this.hooks.togglePause(); break;
      case 'KeyM': this.hooks.toggleMute(); break;
      case 'F1': case 'Slash': e.preventDefault(); this.hooks.help(); break;
      case 'F3': e.preventDefault(); this.hooks.debug(); break;
      case 'KeyF': this.hooks.fullscreen(); break;
    }
  }
  keyup(e) { this.keys.delete(e.code); if (e.code === 'KeyH') this.game.setHorn(false); }
  wheel(e) { if (this.hooks.paused()) return; this.setLever(Math.max(-1, Math.min(1, this.game.train.lever - Math.sign(e.deltaY) * 0.1))); }

  update(dt) {
    const g = this.game; const up = this.keys.has('KeyW') || this.keys.has('ArrowUp'), down = this.keys.has('KeyS') || this.keys.has('ArrowDown');
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (up || down) { const rate = (fast ? 1.8 : 0.6) * dt * (up ? 1 : -1); g.setLever(g.train.lever + rate); }
    this._gamepad(dt);
  }
  _gamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : []; const p = pads && [...pads].find((x) => x && x.connected); if (!p) return;
    const b = (i) => p.buttons[i]?.pressed, edge = (i) => b(i) && !this.pad.lastButtons[i];
    const rt = p.buttons[7]?.value || 0, lt = p.buttons[6]?.value || 0; const ly = -(p.axes[1] || 0);
    const v = Math.abs(ly) > 0.12 ? ly : (rt > 0.05 || lt > 0.05 ? rt - lt : null);
    if (v != null) this.game.setLever(v);
    if (edge(0)) this.game.acknowledge(); if (edge(2)) this.game.toggleDoors(); if (edge(3)) this.hooks.cycleCamera(); if (edge(9)) this.hooks.togglePause();
    if (b(4) && b(5) && (edge(4) || edge(5))) this.game.emergencyBrake();
    this.game.setHorn(!!b(1));
    this.pad.lastButtons = p.buttons.map((x) => x.pressed);
  }
}
