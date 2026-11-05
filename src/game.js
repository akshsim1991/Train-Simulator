// Rendering + input. Uses Sim from sim.js.
(function () {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  let W, H;
  function resize() {
    const d = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * d; canvas.height = H * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
  }
  window.addEventListener('resize', resize); resize();

  let s, paused = false, started = false;
  function restart() { Sim.resetRoute(); s = Sim.newState(); paused = false; }
  restart();

  const keys = {};
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys[e.code] = true;
    if (e.code === 'Space') { s.emergency = true; }
    if (e.code === 'KeyP') paused = !paused;
    if (e.code === 'KeyR') { restart(); }
    if (!started) started = true;
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  // Notch-style controls: throttle W/S (or Up/Down), brake A/D... keep simple: hold keys to ramp
  function controls(dt) {
    const up = keys.KeyW || keys.ArrowUp, down = keys.KeyS || keys.ArrowDown;
    const brakeUp = keys.KeyB || keys.ArrowRight, brakeDown = keys.KeyV || keys.ArrowLeft;
    const rate = 0.6;
    if (up) s.throttle = Math.min(1, s.throttle + rate * dt);
    if (down) s.throttle = Math.max(0, s.throttle - rate * dt);
    if (brakeUp) s.brake = Math.min(1, s.brake + rate * dt);
    if (brakeDown) s.brake = Math.max(0, s.brake - rate * dt);
    if (keys.KeyX) { s.throttle = 0; }
    if (s.emergency && s.speed === 0 && !keys.Space) s.emergency = false;
  }

  const kmh = (ms) => ms * 3.6;

  function drawWorld() {
    const horizon = H * 0.55;
    const g = ctx.createLinearGradient(0, 0, 0, horizon);
    g.addColorStop(0, '#6aa7e0'); g.addColorStop(1, '#cfe6f7');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = '#3f6b3a'; ctx.fillRect(0, horizon, W, H - horizon);

    // far hills with parallax
    ctx.fillStyle = '#5b8a56';
    ctx.beginPath(); ctx.moveTo(0, horizon);
    for (let x = 0; x <= W; x += 20) {
      const wx = x + s.pos * 0.4;
      ctx.lineTo(x, horizon - 30 - 25 * Math.sin(wx / 160) - 15 * Math.sin(wx / 53));
    }
    ctx.lineTo(W, horizon); ctx.closePath(); ctx.fill();

    // track in perspective: ballast strip + sleepers moving toward viewer
    const cx = W / 2;
    ctx.fillStyle = '#6b6258';
    ctx.beginPath();
    ctx.moveTo(cx - 8, horizon); ctx.lineTo(cx + 8, horizon);
    ctx.lineTo(cx + W * 0.28, H); ctx.lineTo(cx - W * 0.28, H); ctx.closePath(); ctx.fill();

    const spacing = 2; // m between sleepers
    const offset = s.pos % spacing;
    for (let i = 0; i < 60; i++) {
      const d = i * spacing - offset + 1;        // distance ahead
      const t = 1 / (1 + d * 0.12);               // perspective scale 0..1
      const y = horizon + (H - horizon) * t;
      const half = 8 + (W * 0.28 - 8) * t;
      ctx.fillStyle = '#3a2f26'; ctx.fillRect(cx - half * 0.9, y, half * 1.8, Math.max(1, 6 * t));
    }
    ctx.strokeStyle = '#c9ccd1'; ctx.lineWidth = 3;
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx + sgn * 5, horizon); ctx.lineTo(cx + sgn * W * 0.2, H); ctx.stroke();
    }

    // upcoming station / speed sign markers
    const marks = [];
    Sim.ROUTE.stations.forEach((st) => { if (!st.done) marks.push({ d: st.pos - s.pos, label: st.name, color: '#ffd24a' }); });
    Sim.ROUTE.limits.forEach((l) => marks.push({ d: l.from - s.pos, label: String(l.kmh), color: '#fff', sign: true }));
    for (const m of marks) {
      if (m.d < 5 || m.d > 400) continue;
      const t = 1 / (1 + m.d * 0.12) ;
      const y = horizon + (H - horizon) * t;
      const x = cx + W * 0.2 * t + 10;
      const r = Math.max(3, 40 * t);
      if (m.sign) {
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y - r * 1.5, r, 0, 7); ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.2); ctx.strokeStyle = '#d22'; ctx.stroke();
        ctx.fillStyle = '#111'; ctx.font = `bold ${r * 0.9}px sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(m.label, x, y - r * 1.2);
      } else {
        ctx.fillStyle = m.color; ctx.fillRect(x, y - r * 2, r * 0.3 + 2, r * 2);
        ctx.font = `bold ${Math.max(10, r * 0.7)}px sans-serif`; ctx.textAlign = 'left';
        ctx.fillText(m.label, x + r * 0.5, y - r * 1.6);
      }
    }
  }

  function dial(x, y, r, value, max, label, danger) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#161c24'; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#2d3846'; ctx.lineWidth = 4; ctx.stroke();
    const a0 = Math.PI * 0.75, span = Math.PI * 1.5;
    ctx.font = `${r * 0.14}px sans-serif`; ctx.fillStyle = '#9fb0c3'; ctx.textAlign = 'center';
    for (let v = 0; v <= max; v += max / 10) {
      const a = a0 + span * (v / max);
      ctx.strokeStyle = '#9fb0c3'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82); ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92); ctx.stroke();
      ctx.fillText(Math.round(v), Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68 + 4);
    }
    if (danger != null) { // speed limit arc
      ctx.strokeStyle = '#e44'; ctx.lineWidth = 5;
      const a = a0 + span * Math.min(1, danger / max);
      ctx.beginPath(); ctx.arc(0, 0, r * 0.95, a - 0.03, a + 0.03); ctx.stroke();
    }
    const a = a0 + span * Math.min(1, value / max);
    ctx.strokeStyle = '#ff9d2e'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); ctx.stroke();
    ctx.fillStyle = '#e8eef5'; ctx.font = `bold ${r * 0.28}px sans-serif`;
    ctx.fillText(Math.round(value), 0, r * 0.5);
    ctx.font = `${r * 0.16}px sans-serif`; ctx.fillStyle = '#9fb0c3'; ctx.fillText(label, 0, r * 0.7);
    ctx.restore();
  }

  function lever(x, y, w, h, v, label, color) {
    ctx.fillStyle = '#161c24'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y + h * (1 - v), w, h * v);
    ctx.strokeStyle = '#2d3846'; ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#9fb0c3'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h + 16);
  }

  function drawHUD() {
    const lim = Sim.limitAt(s.pos);
    const panelY = H - 190;
    ctx.fillStyle = 'rgba(10,14,20,0.88)'; ctx.fillRect(0, panelY, W, 190);
    dial(160, panelY + 95, 80, kmh(s.speed), 160, 'km/h', kmh(lim));
    lever(300, panelY + 25, 36, 120, s.throttle, 'POWER', '#4cc26a');
    lever(360, panelY + 25, 36, 120, s.emergency ? 1 : s.brake, s.emergency ? 'EMERG' : 'BRAKE', s.emergency ? '#ff3b3b' : '#e0a030');

    ctx.textAlign = 'left'; ctx.fillStyle = '#e8eef5'; ctx.font = '16px sans-serif';
    const st = Sim.ROUTE.stations[s.nextStation];
    const lines = [
      st ? `Next: ${st.name} in ${Math.max(0, st.pos - s.pos).toFixed(0)} m` : 'Journey complete',
      `Limit: ${Math.round(kmh(lim))} km/h` + (s.speed > lim + 1 ? '   OVERSPEED' : ''),
      `Gradient: ${(Sim.gradientAt(s.pos) * 1000).toFixed(0)} ‰`,
      `Time: ${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`,
      `Score: ${Math.round(s.score)}`,
    ];
    lines.forEach((t, i) => {
      ctx.fillStyle = t.includes('OVERSPEED') ? '#ff5c5c' : '#e8eef5';
      ctx.fillText(t, 450, panelY + 35 + i * 28);
    });
    ctx.fillStyle = '#9fb0c3'; ctx.font = '13px sans-serif'; ctx.textAlign = 'right';
    ['W/S power   B/V brake   Space emergency brake', 'X cut power   P pause   R restart'].forEach((t, i) => ctx.fillText(t, W - 20, panelY + 30 + i * 20));
    ctx.textAlign = 'left'; ctx.fillStyle = '#cfe0f2';
    s.log.slice(-4).forEach((t, i) => ctx.fillText(t, W - 420, panelY + 90 + i * 20));
  }

  function overlay(title, sub) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = 'bold 44px sans-serif'; ctx.fillText(title, W / 2, H / 2 - 10);
    ctx.font = '18px sans-serif'; ctx.fillText(sub, W / 2, H / 2 + 30);
  }

  let last = performance.now(), acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (started && !paused && !s.finished) {
      controls(dt);
      acc += dt;
      while (acc >= 1 / 120) { Sim.step(s, 1 / 120); acc -= 1 / 120; }
    }
    drawWorld(); drawHUD();
    if (!started) overlay('Train Simulator', 'Press any key to start. Stop at each station within the marked zone.');
    else if (paused) overlay('Paused', 'Press P to resume');
    else if (s.finished) overlay('Journey complete', `Score ${Math.round(s.score)}   Time ${s.time.toFixed(0)}s   Press R to restart`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.__game = { get state() { return s; }, press: (c) => { keys[c] = true; started = true; }, release: (c) => { keys[c] = false; } };
})();
