import { buildRoute } from './sim/route.js';
import { Game } from './sim/game.js';
import { View } from './render/view.js';
import { AudioEngine } from './audio/audio.js';
import { Hud } from './ui/hud.js';
import { Controls } from './ui/input.js';
import { Glass } from './ui/glass.js';
import { Screens } from './ui/screens.js';
import * as storage from './ui/storage.js';

const data = storage.load();
const screens = new Screens(document.getElementById('screens'));
const hudRoot = document.getElementById('hud');
const audio = new AudioEngine();
const glass = new Glass(document.getElementById('glass'));
const params = new URLSearchParams(location.search);
const CAMERAS = ['cab', 'follow', 'lineside'];

let app = null;       // { game, view, hud, ctl, raf }
let paused = false, muted = false;
window.__debug = { get app() { return app; } };

async function startJourney() {
  const s = data.settings; storage.save(data);
  audio.volume = s.volume; audio.voice = s.voice; audio.init();
  const progress = screens.loading('Building the line…');
  await new Promise((r) => setTimeout(r, 30));
  const route = buildRoute(s.route);
  const game = new Game(route, { weather: s.weather, startHour: s.hour, alerter: s.alerter, seed: (Date.now() / 1000) | 0 });
  if (params.get('s')) game.placeAt(parseFloat(params.get('s')), parseFloat(params.get('v') || 0));
  teardown();
  const canvas = document.getElementById('scene');
  const view = new View(canvas, route, { quality: s.quality, weather: game.weather, startHour: s.hour });
  view.setMode(params.get('cam') || 'cab');
  await view.preload(game.train.s, (a, b) => progress(a / Math.max(1, b)));
  const hooks = {
    settings: s, paused: () => paused,
    cycleCamera() { const i = (CAMERAS.indexOf(view.mode) + 1) % CAMERAS.length; this.setCamera(CAMERAS[i]); },
    setCamera(m) { view.setMode(m); glass.setWeather(game.weather, m === 'cab'); },
    togglePause, toggleMute() { muted = !muted; audio.setVolume(muted ? 0 : s.volume); hud.toast(muted ? 'Sound muted' : 'Sound on', 'info'); },
    help() { setPaused(true, true); }, debug() { hud.toggleDebug(); },
    fullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); },
  };
  const ctl = new Controls(game, hooks); const hud = new Hud(hudRoot, ctl);
  app = { game, view, hud, ctl, raf: 0, last: performance.now(), fpsAcc: 0, fpsN: 0, ended: false };
  paused = false; hud.show(true); screens.clear(); glass.setWeather(game.weather, view.mode === 'cab');
  glass.ctx.clearRect(0, 0, glass.c.width, glass.c.height);
  window.__ready = true;
  app.raf = requestAnimationFrame(loop);
}

function teardown() {
  if (!app) return; cancelAnimationFrame(app.raf); app.ctl.dispose(); app.view.dispose(); audio.silenceAll(); window.speechSynthesis?.cancel?.(); app = null;
}

function setPaused(p, help = false) {
  if (!app || app.ended) return; paused = p;
  if (p) {
    audio.silenceAll(); audio.suspend();
    const cb = { resume: () => setPaused(false), restart: () => { screens.clear(); startJourney(); }, quit: () => { teardown(); hudRoot.innerHTML = ''; showMenu(); } };
    if (help) screens.help(() => screens.pause(cb)); else screens.pause(cb);
  } else { screens.clear(); audio.resume(); app.last = performance.now(); }
}
function togglePause() { setPaused(!paused); }

function loop(now) {
  if (!app) return; const a = app; a.raf = requestAnimationFrame(loop);
  if (window.__freeze) { a.last = now; return; }   // test harness hook
  const dt = Math.min(0.1, (now - a.last) / 1000); a.last = now;
  a.fpsAcc += dt; a.fpsN++; if (a.fpsAcc > 0.5) { a.ctl.fps = a.fpsN / a.fpsAcc; a.fpsAcc = 0; a.fpsN = 0; }
  if (!paused) {
    a.ctl.update(dt); a.game.update(dt);
    for (const e of a.game.drainEvents()) { audio.event(e); if (e.type === 'finished' || e.type === 'failed') onEnd(); }
    audio.update(a.game, dt, { tunnel: a.view.env.tunnel, weather: a.game.weather, cab: a.view.mode === 'cab' });
    glass.update(dt, Math.abs(a.game.train.v));
  }
  a.view.update(a.game, paused ? 0 : dt);
  a.hud.update(a.game, a.view, a.ctl, dt);
}

function onEnd() {
  const a = app; if (!a || a.ended) return; a.ended = true;
  setTimeout(() => {
    if (!app) return;
    screens.results(a.game, data, {
      save: () => storage.save(data),
      again: () => { screens.clear(); startJourney(); },
      menu: () => { teardown(); hudRoot.innerHTML = ''; showMenu(); },
    });
  }, a.game.phase === 'finished' ? 2200 : 1800);
}

function showMenu() {
  glass.setWeather('clear', false);
  screens.menu(data, () => startJourney());
  // idle backdrop: keep the canvas dark
}

window.addEventListener('beforeunload', () => storage.save(data));
if (params.get('auto')) { Object.assign(data.settings, { route: params.get('route') || 'coastal', weather: params.get('weather') || 'clear', quality: params.get('quality') || 'medium', hour: params.get('hour') ? parseFloat(params.get('hour')) : null }); if (data.settings.hour == null) data.settings.hour = 17.5; startJourney(); }
else showMenu();
