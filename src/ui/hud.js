const KMH = 3.6;
const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const fmtClock = (sec) => { const s = Math.floor(sec) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const fmtDist = (m) => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m';

export function scheduleDelta(game) {
  const R = game.route, i = game.stationIdx, st = R.stops[i]; if (!st || i === 0) return null;
  const prev = R.stops[i - 1];
  const frac = Math.max(0, Math.min(1, (game.train.s - prev.stopS) / (st.stopS - prev.stopS)));
  const expected = prev.dep + (st.arr - prev.dep) * frac;
  return game.t - expected; // + = late
}

export class Hud {
  constructor(root, ctl) {
    this.root = root; this.ctl = ctl; this.toasts = []; this.lastLog = 0; this.dbgOn = false;
    root.innerHTML = '';
    this.el = {
      clock: $(`<div id="clock" class="panel"><div class="time">--:--:--</div><div class="next"><span>Next stop</span><b>-</b></div><span class="chip">On time</span></div>`),
      toasts: $(`<div id="toasts"></div>`), top: $(`<div id="topright" class="panel"></div>`), hint: $(`<div id="hint" class="panel hidden"></div>`), alerts: $(`<div id="alerts"></div>`),
      cluster: $(`<div id="cluster">
        <div id="speedo" class="panel"><canvas width="452" height="380"></canvas></div>
        <div id="ahead" class="panel"><h4>Route ahead</h4><div class="rows"></div></div>
        <div id="ctl" class="panel click">
          <div id="lever"><div class="lbl p">POWER</div><div class="mid"></div><div class="knob"></div><div class="lbl b">BRAKE</div></div>
          <div class="gauges">
            <div><label>Traction <b class="tv">0%</b></label><div class="bar pow"><i></i></div></div>
            <div><label>Brake cylinder <b class="bv">0%</b></label><div class="bar cyl"><i></i></div></div>
            <div><label>Gradient <b class="gv">0.0%</b></label></div>
            <div class="leds"><span class="led" data-k="doors">DOORS</span><span class="led" data-k="slip">SLIP</span><span class="led" data-k="atp">ATP</span><span class="led" data-k="tpws">TPWS</span></div>
            <div class="btns"><button data-a="doors">Doors <kbd>T</kbd></button><button data-a="horn">Horn <kbd>H</kbd></button><div id="aws"></div></div>
            <div class="btns"><button data-a="ack">Ack <kbd>E</kbd></button><button data-a="emerg" class="danger">Emergency <kbd>␣</kbd></button></div>
          </div>
        </div></div>`),
      cam: $(`<div id="cam"></div>`), dbg: $(`<div id="dbg" class="hidden"></div>`),
    };
    for (const e of Object.values(this.el)) root.appendChild(e);
    this.canvas = this.el.cluster.querySelector('canvas'); this.g = this.canvas.getContext('2d');
    this.lever = this.el.cluster.querySelector('#lever'); this.knob = this.lever.querySelector('.knob');
    this._bind();
    const fit = () => root.style.setProperty('--s', String(Math.max(0.55, Math.min(1, innerHeight / 760, innerWidth / 1180))));
    fit(); addEventListener('resize', fit);
  }

  _bind() {
    const setFromEvent = (e) => { const r = this.lever.getBoundingClientRect(); const y = (e.clientY - r.top) / r.height; this.ctl.setLever(Math.max(-1, Math.min(1, 1 - y * 2))); };
    this.lever.addEventListener('pointerdown', (e) => { this.lever.setPointerCapture(e.pointerId); this.dragging = true; setFromEvent(e); });
    this.lever.addEventListener('pointermove', (e) => { if (this.dragging) setFromEvent(e); });
    this.lever.addEventListener('pointerup', () => { this.dragging = false; });
    this.el.cluster.querySelectorAll('button[data-a]').forEach((b) => {
      const a = b.dataset.a;
      if (a === 'horn') { b.addEventListener('pointerdown', () => this.ctl.horn(true)); b.addEventListener('pointerup', () => this.ctl.horn(false)); b.addEventListener('pointerleave', () => this.ctl.horn(false)); }
      else b.addEventListener('click', () => this.ctl.action(a));
    });
  }

  toast(text, kind) {
    const el = $(`<div class="toast ${kind || ''}">${text}</div>`); this.el.toasts.appendChild(el); this.toasts.push(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 650); }, 6500);
    while (this.el.toasts.children.length > 5) this.el.toasts.firstChild.remove();
  }

  _speedo(game, view) {
    const g = this.g, W = this.canvas.width, H = this.canvas.height, cx = W * 0.45, cy = H * 0.54, R = 132;
    g.clearRect(0, 0, W, H); const T = game.train; const v = Math.abs(T.v) * KMH; const max = 180;
    const a0 = Math.PI * 0.78, span = Math.PI * 1.44; const ang = (k) => a0 + span * Math.min(1, k / max);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 16; g.beginPath(); g.arc(cx, cy, R, a0, a0 + span); g.stroke();
    const gd = game.guidance(); const lim = gd.limit * KMH, ceil = gd.ceiling * KMH;
    // permitted-speed band (green->amber curve ceiling)
    g.strokeStyle = 'rgba(79,220,138,0.55)'; g.lineWidth = 16; g.beginPath(); g.arc(cx, cy, R, a0, ang(Math.min(ceil, lim))); g.stroke();
    if (ceil < lim - 1) { g.strokeStyle = 'rgba(255,180,58,0.7)'; g.beginPath(); g.arc(cx, cy, R, ang(ceil) - 0.012, ang(ceil) + 0.012); g.stroke(); }
    // speed fill
    const over = v > lim + 1; g.strokeStyle = over ? '#ff5a4d' : '#e9eef4'; g.lineWidth = 6; g.beginPath(); g.arc(cx, cy, R - 18, a0, ang(v)); g.stroke();
    // limit marker
    const la = ang(lim); g.strokeStyle = '#ff3b30'; g.lineWidth = 5; g.beginPath(); g.moveTo(cx + Math.cos(la) * (R - 12), cy + Math.sin(la) * (R - 12)); g.lineTo(cx + Math.cos(la) * (R + 14), cy + Math.sin(la) * (R + 14)); g.stroke();
    // ticks
    g.fillStyle = '#8e9bab'; g.font = '600 18px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let k = 0; k <= max; k += 20) { const a = ang(k); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10)); g.lineTo(cx + Math.cos(a) * (R + 22), cy + Math.sin(a) * (R + 22)); g.stroke(); g.fillText(String(k), cx + Math.cos(a) * (R + 38), cy + Math.sin(a) * (R + 38)); }
    // digital readout
    g.fillStyle = over ? '#ff7a6e' : '#fff'; g.font = '700 84px system-ui'; g.fillText(String(Math.round(v)), cx, cy - 6);
    g.fillStyle = '#8e9bab'; g.font = '600 20px system-ui'; g.fillText('km/h', cx, cy + 52);
    // limit sign
    g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy + 112, 34, 0, 7); g.fill(); g.strokeStyle = '#d4141c'; g.lineWidth = 7; g.beginPath(); g.arc(cx, cy + 112, 29, 0, 7); g.stroke();
    g.fillStyle = '#111'; g.font = '800 28px system-ui'; g.fillText(String(Math.round(lim)), cx, cy + 114);
    // target distance bar
    if (gd.target && gd.target.dist < 1600) {
      const t = gd.target, x = W - 40, y0 = cy - 150, h = 290; const f = Math.max(0, 1 - t.dist / 1600);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(x, y0, 14, h); g.fillStyle = t.kind === 'signal' ? '#ff5a4d' : t.kind === 'station' ? '#5aa7ff' : '#ffb43a'; g.fillRect(x, y0 + h * (1 - f), 14, h * f);
      g.fillStyle = '#e9eef4'; g.font = '600 15px system-ui'; g.textAlign = 'left'; g.textAlign = 'right'; g.fillText(fmtDist(t.dist), x - 8, Math.max(y0 + 14, y0 + h * (1 - f))); g.textAlign = 'center';
    }
  }

  update(game, view, ctl, dt) {
    const T = game.train, R = game.route; const t = performance.now();
    // clock + next stop
    const next = R.stops[game.stationIdx]; const delta = scheduleDelta(game);
    const clock = this.el.clock; clock.querySelector('.time').textContent = fmtClock(game.clock).slice(0, 8);
    const nb = clock.querySelector('.next');
    if (next) {
      const sched = fmtClock(game.opts.startHour * 3600 + (game.stationIdx === 0 || game.stopRec[game.stationIdx].served ? next.dep : next.arr)).slice(0, 5);
      const dist = Math.max(0, next.stopS - T.s);
      nb.innerHTML = `<span>${game.stopRec[game.stationIdx].served ? 'Depart' : 'Next stop'} ${sched}${game.stopRec[game.stationIdx].served ? '' : ' · ' + fmtDist(dist)}</span><b>${next.name}</b>`;
    }
    const chip = clock.querySelector('.chip');
    if (delta == null) { chip.textContent = game.stopRec[game.stationIdx]?.served && game.t < (next?.dep ?? 0) ? `Dep. in ${Math.max(0, Math.ceil(next.dep - game.t))}s` : '—'; chip.className = 'chip'; }
    else { const d = Math.round(delta); chip.textContent = Math.abs(d) < 10 ? 'On time' : d > 0 ? `${d} s late` : `${-d} s early`; chip.className = 'chip ' + (d > 15 ? 'late' : d < -20 ? 'early' : ''); }
    // top right
    this.el.top.innerHTML = `<b>${R.name}</b><br>${game.weather[0].toUpperCase() + game.weather.slice(1)} · ${view.mode === 'cab' ? 'Cab' : view.mode === 'follow' ? 'Follow' : 'Lineside'}<br>${(T.s / 1000).toFixed(2)} / ${(R.length / 1000).toFixed(1)} km`;
    // toasts
    const log = game.log; for (; this.lastLog < log.length; this.lastLog++) this.toast(log[this.lastLog].text, log[this.lastLog].kind);
    // speedo & lists
    this._speedo(game, view);
    const up = game.upcoming(3000).slice(0, 6);
    const rows = this.el.cluster.querySelector('.rows');
    const html = up.map((u) => {
      let ic = '', label = '';
      if (u.type === 'signal') { ic = `<span class="ic sig${u.aspect}">${u.aspect === 'R' ? '■' : u.aspect === 'Y' ? '!' : '✓'}</span>`; label = u.aspect === 'R' ? 'Signal at danger' : u.aspect === 'Y' ? 'Signal caution' : 'Signal clear'; }
      else if (u.type === 'limit') { ic = `<span class="ic lim ${u.tsr ? 'tsr' : ''}">${u.kmh}</span>`; label = u.tsr ? 'Temporary restriction' : u.lower ? 'Speed reduces' : 'Speed rises'; }
      else if (u.type === 'station') { ic = `<span class="ic stn">⚑</span>`; label = `Stop · ${u.name}`; }
      else { ic = `<span class="ic tun">◖</span>`; label = u.inside ? 'Tunnel' : `Tunnel · ${Math.round(u.len)} m`; }
      return `<div class="row ${u.d < 400 ? 'near' : ''}">${ic}<span>${label}</span><span class="d">${u.type === 'tunnel' && u.inside ? '' : fmtDist(Math.max(0, u.d))}</span></div>`;
    }).join('');
    if (html !== this._lastHtml) { rows.innerHTML = html || '<div class="row"><span></span><span style="color:var(--dim)">Clear track ahead</span><span></span></div>'; this._lastHtml = html; }
    // controls
    const k = this.knob; k.style.top = `${(1 - (T.lever + 1) / 2) * 100}%`;
    const q = (s) => this.el.cluster.querySelector(s);
    q('.pow > i').style.width = `${T.traction * 100}%`; q('.cyl > i').style.width = `${T.brakeCyl * 100}%`;
    q('.tv').textContent = `${Math.round(T.traction * 100)}%`; q('.bv').textContent = `${Math.round(T.brakeCyl * 100)}%`; q('.gv').textContent = `${(game.env.grade * 100).toFixed(1)}%`;
    const led = (key, cls, on) => { const e = this.el.cluster.querySelector(`.led[data-k="${key}"]`); e.className = 'led' + (on ? ' ' + cls : ''); };
    led('doors', 'on-a', game.doors.open); led('slip', 'on-r', T.slip); led('atp', 'on-r', game.alert.atp); led('tpws', 'on-r', game.alert.tpws);
    this.el.cluster.querySelector('#aws').className = game.alert.aws > 0 ? 'on' : '';
    // alerts
    const al = []; const lim = game.effectiveLimit();
    if (Math.abs(T.v) > lim + 0.8) al.push(['warn', `OVERSPEED  ${Math.round(Math.abs(T.v) * KMH)} / ${Math.round(lim * KMH)}`]);
    if (T.emergency) al.push(['bad', game.alert.tpws ? 'TRAIN STOP — SPAD' : 'EMERGENCY BRAKE']);
    if (game.alert.aws > 0) al.push(['warn', `WARNING — PRESS ACK (${Math.ceil(game.alert.aws)})`]);
    if (game.alert.alerterAlarm) al.push(['bad', 'DRIVER ALERT — TOUCH A CONTROL']);
    if (T.slip) al.push(['warn', 'WHEELSLIP — EASE POWER']);
    const ah = al.map(([c, s]) => `<div class="alert ${c}">${s}</div>`).join(''); if (ah !== this._ah) { this.el.alerts.innerHTML = ah; this._ah = ah; }
    // hint
    const hint = ctl.settings.hints ? computeHint(game) : null; const he = this.el.hint;
    if (hint) { he.textContent = hint; he.classList.remove('hidden'); } else he.classList.add('hidden');
    this.el.cam.textContent = `C camera · P pause · F1 help`;
    if (this.dbgOn) { this.el.dbg.textContent = `fps ${ctl.fps.toFixed(0)}  tiles ${view.terrain.tiles.size}\nv ${T.v.toFixed(2)}  a ${T.a.toFixed(2)}  lat ${game.lat.toFixed(2)}\ncyl ${T.brakeCyl.toFixed(2)}  trac ${T.traction.toFixed(2)}`; }
  }

  toggleDebug() { this.dbgOn = !this.dbgOn; this.el.dbg.classList.toggle('hidden', !this.dbgOn); }
  show(on) { this.root.classList.toggle('hidden', !on); }
}

export function computeHint(game) {
  const T = game.train, R = game.route, i = game.stationIdx, st = R.stops[i], rec = game.stopRec[i]; if (!st || game.phase !== 'running') return null;
  const stopped = Math.abs(T.v) < 0.05;
  if (game.alert.aws > 0) return 'Press E or Enter to acknowledge the warning.';
  if (T.emergency && stopped) return game.alert.tpws ? 'Train stopped by the signal. Press E to reset, then wait for authority.' : 'Press E (or Enter) to reset the brakes, then move the controller to neutral.';
  if (stopped && !rec.served && i === 0) return 'Press T to open the doors and let passengers board.';
  if (game.doors.open && !game.doors.boardDone) return `Passengers boarding… ${Math.max(0, Math.ceil(game.doors.boardTime - game.doors.boarding))} s`;
  if (game.doors.open && game.doors.boardDone && i < R.stops.length - 1) return 'Boarding complete. Press T to close the doors.';
  if (rec.served && rec.boarded && game.t < st.dep && stopped) return `Wait for the departure time (${Math.ceil(st.dep - game.t)} s). The starter signal is red until then.`;
  const sg = game.nextSignal();
  if (rec.served && rec.boarded && stopped && sg && sg.aspect === 'R' && sg.kind === 'starter') return 'Starter signal is red. Wait for it to clear.';
  if (rec.served && rec.boarded && stopped && sg && sg.aspect !== 'R' && !T.emergency) return 'Signal clear — hold W to apply power.';
  if (sg && sg.aspect === 'R' && sg.s - T.s < 1200 && Math.abs(T.v) > 3) return `Red signal in ${Math.round((sg.s - T.s) / 10) * 10} m — brake to stop short of it.`;
  if (!rec.served && i > 0 && st.stopS - T.s < 700 && st.stopS - T.s > 0) return stopped ? 'Press T to open the doors.' : 'Approaching the station — brake to stop at the yellow marker.';
  if (!rec.served && i > 0 && stopped && st.stopS - T.s > -100) return 'Press T to open the doors.';
  return null;
}
