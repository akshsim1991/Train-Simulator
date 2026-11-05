(async () => {
  const a = window.__debug.app, g = a.game, V = a.view; window.__freeze = true;
  const gl = V.renderer.getContext(); const px = new Uint8Array(4); const N = 8; g.train.v = 20; g.setLever(0.2);
  for (let i = 0; i < 2; i++) { g.advance(0.2); V.update(g, 0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }   // warm up
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { g.advance(0.2); V.update(g, 0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const ms = (performance.now() - t0) / N; const inf = V.renderer.info.render;
  window.__perf = { ms: +ms.toFixed(0), calls: inf.calls, tris: inf.triangles, pr: V.renderer.getPixelRatio() };
})()
