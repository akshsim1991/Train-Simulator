(async () => {
  const a = window.__debug.app, g = a.game, V = a.view; window.__freeze = true;
  const gl = V.renderer.getContext(); const px = new Uint8Array(4); g.train.v = 20; g.setLever(0.2);
  const run = (n = 4) => { for (let i = 0; i < 1; i++) { V.update(g, 0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } const t0 = performance.now(); for (let i = 0; i < n; i++) { V.update(g, 0.016); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return Math.round((performance.now() - t0) / n); };
  const out = {}; out.all = run();
  const trees = []; V.terrain.group.traverse((o) => { if (o.isInstancedMesh) trees.push(o); });
  const vis = (list, v) => list.forEach((o) => { o.visible = v; });
  vis(trees, false); out.noTrees = run(); vis(trees, true);
  V.terrain.group.visible = false; out.noTerrain = run(); V.terrain.group.visible = true;
  V.env.sky.visible = false; out.noSky = run(); V.env.sky.visible = true;
  V.terrain.water.visible = false; out.noWater = run(); V.terrain.water.visible = true;
  V.env.clouds.forEach((c) => { c.visible = false; }); out.noClouds = run();
  V.structs.group.visible = false; out.noStructs = run(); V.structs.group.visible = true;
  V.track.group.visible = false; out.noTrack = run(); V.track.group.visible = true;
  V.hudHidden = true; document.getElementById('hud').style.display = 'none'; out.noHud = run();
  window.__perf = out;
})()
