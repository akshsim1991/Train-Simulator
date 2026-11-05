const KEY = 'trainsim.v2';
const defaults = { settings: { quality: 'medium', volume: 0.7, alerter: false, hints: true, voice: true, route: 'coastal', weather: 'clear', hour: null }, best: {} };
export function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); return { settings: { ...defaults.settings, ...d.settings }, best: d.best || {} }; } } catch (e) { /* storage unavailable */ }
  return JSON.parse(JSON.stringify(defaults));
}
export function save(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } }
