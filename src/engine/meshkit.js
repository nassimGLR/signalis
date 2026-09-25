// meshkit: a tiny low-poly geometry kit for the character rigs.
//
// Every primitive emits flat-shaded, non-indexed triangles with a per-face
// vertex colour and a UV into a shared 128x64 atlas (untextured faces sample a
// white block). Parts are tagged with the index of the pivot ("bone") they
// ride on; mergeByBone() fuses all parts of a rig into ONE geometry with rigid
// single-bone skin weights, so a whole character is a single draw call while
// every segment still moves exactly like a rigid piece parented to its pivot.
import * as THREE from 'three';

// ---------------------------------------------------------------- atlas
export const ATLAS_W = 128, ATLAS_H = 64;
// pixel rects [x, y, w, h] in the atlas canvas (y down)
export const RECT = {
  faceWren: [0, 0, 32, 32],
  faceHollow: [32, 0, 32, 32],
  faceRusher: [64, 0, 32, 32],
  plate: [96, 0, 32, 32],
  white: [0, 32, 16, 16],
  ribs: [16, 32, 16, 16],
  lens: [32, 32, 8, 8],
  pips: [40, 32, 8, 8],
  seam: [48, 32, 16, 16],
  eyeRed: [64, 32, 8, 8],
};
// uv of a pixel coordinate (CanvasTexture has flipY = true)
export const uvOf = (px, py) => [px / ATLAS_W, 1 - py / ATLAS_H];
export const uvCenter = (r) => uvOf(r[0] + r[2] / 2, r[1] + r[3] / 2);
const UV_WHITE = uvCenter(RECT.white);

// hex → [r,g,b] 0..1 (colour management is off in this project)
export function rgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
export function mixHex(a, b, t) {
  const A = rgb(a), B = rgb(b);
  const c = A.map((v, i) => Math.round((v + (B[i] - v) * t) * 255));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}

// ---------------------------------------------------------------- part buffer
// A Part collects triangles: pos (xyz), col (rgb), uv (uv) — flat arrays.
export class Part {
  constructor(bone = 0) {
    this.bone = bone;
    this.pos = [];
    this.col = [];
    this.uv = [];
  }
  get triCount() { return this.pos.length / 9; }
  // Append another part's triangles transformed by matrix m (optional).
  add(p, m = null) {
    const v = new THREE.Vector3();
    for (let i = 0; i < p.pos.length; i += 3) {
      v.set(p.pos[i], p.pos[i + 1], p.pos[i + 2]);
      if (m) v.applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
    }
    this.col.push(...p.col);
    this.uv.push(...p.uv);
    return this;
  }
  transform(m) {
    const v = new THREE.Vector3();
    for (let i = 0; i < this.pos.length; i += 3) {
      v.set(this.pos[i], this.pos[i + 1], this.pos[i + 2]).applyMatrix4(m);
      this.pos[i] = v.x; this.pos[i + 1] = v.y; this.pos[i + 2] = v.z;
    }
    // mirrored transforms flip winding
    if (m.determinant() < 0) {
      for (let t = 0; t < this.pos.length; t += 9) {
        for (let k = 0; k < 3; k++) { const a = this.pos[t + 3 + k]; this.pos[t + 3 + k] = this.pos[t + 6 + k]; this.pos[t + 6 + k] = a; }
      }
      for (let t = 0; t < this.uv.length; t += 6) {
        for (let k = 0; k < 2; k++) { const a = this.uv[t + 2 + k]; this.uv[t + 2 + k] = this.uv[t + 4 + k]; this.uv[t + 4 + k] = a; }
      }
    }
    return this;
  }
  // place: translate / rotate(xyz euler) / scale
  place(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s),
    );
    return this.transform(m);
  }
  // recolour every face for which fn(centroid, normal) returns a hex (or keep)
  recolor(fn, shade = true) {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3();
    for (let t = 0; t < this.pos.length; t += 9) {
      a.fromArray(this.pos, t); b.fromArray(this.pos, t + 3); c.fromArray(this.pos, t + 6);
      triNormal(a, b, c, n);
      cen.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      const hex = fn(cen, n);
      if (hex == null) continue;
      const col = shadeColor(hex, n, shade);
      for (let k = 0; k < 3; k++) { this.col[t + k * 3] = col[0]; this.col[t + k * 3 + 1] = col[1]; this.col[t + k * 3 + 2] = col[2]; }
    }
    return this;
  }
  clone() {
    const p = new Part(this.bone);
    p.pos = this.pos.slice(); p.col = this.col.slice(); p.uv = this.uv.slice();
    return p;
  }
}

const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
function triNormal(a, b, c, out) {
  _e1.subVectors(b, a); _e2.subVectors(c, a);
  return out.crossVectors(_e1, _e2).normalize();
}

// Bake a little ambient occlusion into the vertex colour: undersides darker,
// top faces a touch lighter. Keeps silhouettes readable at 270 lines.
export function shadeColor(hex, n, shade = true) {
  const c = rgb(hex);
  if (!shade) return c;
  let f = 1;
  if (n.y < -0.35) f = 0.74 + 0.1 * (1 + n.y);
  else if (n.y > 0.55) f = 1.06;
  return [Math.min(1, c[0] * f), Math.min(1, c[1] * f), Math.min(1, c[2] * f)];
}

// Emit a triangle, flipping winding if its normal disagrees with `out`.
function emit(part, a, b, c, color, uva, uvb, uvc, outward, opts) {
  const n = triNormal(a, b, c, new THREE.Vector3());
  if (!Number.isFinite(n.x) || n.lengthSq() < 0.5) return; // degenerate
  if (outward && n.dot(outward) < 0) { [b, c] = [c, b]; [uvb, uvc] = [uvc, uvb]; n.negate(); }
  const cen = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
  const hex = typeof color === 'function' ? color(cen, n) : color;
  const col = shadeColor(hex, n, opts.shade !== false);
  let ua = uva, ub = uvb, uc = uvc;
  if (opts.uv && (!opts.uvFilter || opts.uvFilter(cen, n))) { ua = opts.uv(a); ub = opts.uv(b); uc = opts.uv(c); }
  part.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let k = 0; k < 3; k++) part.col.push(col[0], col[1], col[2]);
  part.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
}

// ---------------------------------------------------------------- primitives
// loft(sections, opts): a tube through elliptical cross-sections.
//   section: { y, w, d, dx=0, dz=0, yf?: (phi)=>dy, wf?: (phi)=>scale }
//   opts: { sides=8, color, capTop=true, capBot=true, rot=π/sides, uv, uvFilter, shade }
// phi = 0 faces +Z (front); increasing phi turns toward +X.
export function loft(sections, opts = {}) {
  const N = opts.sides || 8;
  const rot = opts.rot ?? Math.PI / N;
  const part = new Part();
  const rings = sections.map((s) => {
    const r = [];
    for (let i = 0; i < N; i++) {
      const phi = rot + (i / N) * Math.PI * 2;
      const sc = s.wf ? s.wf(phi) : 1;
      r.push(new THREE.Vector3(
        (s.dx || 0) + Math.sin(phi) * s.w * 0.5 * sc,
        s.y + (s.yf ? s.yf(phi) : 0),
        (s.dz || 0) + Math.cos(phi) * s.d * 0.5 * sc,
      ));
    }
    return r;
  });
  const color = opts.color ?? 0x808080;
  const out = new THREE.Vector3();
  for (let j = 0; j < rings.length - 1; j++) {
    const A = rings[j], B = rings[j + 1];
    const cx = ((sections[j].dx || 0) + (sections[j + 1].dx || 0)) / 2;
    const cz = ((sections[j].dz || 0) + (sections[j + 1].dz || 0)) / 2;
    for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N;
      const a = A[i], b = A[i2], c = B[i2], d = B[i];
      out.set((a.x + b.x + c.x + d.x) / 4 - cx, 0, (a.z + b.z + c.z + d.z) / 4 - cz);
      if (out.lengthSq() < 1e-8) out.set(0, Math.sign(sections[j + 1].y - sections[j].y) || 1, 0);
      emit(part, a, b, c, color, UV_WHITE, UV_WHITE, UV_WHITE, out, opts);
      emit(part, a, c, d, color, UV_WHITE, UV_WHITE, UV_WHITE, out, opts);
    }
  }
  const up = sections[sections.length - 1].y >= sections[0].y ? 1 : -1;
  const cap = (ring, s, dir) => {
    const c = new THREE.Vector3(s.dx || 0, s.y + (s.capY || 0), s.dz || 0);
    const o = new THREE.Vector3(0, dir, 0);
    for (let i = 0; i < N; i++) emit(part, c, ring[i], ring[(i + 1) % N], opts.capColor ?? color, UV_WHITE, UV_WHITE, UV_WHITE, o, opts);
  };
  if (opts.capBot !== false) cap(rings[0], sections[0], -up);
  if (opts.capTop !== false) cap(rings[rings.length - 1], sections[sections.length - 1], up);
  return part;
}

// prism: a tapered limb hanging DOWN from its pivot (y = 0 → y = -len).
// r may be a number or [rx, rz] for an elliptical section.
export function prism(rTop, rBot, len, sides = 7, opts = {}) {
  const rt = Array.isArray(rTop) ? rTop : [rTop, rTop];
  const rb = Array.isArray(rBot) ? rBot : [rBot, rBot];
  const top = opts.top ?? 0;
  return loft([
    { y: -len, w: rb[0] * 2, d: rb[1] * 2, dz: opts.dzBot || 0, dx: opts.dxBot || 0 },
    { y: top, w: rt[0] * 2, d: rt[1] * 2, dz: opts.dzTop || 0, dx: opts.dxTop || 0 },
  ], { sides, ...opts });
}

// ball: a low-poly joint sphere (hides gaps at elbows / knees / shoulders).
export function ball(r, opts = {}) {
  const sides = opts.sides || 6;
  const ry = opts.ry ?? r;
  const secs = [];
  const rings = opts.rings || 3;
  for (let k = 0; k <= rings + 1; k++) {
    const t = -Math.PI / 2 + (k / (rings + 1)) * Math.PI;
    const cw = Math.cos(t);
    secs.push({ y: Math.sin(t) * ry, w: 2 * r * Math.max(cw, 0.0001), d: 2 * (opts.rz ?? r) * Math.max(cw, 0.0001) });
  }
  const p = loft(secs, { sides, capTop: false, capBot: false, ...opts });
  return p;
}

// extrudeSide(profile, width): a side-view outline [[z, y], ...] extruded along X.
// opts.taper scales the +X cap (for mittens / wedges); opts.bevel insets caps.
export function extrudeSide(profile, width, opts = {}) {
  let pts = profile.map(([z, y]) => new THREE.Vector2(z, y));
  if (THREE.ShapeUtils.area(pts) < 0) pts = pts.reverse();
  const part = new Part();
  const color = opts.color ?? 0x808080;
  const hw = width / 2;
  const tp = opts.taper ?? 1;
  const cz = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const L = pts.map((p) => new THREE.Vector3(-hw, p.y, p.x));
  const R = pts.map((p) => new THREE.Vector3(hw * (opts.skewX ? 1 : 1), cy + (p.y - cy) * tp, cz + (p.x - cz) * tp));
  if (opts.bevel) {
    for (const v of L) { v.y = cy + (v.y - cy) * (1 - opts.bevel); v.z = cz + (v.z - cz) * (1 - opts.bevel); }
  }
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const e = new THREE.Vector2().subVectors(pts[i2], pts[i]);
    const out = new THREE.Vector3(0, -e.x, e.y); // CCW in (z,y): outward = (e.y, -e.x) in (z,y)
    emit(part, L[i], L[i2], R[i2], color, UV_WHITE, UV_WHITE, UV_WHITE, out, opts);
    emit(part, L[i], R[i2], R[i], color, UV_WHITE, UV_WHITE, UV_WHITE, out, opts);
  }
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  const capColor = opts.capColor ?? color;
  for (const [a, b, c] of tris) {
    emit(part, L[a], L[b], L[c], capColor, UV_WHITE, UV_WHITE, UV_WHITE, new THREE.Vector3(-1, 0, 0), opts);
    emit(part, R[a], R[b], R[c], capColor, UV_WHITE, UV_WHITE, UV_WHITE, new THREE.Vector3(1, 0, 0), opts);
  }
  return part;
}

// box: for hard-surface bits only (plates, lamp housings, pouches).
export function box(w, h, d, opts = {}) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const part = new Part();
  const color = opts.color ?? 0x808080;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const faces = [
    [V(-hw, -hh, hd), V(hw, -hh, hd), V(hw, hh, hd), V(-hw, hh, hd), V(0, 0, 1)],
    [V(hw, -hh, -hd), V(-hw, -hh, -hd), V(-hw, hh, -hd), V(hw, hh, -hd), V(0, 0, -1)],
    [V(hw, -hh, hd), V(hw, -hh, -hd), V(hw, hh, -hd), V(hw, hh, hd), V(1, 0, 0)],
    [V(-hw, -hh, -hd), V(-hw, -hh, hd), V(-hw, hh, hd), V(-hw, hh, -hd), V(-1, 0, 0)],
    [V(-hw, hh, hd), V(hw, hh, hd), V(hw, hh, -hd), V(-hw, hh, -hd), V(0, 1, 0)],
    [V(-hw, -hh, -hd), V(hw, -hh, -hd), V(hw, -hh, hd), V(-hw, -hh, hd), V(0, -1, 0)],
  ];
  const skip = opts.skip || '';
  const names = 'fbrlud';
  faces.forEach(([a, b, c, d, n], i) => {
    if (skip.includes(names[i])) return;
    const fc = (opts.faceColor && opts.faceColor[names[i]]) ?? color;
    const fuv = opts.faceUV && opts.faceUV[names[i]];
    if (fuv) {
      // map the face to a pixel rect of the atlas: a=BL b=BR c=TR d=TL
      const [px, py, pw, ph] = fuv;
      const bl = uvOf(px, py + ph), br = uvOf(px + pw, py + ph), tr = uvOf(px + pw, py), tl = uvOf(px, py);
      emit(part, a, b, c, fc, bl, br, tr, n, { ...opts, uv: null });
      emit(part, a, c, d, fc, bl, tr, tl, n, { ...opts, uv: null });
    } else {
      emit(part, a, b, c, fc, UV_WHITE, UV_WHITE, UV_WHITE, n, opts);
      emit(part, a, c, d, fc, UV_WHITE, UV_WHITE, UV_WHITE, n, opts);
    }
  });
  return part;
}

// ribbon: a thin band with thickness following a polyline (straps, belts, cables).
// pts: Vector3[]; side: Vector3 giving the band's width direction per point (or fn)
export function ribbon(pts, width, thick, sideFn, opts = {}) {
  const part = new Part();
  const color = opts.color ?? 0x808080;
  const secs = pts.map((p, i) => {
    const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector3().subVectors(next, prev).normalize();
    const s = sideFn(p, i, t).clone().normalize();
    const nrm = new THREE.Vector3().crossVectors(t, s).normalize();
    const hw = (typeof width === 'function' ? width(i) : width) / 2;
    return [
      p.clone().addScaledVector(s, -hw).addScaledVector(nrm, thick / 2),
      p.clone().addScaledVector(s, hw).addScaledVector(nrm, thick / 2),
      p.clone().addScaledVector(s, hw).addScaledVector(nrm, -thick / 2),
      p.clone().addScaledVector(s, -hw).addScaledVector(nrm, -thick / 2),
      nrm, s,
    ];
  });
  for (let i = 0; i < secs.length - 1; i++) {
    const A = secs[i], B = secs[i + 1];
    const faces = [[0, 1, A[4]], [2, 3, A[4].clone().negate()], [1, 2, A[5]], [3, 0, A[5].clone().negate()]];
    for (const [u, v, n] of faces) {
      emit(part, A[u], A[v], B[v], color, UV_WHITE, UV_WHITE, UV_WHITE, n, opts);
      emit(part, A[u], B[v], B[u], color, UV_WHITE, UV_WHITE, UV_WHITE, n, opts);
    }
  }
  return part;
}

// shell: a dome-and-skirt around an ellipsoid whose hem height varies with
// azimuth (hair). Solid: the skirt has an inner surface and a hem band.
//   o: { cx, cy, cz, rx, ry, rz, power, sides, rows, pole:[dx,dz],
//        hem(phi) → y, flare(phi) → m, thick(phi) → m, color(cen, n, inner) }
export function shell(o) {
  const M = o.sides || 12, K = o.rows || 5;
  const ex = 2 / (o.power || 2);
  const part = new Part();
  const rmax = Math.max(o.rx, o.rz);
  const grid = [], inner = [];
  const pole = new THREE.Vector3(o.cx + (o.pole ? o.pole[0] : 0), o.cy + o.ry, o.cz + (o.pole ? o.pole[1] : 0));
  for (let i = 0; i < M; i++) {
    const phi0 = (i / M) * Math.PI * 2 - Math.PI;
    const tip = i % 2 === 1;
    const hy = o.hem(phi0) - (tip && o.jag ? o.jag(phi0) : 0);
    const sw = tip && o.sweep ? o.sweep(phi0) : 0;
    const bulge = o.bulge ? o.bulge(phi0) : 1;
    const fl = o.flare ? o.flare(phi0) : 0;
    const th = o.thick ? o.thick(phi0) : 0.012;
    let thEnd = Math.PI / 2, skirt = 0;
    if (hy >= o.cy) {
      const c = Math.min(1, Math.max(0, (hy - o.cy) / o.ry));
      thEnd = Math.acos(Math.pow(c, 1 / ex));
    } else skirt = o.cy - hy;
    const domeLen = thEnd * (o.ry + rmax) / 2;
    const total = domeLen + skirt;
    const col = [], inn = [];
    for (let k = 1; k <= K; k++) {
      const s = total * k / K;
      const phi = phi0 + sw * Math.pow(k / K, 2);
      const sx = Math.sin(phi) * bulge, sz = Math.cos(phi) * bulge;
      const p = new THREE.Vector3();
      if (s <= domeLen + 1e-9) {
        const t = (s / domeLen) * thEnd;
        const r = Math.pow(Math.sin(t), ex), h = Math.pow(Math.max(0, Math.cos(t)), ex);
        const pw = Math.pow(1 - Math.min(1, t / (Math.PI / 2)), 2);
        p.set(o.cx + o.rx * r * sx + (pole.x - o.cx) * pw, o.cy + o.ry * h, o.cz + o.rz * r * sz + (pole.z - o.cz) * pw);
      } else {
        const d = s - domeLen;
        const f = 1 + (fl / rmax) * (skirt > 0 ? d / skirt : 0);
        p.set(o.cx + o.rx * f * sx, o.cy - d, o.cz + o.rz * f * sz);
      }
      col.push(p);
      const dir = new THREE.Vector3(p.x - o.cx, 0, p.z - o.cz).normalize();
      inn.push(p.clone().addScaledVector(dir, -th).add(new THREE.Vector3(0, k === K ? 0.004 : 0, 0)));
    }
    grid.push(col); inner.push(inn);
  }
  const cen = new THREE.Vector3(o.cx, o.cy - 0.02, o.cz);
  const outCol = (c, n) => o.color(c, n, false), inCol = (c, n) => o.color(c, n, true);
  const hint = (a, b, c, sign = 1) => new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3).sub(cen).multiplyScalar(sign);
  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    const A = grid[i], B = grid[j];
    emit(part, pole, A[0], B[0], outCol, UV_WHITE, UV_WHITE, UV_WHITE, new THREE.Vector3(0, 1, 0), o);
    for (let k = 0; k < K - 1; k++) {
      emit(part, A[k], B[k], B[k + 1], outCol, UV_WHITE, UV_WHITE, UV_WHITE, hint(A[k], B[k], B[k + 1]), o);
      emit(part, A[k], B[k + 1], A[k + 1], outCol, UV_WHITE, UV_WHITE, UV_WHITE, hint(A[k], B[k + 1], A[k + 1]), o);
      const below = A[k].y < o.cy + 0.01 && B[k].y < o.cy + 0.01;
      if (below) {
        const IA = inner[i], IB = inner[j];
        const hi = (a, b, c) => { const h = hint(a, b, c, -1); h.y = 0; return h; };
        emit(part, IA[k], IB[k], IB[k + 1], inCol, UV_WHITE, UV_WHITE, UV_WHITE, hi(IA[k], IB[k], IB[k + 1]), o);
        emit(part, IA[k], IB[k + 1], IA[k + 1], inCol, UV_WHITE, UV_WHITE, UV_WHITE, hi(IA[k], IB[k + 1], IA[k + 1]), o);
      }
    }
    const a = A[K - 1], b = B[K - 1], c = inner[j][K - 1], d = inner[i][K - 1];
    const down = new THREE.Vector3(0, -1, 0);
    emit(part, a, b, c, inCol, UV_WHITE, UV_WHITE, UV_WHITE, down, o);
    emit(part, a, c, d, inCol, UV_WHITE, UV_WHITE, UV_WHITE, down, o);
  }
  return part;
}

// A free polygon fan (for torn cloth flaps etc.). pts in order; normal hint.
export function fan(pts, color, outward, opts = {}) {
  const part = new Part();
  for (let i = 1; i < pts.length - 1; i++) emit(part, pts[0], pts[i], pts[i + 1], color, UV_WHITE, UV_WHITE, UV_WHITE, outward, opts);
  return part;
}

// ---------------------------------------------------------------- merge
// mergeByBone(parts) → BufferGeometry with rigid skin weights (1 bone / vertex).
// Parts must already be expressed in their bone's local space.
export function mergeByBone(parts) {
  let n = 0;
  for (const p of parts) n += p.pos.length / 3;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  let o = 0;
  for (const p of parts) {
    const c = p.pos.length / 3;
    pos.set(p.pos, o * 3); col.set(p.col, o * 3); uv.set(p.uv, o * 2);
    for (let i = 0; i < c; i++) { si[(o + i) * 4] = p.bone; sw[(o + i) * 4] = 1; }
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.computeVertexNormals();
  return g;
}

// A plain (unskinned) geometry from parts, for separately toggled meshes.
export function toGeometry(parts) {
  const list = Array.isArray(parts) ? parts : [parts];
  const g = mergeByBone(list);
  g.deleteAttribute('skinIndex');
  g.deleteAttribute('skinWeight');
  return g;
}

// ---------------------------------------------------------------- painting
// Pixmap: an RGBA pixel buffer (y down) that becomes a nearest-filtered
// DataTexture. No DOM needed, so rigs also build under Node for tests.
export class Pixmap {
  constructor(w, h, fill = 0x000000) {
    this.w = w; this.h = h;
    this.data = new Uint8Array(w * h * 4);
    this.rect(0, 0, w, h, fill);
  }
  put(x, y, hex) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = ((this.h - 1 - y) * this.w + x) * 4; // data row 0 = bottom (v = 0)
    this.data[i] = (hex >> 16) & 255; this.data[i + 1] = (hex >> 8) & 255; this.data[i + 2] = hex & 255; this.data[i + 3] = 255;
  }
  rect(x, y, w, h, hex) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, hex); }
  texture() {
    const t = new THREE.DataTexture(this.data, this.w, this.h, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }
}

// paintFace(pix, rect, draw, emissive?): paint a 32x32 face into an atlas rect.
// draw(f, e) gets painters f(x, y, color) or f(x, y, w, h, color) in face
// pixels (0..31) for the diffuse map, and e(...) for the emissive map.
export function paintFace(pix, rect, draw, emissive = null) {
  const [ox, oy] = rect;
  const painter = (p) => (x, y, a, b, c) => (c === undefined ? p.put(ox + x, oy + y, a) : p.rect(ox + x, oy + y, a, b, c));
  draw(painter(pix), emissive ? painter(emissive) : () => {});
}
