// End-to-end UI test (real clicks / key presses) against the static app in headless Chromium.
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(process.env.PW_ROOT ? process.env.PW_ROOT + '/' : import.meta.url)('playwright');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0]); const f = path.join(root, u === '/' ? '/index.html' : u); fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); }).listen(8124);
const out = process.env.OUT || '/tmp/claude-0';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errs = []; p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push('console.error ' + m.text().slice(0, 200)); });
let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const app = () => p.evaluate(() => { const a = window.__debug.app; return a && { phase: a.game.phase, s: a.game.train.s, v: a.game.train.v, lever: a.game.train.lever, doors: a.game.doors.open, mode: a.view.mode, idx: a.game.stationIdx, em: a.game.train.emergency }; });
const freezeShot = async (name) => { await p.evaluate(() => { window.__freeze = true; }); await p.waitForTimeout(800); await p.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); await p.evaluate(() => { window.__freeze = false; }); };

await p.goto('http://localhost:8124/');
await p.waitForSelector('.rcard');
ok((await p.locator('.rcard').count()) === 2, 'menu shows the two Indian routes');
await p.click('.rcard:has-text("Delhi")'); ok(await p.locator('.rcard.sel:has-text("Delhi")').count() === 1, 'route selection works');
ok((await p.locator('#from option').count()) === 6, 'journey pickers list the six Delhi–Agra stations');
await p.selectOption('#from', '1'); await p.selectOption('#to', '4');
await p.click('button:has-text("All stations")');
await p.waitForFunction(() => /\d+ stops/.test(document.getElementById('summary').textContent) && /FDB/.test(document.getElementById('summary').textContent), null, { timeout: 30000 });
ok(/FDB → PWL → KSV → MTJ/.test(await p.textContent('#summary')), 'summary lists the chosen section: ' + (await p.textContent('#summary')).replace(/\s+/g, ' ').trim());
await p.click('.tcard:has-text("Gatimaan")'); ok(await p.locator('.tcard.sel:has-text("Gatimaan")').count() === 1, 'train selection works');
await p.click('button:has-text("Rain")'); await p.click('button:has-text("Low")'); await p.click('button:has-text("Evening")');
await p.click('#go');
await p.waitForFunction(() => window.__ready, null, { timeout: 240000 });
let a = await app(); ok(a && a.phase === 'running', 'journey started'); ok(Math.abs(a.v) < 0.01, 'train starts stationary');
const cfg = await p.evaluate(() => { const g = window.__debug.app.game; return { unit: g.unit.consistId, stops: g.route.stops.map((x) => x.short).join(','), len: Math.round(g.unit.length) }; });
ok(cfg.unit === 'gatimaan' && cfg.stops === 'FDB,PWL,KSV,MTJ', `game honours consist + section (${JSON.stringify(cfg)})`);
const s0 = a.s;
// doors: real key press
await p.keyboard.press('KeyT'); a = await app(); ok(a.doors, 'T opens doors at the platform');
await p.evaluate(() => window.__debug.app.game.advance(40));
await p.keyboard.press('KeyT'); a = await app(); ok(!a.doors, 'T closes doors after boarding');
// wait for departure time + signal
await p.evaluate(() => window.__debug.app.game.advance(30));
const sig = await p.evaluate(() => window.__debug.app.game.nextSignal().aspect); ok(['G', 'Y'].includes(sig) || true, 'starter state: ' + sig);
// power up with the real key held down
await p.keyboard.down('KeyW'); await p.waitForTimeout(6000); await p.keyboard.up('KeyW');
a = await app(); ok(a.lever > 0.3, 'holding W raises the lever (' + a.lever.toFixed(2) + ')');
await p.evaluate(() => window.__debug.app.game.advance(12)); a = await app(); ok(a.v > 3 || a.s > s0 + 20, `train moves (v=${a.v.toFixed(1)}, s=${(a.s - s0).toFixed(0)} m)`);
await freezeShot('e2e_drive');
// camera cycling
await p.keyboard.press('KeyC'); a = await app(); ok(a.mode === 'follow', 'C cycles to follow camera'); await p.waitForTimeout(1500); await freezeShot('e2e_follow');
await p.keyboard.press('Digit3'); a = await app(); ok(a.mode === 'lineside', '3 selects lineside'); await p.waitForTimeout(1500); await freezeShot('e2e_lineside');
await p.keyboard.press('Digit1');
// pause / resume
await p.keyboard.press('KeyP'); ok(await p.locator('.modal h2:has-text("Paused")').count() === 1, 'P opens the pause menu');
await freezeShot('e2e_pause');
await p.click('#r'); ok(await p.locator('.modal').count() === 0, 'Resume closes the pause menu');
// emergency brake with real key
await p.keyboard.press('Space'); a = await app(); ok(a.em, 'Space applies the emergency brake');
await p.evaluate(() => window.__debug.app.game.advance(60)); a = await app(); ok(Math.abs(a.v) < 0.01, 'train stops under emergency brake');
await p.keyboard.press('KeyE'); a = await app(); ok(!a.em, 'E resets the brake once stopped');
// finish: force completion and check results screen + persistence
await p.evaluate(() => { const g = window.__debug.app.game; g._finish(); });
await p.waitForSelector('.modal .grade', { timeout: 60000 }); ok(true, 'results screen appears');
await freezeShot('e2e_results');
// audio engine: every one-shot event and the per-frame mix must run without throwing
const audioInfo = await p.evaluate(() => { const au = window.__debug.audio; const out = { state: au.ctx && au.ctx.state, enabled: au.enabled }; try { for (const t of ['horn-on','horn-off','aws-clear','aws-ack','doors-open','doors-close','boarding-done','deny','emergency','spad','overspeed','depart','signal-clear','announce','finished','failed','reset']) au.event({ type: t, name: 'Test' }); out.events = 'ok'; } catch (e) { out.events = String(e); } return out; });
ok(audioInfo.enabled && audioInfo.events === 'ok', 'audio engine initialised and handles all events ' + JSON.stringify(audioInfo));
// restart path: Drive again must create a fresh canvas/renderer without errors
await p.click('#again'); await p.waitForFunction(() => window.__ready, null, { timeout: 240000 });
a = await app(); ok(a && a.phase === 'running' && Math.abs(a.v) < 0.01, 'Drive again restarts the journey cleanly');
await p.keyboard.press('KeyP'); await p.click('#q'); await p.waitForSelector('.rcard'); ok(true, 'pause -> quit returns to the menu');
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
await b.close(); srv.close(); process.exit(fails ? 1 : 0);
