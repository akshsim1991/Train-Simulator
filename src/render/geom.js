import * as THREE from './three.js';

const UP = new THREE.Vector3(0, 1, 0);

/** Frame of the track at distance s, offset laterally `off` (right +) and `dy` above the rail base. */
export function frameAt(route, s, off = 0, dy = 0, out = {}) {
  const p = route.at(s);
  const c = Math.cos(p.bank), sn = Math.sin(p.bank);
  out.x = p.x + p.nx * off * c;
  out.z = p.z + p.nz * off * c;
  out.y = p.y + dy * c - off * sn;
  out.p = p;
  return out;
}

/** Lofted strip along the track. profile: [[off, dy, u], ...] ordered left -> right. */
export function stripGeometry(route, s0, s1, step, profile, { vScale = 4, closeLoop = false } = {}) {
  s0 = Math.max(0, s0); s1 = Math.min(route.length, s1);
  const n = Math.max(1, Math.ceil((s1 - s0) / step));
  const m = profile.length;
  const pos = new Float32Array((n + 1) * m * 3), uv = new Float32Array((n + 1) * m * 2);
  const tmp = {};
  for (let k = 0; k <= n; k++) {
    const s = s0 + (s1 - s0) * k / n;
    for (let j = 0; j < m; j++) {
      frameAt(route, s, profile[j][0], profile[j][1], tmp);
      const i = k * m + j;
      pos[i * 3] = tmp.x; pos[i * 3 + 1] = tmp.y; pos[i * 3 + 2] = tmp.z;
      uv[i * 2] = profile[j][2]; uv[i * 2 + 1] = s / vScale;
    }
  }
  const segs = closeLoop ? m : m - 1;
  const idx = [];
  for (let k = 0; k < n; k++) for (let j = 0; j < segs; j++) {
    const a = k * m + j, b = k * m + ((j + 1) % m), c = (k + 1) * m + j, d = (k + 1) * m + ((j + 1) % m);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Matrix placing an object at track distance s with lateral offset and height, facing along the track. */
export function trackMatrix(route, s, off = 0, dy = 0, { yaw = 0, scale = 1, roll = true } = {}) {
  const f = frameAt(route, s, off, dy);
  const p = f.p;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(Math.atan(p.grade), -p.heading + yaw, roll ? -p.bank : 0, 'YXZ');
  q.setFromEuler(e);
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(f.x, f.y, f.z), q, new THREE.Vector3(scale, scale, scale));
  return m;
}

export function hashRand(a, b, seed = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export { UP };
