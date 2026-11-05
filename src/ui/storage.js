const KEY = 'trainsim.v3';
const defaults = { settings: { quality: 'auto', volume: 0.7, alerter: false, hints: true, voice: true, route: 'bengaluru_mysuru', consist: 'shatabdi', from: 0, to: null, pattern: 'express', weather: 'clear', hour: null }, best: {} };
export function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { const d = JSON.parse(raw); return { settings: { ...defaults.settings, ...d.settings }, best: d.best || {} }; } } catch (e) { /* storage unavailable */ }
  return JSON.parse(JSON.stringify(defaults));
}
export function save(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ } }
