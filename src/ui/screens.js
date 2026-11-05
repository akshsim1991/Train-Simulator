import { PRESETS } from '../sim/route.js';

const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const PICS = {
  coastal: 'linear-gradient(180deg,#6fb2ea 0%,#cfe7f6 52%,#2f7aa8 52%,#1d5a7a 100%)',
  valley: 'linear-gradient(180deg,#8fc0e6 0%,#d9ecf5 45%,#6aa14a 45%,#3d6f2e 100%)',
  alpine: 'linear-gradient(180deg,#5f93c9 0%,#c8dcf0 40%,#e8eef5 40%,#9aa7b5 70%,#55704a 100%)',
};
const HOURS = [['Morning', 8], ['Noon', 12.5], ['Evening', 18.5], ['Night', 22.5]];
export const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

export class Screens {
  constructor(root) { this.root = root; }
  clear() { this.root.innerHTML = ''; }
  mount(el) { this.clear(); this.root.appendChild(el); return el; }

  menu(data, onStart) {
    const s = data.settings; const route = PRESETS[s.route] ? s.route : 'coastal'; s.route = route;
    if (s.hour == null) s.hour = PRESETS[route].defaultTime;
    const el = $(`<div class="screen"><div class="menu">
      <div class="brand"><h1>TRAIN <span>SIMULATOR</span></h1><small>Driver's edition</small></div>
      <p class="sub">Drive a modern electric multiple unit on a timetable. Stop precisely, obey signals and speed limits, and keep your passengers comfortable.</p>
      <div class="routes"></div>
      <div class="options">
        <div class="opt"><h4>Weather</h4><div class="seg" data-k="weather"></div><h4 style="margin-top:14px">Time of day <span class="hourval"></span></h4><div class="seg" data-k="hourpre" style="margin-bottom:8px"></div><input type="range" min="0" max="23.75" step="0.25" id="hour"></div>
        <div class="opt"><h4>Graphics</h4><div class="seg" data-k="quality"></div><h4 style="margin-top:14px">Volume</h4><input type="range" min="0" max="1" step="0.05" id="vol"></div>
        <div class="opt"><h4>Assists &amp; rules</h4>
          <label class="chk"><input type="checkbox" id="hints"> Contextual hints</label>
          <label class="chk"><input type="checkbox" id="alerter"> Driver vigilance (alerter)</label>
          <label class="chk"><input type="checkbox" id="voice"> Station announcements (voice)</label></div>
      </div>
      <div class="actions"><button class="btn btn-primary" id="go">Start driving</button><button class="btn" id="how">How to drive</button>
        <div class="keys"><span><kbd>W</kbd>/<kbd>S</kbd> power &amp; brake</span><span><kbd>T</kbd> doors</span><span><kbd>E</kbd> acknowledge</span><span><kbd>␣</kbd> emergency</span><span><kbd>C</kbd> camera</span></div></div>
    </div></div>`);
    const routes = el.querySelector('.routes');
    const renderRoutes = () => {
      routes.innerHTML = '';
      for (const p of Object.values(PRESETS)) {
        const best = data.best[p.id];
        const card = $(`<div class="rcard ${p.id === s.route ? 'sel' : ''}" data-id="${p.id}">
          <div class="pic" style="--pic:${PICS[p.id]}"></div>${best ? `<div class="best g-${best.grade}">${best.grade} · ${Math.round(best.total)}</div>` : ''}
          <h3>${p.name}</h3><p>${p.blurb}</p>
          <div class="meta"><span class="dots">${[1, 2, 3].map((i) => `<i class="${i <= p.difficulty ? 'on' : ''}"></i>`).join('')}</span><span><b>${(p.length / 1000).toFixed(1)}</b> km</span><span><b>${p.stations.length}</b> stations</span></div></div>`);
        card.addEventListener('click', () => { s.route = p.id; s.hour = p.defaultTime; if (s.route === 'alpine' && s.weather === 'clear') { /* keep */ } renderRoutes(); syncHour(); });
        routes.appendChild(card);
      }
    };
    const seg = (key, items, current, onPick) => {
      const e = el.querySelector(`.seg[data-k="${key}"]`); e.innerHTML = '';
      for (const [label, val] of items) { const b = $(`<button class="${String(val) === String(current()) ? 'sel' : ''}">${label}</button>`); b.addEventListener('click', () => { onPick(val); refresh(); }); e.appendChild(b); }
    };
    const hourEl = el.querySelector('#hour'), hourVal = el.querySelector('.hourval');
    const syncHour = () => { hourEl.value = s.hour; hourVal.textContent = fmtHour(s.hour); };
    const refresh = () => {
      seg('weather', [['Clear', 'clear'], ['Rain', 'rain'], ['Fog', 'fog'], ['Snow', 'snow']], () => s.weather, (v) => { s.weather = v; });
      seg('quality', [['Low', 'low'], ['Medium', 'medium'], ['High', 'high']], () => s.quality, (v) => { s.quality = v; });
      seg('hourpre', HOURS, () => HOURS.find(([, h]) => h === s.hour)?.[1], (v) => { s.hour = v; syncHour(); });
    };
    hourEl.addEventListener('input', () => { s.hour = parseFloat(hourEl.value); hourVal.textContent = fmtHour(s.hour); refresh(); });
    const vol = el.querySelector('#vol'); vol.value = s.volume; vol.addEventListener('input', () => { s.volume = parseFloat(vol.value); });
    for (const k of ['hints', 'alerter', 'voice']) { const c = el.querySelector('#' + k); c.checked = !!s[k]; c.addEventListener('change', () => { s[k] = c.checked; }); }
    el.querySelector('#go').addEventListener('click', () => onStart());
    el.querySelector('#how').addEventListener('click', () => this.help(() => this.menu(data, onStart)));
    renderRoutes(); refresh(); syncHour(); this.mount(el); return el;
  }

  help(onClose) {
    const rows = [['W / S  or  ↑ / ↓', 'Raise / lower the master controller. Past zero it becomes the brake. Hold Shift to move faster.'], ['Mouse wheel · lever', 'Move the controller directly; drag the lever in the cluster.'], ['X · Z', 'Controller to neutral · full service brake'],
      ['Space', 'Emergency brake (hold until stopped, then press E to reset)'], ['E · Enter', 'Acknowledge AWS warnings / reset brakes'], ['T', 'Open and close the doors (only when stopped at the platform)'], ['H', 'Horn'],
      ['C · 1 2 3', 'Camera: cab, follow, lineside'], ['P · Esc', 'Pause'], ['M · F · F3', 'Mute · fullscreen · debug'], ['Gamepad', 'Left stick or triggers = controller, A ack, X doors, B horn, Y camera, LB+RB emergency']];
    const el = $(`<div class="screen"><div class="panel modal"><h2>How to drive</h2><p class="sub">Run to the timetable. Doors, signals and speed limits are enforced by the safety systems.</p>
      <div class="help-grid">${rows.map(([k, v]) => `<span><kbd>${k}</kbd></span><span>${v}</span>`).join('')}</div>
      <p class="sub" style="margin-bottom:6px"><b style="color:var(--text)">Each station:</b> stop with the front of the train on the yellow marker → <kbd>T</kbd> open doors → wait for boarding → <kbd>T</kbd> close → wait for the starter signal and departure time → power up.</p>
      <p class="sub"><b style="color:var(--text)">Signals:</b> green = clear, yellow = next signal is red (prepare to stop; acknowledge the warning with <kbd>E</kbd>), red = stop. Passing red or exceeding the limit by 15 km/h triggers an emergency stop.</p>
      <div class="actions"><button class="btn btn-primary" id="ok">Got it</button></div></div></div>`);
    el.querySelector('#ok').addEventListener('click', onClose); this.mount(el);
  }

  loading(text = 'Building the line…') {
    const el = $(`<div class="screen"><div class="loading"><h2>${text}</h2><div class="progress"><i></i></div></div></div>`); this.mount(el);
    return (f) => { el.querySelector('i').style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; };
  }

  pause(cb) {
    const el = $(`<div class="screen"><div class="panel modal" style="width:min(420px,90vw);text-align:center"><h2>Paused</h2><p class="sub">Take your time.</p>
      <div style="display:grid;gap:10px"><button class="btn btn-primary" id="r" style="padding:12px">Resume</button><button class="btn" id="h">Controls</button><button class="btn" id="re">Restart journey</button><button class="btn danger" id="q">Quit to menu</button></div></div></div>`);
    el.querySelector('#r').onclick = cb.resume; el.querySelector('#h').onclick = () => this.help(() => this.pause(cb)); el.querySelector('#re').onclick = cb.restart; el.querySelector('#q').onclick = cb.quit; this.mount(el);
  }

  results(game, data, cb) {
    const sc = game.scores(); const ok = game.phase === 'finished';
    const bar = (name, v) => `<div class="cat"><span>${name}</span><div class="bar"><i style="width:${Math.round(v)}%"></i></div><b>${Math.round(v)}</b></div>`;
    const fm = (s) => (s == null ? '—' : `${s >= 0 ? '+' : '−'}${Math.abs(Math.round(s))} s`);
    const rows = sc.stops.map((r) => `<tr><td>${r.name}</td><td>${r.e == null ? 'ran through' : `${Math.abs(r.e).toFixed(1)} m ${r.e < 0 ? 'short' : 'past'}`}</td><td>${fm(r.late)}</td><td>${r.accuracy == null ? '—' : Math.round(r.accuracy)}</td></tr>`).join('');
    const el = $(`<div class="screen"><div class="panel modal">
      <h2>${ok ? 'Journey complete' : 'Journey ended'}</h2><p class="sub">${ok ? `${game.route.name} · ${Math.floor(game.t / 60)} min ${Math.round(game.t % 60)} s` : game.failReason}</p>
      <div class="res-top"><div class="grade g-${sc.grade}">${sc.grade}</div><div class="score">${Math.round(sc.total)}<small>${ok ? 'overall score' : 'score capped: journey not completed'}</small></div></div>
      <div class="cats">${bar('Stopping', sc.accuracy)}${bar('Punctuality', sc.punctuality)}${bar('Safety', sc.safety)}${bar('Speed limits', sc.speed)}${bar('Comfort', sc.comfort)}</div>
      ${rows ? `<table class="stn"><tr><th>Station</th><th>Stopped</th><th>vs timetable</th><th>Pts</th></tr>${rows}</table>` : ''}
      <p class="sub">Signals passed at danger: <b style="color:var(--text)">${game.cat.spads}</b> · Emergency applications: <b style="color:var(--text)">${game.cat.emergencies}</b> · Top speed: <b style="color:var(--text)">${Math.round(game.cat.maxSpeed * 3.6)} km/h</b></p>
      <div class="actions"><button class="btn btn-primary" id="again">Drive again</button><button class="btn" id="menu">Main menu</button></div></div></div>`);
    el.querySelector('#again').onclick = cb.again; el.querySelector('#menu').onclick = cb.menu; this.mount(el);
    if (ok) { const b = data.best[game.route.id]; if (!b || sc.total > b.total) { data.best[game.route.id] = { total: sc.total, grade: sc.grade }; cb.save(); } }
  }
}
