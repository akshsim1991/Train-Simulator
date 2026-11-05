import { PRESETS, buildRoute } from '../sim/route.js';
import { CONSISTS, makeUnit } from '../sim/consist.js';
import { makeSession } from '../sim/timetable.js';

const $ = (h) => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstChild; };
const PICS = {
  bengaluru_mysuru: 'linear-gradient(180deg,#cfd9e2 0%,#e8dcc4 48%,#5e8a3a 48%,#8a4a2a 78%,#4f7a2c 100%)',
  delhi_agra: 'linear-gradient(180deg,#d9cdb4 0%,#efe2c4 50%,#d6b73a 50%,#a8c040 78%,#c9a23a 100%)',
};
const HOURS = [['Morning', 8], ['Noon', 12.5], ['Evening', 18.5], ['Night', 21.5]];
export const fmtHour = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

const routeCache = new Map();
function getRoute(id) { if (!routeCache.has(id)) routeCache.set(id, buildRoute(id)); return routeCache.get(id); }
const fmtDur = (sec) => `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')} min`;

export class Screens {
  constructor(root) { this.root = root; }
  clear() { this.root.innerHTML = ''; }
  mount(el) { this.clear(); this.root.appendChild(el); return el; }

  menu(data, onStart) {
    const s = data.settings; if (!PRESETS[s.route]) s.route = 'bengaluru_mysuru'; if (!CONSISTS[s.consist]) s.consist = 'shatabdi';
    const P0 = PRESETS[s.route]; if (s.hour == null) s.hour = P0.defaultTime;
    const el = $(`<div class="screen"><div class="menu">
      <div class="brand"><h1>INDIAN RAIL <span>SIMULATOR</span></h1><small>Driver's cab</small></div>
      <p class="sub">Drive WAP-7 and WDP-4D locomotives with LHB and ICF coaches on real Indian Railways main lines. Stop on the mark, obey signals and the timetable.</p>
      <div class="cols">
        <div class="col">
          <div class="opt"><h4>Route</h4><div class="routes"></div></div>
          <div class="opt"><h4>Journey</h4>
            <div class="jrow"><label>From<select id="from"></select></label><label>To<select id="to"></select></label></div>
            <div class="seg" data-k="pattern" style="margin:8px 0 6px"></div><div class="summary" id="summary"></div></div>
          <div class="opt"><h4>Train</h4><div class="trains"></div></div>
        </div>
        <div class="col narrow">
          <div class="opt"><h4>Weather</h4><div class="seg" data-k="weather"></div><h4 style="margin-top:12px">Time of day <span class="hourval"></span></h4><div class="seg" data-k="hourpre" style="margin-bottom:6px"></div><input type="range" min="0" max="23.75" step="0.25" id="hour"></div>
          <div class="opt"><h4>Graphics</h4><div class="seg" data-k="quality"></div><div class="note" id="qnote"></div><h4 style="margin-top:12px">Volume</h4><input type="range" min="0" max="1" step="0.05" id="vol"></div>
          <div class="opt"><h4>Assists &amp; rules</h4>
            <label class="chk"><input type="checkbox" id="hints"> Contextual hints</label>
            <label class="chk"><input type="checkbox" id="alerter"> Driver vigilance (alerter)</label>
            <label class="chk"><input type="checkbox" id="voice"> Station announcements (voice)</label></div>
        </div>
      </div>
      <div class="actions"><button class="btn btn-primary" id="go">Start driving</button><button class="btn" id="how">How to drive</button>
        <div class="keys"><span><kbd>W</kbd>/<kbd>S</kbd> power &amp; brake</span><span><kbd>T</kbd> doors</span><span><kbd>E</kbd> acknowledge</span><span><kbd>␣</kbd> emergency</span><span><kbd>C</kbd> camera</span></div></div>
    </div></div>`);
    const $q = (q) => el.querySelector(q);
    const seg = (key, items, current, onPick) => {
      const e = $q(`.seg[data-k="${key}"]`); e.innerHTML = '';
      for (const [label, val] of items) { const b = $(`<button class="${String(val) === String(current()) ? 'sel' : ''}">${label}</button>`); b.addEventListener('click', () => { onPick(val); refresh(); }); e.appendChild(b); }
    };
    const renderRoutes = () => {
      const box = $q('.routes'); box.innerHTML = '';
      for (const p of Object.values(PRESETS)) {
        const best = data.best[p.id];
        const c = $(`<div class="rcard ${p.id === s.route ? 'sel' : ''}"><div class="pic" style="--pic:${PICS[p.id]}"></div>${best ? `<div class="best g-${best.grade}">${best.grade} · ${Math.round(best.total)}</div>` : ''}
          <h3>${p.name}</h3><p>${p.blurb}</p><div class="meta"><span class="dots">${[1, 2, 3].map((i) => `<i class="${i <= p.difficulty ? 'on' : ''}"></i>`).join('')}</span><span><b>${p.stations[p.stations.length - 1].km}</b> km</span><span><b>${p.stations.length}</b> stations</span></div></div>`);
        c.addEventListener('click', () => { s.route = p.id; s.hour = p.defaultTime; s.from = 0; s.to = null; renderRoutes(); fillStations(); refresh(); });
        box.appendChild(c);
      }
    };
    const renderTrains = () => {
      const box = $q('.trains'); box.innerHTML = '';
      for (const c of Object.values(CONSISTS)) {
        const u = makeUnit(c.id);
        const t = $(`<div class="tcard ${c.id === s.consist ? 'sel' : ''}"><b>${c.title}</b><span>${c.blurb}</span><small>${Math.round(u.mass / 1000)} t · ${Math.round(u.length)} m · ${Math.round(u.topSpeed * 3.6)} km/h · ${Math.round(u.loco.railPower / 1000 / 0.746 / 1000 * 1000)} hp</small></div>`);
        t.addEventListener('click', () => { s.consist = c.id; renderTrains(); summarise(); });
        box.appendChild(t);
      }
    };
    const fillStations = () => {
      const P = PRESETS[s.route], f = $q('#from'), t = $q('#to'); f.innerHTML = ''; t.innerHTML = '';
      P.stations.forEach((st, i) => { f.appendChild($(`<option value="${i}">${st.name} (${st.km} km)</option>`)); t.appendChild($(`<option value="${i}">${st.name} (${st.km} km)</option>`)); });
      s.from = Math.min(s.from ?? 0, P.stations.length - 2); if (s.to == null || s.to <= s.from) s.to = P.stations.length - 1; f.value = s.from; t.value = s.to;
    };
    let token = 0;
    const summarise = () => {
      const box = $q('#summary'); const my = ++token; box.textContent = 'Calculating timetable…';
      setTimeout(() => {
        if (my !== token) return;
        try {
          const r = getRoute(s.route), u = makeUnit(s.consist), ses = makeSession(r, u, { from: s.from, to: s.to, pattern: s.pattern });
          const km = (ses.stops[ses.stops.length - 1].km - ses.stops[0].km);
          box.innerHTML = `<b>${ses.stops.length}</b> stops · <b>${km}</b> km · scheduled <b>${fmtDur(ses.stops[ses.stops.length - 1].arr)}</b><br><span>${ses.stops.map((x) => x.short).join(' → ')}</span>`;
        } catch (e) { box.textContent = ''; }
      }, 20);
    };
    const hourEl = $q('#hour'), hourVal = $q('.hourval');
    const refresh = () => {
      seg('pattern', [['Express stops', 'express'], ['All stations', 'all']], () => s.pattern, (v) => { s.pattern = v; });
      seg('weather', [['Clear', 'clear'], ['Rain', 'rain'], ['Fog', 'fog']], () => s.weather, (v) => { s.weather = v; });
      seg('quality', [['Auto', 'auto'], ['Low', 'low'], ['Medium', 'medium'], ['High', 'high']], () => s.quality, (v) => { s.quality = v; });
      seg('hourpre', HOURS, () => HOURS.find(([, h]) => h === s.hour)?.[1], (v) => { s.hour = v; hourEl.value = v; hourVal.textContent = fmtHour(v); });
      $q('#qnote').textContent = s.quality === 'auto' ? 'Picks a preset for your GPU and adapts resolution to keep the game smooth.' : s.quality === 'low' ? 'Best for laptops and integrated graphics.' : s.quality === 'medium' ? 'Shadows and denser scenery.' : 'Bloom, anti-aliasing and the longest view distance.';
      summarise();
    };
    $q('#from').addEventListener('change', (e) => { s.from = +e.target.value; if (s.to <= s.from) { s.to = Math.min(PRESETS[s.route].stations.length - 1, s.from + 1); $q('#to').value = s.to; } summarise(); });
    $q('#to').addEventListener('change', (e) => { s.to = +e.target.value; if (s.to <= s.from) { s.from = Math.max(0, s.to - 1); $q('#from').value = s.from; } summarise(); });
    hourEl.value = s.hour; hourVal.textContent = fmtHour(s.hour);
    hourEl.addEventListener('input', () => { s.hour = parseFloat(hourEl.value); hourVal.textContent = fmtHour(s.hour); seg('hourpre', HOURS, () => HOURS.find(([, h]) => h === s.hour)?.[1], (v) => { s.hour = v; hourEl.value = v; hourVal.textContent = fmtHour(v); }); });
    const vol = $q('#vol'); vol.value = s.volume; vol.addEventListener('input', () => { s.volume = parseFloat(vol.value); });
    for (const k of ['hints', 'alerter', 'voice']) { const c = $q('#' + k); c.checked = !!s[k]; c.addEventListener('change', () => { s[k] = c.checked; }); }
    $q('#go').addEventListener('click', () => onStart());
    $q('#how').addEventListener('click', () => this.help(() => this.menu(data, onStart)));
    renderRoutes(); renderTrains(); fillStations(); refresh(); this.mount(el); return el;
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
      <h2>${ok ? 'Journey complete' : 'Journey ended'}</h2><p class="sub">${ok ? `${game.route.name} · ${game.unit.name} · ${Math.floor(game.t / 60)} min ${Math.round(game.t % 60)} s` : game.failReason}</p>
      <div class="res-top"><div class="grade g-${sc.grade}">${sc.grade}</div><div class="score">${Math.round(sc.total)}<small>${ok ? 'overall score' : 'score capped: journey not completed'}</small></div></div>
      <div class="cats">${bar('Stopping', sc.accuracy)}${bar('Punctuality', sc.punctuality)}${bar('Safety', sc.safety)}${bar('Speed limits', sc.speed)}${bar('Comfort', sc.comfort)}</div>
      ${rows ? `<table class="stn"><tr><th>Station</th><th>Stopped</th><th>vs timetable</th><th>Pts</th></tr>${rows}</table>` : ''}
      <p class="sub">Signals passed at danger: <b style="color:var(--text)">${game.cat.spads}</b> · Emergency applications: <b style="color:var(--text)">${game.cat.emergencies}</b> · Top speed: <b style="color:var(--text)">${Math.round(game.cat.maxSpeed * 3.6)} km/h</b></p>
      <div class="actions"><button class="btn btn-primary" id="again">Drive again</button><button class="btn" id="menu">Main menu</button></div></div></div>`);
    el.querySelector('#again').onclick = cb.again; el.querySelector('#menu').onclick = cb.menu; this.mount(el);
    if (ok) { const b = data.best[game.route.id]; if (!b || sc.total > b.total) { data.best[game.route.id] = { total: sc.total, grade: sc.grade }; cb.save(); } }
  }
}
