// Rain / snow droplets on the cab windscreen with wiper sweeps (2D canvas overlay).
export class Glass {
  constructor(canvas) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.drops = []; this.t = 0; this.wipe = 0; this.on = false; this.mode = 'rain';
    this.resize(); window.addEventListener('resize', () => this.resize());
  }
  resize() { const d = Math.min(2, window.devicePixelRatio || 1); this.c.width = innerWidth * d; this.c.height = innerHeight * d; this.d = d; }
  setWeather(w, cab) { this.on = cab && (w === 'rain' || w === 'snow'); this.mode = w; if (!this.on) this.ctx.clearRect(0, 0, this.c.width, this.c.height); }
  update(dt, speed) {
    if (!this.on) return; const W = this.c.width, H = this.c.height, d = this.d; this.t += dt;
    const rate = this.mode === 'rain' ? 42 : 14; if (this.drops.length < 190 && Math.random() < rate * dt) {
      this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.8, r: (1.5 + Math.random() * 3.5) * d, vy: 0, life: 0 });
    }
    // wipers sweep every ~1.7 s: clear a moving wedge
    const phase = (this.t % 1.7) / 1.7; const ang = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    const cx = W * 0.5, cy = H * 0.84; const a = -2.35 + ang * 1.55; const wx = Math.cos(a), wy = Math.sin(a);
    this.drops = this.drops.filter((p) => { const dx = p.x - cx, dy = p.y - cy; const cross = Math.abs(dx * wy - dy * wx); const along = dx * wx + dy * wy; return !(cross < 22 * d && along > 0 && along < H * 0.95 && phase < 0.98); });
    for (const p of this.drops) { p.life += dt; if (p.r > 3.4 * d && p.life > 1.2) p.vy += 22 * d * dt; p.y += p.vy * dt + speed * 0.1 * d * dt; p.x += speed * 0.25 * d * dt * (Math.random() - 0.3); }
    this.drops = this.drops.filter((p) => p.y < H + 20 && p.x < W + 20);
    const g = this.ctx; g.clearRect(0, 0, W, H);
    for (const p of this.drops) {
      g.fillStyle = this.mode === 'snow' ? 'rgba(255,255,255,0.55)' : 'rgba(190,210,235,0.20)'; g.beginPath(); g.ellipse(p.x, p.y, p.r, p.r * 1.25, 0, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.arc(p.x - p.r * 0.3, p.y - p.r * 0.4, p.r * 0.32, 0, 7); g.fill();
      if (p.vy > 5) { g.strokeStyle = 'rgba(190,210,235,0.14)'; g.lineWidth = p.r * 0.7; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x, p.y - Math.min(60, p.vy * 0.5)); g.stroke(); }
    }
  }
}
