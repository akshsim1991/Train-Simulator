// Electron main process: serves the app over a privileged app:// protocol (reliable ES modules,
// persistent localStorage), creates the window and sets sensible desktop behaviour for macOS + Windows.
const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, 'src');
const SELFTEST = !!process.env.TRAIN_SIM_SELFTEST;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

// GPU: prefer the discrete/high-performance path and don't let the blocklist force software rendering.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

let win = null;

function resolveAppPath(urlStr) {
  const u = new URL(urlStr);
  let rel = decodeURIComponent(u.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(ROOT, rel));
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) return null;    // block path traversal
  return full;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 810, minWidth: 960, minHeight: 600,
    backgroundColor: '#0a0e13', title: 'Indian Rail Simulator', show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => { win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.loadURL('app://game/index.html');
  win.on('closed', () => { win = null; });
  if (SELFTEST) runSelfTest(win);
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'reload' }, ...(process.argv.includes('--dev') ? [{ role: 'toggleDevTools' }] : [])] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function runSelfTest(w) {
  const out = process.env.TRAIN_SIM_SELFTEST;
  const fail = (m) => { console.log('SELFTEST FAIL: ' + m); app.exit(1); };
  w.webContents.on('render-process-gone', () => fail('renderer crashed'));
  w.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) console.log('[renderer]', msg.slice(0, 200)); });
  w.webContents.once('did-finish-load', async () => {
    try {
      await new Promise((r) => setTimeout(r, 800));
      const menuOk = await w.webContents.executeJavaScript(`document.querySelectorAll('.rcard').length`);
      if (menuOk !== 2) return fail('menu did not render (cards=' + menuOk + ')');
      await w.webContents.executeJavaScript(`document.querySelector('#go').click()`);
      await w.webContents.executeJavaScript(`new Promise((res, rej) => { const t0 = Date.now(); const i = setInterval(() => { if (window.__ready) { clearInterval(i); res(true); } else if (Date.now() - t0 > 170000) { clearInterval(i); rej('timeout'); } }, 250); })`);
      const info = await w.webContents.executeJavaScript(`(() => { const a = window.__debug.app; const gl = a.view.renderer.getContext(); return { phase: a.game.phase, gl: gl.getParameter(gl.VERSION), vendor: (gl.getExtension('WEBGL_debug_renderer_info') ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) : 'n/a'), audio: typeof AudioContext, storage: (() => { try { localStorage.setItem('t', '1'); return localStorage.getItem('t') === '1'; } catch (e) { return false; } })() }; })()`);
      console.log('SELFTEST INFO ' + JSON.stringify(info));
      await w.webContents.executeJavaScript(`window.__freeze = true`);
      await new Promise((r) => setTimeout(r, 1500));
      const img = await w.webContents.capturePage();
      if (out && out !== '1') fs.writeFileSync(out, img.toPNG());
      console.log('SELFTEST PASS');
      app.exit(0);
    } catch (e) { fail(String(e)); }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const file = resolveAppPath(request.url);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  buildMenu(); createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// macOS convention: stay running until Cmd+Q; elsewhere quit when the window closes.
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
