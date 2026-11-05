import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PW_ROOT ? process.env.PW_ROOT + '/' : import.meta.url)('playwright');
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]); let f = path.join(root, 'src', u === '/' ? '/index.html' : u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end('nf'); return; } res.writeHead(200, { 'Content-Type': mime[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(8123);
const [,, query, out, wait = '4000', vp = '1280x720', script = ''] = process.argv;
const [w, h] = vp.split('x').map(Number);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: w, height: h } });
const logs = []; p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 300)); }); p.on('response', (r) => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url()); }); p.on('pageerror', (e) => logs.push('PAGEERR: ' + e.message + (e.stack ? '\n' + e.stack.split('\n').slice(0, 4).join('\n') : '')));
await p.goto('http://localhost:8123/?' + query);
try { if (query.includes('auto=1')) await p.waitForFunction(() => window.__ready, null, { timeout: 180000 }); } catch (e) { logs.push('not ready: ' + JSON.stringify(await p.evaluate(() => window.__loading))); }
await p.waitForTimeout(Number(wait));
if (script) { await p.evaluate(script); await p.waitForTimeout(Number(process.env.POST_WAIT || 2500)); }
await p.evaluate(() => new Promise((r) => { window.__freeze = false; requestAnimationFrame(() => requestAnimationFrame(() => { window.__freeze = true; r(); })); })); await p.waitForTimeout(1200);
const info = await p.evaluate(() => { const a = window.__debug && window.__debug.app; return a ? { s: a.game.train.s.toFixed(1), v: a.game.train.v.toFixed(2), tiles: a.view.terrain.tiles.size, calls: a.view.renderer.info.render.calls, tris: a.view.renderer.info.render.triangles, phase: a.game.phase } : null; });
console.log(JSON.stringify(info)); console.log('PERF', JSON.stringify(await p.evaluate(() => window.__perf || null))); console.log(logs.slice(0, 12).join('\n'));
await p.screenshot({ path: out, timeout: 120000 });
await b.close(); srv.close();
