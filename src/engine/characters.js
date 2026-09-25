// Characters: WREN-3 (the custodian) and the Hollows.
//
// Tapered low-poly bodies built with meshkit, rigid segments riding on named
// pivots (see the rig contract in the plan, §3.2):
//   root → hips → torso → chest → neck → head
//   chest → shoulderL/R → elbowL/R → handL/R
//   hips  → thighL/R → kneeL/R → footL/R
// Each body is ONE mesh with rigid single-bone skin weights: the pivots are the
// skeleton, so every segment moves exactly as if it were parented to its pivot,
// but the whole figure costs a single draw call. L = the character's own left
// (+X when the model faces +Z).
//
// Animation is procedural and layered: planted-foot locomotion via two-bone
// IK, an upper-body layer (aim / reload / actions / condition), head look,
// hurt flinch and a death fall. Layer weights blend over ~0.15 s.
import * as THREE from 'three';
import {
  Part, loft, prism, ball, extrudeSide, box, ribbon, shell, mergeByBone, toGeometry,
  RECT, ATLAS_W, ATLAS_H, uvOf,
} from './meshkit.js';

export const STOMP_IMPACT_T = 0.30;
export const TOOL_STRIKE_T = 0.35;

const BONES = ['root', 'hips', 'torso', 'chest', 'neck', 'head',
  'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR',
  'thighL', 'kneeL', 'footL', 'thighR', 'kneeR', 'footR'];
const NB = BONES.length;
const BI = Object.fromEntries(BONES.map((n, i) => [n, i]));

// ------------------------------------------------------------------ palette
const C = {
  suit: 0x33373b, suitDark: 0x25282b, suitLight: 0x3d4247, glove: 0x1e1f22,
  skin: 0xd9cfc4, skinShade: 0xc6b8aa,
  hair: 0x7a4632, hairHi: 0x94583f, hairDeep: 0x4b281d,
  yoke: 0xc7bfae, band: 0xa3161f, belt: 0x4a3c30, beltDark: 0x3a2f26,
  boot: 0x16171a, sole: 0x0a0a0b, bone: 0xd9d2c2, metal: 0x8a8578, lamp: 0x3b3e42,
  gun: 0x1d1f22, gunHi: 0x2e3135,
  // hollows
  hSkin: 0x7b7478, hSkinDark: 0x5e585c, chassis: 0x5a5d60, chassisDark: 0x3a3c3f,
  cable: 0x1a1414, cableTip: 0xa3161f, feet: 0x55585b, feetDark: 0x3a3c3f,
};
const HOLLOW_TONES = [0x3a3b3e, 0x44392e, 0x2f3a40];

// ------------------------------------------------------------------ atlas
// A 128x64 texture painted once (no DOM needed): faces, rib lines, lamp lens,
// service-plate pips and the Warden plate markings. Untextured faces sample
// the white block and take their colour from vertex colours.
let _atlas = null;
function atlas() {
  if (_atlas) return _atlas;
  const W = ATLAS_W, H = ATLAS_H;
  const dif = new Uint8Array(W * H * 4), emi = new Uint8Array(W * H * 4);
  const put = (buf, x, y, hex) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = ((H - 1 - y) * W + x) * 4; // row 0 of the data = bottom (v = 0)
    buf[i] = (hex >> 16) & 255; buf[i + 1] = (hex >> 8) & 255; buf[i + 2] = hex & 255; buf[i + 3] = 255;
  };
  const rect = (buf, x, y, w, h, hex) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(buf, x + i, y + j, hex); };
  rect(dif, 0, 0, W, H, 0xffffff);
  rect(emi, 0, 0, W, H, 0x000000);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  // WREN-3's face: 0.005 m per pixel, x −0.08..0.08, y 0.12 (top) .. −0.04 (chin)
  {
    const [ox, oy] = RECT.faceWren;
    const f = (x, y, a, b, c) => (c === undefined ? rect(dif, ox + x, oy + y, 1, 1, a) : rect(dif, ox + x, oy + y, a, b, c));
    f(0, 0, 32, 32, C.skin);
    f(8, 5, 5, 1, 0xa88878); f(19, 5, 5, 1, 0xa88878);     // faint brows (under the fringe)
    // eyes: 2x1 teal with a dark lash line above
    f(8, 8, 3, 1, 0x2a1d1a); f(21, 8, 3, 1, 0x2a1d1a);
    f(9, 9, 2, 1, 0x6fc3c9); f(21, 9, 2, 1, 0x6fc3c9);
    rect(emi, ox + 9, oy + 9, 2, 1, 0x28585c); rect(emi, ox + 21, oy + 9, 2, 1, 0x28585c);
    f(16, 14, 1, 1, 0xb09e8f); // nose shadow
    f(9, 15, 2, 2, 0xdcc9bf); f(21, 15, 2, 2, 0xdcc9bf);   // a little warmth in the cheeks
    // android panel seams: faint, along the jaw line only
    for (let y = 16; y < 27; y++) {
      const t = (y - 16) / 10;
      f(Math.round(3 + t * 5), y, 1, 1, 0xcdc0b3);
      f(Math.round(28 - t * 5), y, 1, 1, 0xcdc0b3);
    }
  }
  // Hollow faces: grey-violet, split vertically with a dark cavity
  const hollowFace = (ox, oy, bothEyes) => {
    const f = (x, y, a, b, c) => (c === undefined ? rect(dif, ox + x, oy + y, 1, 1, a) : rect(dif, ox + x, oy + y, a, b, c));
    f(0, 0, 32, 32, C.hSkin);
    for (let i = 0; i < 40; i++) f(Math.floor(rnd() * 32), Math.floor(rnd() * 32), 0x6c656a);
    f(0, 18, 4, 14, 0x6a6468); f(28, 18, 4, 14, 0x6a6468);
    // eye sockets
    f(7, 8, 4, 2, 0x221d20); f(21, 8, 4, 2, 0x221d20);
    f(8, 8, 2, 1, 0xff3a30); rect(emi, ox + 8, oy + 8, 2, 1, 0xd02018);
    if (bothEyes) { f(22, 8, 2, 1, 0xff3a30); rect(emi, ox + 22, oy + 8, 2, 1, 0xd02018); }
    // the split: a crack from the brow down to the chin, widening into a cavity
    for (let y = 0; y < 32; y++) {
      const cx = 17 + Math.round(Math.sin(y * 0.7) * 0.8);
      const wdt = y < 6 ? 1 : y < 10 ? 2 : y < 26 ? (bothEyes ? 5 : 4) : 2;
      f(cx - (wdt >> 1), y, wdt, 1, 0x100b0b);
      if (wdt >= 4) f(cx, y, 1, 1, 0x3a0e10);
      if (y > 10 && y < 26) { f(cx - (wdt >> 1) - 1, y, 1, 1, 0x4e474b); f(cx + wdt - (wdt >> 1), y, 1, 1, 0x4e474b); }
    }
    for (let y = 12; y < 28; y++) { f(Math.round(5 + (y - 12) * 0.25), y, 1, 1, 0x655f63); }
  };
  hollowFace(RECT.faceHollow[0], RECT.faceHollow[1], false);
  hollowFace(RECT.faceRusher[0], RECT.faceRusher[1], true);
  // Warden bulkhead plate: scuffed steel, our bone/red chevron band + stencil block
  {
    const [ox, oy] = RECT.plate;
    const f = (x, y, a, b, c) => (c === undefined ? rect(dif, ox + x, oy + y, 1, 1, a) : rect(dif, ox + x, oy + y, a, b, c));
    f(0, 0, 32, 32, 0x5d6063);
    for (let i = 0; i < 90; i++) f(Math.floor(rnd() * 32), Math.floor(rnd() * 32), rnd() < 0.5 ? 0x676a6d : 0x4d5053);
    f(0, 0, 32, 1, 0x3a3c3f); f(0, 31, 32, 1, 0x3a3c3f); f(0, 0, 1, 32, 0x3a3c3f); f(31, 0, 1, 32, 0x3a3c3f);
    for (let i = 3; i < 32; i += 9) { f(2, i, 1, 1, 0x2a2c2e); f(29, i, 1, 1, 0x2a2c2e); } // rivets
    for (let y = 5; y < 13; y++) {
      for (let x = 0; x < 32; x++) {
        const s = Math.floor((y - 5 + Math.abs((x % 12) - 6)) / 3) % 2;
        f(x, y, s ? C.band : C.bone);
      }
    }
    f(3, 22, 9, 4, C.band); f(14, 22, 3, 4, C.bone);
    for (let i = 0; i < 30; i++) f(Math.floor(rnd() * 32), 26 + Math.floor(rnd() * 6), 0x5a3a2a); // rust
  }
  // rib lines (horizontal), lamp lens, service-plate pips
  {
    const [ox, oy, w, h] = RECT.ribs;
    rect(dif, ox, oy, w, h, C.chassis);
    // rows 0..11: rib cage (ribs slope down toward the flanks), 12..15: abdomen cabling
    for (let y = 1; y < 12; y += 3) {
      for (let x = 0; x < w; x++) {
        const dx = Math.abs(x - 7.5);
        if (dx < 1.5) continue;
        put(dif, ox + x, oy + Math.min(11, y + Math.floor(dx / 4)), 0x3e4043);
      }
    }
    rect(dif, ox + 7, oy, 2, 12, 0x46484b);
    for (let y = 12; y < 16; y++) for (let x = 1; x < w; x += 3) put(dif, ox + x, oy + y, 0x404245);
    const [lx, ly, lw, lh] = RECT.lens;
    rect(dif, lx, ly, lw, lh, 0xfff1d6); rect(emi, lx, ly, lw, lh, 0xd8c8a8);
    rect(emi, lx + 2, ly + 2, 4, 4, 0xfff1d6);
    const [px, py, pw, ph] = RECT.pips;
    rect(dif, px, py, pw, ph, C.bone);
    rect(dif, px + 1, py + 3, 2, 2, 0x6fc3c9); rect(dif, px + 5, py + 3, 2, 2, 0x6fc3c9);
    rect(emi, px + 1, py + 3, 2, 2, 0x3c8a90); rect(emi, px + 5, py + 3, 2, 2, 0x3c8a90);
  }
  const mk = (data) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  _atlas = { map: mk(dif), emissive: mk(emi) };
  return _atlas;
}

function bodyMaterial() {
  const A = atlas();
  return new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: true, map: A.map, emissive: 0xffffff, emissiveMap: A.emissive,
  });
}

// ------------------------------------------------------------------ rig scaffold
function pivot(parent, x, y, z, name) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// P: proportions. Pivot offsets are relative to the parent pivot.
function scaffold(P, kind) {
  const rig = { root: new THREE.Group(), kind };
  rig.root.name = kind;
  const r = rig;
  r.hips = pivot(r.root, 0, P.hipsY, 0, 'hips');
  r.torso = pivot(r.hips, 0, P.torsoY, 0, 'torso');
  r.chest = pivot(r.torso, 0, P.chestY, 0, 'chest');
  r.neck = pivot(r.chest, 0, P.neckY, P.neckZ, 'neck');
  r.head = pivot(r.neck, 0, P.headY, P.headZ, 'head');
  r.shoulderL = pivot(r.chest, P.shX, P.shY + (P.shDropL || 0), P.shZ, 'shoulderL');
  r.elbowL = pivot(r.shoulderL, 0, -P.upper, 0, 'elbowL');
  r.handL = pivot(r.elbowL, 0, -P.fore, 0, 'handL');
  r.shoulderR = pivot(r.chest, -P.shX, P.shY, P.shZ, 'shoulderR');
  r.elbowR = pivot(r.shoulderR, 0, -P.upper, 0, 'elbowR');
  r.handR = pivot(r.elbowR, 0, -P.fore, 0, 'handR');
  r.thighL = pivot(r.hips, P.hipX, P.hipDrop, 0, 'thighL');
  r.kneeL = pivot(r.thighL, 0, -P.thigh, 0, 'kneeL');
  r.footL = pivot(r.kneeL, 0, -P.shin, 0, 'footL');
  r.thighR = pivot(r.hips, -P.hipX, P.hipDrop, 0, 'thighR');
  r.kneeR = pivot(r.thighR, 0, -P.thigh, 0, 'kneeR');
  r.footR = pivot(r.kneeR, 0, -P.shin, 0, 'footR');
  r.bones = BONES.map((n) => r[n]);
  r.P = P;
  return rig;
}

function skinBody(rig, parts, mat) {
  const geo = mergeByBone(parts);
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = rig.kind + '-body';
  rig.root.add(mesh);
  const skel = new THREE.Skeleton(rig.bones, rig.bones.map(() => new THREE.Matrix4()));
  mesh.bind(skel, new THREE.Matrix4());
  mesh.frustumCulled = false; // bounds change with pose (lying bodies); cost is trivial
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  rig.body = mesh;
  rig.tris = geo.attributes.position.count / 3;
  return mesh;
}

function partMesh(parts, mat, parent, name) {
  const m = new THREE.Mesh(toGeometry(parts), mat);
  m.name = name;
  m.castShadow = true;
  parent.add(m);
  return m;
}

// surface helper: point on an elliptical loft (sections sorted by y) at (x, y)
function loftSurfaceZ(secs, x, y, front = 1) {
  let a = secs[0], b = secs[secs.length - 1];
  for (let i = 0; i < secs.length - 1; i++) if (y >= secs[i].y && y <= secs[i + 1].y) { a = secs[i]; b = secs[i + 1]; break; }
  const t = b.y === a.y ? 0 : Math.max(0, Math.min(1, (y - a.y) / (b.y - a.y)));
  const w = a.w + (b.w - a.w) * t, d = a.d + (b.d - a.d) * t, dz = (a.dz || 0) + ((b.dz || 0) - (a.dz || 0)) * t;
  const u = Math.min(0.999, Math.abs(x) / (w / 2));
  return dz + front * (d / 2) * Math.sqrt(1 - u * u);
}

// ==================================================================== WREN-3
const WREN = {
  height: 1.72,
  hipsY: 0.95, torsoY: 0.09, chestY: 0.18, neckY: 0.235, neckZ: -0.01, headY: 0.07, headZ: 0.008,
  shX: 0.185, shY: 0.2, shZ: -0.012, upper: 0.29, fore: 0.26,
  hipX: 0.09, hipDrop: -0.05, thigh: 0.42, shin: 0.40, ankle: 0.08,
};

const CHEST_SECS = (V) => [
  { y: -0.05, w: 0.29, d: 0.18 },
  { y: 0.02, w: 0.312, d: 0.192, dz: 0.002 },
  { y: 0, yf: V, w: 0.336, d: 0.206, dz: 0.006 },
  { y: 0.2, w: 0.36, d: 0.184, dz: -0.006 },
  { y: 0.245, w: 0.17, d: 0.124, dz: -0.01 },
];
// yoke hem: a V on the front (lowest at the sternum), level across the back
const YOKE_V = (phi) => {
  const a = Math.abs(Math.atan2(Math.sin(phi), Math.cos(phi)));
  if (a <= Math.PI / 2) return 0.07 + 0.09 * Math.pow(a / (Math.PI / 2), 0.9);
  return 0.16 - 0.012 * ((a - Math.PI / 2) / (Math.PI / 2));
};

// Keyframed hem height of the hair around the head (deg → head-local y).
// Long on the left (+X), sweeping past the jaw; cropped on the right.
const HAIR_HEM = [
  [-180, 0.035], [-140, 0.07], [-100, 0.112], [-60, 0.132], [-25, 0.13], [0, 0.118], [22, 0.1],
  [42, 0.05], [62, -0.07], [88, -0.1], [118, -0.06], [150, 0.0], [180, 0.035],
];
function keyed(keys, deg) {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, va] = keys[i], [b, vb] = keys[i + 1];
    if (d >= a && d <= b) {
      const t = (d - a) / (b - a);
      const s = t * t * (3 - 2 * t);
      return va + (vb - va) * s;
    }
  }
  return keys[0][1];
}

function buildWrenParts(rig) {
  const P = rig.P;
  const parts = [];
  const add = (bone, part) => { part.bone = BI[bone]; parts.push(part); return part; };

  // ---- pelvis + belt kit (hips)
  add('hips', loft([
    { y: -0.165, w: 0.19, d: 0.15, dz: -0.004 },
    { y: -0.105, w: 0.294, d: 0.188 },
    { y: -0.04, w: 0.318, d: 0.2 },
    { y: 0.03, w: 0.294, d: 0.184 },
    { y: 0.1, w: 0.272, d: 0.17 },
  ], { sides: 10, rot: 0, color: C.suit, capTop: false }));
  add('hips', loft([
    { y: -0.008, w: 0.322, d: 0.206 },
    { y: 0.038, w: 0.306, d: 0.196 },
  ], { sides: 10, rot: 0, color: C.belt }));
  add('hips', box(0.046, 0.036, 0.012, { color: C.metal })).place(0, 0.015, 0.104);
  add('hips', box(0.064, 0.07, 0.042, { color: C.beltDark })).place(0.118, -0.022, 0.074, 0, 0.62, 0);
  add('hips', box(0.07, 0.065, 0.04, { color: C.beltDark })).place(0.075, -0.02, -0.104, 0, -0.2, 0);
  add('hips', box(0.028, 0.052, 0.005, { color: C.bone })).place(0.048, -0.042, 0.104, 0.05, 0, 0.12);
  // holster on the right hip
  add('hips', extrudeSide([[-0.035, 0.03], [0.045, 0.03], [0.04, -0.06], [0.014, -0.15], [-0.03, -0.138]], 0.044, { color: C.beltDark }))
    .place(-0.182, -0.005, 0.0, 0, 0, 0.1);

  // ---- torso (waist)
  add('torso', loft([
    { y: -0.06, w: 0.288, d: 0.18 },
    { y: 0.02, w: 0.262, d: 0.17 },
    { y: 0.12, w: 0.286, d: 0.178, dz: 0.002 },
    { y: 0.22, w: 0.305, d: 0.188, dz: 0.002 },
  ], { sides: 10, rot: 0, color: C.suit, capTop: false, capBot: false }));

  // ---- chest: coverall below a bone yoke with a V front
  const cs = CHEST_SECS(YOKE_V);
  add('chest', loft(cs, {
    sides: 10, rot: 0, capBot: false,
    color: (cen) => (cen.y > YOKE_V(Math.atan2(cen.x, cen.z)) - 0.003 ? C.yoke : C.suit),
  }));
  // stand collar
  add('chest', loft([
    { y: 0.222, w: 0.162, d: 0.132, dz: -0.008 },
    { y: 0.272, w: 0.146, d: 0.12, dz: -0.006 },
  ], { sides: 8, color: C.suitDark }));
  // diagonal harness strap: right shoulder → across the chest → left flank
  const strapPts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const x = -0.1 + t * 0.245, y = 0.218 - t * 0.245;
    const flat = [{ y: -0.05, w: 0.29, d: 0.18 }, { y: 0.02, w: 0.312, d: 0.192, dz: 0.002 }, { y: 0.1, w: 0.336, d: 0.206, dz: 0.006 }, { y: 0.2, w: 0.36, d: 0.184, dz: -0.006 }, { y: 0.245, w: 0.2, d: 0.14 }];
    strapPts.push(new THREE.Vector3(x, y, loftSurfaceZ(flat, x, y) + 0.007));
  }
  strapPts.unshift(new THREE.Vector3(-0.102, 0.232, 0.0));
  add('chest', ribbon(strapPts, 0.03, 0.008, (p, i, t) => new THREE.Vector3(0, 0, 1).cross(t).normalize(), { color: C.belt }));
  // harness lamp at the left chest (lens mapped to the emissive lens block)
  const lampZ = loftSurfaceZ(cs.map((s) => ({ ...s, yf: undefined, y: s.yf ? 0.1 : s.y })), 0.09, 0.1) + 0.022;
  add('chest', box(0.066, 0.05, 0.04, { color: C.lamp, faceUV: { f: RECT.lens } })).place(0.088, 0.1, lampZ, -0.12, 0.12, 0);
  add('chest', box(0.072, 0.012, 0.024, { color: C.suitDark })).place(0.088, 0.13, lampZ + 0.012, -0.12, 0.12, 0);
  rig.lamp = new THREE.Object3D();
  rig.lamp.name = 'lamp';
  rig.lamp.position.set(0.091, 0.1, lampZ + 0.024);
  rig.chest.add(rig.lamp);

  // ---- neck + head
  add('neck', prism(0.04, 0.045, 0.03, 6, { top: 0.1, color: C.skinShade }));
  const headSecs = [
    { y: -0.044, w: 0.044, d: 0.046, dz: 0.052 },
    { y: -0.02, w: 0.102, d: 0.122, dz: 0.022 },
    { y: 0.035, w: 0.146, d: 0.184, dz: 0.004 },
    { y: 0.095, w: 0.162, d: 0.198, dz: -0.004 },
    { y: 0.155, w: 0.152, d: 0.19, dz: -0.012 },
    { y: 0.192, w: 0.09, d: 0.116, dz: -0.016 },
  ];
  const [fx, fy] = RECT.faceWren;
  const faceUV = (p) => uvOf(fx + Math.max(0, Math.min(32, (p.x + 0.08) / 0.005)), fy + Math.max(0, Math.min(32, (0.12 - p.y) / 0.005)));
  const isFace = (cen, n) => n.z > 0.28 && cen.y < 0.13;
  add('head', loft(headSecs, {
    sides: 8, uv: faceUV, uvFilter: isFace,
    color: (cen, n) => (isFace(cen, n) ? 0xffffff : cen.y > 0.12 || (n.z < 0.3 && cen.y > 0.0) ? C.hairDeep : C.skin),
  }));
  // service plate behind the right ear, two teal pips
  add('head', box(0.008, 0.032, 0.046, { color: C.bone, faceUV: { l: RECT.pips }, shade: false })).place(-0.079, 0.055, -0.026, 0, -0.1, 0);
  // hair: one solid asymmetric shell
  add('head', shell({
    cx: 0.0, cy: 0.088, cz: -0.012, rx: 0.097, ry: 0.124, rz: 0.118, power: 2.4,
    sides: 20, rows: 5, pole: [-0.034, -0.006],
    hem: (phi) => keyed(HAIR_HEM, phi * 180 / Math.PI),
    // strand tips: longer + swept toward the left on the fringe and the long side
    jag: (phi) => { const d = phi * 180 / Math.PI; return d > -40 && d < 150 ? 0.02 : d <= -40 && d > -120 ? 0.006 : 0.012; },
    sweep: (phi) => { const d = phi * 180 / Math.PI; return d > -40 && d < 60 ? 0.2 : d >= 60 && d < 140 ? 0.12 : 0; },
    bulge: (phi) => { const d = phi * 180 / Math.PI; return 1 + (d > -30 && d < 30 ? 0.05 : 0) + (d > 30 && d < 160 ? 0.085 * Math.sin((d - 30) / 130 * Math.PI) : 0) - (d < -55 && d > -135 ? 0.07 : 0); },
    flare: (phi) => { const d = phi * 180 / Math.PI; return d > 30 && d < 150 ? 0.03 * Math.sin((d - 30) / 120 * Math.PI) : 0; },
    thick: (phi) => { const d = phi * 180 / Math.PI; return d > 30 && d < 150 ? 0.024 : 0.014; },
    color: (cen, n, inner) => (inner ? C.hairDeep : n.y > 0.5 ? C.hairHi : n.y < -0.3 ? C.hairDeep : C.hair),
  }));

  // ---- arms
  for (const s of [1, -1]) {
    const L = s > 0;
    const sh = L ? 'shoulderL' : 'shoulderR', el = L ? 'elbowL' : 'elbowR', hd = L ? 'handL' : 'handR';
    add(sh, ball(0.05, { sides: 7, rings: 3, color: C.yoke, ry: 0.046 })).place(-0.004 * s, -0.008, 0);
    add(sh, prism(0.047, 0.041, 0.275, 7, { top: -0.02, color: C.suit }));
    if (L) add(sh, loft([{ y: -0.168, w: 0.106, d: 0.106 }, { y: -0.108, w: 0.112, d: 0.112 }], { sides: 7, color: C.band }));
    add(el, ball(0.045, { sides: 6, rings: 2, color: C.suit }));
    add(el, prism(0.044, 0.034, 0.24, 7, { top: 0.0, color: C.suit }));
    add(el, loft([{ y: -0.262, w: 0.072, d: 0.074 }, { y: -0.19, w: 0.08, d: 0.082 }], { sides: 7, color: C.glove }));
    add(hd, extrudeSide([[-0.022, 0.012], [0.026, 0.012], [0.032, -0.03], [0.024, -0.082], [0.004, -0.095], [-0.016, -0.084], [-0.024, -0.035]], 0.03, { color: C.glove, taper: 0.85 }));
    add(hd, box(0.016, 0.046, 0.018, { color: C.glove })).place(-s * 0.007, -0.03, 0.03, -0.45, 0, 0);
  }

  // ---- legs
  const bootProfile = [[-0.068, -0.08], [0.162, -0.08], [0.184, -0.066], [0.186, -0.042], [0.164, -0.024], [0.1, -0.012], [0.045, 0.012], [0.035, 0.045], [-0.056, 0.045], [-0.072, 0.0]];
  for (const s of [1, -1]) {
    const L = s > 0;
    const th = L ? 'thighL' : 'thighR', kn = L ? 'kneeL' : 'kneeR', ft = L ? 'footL' : 'footR';
    add(th, prism([0.086, 0.09], [0.061, 0.064], 0.43, 7, { top: 0.06, color: C.suit, dxTop: 0.006 * s }));
    add(kn, ball(0.062, { sides: 7, rings: 2, color: C.suit, rz: 0.066 }));
    add(kn, box(0.07, 0.075, 0.03, { color: C.suitDark })).place(0, -0.005, 0.052, -0.1, 0, 0); // knee pad
    add(kn, prism([0.058, 0.062], [0.043, 0.046], 0.34, 7, { top: 0.0, color: C.suit }));
    add(kn, loft([
      { y: -0.405, w: 0.104, d: 0.114, dz: 0.004 },
      { y: -0.3, w: 0.106, d: 0.112 },
      { y: -0.252, w: 0.118, d: 0.124 },
    ], { sides: 7, color: C.boot }));
    add(ft, extrudeSide(bootProfile, 0.102, { color: C.boot })).recolor((cen) => (cen.y < -0.066 ? C.sole : null));
  }

  return parts;
}

export function buildCustodian() {
  const rig = scaffold(WREN, 'custodian');
  rig.variant = 0;
  rig.height = WREN.height;
  const mat = bodyMaterial();
  rig.material = mat;
  skinBody(rig, buildWrenParts(rig), mat);

  // condition lamp on the collar (C colours it)
  rig.statusLamp = new THREE.MeshBasicMaterial({ color: 0x6fc3c9 });
  const sl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.016, 0.01), rig.statusLamp);
  sl.name = 'statusLamp';
  sl.position.set(0.042, 0.252, 0.062);
  rig.chest.add(sl);

  // sidearm: grip in the right fist, barrel continues the forearm (-Y), slide on +Z
  const gunParts = [
    box(0.028, 0.19, 0.036, { color: C.gunHi }).place(0, -0.085, 0.036),
    box(0.024, 0.12, 0.02, { color: C.gun }).place(0, -0.1, 0.012),
    box(0.026, 0.044, 0.086, { color: C.gun }).place(0, -0.036, -0.02, 0.26, 0, 0),
    box(0.008, 0.034, 0.022, { color: C.gun }).place(0, -0.074, -0.004),
  ];
  rig.gun = partMesh(gunParts, mat, rig.handR, 'gun');
  rig.gun.visible = false;
  rig.muzzle = new THREE.Object3D();
  rig.muzzle.name = 'muzzle';
  rig.muzzle.position.set(0, -0.184, 0.036);
  rig.gun.add(rig.muzzle);
  // holstered sidearm (grip showing) — shown when owned but not drawn
  rig.holster = partMesh([
    box(0.028, 0.074, 0.036, { color: C.gun }).place(-0.186, 0.052, -0.004, -0.28, 0, 0.1),
  ], mat, rig.hips, 'holster');
  rig.holster.visible = false;

  rig.eyeLight = rig.statusLamp; // legacy alias (was the eye material)
  rig._st = makeState();
  rig.gaitPhase = 0;
  poseCustodian(rig, {}, 1);
  return rig;
}

// ==================================================================== HOLLOWS
const HOLLOW_BASE = {
  height: 1.85,
  hipsY: 1.0, torsoY: 0.095, chestY: 0.19, neckY: 0.24, neckZ: -0.005, headY: 0.14, headZ: 0.03,
  shX: 0.195, shY: 0.205, shZ: -0.012, shDropL: -0.06, upper: 0.3, fore: 0.28,
  hipX: 0.095, hipDrop: -0.05, thigh: 0.45, shin: 0.43, ankle: 0.07,
  limb: 1, chestScale: 1, stride: 0.52, face: 'faceHollow',
};
function hollowProps(variant) {
  if (variant === 'rusher') return { ...HOLLOW_BASE, height: 1.62, fore: 0.32, limb: 0.84, stride: 0.72, face: 'faceRusher', hipsY: 1.0 };
  if (variant === 'warden') return { ...HOLLOW_BASE, height: 1.9, chestScale: 1.2, shX: 0.225, limb: 1.1, stride: 0.5 };
  return { ...HOLLOW_BASE };
}

function buildHollowParts(rig, variant) {
  const P = rig.P;
  const parts = [];
  const add = (bone, part) => { part.bone = BI[bone]; parts.push(part); return part; };
  const tone = typeof variant === 'number' ? HOLLOW_TONES[((variant % 3) + 3) % 3] : variant === 'rusher' ? 0x4a2824 : 0x3e3d38;
  const toneDark = ((tone >> 1) & 0x7f7f7f) + 0x0a0a0a;
  const cs = P.chestScale, lm = P.limb;
  let seed = typeof variant === 'number' ? 11 + variant * 7 : variant === 'rusher' ? 97 : 53;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jag = (amp, n) => { const o = []; for (let i = 0; i < n; i++) o.push((rnd() - 0.5) * 2 * amp); return (phi) => { const t = ((phi / (Math.PI * 2)) % 1 + 1) % 1 * n; const i = Math.floor(t) % n; return o[i]; }; };

  // pelvis in torn coverall with ragged waist
  const waistJag = jag(0.03, 9);
  add('hips', loft([
    { y: -0.17, w: 0.19, d: 0.15, dz: -0.004 },
    { y: -0.105, w: 0.3 * cs, d: 0.19 },
    { y: -0.04, w: 0.322 * cs, d: 0.2 },
    { y: 0.05, yf: waistJag, w: 0.29 * cs, d: 0.18 },
  ], { sides: 9, rot: 0, color: tone, capTop: true, capColor: C.chassisDark }));
  // hanging cloth flaps
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rnd() * 0.8;
    const x = Math.sin(a) * 0.165 * cs, z = Math.cos(a) * 0.105;
    add('hips', box(0.06 + rnd() * 0.03, 0.1 + rnd() * 0.08, 0.008, { color: toneDark })).place(x, -0.12 - rnd() * 0.03, z, 0.1, a, (rnd() - 0.5) * 0.4);
  }
  // exposed chassis: a thin spine-waist and a ribbed cage
  const [rx, ry, rw, rh] = RECT.ribs;
  const ribUV = (y0, y1, r0, r1) => (p) => uvOf(
    rx + Math.max(0.5, Math.min(rw - 0.5, rw / 2 + Math.atan2(p.x, p.z) / Math.PI * rw)),
    ry + Math.max(r0 + 0.5, Math.min(r1 - 0.5, r0 + (y1 - p.y) / (y1 - y0) * (r1 - r0))));
  add('torso', loft([
    { y: -0.07, w: 0.2 * cs, d: 0.14 },
    { y: 0.02, w: 0.19 * cs, d: 0.14 },
    { y: 0.12, w: 0.24 * cs, d: 0.16 },
    { y: 0.22, w: 0.28 * cs, d: 0.18 },
  ], { sides: 8, rot: 0, capTop: false, capBot: false, color: 0xffffff, uv: ribUV(-0.07, 0.22, 11, 16) }));
  add('torso', prism(0.035, 0.035, 0.3, 5, { top: 0.22, color: C.chassisDark })).place(0, 0, -0.058);
  add('chest', loft([
    { y: -0.05, w: 0.27 * cs, d: 0.176 * (0.9 + 0.1 * cs) },
    { y: 0.04, w: 0.31 * cs, d: 0.194 * (0.9 + 0.1 * cs), dz: 0.004 },
    { y: 0.13, w: 0.34 * cs, d: 0.2 * (0.9 + 0.1 * cs), dz: 0.004 },
    { y: 0.2, w: 0.36 * cs, d: 0.18 * (0.9 + 0.1 * cs), dz: -0.006 },
    { y: 0.245, w: 0.17 * cs, d: 0.12, dz: -0.01 },
  ], {
    sides: 10, rot: 0, capBot: false, uv: ribUV(-0.05, 0.2, 0, 12), uvFilter: (cen, n) => n.y < 0.5,
    color: (cen, n) => (n.y >= 0.5 ? C.chassisDark : 0xffffff),
  }));
  // sternum plate and a torn cloth sash hanging from the left shoulder
  add('chest', box(0.05, 0.16, 0.02, { color: C.chassisDark })).place(0, 0.1, 0.1 * (0.9 + 0.1 * cs) + 0.006, 0.08, 0, 0);
  {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      const x = 0.15 * cs - t * 0.26 * cs, y = 0.22 - t * 0.3;
      pts.push(new THREE.Vector3(x, y, loftSurfaceZ([{ y: -0.1, w: 0.27 * cs, d: 0.176 }, { y: 0.13, w: 0.34 * cs, d: 0.2 }, { y: 0.22, w: 0.3 * cs, d: 0.16 }], x, y) + 0.01));
    }
    add('chest', ribbon(pts, (i) => 0.07 - i * 0.008, 0.008, (p, i, t) => new THREE.Vector3(0, 0, 1).cross(t).normalize(), { color: tone }));
  }
  if (variant === 'rusher') {
    for (let i = 0; i < 4; i++) add(i < 2 ? 'chest' : 'torso', box(0.05 - i * 0.006, 0.028, 0.05, { color: C.chassisDark })).place(0, i < 2 ? 0.17 - i * 0.09 : 0.2 - (i - 2) * 0.1, -0.1 - (i < 2 ? 0.0 : -0.01), -0.5, 0, 0);
  }
  // neck: long, with tendon cables
  add('neck', prism(0.036 * lm, 0.042 * lm, 0.04, 6, { top: 0.17, color: C.hSkinDark }));
  add('neck', prism(0.009, 0.009, 0.0, 3, { top: 0.16, color: C.cable })).place(0.022, 0, 0.026);
  add('neck', prism(0.009, 0.009, 0.0, 3, { top: 0.16, color: C.cable })).place(-0.024, 0, 0.022);

  // head: longer skull, split face plate, cables from the cavity
  const faceKey = P.face;
  const [hx, hy] = RECT[faceKey];
  const faceUV = (p) => uvOf(hx + Math.max(0, Math.min(32, (p.x + 0.08) / 0.005)), hy + Math.max(0, Math.min(32, (0.12 - p.y) / 0.005)));
  const isFace = (cen, n) => n.z > 0.28 && cen.y < 0.13;
  const scalp = variant === 1 ? 0x2a2420 : C.hSkinDark;
  add('head', loft([
    { y: -0.05, w: 0.05, d: 0.05, dz: 0.056 },
    { y: -0.024, w: 0.108, d: 0.128, dz: 0.024 },
    { y: 0.035, w: 0.146, d: 0.19, dz: 0.004 },
    { y: 0.1, w: 0.156, d: 0.206, dz: -0.008 },
    { y: 0.16, w: 0.146, d: 0.198, dz: -0.018 },
    { y: 0.2, w: 0.086, d: 0.12, dz: -0.024 },
  ], {
    sides: 8, uv: faceUV, uvFilter: isFace,
    color: (cen, n) => (isFace(cen, n) ? 0xffffff : n.y > 0.5 ? scalp : C.hSkin),
  }));
  if (variant === 1) {
    add('head', shell({
      cx: 0, cy: 0.09, cz: -0.02, rx: 0.088, ry: 0.118, rz: 0.114, power: 2.6, sides: 10, rows: 4, pole: [0.01, -0.01],
      hem: (phi) => 0.1 + 0.03 * Math.sin(phi * 3 + 1) + (Math.abs(phi) > 2.4 ? -0.04 : 0),
      thick: () => 0.01, color: (cen, n, inner) => (inner ? 0x151210 : n.y > 0.6 ? 0x3a322c : 0x2a2420),
    }));
  } else if (variant === 2 || variant === 'warden') {
    add('head', box(0.07, 0.012, 0.09, { color: 0x1c1a1b })).place(0.018, 0.2, -0.03, 0.1, 0.2, 0.08); // missing skull panel
  } else {
    add('head', box(0.01, 0.008, 0.17, { color: C.hSkinDark })).place(0.006, 0.194, -0.024, 0.05, 0, 0); // seam ridge
  }
  // cables hanging from the split (tilted back to hang plumb under the thrust head)
  const nc = 6;
  for (let i = 0; i < nc; i++) {
    const x = 0.012 + (i - (nc - 1) / 2) * 0.009 + (rnd() - 0.5) * 0.006;
    const len = 0.08 + rnd() * 0.12;
    const red = i === 1 || i === 4;
    const top = new THREE.Vector3(x, 0.02 + rnd() * 0.04, 0.082);
    const mid = new THREE.Vector3(x + (rnd() - 0.5) * 0.02, top.y - len * 0.55, 0.1 + rnd() * 0.02);
    const end = new THREE.Vector3(x + (rnd() - 0.5) * 0.03, top.y - len, 0.09 + rnd() * 0.04);
    const pts = [top, mid, end];
    const cab = ribbon(pts, 0.009, 0.006, () => new THREE.Vector3(1, 0, 0), { color: C.cable });
    if (red) cab.recolor((cen) => (cen.y < end.y + 0.025 ? C.cableTip : null));
    add('head', cab);
  }

  // arms: bare grey-violet with a torn sleeve stub on the right
  for (const s of [1, -1]) {
    const L = s > 0;
    const sh = L ? 'shoulderL' : 'shoulderR', el = L ? 'elbowL' : 'elbowR', hd = L ? 'handL' : 'handR';
    add(sh, ball(0.054 * lm, { sides: 6, rings: 2, color: C.chassis }));
    add(sh, prism(0.05 * lm, 0.04 * lm, P.upper - 0.01, 6, { top: -0.01, color: C.hSkin }));
    if (!L) add(sh, loft([{ y: -0.12, yf: jag(0.025, 6), w: 0.112 * lm, d: 0.112 * lm }, { y: -0.01, w: 0.12 * lm, d: 0.12 * lm }], { sides: 6, color: tone }));
    add(el, ball(0.04 * lm, { sides: 6, rings: 2, color: C.hSkinDark }));
    add(el, prism(0.043 * lm, 0.031 * lm, P.fore - 0.01, 6, { top: 0.0, color: C.hSkin }));
    const hl = variant === 'rusher' ? 0.14 : 0.11;
    add(hd, extrudeSide([[-0.02, 0.01], [0.024, 0.01], [0.03, -0.03], [0.02, -hl], [0.008, -hl - 0.012], [-0.012, -hl + 0.01], [-0.022, -0.035]], 0.026, { color: C.hSkinDark, taper: 0.8 }))
      .recolor((cen) => (cen.y < -hl + 0.03 ? 0x2a2426 : null));
  }
  // legs: torn trouser legs, bare shins, metal feet
  for (const s of [1, -1]) {
    const L = s > 0;
    const th = L ? 'thighL' : 'thighR', kn = L ? 'kneeL' : 'kneeR', ft = L ? 'footL' : 'footR';
    add(th, prism([0.08 * lm, 0.084 * lm], [0.057 * lm, 0.06 * lm], P.thigh, 7, { top: 0.06, color: tone }));
    add(kn, ball(0.056 * lm, { sides: 7, rings: 2, color: tone }));
    add(kn, loft([
      { y: -0.2, yf: jag(0.04, 7), w: 0.112 * lm, d: 0.118 * lm },
      { y: 0.0, w: 0.118 * lm, d: 0.124 * lm },
    ], { sides: 7, color: tone, capTop: false }));
    add(kn, prism([0.05 * lm, 0.054 * lm], [0.034 * lm, 0.036 * lm], P.shin + 0.02, 6, { top: -0.02, color: C.hSkin }));
    add(ft, extrudeSide([[-0.06, -0.07], [0.15, -0.07], [0.19, -0.058], [0.16, -0.04], [0.07, -0.028], [0.03, 0.02], [-0.045, 0.02], [-0.064, -0.02]], 0.08 * lm, { color: C.feet }))
      .recolor((cen) => (cen.y < -0.06 ? C.feetDark : null));
  }
  return parts;
}

export function buildHollow(variant = 0) {
  const P = hollowProps(variant);
  const rig = scaffold(P, 'hollow');
  rig.variant = variant;
  rig.height = P.height;
  const mat = bodyMaterial();
  rig.material = mat;
  skinBody(rig, buildHollowParts(rig, variant), mat);
  // chest core: the revive tell
  rig.glow = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  rig.core = new THREE.Mesh(new THREE.OctahedronGeometry(0.036, 0), rig.glow);
  rig.core.name = 'core';
  rig.core.position.set(0.018, 0.085, 0.1 * (0.9 + 0.1 * P.chestScale) + 0.012);
  rig.core.rotation.set(0.3, 0.5, 0);
  rig.chest.add(rig.core);
  rig._st = makeState();
  rig.gaitPhase = 0;
  if (variant === 'warden') {
    // torn, dented bulkhead plate (0.55 x 0.95 m) strapped to the left forearm
    const [px, py] = RECT.plate;
    const plUV = (p) => uvOf(px + Math.max(0, Math.min(32, (p.z + 0.275) / 0.55 * 32)), py + Math.max(0, Math.min(32, (0.475 - p.y) / 0.95 * 32)));
    const outline = [[-0.26, 0.47], [0.05, 0.48], [0.2, 0.44], [0.28, 0.3], [0.27, -0.1], [0.24, -0.3], [0.28, -0.46], [0.08, -0.47], [-0.06, -0.41], [-0.2, -0.47], [-0.28, -0.3], [-0.25, 0.05], [-0.28, 0.3]];
    const plate = extrudeSide(outline, 0.03, { color: 0xffffff, uv: plUV, uvFilter: (cen, n) => Math.abs(n.x) > 0.7 });
    plate.recolor((cen, n) => (Math.abs(n.x) > 0.7 ? null : 0x2c2e30));
    for (let i = 0; i < plate.pos.length; i += 3) { // dent: the lower third folds forward
      const y = plate.pos[i + 1];
      if (y < -0.12) plate.pos[i] += (-0.12 - y) * 0.2;
      if (Math.abs(plate.pos[i + 2] - 0.05) < 0.08 && Math.abs(y - 0.1) < 0.12) plate.pos[i] -= 0.012;
    }
    plate.place(0, 0, 0, 0, -Math.PI / 2, 0); // broad face → +Z
    rig.plate = partMesh([plate], mat, rig.elbowL, 'plate');
    // hang it upright in front of the left flank for the guard pose
    poseHollow(rig, { state: 'idle' }, 1);
    rig.root.updateMatrixWorld(true);
    const want = new THREE.Matrix4().compose(new THREE.Vector3(0.1, 1.02, 0.34), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.25, 0.04)), new THREE.Vector3(1, 1, 1));
    new THREE.Matrix4().copy(rig.elbowL.matrixWorld).invert().multiply(want).decompose(rig.plate.position, rig.plate.quaternion, rig.plate.scale);
  }
  poseHollow(rig, { state: 'idle' }, 1);
  return rig;
}

// Blacken a Hollow for the burning / ash states (0..1).
export function setHollowScorch(rig, k) {
  const t = Math.max(0, Math.min(1, +k || 0));
  if (rig.material) {
    rig.material.color.setRGB(1 - 0.86 * t, 1 - 0.88 * t, 1 - 0.89 * t);
    rig.material.emissive.setScalar(1 - t);
  }
}

// ==================================================================== posing
function makeState() {
  return {
    T: new Float32Array(NB * 3), snap: new Float32Array(NB * 3), last: new Float32Array(NB * 3),
    hp: new THREE.Vector3(), hq: new THREE.Quaternion(),
    snapHp: new THREE.Vector3(), snapHq: new THREE.Quaternion(),
    lastHp: new THREE.Vector3(), lastHq: new THREE.Quaternion(),
    hs: new THREE.Vector3(1, 1, 1), // head scale (stomped)
    fadeT: 1, fadeDur: 0.2, mode: '', init: false,
    wAim: 0, wReload: 0, cond: 0, hurt: 0, lookY: 0, lookP: 0, wTurn: 0, turnSign: 1, tph: 0,
    mvx: 0, mvz: 1, wDead: 0, gph: 0, prevState: '', stateAge: 0,
  };
}

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const sstep = (a, b, v) => smooth((v - a) / (b - a));
const wrap = (a) => { a = (a + PI) % TAU; if (a < 0) a += TAU; return a - PI; };
const lerpA = (a, b, t) => a + wrap(b - a) * t;
const frac = (v) => v - Math.floor(v);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
// window: 0 before a, ramps to 1 by b, holds, ramps down from c to d
const win = (t, a, b, c, d) => (t < a || t > d ? 0 : t < b ? smooth((t - a) / (b - a)) : t <= c ? 1 : 1 - smooth((t - c) / (d - c)));

// scratch (no per-call allocation)
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler(), _eY = new THREE.Euler(0, 0, 0, 'YXZ');
const _mH = new THREE.Matrix4(), _mC = new THREE.Matrix4(), _mI = new THREE.Matrix4(), _mT = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const IK = { x: 0, z: 0, b: 0 };
const FOOT = { z: 0, y: 0, a: 0 };

// Two-bone IK in the parent's frame. (dx,dy,dz) = target − pivot. Upper bone
// rotation = Euler XYZ (x = pitch, z = splay), lower bone bends about its local X.
// sign +1 → bends backward (knee), −1 → forward (elbow).
function solveLimb(dx, dy, dz, a, b, sign) {
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxd = (a + b) * 0.9995, mind = Math.abs(a - b) + 0.03;
  if (d > maxd) { const f = maxd / d; dx *= f; dy *= f; dz *= f; d = maxd; } else if (d < mind) { const f = mind / Math.max(d, 1e-5); dx *= f; dy *= f; dz *= f; d = mind; if (d < 1e-4) { dy = -mind; } }
  const ci = (a * a + b * b - d * d) / (2 * a * b);
  const beta = PI - Math.acos(clamp(ci, -1, 1));
  const p = a + b * Math.cos(beta);
  const q = -sign * b * Math.sin(beta);
  const g = Math.asin(clamp(dx / Math.max(p, 1e-4), -1, 1));
  const Pp = p * Math.cos(g);
  IK.x = wrap(Math.atan2(dz, dy) - Math.atan2(q, -Pp));
  IK.z = g;
  IK.b = sign * beta;
  return IK;
}

// Foot cycle for one leg. u: 0..1 cycle position (0 = heel strike), beta:
// stance fraction, D: hip travel per full cycle (two steps). Writes ankle
// (z along the move direction, y) and foot pitch (toe-up +) to FOOT, keeping
// the ground contact point planted (heel roll → flat → toe roll). The swing
// is eased in world space, so the foot leaves and lands at rest.
const HEEL = 0.066, TOE = 0.15;
function footCycle(u, beta, D, lift, aStrike, aToe, ank) {
  const span = beta * D;
  const front = 0.42 * span, back = -0.58 * span;
  const stance = (t) => {
    const c = front + (back - front) * t;
    let a = 0;
    if (t < 0.22) a = aStrike * (1 - smooth(t / 0.22));
    else if (t > 0.6) a = -aToe * smooth((t - 0.6) / 0.4);
    if (a >= 0) {
      FOOT.z = c - HEEL + HEEL * Math.cos(a) - ank * Math.sin(a);
      FOOT.y = HEEL * Math.sin(a) + ank * Math.cos(a);
    } else {
      FOOT.z = c + TOE - TOE * Math.cos(a) - ank * Math.sin(a);
      FOOT.y = -TOE * Math.sin(a) + ank * Math.cos(a);
    }
    FOOT.a = a;
  };
  if (u < beta) { stance(u / beta); return FOOT; }
  const t = (u - beta) / (1 - beta);
  stance(1); const z0 = FOOT.z, y0 = FOOT.y, a0 = FOOT.a;
  stance(0); const z1 = FOOT.z, y1 = FOOT.y, a1 = FOOT.a;
  const e = smooth((t - 0.08) / 0.8); // lift first, land after the reach
  const travel = D * (1 - beta);        // hip travel during the swing
  FOOT.z = z0 + (z1 - z0 + travel) * e - travel * t;
  FOOT.y = lerp(y0, y1, t) + lift * Math.pow(Math.sin(PI * t), 0.85);
  FOOT.a = t < 0.5 ? lerp(a0, 0.05, smooth(t / 0.5)) : lerp(0.05, a1, smooth((t - 0.5) / 0.5));
  return FOOT;
}

// stride length (one step) for a speed & condition: fits the leg reach so the
// stance foot stays planted at every speed.
function stepLength(speed, cond) {
  const walk = lerp(0.36, 0.62, clamp01(speed / 2.3));
  const run = clamp01((speed - 2.4) / 1.6);
  return lerp(walk, 1.08, run) * (1 - 0.1 * clamp01(cond - 1));
}
// rad/s of stride phase for a planar speed; one footfall every π of phase.
export function custodianPhaseRate(speed, condition = 0) {
  const v = Math.max(0, +speed || 0);
  if (v < 1e-4) return 0;
  return PI * v / stepLength(v, +condition || 0);
}
export function hollowPhaseRate(speed, variant = 0) {
  const v = Math.max(0, +speed || 0);
  const stride = variant === 'rusher' ? 0.72 : variant === 'warden' ? 0.5 : 0.52;
  return PI * v / stride;
}

// T accessors
function R(S, bone, x, y, z) { const i = BI[bone] * 3; S.T[i] = x; S.T[i + 1] = y; S.T[i + 2] = z; }
function Radd(S, bone, x, y, z) { const i = BI[bone] * 3; S.T[i] += x; S.T[i + 1] += y; S.T[i + 2] += z; }
function Rget(S, bone, k) { return S.T[BI[bone] * 3 + k]; }
function Rmix(S, bone, x, y, z, w) {
  if (w <= 0) return;
  const i = BI[bone] * 3;
  S.T[i] = lerpA(S.T[i], x, w); S.T[i + 1] = lerpA(S.T[i + 1], y, w); S.T[i + 2] = lerpA(S.T[i + 2], z, w);
}

// local matrix of a pivot from its rest position + target euler in T
function localMatrix(rig, S, bone, out) {
  const i = BI[bone] * 3;
  _e.set(S.T[i], S.T[i + 1], S.T[i + 2]);
  _q3.setFromEuler(_e);
  return out.compose(rig[bone].position, _q3, _one);
}

// chest frame (in root space) from the target pose → _mC; its inverse → _mI
function chestFrame(rig, S) {
  _mH.compose(S.hp, S.hq, _one);
  localMatrix(rig, S, 'torso', _mT); _mC.multiplyMatrices(_mH, _mT);
  localMatrix(rig, S, 'chest', _mT); _mC.multiply(_mT);
  _mI.copy(_mC).invert();
}

// Arm IK toward a root-space wrist target; writes shoulder/elbow into T with weight w.
function armIK(rig, S, side, tx, ty, tz, w, inChest = false) {
  if (w <= 0) return;
  const P = rig.P;
  _v.set(tx, ty, tz);
  if (!inChest) _v.applyMatrix4(_mI);
  const sh = side > 0 ? rig.shoulderL : rig.shoulderR;
  const r = solveLimb(_v.x - sh.position.x, _v.y - sh.position.y, _v.z - sh.position.z, P.upper, P.fore, -1);
  const sx = r.x, sz = r.z, eb = r.b;
  Rmix(S, side > 0 ? 'shoulderL' : 'shoulderR', sx, 0, sz, w);
  Rmix(S, side > 0 ? 'elbowL' : 'elbowR', eb, 0, 0, w);
}

// Orient a hand so its -Y (barrel) points along root-space euler (px, py, pz); weight w.
function handAim(rig, S, side, px, py, pz, w) {
  if (w <= 0) return;
  const sh = side > 0 ? 'shoulderL' : 'shoulderR', el = side > 0 ? 'elbowL' : 'elbowR', hd = side > 0 ? 'handL' : 'handR';
  _q.copy(S.hq);
  for (const b of ['torso', 'chest', sh, el]) {
    const i = BI[b] * 3;
    _e.set(S.T[i], S.T[i + 1], S.T[i + 2]);
    _q.multiply(_q2.setFromEuler(_e));
  }
  _e.set(px, py, pz);
  _q2.setFromEuler(_e);
  _q.invert().multiply(_q2);
  _e.setFromQuaternion(_q);
  Rmix(S, hd, _e.x, _e.y, _e.z, w);
}

// Leg IK: root-space ankle target → thigh/knee/foot. footPitch: toe-up +.
function legIK(rig, S, side, tx, ty, tz, footPitch, footYaw, w = 1) {
  if (w <= 0) return;
  const P = rig.P;
  _mH.compose(S.hp, S.hq, _one);
  _mI.copy(_mH).invert();
  _v.set(tx, ty, tz).applyMatrix4(_mI);
  const th = side > 0 ? rig.thighL : rig.thighR;
  const r = solveLimb(_v.x - th.position.x, _v.y - th.position.y, _v.z - th.position.z, P.thigh, P.shin, 1);
  const tb = side > 0 ? 'thighL' : 'thighR', kb = side > 0 ? 'kneeL' : 'kneeR', fb = side > 0 ? 'footL' : 'footR';
  const tx0 = r.x, tz0 = r.z, kb0 = r.b;
  Rmix(S, tb, tx0, 0, tz0, w);
  Rmix(S, kb, kb0, 0, 0, w);
  // foot: exact local rotation so the sole has root-space pitch/yaw
  _q.copy(S.hq);
  _q.multiply(_q2.setFromEuler(_e.set(tx0, 0, tz0)));
  _q.multiply(_q2.setFromEuler(_e.set(kb0, 0, 0)));
  _q2.setFromEuler(_eY.set(-footPitch, footYaw, 0));
  _q.invert().multiply(_q2);
  _e.setFromQuaternion(_q);
  Rmix(S, fb, _e.x, _e.y, _e.z, w);
}

function commit(rig, S, dt) {
  let w = 1;
  if (dt >= 1) S.fadeT = S.fadeDur;
  if (S.fadeT < S.fadeDur) { S.fadeT += dt; w = smooth(S.fadeT / S.fadeDur); }
  const b = rig.bones;
  for (let i = 2; i < NB; i++) {
    const j = i * 3;
    let x = S.T[j], y = S.T[j + 1], z = S.T[j + 2];
    if (w < 1) { x = lerpA(S.snap[j], x, w); y = lerpA(S.snap[j + 1], y, w); z = lerpA(S.snap[j + 2], z, w); }
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) { x = S.last[j]; y = S.last[j + 1]; z = S.last[j + 2]; }
    b[i].rotation.set(x, y, z);
    S.last[j] = x; S.last[j + 1] = y; S.last[j + 2] = z;
  }
  if (w < 1) { _v.lerpVectors(S.snapHp, S.hp, w); _q.slerpQuaternions(S.snapHq, S.hq, w); } else { _v.copy(S.hp); _q.copy(S.hq); }
  if (Number.isFinite(_v.x + _v.y + _v.z) && Number.isFinite(_q.x + _q.y + _q.z + _q.w)) {
    rig.hips.position.copy(_v);
    rig.hips.quaternion.copy(_q);
    S.lastHp.copy(_v); S.lastHq.copy(_q);
  }
  rig.head.scale.copy(S.hs);
}

function startFade(S, dur) {
  S.snap.set(S.last);
  S.snapHp.copy(S.lastHp); S.snapHq.copy(S.lastHq);
  S.fadeT = 0; S.fadeDur = dur;
}

// ------------------------------------------------------------------ custodian
// Pose driver for WREN-3. All fields optional (see the rig contract).
export function poseCustodian(rig, s, dt) {
  const S = rig._st;
  s = s || {};
  dt = num(dt, 0.016);
  if (dt < 0) dt = 0;
  const snap = dt >= 1;
  const k = snap ? 1 : 1 - Math.exp(-dt * 14);
  const P = rig.P;

  const time = num(s.time, 0);
  const speed = Math.max(0, num(s.speed, 0));
  const phase = num(s.phase, 0);
  const aiming = !!s.aiming;
  const aimPitch = clamp(num(s.aimPitch, 0), -0.8, 0.8);
  const recoil = clamp01(num(s.recoil, 0));
  const reload = Math.max(0, num(s.reload, 0));
  const hurtIn = clamp01(num(s.hurt, 0));
  const hurtDir = num(s.hurtDir, 0);
  let cond = clamp(num(s.condition, 0), 0, 3);
  if (s.limp && cond < 1) cond = 1;
  const dead = !!s.dead, deadT = Math.max(0, num(s.deadT, 0));
  const action = typeof s.action === 'string' ? s.action : null;
  const actT = Math.max(0, num(s.actionT, 0));
  const turn = num(s.turn, 0);
  const look = s.look && typeof s.look === 'object' ? s.look : null;

  // ---- layer weights (blend ~0.15 s)
  if (!S.init || snap) {
    S.wAim = aiming ? 1 : 0; S.wReload = reload > 0 ? 1 : 0; S.cond = cond; S.hurt = hurtIn;
    S.lookY = look ? clamp(num(look.yaw, 0), -1.22, 1.22) : 0; S.lookP = look ? clamp(num(look.pitch, 0), -0.44, 0.44) : 0;
    S.init = true;
  }
  S.wAim += ((aiming ? 1 : 0) - S.wAim) * k;
  S.wReload += ((reload > 0 ? 1 : 0) - S.wReload) * k;
  S.cond += (cond - S.cond) * (snap ? 1 : 1 - Math.exp(-dt * 5));
  S.hurt = hurtIn > S.hurt ? S.hurt + (hurtIn - S.hurt) * (snap ? 1 : 1 - Math.exp(-dt * 28)) : hurtIn;
  S.lookY += ((look ? clamp(num(look.yaw, 0), -1.22, 1.22) : 0) - S.lookY) * k * 0.8;
  S.lookP += ((look ? clamp(num(look.pitch, 0), -0.44, 0.44) : 0) - S.lookP) * k * 0.8;
  const turning = Math.abs(turn) > 1.5 && speed < 0.2;
  S.wTurn += ((turning ? 1 : 0) - S.wTurn) * k;
  if (turning) S.turnSign = Math.sign(turn);
  if (S.wTurn > 0.01 && !snap) S.tph += dt * TAU / 0.6; else if (S.wTurn <= 0.01) S.tph = 0;
  let mvx = 0, mvz = 1;
  if (s.moveLocal && typeof s.moveLocal === 'object' && speed > 0.05) {
    const mx = num(s.moveLocal.x, 0), mz = num(s.moveLocal.z, 1), ml = Math.hypot(mx, mz);
    if (ml > 1e-3) { mvx = mx / ml; mvz = mz / ml; }
  }
  S.mvx += (mvx - S.mvx) * k; S.mvz += (mvz - S.mvz) * k;
  { const ml = Math.hypot(S.mvx, S.mvz) || 1; S.mvx /= ml; S.mvz /= ml; }
  const wAim = S.wAim, wRel = S.wReload * (1 - wAim);
  const limpW = clamp01(S.cond), failW = clamp01(S.cond - 1), critW = clamp01(S.cond - 2);

  // ---- death has its own full-body animation
  if (dead) {
    if (S.mode !== 'dead') { startFade(S, 0.18); S.mode = 'dead'; }
    custodianDeath(rig, S, deadT, time);
    commit(rig, S, dt);
    return;
  }
  if (S.mode === 'dead') { startFade(S, 0.3); }
  S.mode = 'live';

  // ---- locomotion
  const walkW = sstep(0.04, 0.4, speed);
  const runW = clamp01((speed - 2.4) / 1.6);
  const stepLen = stepLength(speed, S.cond);
  const D = 2 * stepLen;
  const beta = lerp(0.6, 0.38, runW);
  const lift = lerp(0.075, 0.17, runW) * (1 - 0.35 * limpW);
  const aStrike = lerp(0.24, 0.1, runW), aToe = lerp(0.34, 0.42, runW);
  const ph = phase;
  const cph = Math.cos(ph), sph = Math.sin(ph);

  // idle life: breathing, weight shifts, glances
  const idle = 1 - walkW;
  const breath = Math.sin(time * TAU * 0.22);
  const shiftRaw = Math.sin(time * 0.52 + 0.7) + 0.45 * Math.sin(time * 0.23 + 2.1);
  const shift = Math.tanh(shiftRaw * 3) * idle * (1 - wAim * 0.7); // −1..1 (+ = weight on left)
  const gl = frac(time / 9.7);
  const glance = (gl > 0.82 ? win(gl, 0.82, 0.86, 0.95, 0.99) : 0) * (Math.sin(time * 0.37) > 0 ? 1 : -1) * idle;
  const sway = critW * Math.sin(time * TAU * 0.4);

  // hips
  const bobW = -lerp(0.022, 0.042, runW) * walkW * (0.5 + 0.5 * Math.cos(2 * ph));
  const bobR = -lerp(0.022, 0.042, runW) * walkW * (0.5 + 0.5 * Math.cos(2 * ph - TAU * 0.19));
  const uR = frac(ph / TAU + 0.5);
  const rStance = uR < beta * (1 - 0.3 * limpW) ? Math.sin(PI * uR / (beta * (1 - 0.3 * limpW))) : 0;
  let hy = P.hipsY - 0.012 - 0.028 * walkW - 0.05 * runW + lerp(bobW, bobR, runW)
    + breath * 0.002 * idle - 0.01 * Math.abs(shift)
    - 0.02 * limpW * rStance * walkW - 0.025 * critW - 0.01 * failW;
  let hx = 0.014 * sph * walkW * (1 - runW) + 0.016 * shift + 0.02 * sway + 0.012 * limpW * idle;
  let hz = 0;
  // strafe / backpedal: hips turn toward the move direction (≤ 45°)
  const sgn = S.mvz >= -0.2 ? 1 : -1;
  const hipMoveYaw = clamp(Math.atan2(S.mvx * sgn, Math.abs(S.mvz) + 0.2), -PI / 4, PI / 4) * walkW;
  const hipYaw = -0.1 * cph * walkW * (1 - 0.5 * runW) + hipMoveYaw + 0.1 * S.wTurn * S.turnSign;
  const hipRoll = 0.045 * sph * walkW * (1 - runW) - 0.035 * shift - 0.04 * limpW * rStance * walkW;
  const hipPitch = 0.03 * walkW + 0.05 * runW;

  // action body drops
  let actDrop = 0, actLean = 0, stompW = 0;
  if (action === 'reach') { const e = win(actT, 0, 0.16, 0.26, 0.45); actDrop = 0.08 * e; actLean = 0.2 * e; }
  else if (action === 'reachLow') { const e = win(actT, 0, 0.18, 0.28, 0.45); actDrop = 0.3 * e; actLean = 0.7 * e; }
  else if (action === 'stomp') { stompW = win(actT, 0, 0.04, 0.5, 0.55); actDrop = 0.04 * win(actT, 0.22, 0.3, 0.36, 0.5); actLean = -0.14 * win(actT, 0, 0.14, 0.2, 0.3) + 0.12 * win(actT, 0.22, 0.3, 0.34, 0.5); }
  else if (action === 'toolFlare') { const e = win(actT, 0.35, 0.5, 0.58, 0.7); actDrop = 0.2 * e; actLean = 0.45 * e; }
  else if (action === 'toolProng') { const e = win(actT, 0.2, 0.33, 0.38, 0.5); actLean = 0.14 * e; hz += 0.05 * e; }
  hy -= actDrop;

  S.hp.set(hx, hy, hz);
  _e.set(hipPitch, hipYaw, hipRoll);
  S.hq.setFromEuler(_e);

  // spine
  const lean = 0.05 * walkW + 0.11 * runW + 0.2 * failW + 0.04 * critW + actLean;
  const counter = (0.14 * cph * walkW * (1 - 0.6 * runW) - hipYaw + hipMoveYaw * 0) * (1 - 0.8 * wAim);
  const strafeCounter = -hipMoveYaw;
  const turnLead = 0.2 * S.wTurn * S.turnSign;
  R(S, 'torso', lean * 0.45 + 0.05 * failW, counter * 0.45 + strafeCounter * 0.5 + turnLead * 0.4, -hipRoll * 0.5 + 0.03 * sway);
  R(S, 'chest', lean * 0.55 + breath * 0.015 * (1 - walkW * 0.5) - 0.05 * recoil, counter * 0.55 + strafeCounter * 0.5 + turnLead * 0.6 + 0.15 * S.lookY, -hipRoll * 0.3 - 0.05 * limpW * rStance);
  // head: stabilised, then look / glance / condition
  const spineYaw = hipYaw + Rget(S, 'torso', 1) + Rget(S, 'chest', 1);
  const spinePitch = hipPitch + Rget(S, 'torso', 0) + Rget(S, 'chest', 0);
  R(S, 'neck', -spinePitch * 0.25 + 0.25 * S.lookP + 0.06 * failW, -spineYaw * 0.3 + 0.25 * S.lookY, 0);
  R(S, 'head', -spinePitch * 0.45 + 0.6 * S.lookP + 0.15 * failW + 0.1 * critW + (actLean > 0.3 ? 0.3 * actLean : 0),
    -spineYaw * 0.5 + 0.6 * S.lookY + 0.4 * glance + turnLead * 0.8, -hipRoll * 0.4 + 0.03 * Math.sin(time * 0.9) * idle);

  // ---- legs: planted-foot IK
  const legs = [[1, 0], [-1, 0.5]];
  for (const [side, off] of legs) {
    const u = frac(ph / TAU + off);
    const bLeg = side < 0 ? beta * (1 - 0.3 * limpW) : beta;
    footCycle(u, bLeg, D, lift * (side < 0 ? 1 - 0.3 * limpW : 1), aStrike, aToe, P.ankle);
    let fz = FOOT.z * walkW, fy = P.ankle + (FOOT.y - P.ankle) * walkW, fa = FOOT.a * walkW;
    // idle stance: left foot a little forward, toes out, weight shifts
    let bx = side * (0.1 - 0.018 * walkW), bz = (side > 0 ? 0.035 : -0.02) * idle;
    // turn in place: quick alternating steps
    if (S.wTurn > 0.01) {
      const tu = frac(S.tph / TAU + (side > 0 ? 0 : 0.5));
      const st = tu < 0.5 ? Math.sin(tu / 0.5 * PI) : 0;
      fy += 0.05 * st * S.wTurn;
      bz += 0.03 * st * S.wTurn * S.turnSign * side;
    }
    // critical: knees bent
    if (stompW > 0 && side < 0) {
      // stomp with the right leg: knee up, drive down ahead, recover
      const t = actT;
      let sz = 0, sy = P.ankle, sa = 0;
      if (t < 0.2) { const e = smooth(t / 0.2); sz = 0.3 * e; sy = P.ankle + 0.36 * e; sa = 0.25 * e; }
      else if (t < STOMP_IMPACT_T) { const e = smooth((t - 0.2) / (STOMP_IMPACT_T - 0.2)); sz = lerp(0.3, 0.4, e); sy = lerp(P.ankle + 0.36, P.ankle, e * e); sa = lerp(0.25, 0, e); }
      else { const e = smooth((t - STOMP_IMPACT_T) / 0.25); sz = lerp(0.4, 0.0, e); sy = P.ankle + 0.06 * Math.sin(e * PI); }
      fz = lerp(fz, sz, stompW); fy = lerp(fy, sy, stompW); fa = lerp(fa, sa, stompW);
    }
    const tx = bx + S.mvx * fz;
    const tz = bz + S.mvz * fz;
    const toeOut = (0.14 * idle + 0.05) * side;
    legIK(rig, S, side, tx, fy, tz, fa, toeOut, 1);
  }

  // ---- arms: locomotion swing (FK) as the base layer
  const swing = lerp(0.42, 0.7, runW) * walkW;
  const abd = 0.1 + 0.03 * walkW;
  for (const side of [1, -1]) {
    const damp = side < 0 ? 1 - 0.6 * failW : 1 - 0.3 * failW;
    const sw = side * swing * cph * damp;
    const fwd = Math.max(0, -sw);
    const sh = side > 0 ? 'shoulderL' : 'shoulderR', el = side > 0 ? 'elbowL' : 'elbowR', hd = side > 0 ? 'handL' : 'handR';
    R(S, sh, sw - 0.12 * runW + 0.02 * idle * Math.sin(time * 0.8 + side), 0, side * (abd + 0.02 * breath * idle));
    R(S, el, -(0.16 + 0.3 * fwd / Math.max(0.2, swing) * walkW + 1.05 * runW + 0.04 * idle), 0, 0);
    R(S, hd, 0.05, side * 0.1, 0);
  }

  // ---- upper-body overrides (IK in the chest frame)
  chestFrame(rig, S);
  const failClutch = failW * (1 - wAim) * (1 - wRel);
  if (failClutch > 0) {
    armIK(rig, S, 1, -0.07, 0.03, 0.125, failClutch, true);
    Rmix(S, 'handL', -0.4, -0.9, 0.2, failClutch);
  }
  if (wAim > 0) {
    // two-handed isosceles grip, gun ≈ 1.25 m high
    const py = 1.245 - Math.sin(aimPitch) * 0.44 + 0.05 * recoil;
    const pz = 0.45 * Math.cos(aimPitch) - 0.045 * recoil;
    armIK(rig, S, -1, -0.03, py, pz, wAim);
    armIK(rig, S, 1, 0.025, py - 0.055, pz - 0.035, wAim);
    handAim(rig, S, -1, -PI / 2 + aimPitch - 0.25 * recoil, 0, 0, wAim);
    handAim(rig, S, 1, -PI / 2 + aimPitch - 0.25 * recoil, 0, -0.9, wAim);
    // head follows the sights
    Rmix(S, 'head', Rget(S, 'head', 0) + 0.06 + aimPitch * 0.5, Rget(S, 'head', 1) * 0.3, 0, wAim * 0.7);
  }
  if (wRel > 0) {
    const r = clamp01(1 - reload / 1.1);
    // right hand: gun to chest, hold, seat & raise
    const rE = smooth(r / 0.3), rR = smooth((r - 0.8) / 0.2);
    const gx = lerp(lerp(-0.05, -0.02, rE), -0.03, rR), gy = lerp(lerp(1.18, 1.1, rE), 1.2, rR), gz = lerp(lerp(0.34, 0.25, rE), 0.34, rR);
    armIK(rig, S, -1, gx, gy, gz, wRel);
    handAim(rig, S, -1, lerp(-1.1, -0.35, rE * (1 - rR)), 0.25, 0.2, wRel);
    // left hand: to the gun, down to the belt pouch, back, slap
    let lx, ly, lz;
    if (r < 0.3) { const e = smooth(r / 0.3); lx = lerp(0.12, 0.03, e); ly = lerp(1.0, 1.05, e); lz = lerp(0.14, 0.26, e); }
    else if (r < 0.55) { const e = smooth((r - 0.3) / 0.25); lx = lerp(0.03, 0.13, e); ly = lerp(1.05, 0.95, e); lz = lerp(0.26, 0.09, e); }
    else if (r < 0.8) { const e = smooth((r - 0.55) / 0.25); lx = lerp(0.13, 0.0, e); ly = lerp(0.95, 1.04, e); lz = lerp(0.09, 0.25, e); }
    else { const e = smooth((r - 0.8) / 0.2); lx = lerp(0.0, 0.03, e); ly = lerp(1.04, 1.13, e); lz = lerp(0.25, 0.3, e); }
    armIK(rig, S, 1, lx, ly, lz, wRel);
    Rmix(S, 'head', Rget(S, 'head', 0) + 0.4, Rget(S, 'head', 1) * 0.3 - 0.12, 0, wRel);
  }
  if (action) {
    let w = 0;
    if (action === 'reach' || action === 'reachLow') {
      const low = action === 'reachLow';
      w = win(actT, 0, low ? 0.18 : 0.16, low ? 0.28 : 0.26, 0.45);
      armIK(rig, S, -1, -0.06, low ? 0.26 : 0.9, low ? 0.46 : 0.5, w);
      handAim(rig, S, -1, -PI / 2 - (low ? -0.9 : 0.1), 0, 0.3, w);
      Rmix(S, 'head', Rget(S, 'head', 0) + (low ? 0.3 : 0.15), Rget(S, 'head', 1) * 0.5, 0, w);
    } else if (action === 'stomp') {
      w = stompW;
      armIK(rig, S, -1, -0.24, 1.0, -0.08, w * 0.8);
      armIK(rig, S, 1, 0.26, 1.02, -0.02, w * 0.8);
      Rmix(S, 'head', Rget(S, 'head', 0) + 0.45 * win(actT, 0.1, 0.25, 0.35, 0.55), 0, 0, w);
    } else if (action === 'toolFlare') {
      // strike arc with the left hand, then set the flare down ahead
      w = win(actT, 0, 0.08, 0.6, 0.7);
      let lx, ly, lz;
      if (actT < TOOL_STRIKE_T) { const e = smooth(actT / TOOL_STRIKE_T); const a = lerp(-0.6, 1.9, e); lx = 0.18 - 0.08 * e; ly = 1.02 + 0.32 * Math.sin(a * 0.8); lz = 0.3 * Math.sin(a) - 0.02; }
      else { const e = smooth((actT - TOOL_STRIKE_T) / 0.23); lx = lerp(0.1, 0.1, e); ly = lerp(1.02 + 0.32 * Math.sin(1.52), 0.36, e); lz = lerp(0.3 * Math.sin(1.9) - 0.02, 0.5, e); }
      armIK(rig, S, 1, lx, ly, lz, w);
      Rmix(S, 'head', Rget(S, 'head', 0) + 0.25, 0.25, 0, w);
    } else if (action === 'toolProng') {
      w = win(actT, 0, 0.06, 0.42, 0.5);
      let jz, jy;
      if (actT < 0.2) { const e = smooth(actT / 0.2); jz = lerp(0.3, 0.12, e); jy = lerp(1.05, 1.12, e); }
      else if (actT < TOOL_STRIKE_T) { const e = smooth((actT - 0.2) / (TOOL_STRIKE_T - 0.2)); jz = lerp(0.12, 0.64, e); jy = lerp(1.12, 1.16, e); }
      else { const e = smooth((actT - TOOL_STRIKE_T) / 0.15); jz = lerp(0.64, 0.35, e); jy = lerp(1.16, 1.08, e); }
      armIK(rig, S, -1, -0.07, jy, jz, w);
      handAim(rig, S, -1, -PI / 2, 0, 0, w);
    }
  }

  // ---- hurt: flinch away from the hit
  const hurtE = S.hurt > 0 ? Math.sin(Math.min(1, S.hurt) * PI * 0.5) : 0;
  if (hurtE > 0) {
    const cx = Math.cos(hurtDir), cz = Math.sin(hurtDir);
    Radd(S, 'torso', -0.2 * cx * hurtE, 0, 0.2 * cz * hurtE);
    Radd(S, 'chest', -0.15 * cx * hurtE, 0.1 * cz * hurtE, 0.15 * cz * hurtE);
    Radd(S, 'head', -0.3 * cx * hurtE, 0, 0.2 * cz * hurtE);
    Radd(S, 'shoulderL', -0.3 * hurtE * (1 - wAim), 0, 0.2 * hurtE);
    Radd(S, 'shoulderR', -0.3 * hurtE * (1 - wAim), 0, -0.2 * hurtE);
  }

  // clamp the head look range (±70° yaw, ±25° pitch) across the chain
  const hy2 = Rget(S, 'head', 1), ny2 = Rget(S, 'neck', 1);
  if (Math.abs(hy2 + ny2) > 1.22) { const f = 1.22 / Math.abs(hy2 + ny2); R(S, 'head', Rget(S, 'head', 0), hy2 * f, Rget(S, 'head', 2)); R(S, 'neck', Rget(S, 'neck', 0), ny2 * f, 0); }

  rig.shoulderL.position.y = P.shY + 0.004 * breath * idle;
  rig.shoulderR.position.y = P.shY + 0.004 * breath * idle;
  rig.gaitPhase = ph;
  commit(rig, S, dt);
}

// Death: knees buckle (0–0.5), fall forward onto the right side (0.5–1.1), settle.
const _qDown1 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0.05, 0.08));
const _qDown2 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0.12, 0.99, 0.0).normalize(), // local +X (left side) → up
  new THREE.Vector3(-0.28, 0.0, 0.96).normalize(), // local +Y (head) → forward
  new THREE.Vector3(0.95, -0.12, 0.28).normalize(), // local +Z (front) → +X
));
_qDown2.normalize();
function custodianDeath(rig, S, t, time) {
  const P = rig.P;
  const a = smooth(t / 0.5), b = smooth((t - 0.45) / 0.65), c = smooth((t - 1.05) / 0.35);
  // hips path
  const y = t < 0.5 ? lerp(P.hipsY - 0.01, 0.5, a * a) : lerp(0.5, 0.155, b);
  S.hp.set(lerp(0, -0.02, b), y + 0.01 * (1 - c) * Math.sin(c * PI), lerp(0.06 * a, 0.42, b));
  _q.identity().slerp(_qDown1, a);
  S.hq.copy(_q).slerp(_qDown2, b);
  // spine & head
  R(S, 'torso', lerp(0.3 * a, 0.05, b), 0, lerp(0, 0.05, b));
  R(S, 'chest', lerp(0.2 * a, -0.05, b), lerp(0, 0.15, b), 0);
  R(S, 'neck', lerp(0.2 * a, 0.1, b), 0, lerp(0, 0.25, b));
  R(S, 'head', lerp(0.35 * a, 0.2, b), lerp(0, 0.3, b), lerp(0, 0.35 + 0.05 * c, b));
  // legs: buckle to kneel, then trail bent
  R(S, 'thighL', lerp(-0.45 * a, -0.55, b), 0, lerp(0.05, 0.1, b));
  R(S, 'kneeL', lerp(1.6 * a, 1.0, b), 0, 0);
  R(S, 'footL', lerp(0.5 * a, 0.3, b), 0, 0);
  R(S, 'thighR', lerp(-0.3 * a, -0.25, b), 0, lerp(-0.05, -0.05, b));
  R(S, 'kneeR', lerp(1.7 * a, 0.45, b), 0, 0);
  R(S, 'footR', lerp(0.5 * a, 0.2, b), 0, 0);
  // arms: loose, the lower one reaches forward under the head, the upper drapes
  R(S, 'shoulderL', lerp(-0.2 * a, -0.6, b), 0, lerp(0.15, -0.35, b));
  R(S, 'elbowL', lerp(-0.3 * a, -0.5, b), 0, 0);
  R(S, 'handL', 0, 0, 0);
  R(S, 'shoulderR', lerp(-0.3 * a, -1.9, b), 0, lerp(-0.15, 0.1, b));
  R(S, 'elbowR', lerp(-0.2 * a, -0.3, b), 0, 0);
  R(S, 'handR', 0, 0, 0);
}

// ------------------------------------------------------------------ hollows
const HOLLOW_STATES = new Set(['dormant', 'idle', 'investigate', 'notice', 'rising', 'chase', 'lunge', 'attack', 'flinch', 'knockdown', 'down', 'stomped', 'burning', 'ash', 'dead']);
const LYING = new Set(['knockdown', 'down', 'stomped', 'burning', 'ash', 'dead']);
const FADE = { notice: 0.08, flinch: 0.07, attack: 0.12, lunge: 0.15, knockdown: 0.1, down: 0.25, stomped: 0.06, rising: 0.12, dead: 0.3, ash: 0.5, burning: 0.2 };

// Pose driver for the Hollows. See the rig contract for the fields.
export function poseHollow(rig, s, dt) {
  const S = rig._st;
  s = s || {};
  dt = num(dt, 0.016);
  if (dt < 0) dt = 0;
  const snap = dt >= 1;
  const P = rig.P;
  const variant = rig.variant;
  const rusher = variant === 'rusher', warden = variant === 'warden';
  const state = HOLLOW_STATES.has(s.state) ? s.state : 'idle';
  const st = Math.max(0, num(s.stateT, 0));
  const t = num(s.time, 0);
  const speed = Math.max(0, num(s.speed, 0));
  const hurt = clamp01(num(s.hurt, 0));
  const ap = clamp(num(s.attackPhase, 0), 0, 3);
  const twitch = clamp01(num(s.twitch, 0));
  const reviving = clamp01(num(s.reviving, 0));

  if (!S.init) { S.init = true; S.prevState = state; }
  if (state !== S.prevState) {
    const fromFloor = LYING.has(S.prevState) || S.prevState === 'dormant';
    if (!snap) startFade(S, state === 'rising' && fromFloor ? 0.45 : FADE[state] ?? 0.22);
    S.prevState = state;
  }
  if (!snap) S.gph += dt * hollowPhaseRate(speed, variant);
  const jit = (f, o = 0) => Math.sin(t * f * 7.1 + o) * Math.sin(t * f * 3.3 + 1.7 + o);
  S.hs.set(1, 1, 1);

  // posture base (hunch, thrust head, dropped shoulder)
  const hunch = rusher ? 0.46 : warden ? 0.12 : 0.26;
  const baseHips = P.hipsY - (rusher ? 0.17 : 0.035);
  const setStand = (lean, headLook, walk) => {
    R(S, 'torso', hunch * 0.9 + lean * 0.5, 0, 0.06);
    R(S, 'chest', hunch * 0.75 + lean * 0.5, 0, 0.05);
    R(S, 'neck', (rusher ? 0.5 : 0.55) + 0.1 * walk, 0, -0.05);
    R(S, 'head', -(rusher ? 0.55 : 0.4) - hunch * 1.2 + headLook, 0, 0.28 + 0.1 * jit(0.4));
  };
  let lying = false;

  // gait (used by the walking states)
  const walkLegs = (spd, drag) => {
    const walkW = sstep(0.05, 0.35, spd);
    const stride = hollowPhaseRate(1, variant) > 0 ? PI / hollowPhaseRate(1, variant) : 0.5;
    const D = 2 * stride, beta = rusher ? 0.45 : 0.62;
    const ph = S.gph;
    for (const [side, off] of [[1, 0], [-1, 0.5]]) {
      const u = frac(ph / TAU + off);
      const dragging = side < 0 && drag;
      const bL = dragging ? beta * 0.8 : beta;
      footCycle(u, bL, D, (dragging ? 0.02 : rusher ? 0.12 : 0.06), dragging ? 0 : 0.2, dragging ? 0.1 : 0.3, P.ankle);
      const fz = FOOT.z * walkW, fy = P.ankle + (FOOT.y - P.ankle) * walkW, fa = (dragging ? -0.25 * walkW : 0) + FOOT.a * walkW;
      legIK(rig, S, side, side * (warden ? 0.13 : 0.1), fy, fz + (side > 0 ? 0.04 : -0.03) * (1 - walkW), fa, side * 0.12 + (dragging ? -0.3 : 0), 1);
    }
    return walkW;
  };

  switch (state) {
    case 'dormant': {
      // slumped against a wall: sitting, knees up, one leg out, head lolled
      S.hp.set(0, 0.2, -0.05);
      S.hq.setFromEuler(_e.set(-0.25, 0, 0.06));
      R(S, 'torso', -0.1, 0, 0.1); R(S, 'chest', 0.25, 0, 0.05);
      R(S, 'neck', 0.5, 0.1, 0.2); R(S, 'head', 0.4 + jit(0.4) * 0.05 * twitch, 0.35, 0.35);
      R(S, 'thighL', -1.35, 0.25, 0.15); R(S, 'kneeL', 1.9, 0, 0); R(S, 'footL', -0.3, 0, 0);
      R(S, 'thighR', -1.45, -0.2, -0.2); R(S, 'kneeR', 0.5, 0, 0); R(S, 'footR', 0.4, 0, 0);
      R(S, 'shoulderL', 0.15, 0, 0.35); R(S, 'elbowL', -0.3, 0, 0); R(S, 'handL', 0.3, 0, 0);
      R(S, 'shoulderR', -0.25, 0, -0.35 + jit(0.8, 2) * 0.1 * twitch); R(S, 'elbowR', -0.5, 0, 0); R(S, 'handR', 0.2, 0, 0);
      break;
    }
    case 'rising': {
      // 1.6 s, jerky: stutter from the slump to standing
      const r = clamp01(st / 1.6);
      const steps = 6, sr = r * steps, fi = Math.floor(sr);
      const e = clamp01((fi + Math.pow(smooth(sr - fi), 3)) / steps);
      const ee = smooth(e);
      const jolt = (1 - r) * jit(2.2) * 0.25;
      S.hp.set(0, lerp(0.2, baseHips, ee), lerp(-0.05, 0, ee));
      S.hq.setFromEuler(_e.set(lerp(-0.25, 0.2, ee) + 0.3 * Math.sin(ee * PI), 0, lerp(0.06, 0, ee)));
      R(S, 'torso', lerp(-0.1, hunch, ee) + 0.4 * Math.sin(ee * PI), 0, 0.1);
      R(S, 'chest', lerp(0.25, hunch, ee), 0, 0.05);
      R(S, 'neck', lerp(0.5, 0.45, ee) + jolt, 0, 0.1);
      R(S, 'head', lerp(0.4, -0.35, ee) + jolt * 1.5, jit(1.3) * 0.5 * (1 - r), 0.3);
      R(S, 'thighL', lerp(-1.35, -0.05, ee), 0, 0.05); R(S, 'kneeL', lerp(1.9, 0.12, ee), 0, 0); R(S, 'footL', lerp(-0.3, -0.05, ee), 0, 0);
      R(S, 'thighR', lerp(-1.45, 0.02, ee), 0, -0.05); R(S, 'kneeR', lerp(0.5, 0.1, ee), 0, 0); R(S, 'footR', lerp(0.4, -0.1, ee), 0, 0);
      R(S, 'shoulderL', lerp(0.15, -0.5, ee) + jolt, 0, 0.3); R(S, 'elbowL', -0.3, 0, 0); R(S, 'handL', 0.3, 0, 0);
      R(S, 'shoulderR', lerp(-0.25, 0.25, ee), 0, -0.25); R(S, 'elbowR', -0.3, 0, 0); R(S, 'handR', 0.2, 0, 0);
      break;
    }
    case 'idle': case 'notice': case 'investigate': case 'chase': case 'attack': case 'flinch': case 'lunge': {
      const moving = state === 'investigate' || state === 'chase';
      const spd = moving ? speed : 0;
      const walkW = sstep(0.05, 0.35, spd);
      const ph = S.gph;
      const lurch = state === 'chase' ? Math.max(0, Math.sin(ph)) : 0;
      const sway = (1 - walkW) * Math.sin(t * 1.9) * 0.02;
      S.hp.set(sway + 0.02 * Math.sin(ph) * walkW, baseHips - 0.03 * walkW * (0.5 + 0.5 * Math.cos(2 * ph)) - 0.03 * lurch * walkW - (warden ? 0.02 : 0), 0);
      S.hq.setFromEuler(_e.set(0.05 + 0.08 * walkW, -0.12 * Math.cos(ph) * walkW, 0.06 * Math.sin(ph) * walkW + 0.05 * (state === 'chase' ? 1 : 0) + sway * 1.5));
      setStand(0.12 * walkW + 0.1 * lurch, 0, walkW);
      walkLegs(spd, state === 'chase' && !rusher);
      // head: twitches, scanning, the snap of noticing
      const snapJ = Math.sin(t * 2.3) > 0.93 ? jit(3) * 0.6 : 0;
      if (state === 'idle') Radd(S, 'head', snapJ * 0.3, snapJ, jit(0.7) * 0.15);
      if (state === 'investigate') Radd(S, 'head', 0, Math.sin(t * 0.9) * 1.05, 0);
      if (state === 'notice') {
        const n = clamp01(st / 0.4);
        const e = n < 0.25 ? smooth(n / 0.25) : 1 - 0.4 * smooth((n - 0.25) / 0.75);
        Radd(S, 'head', -0.45 * e, 0, -0.25 * e);
        Radd(S, 'neck', -0.2 * e, 0, 0);
        Radd(S, 'chest', -0.12 * e, 0, 0);
      }
      // arms
      const sw = Math.sin(ph) * 0.35 * walkW;
      if (state === 'chase' || state === 'investigate') {
        const reach = state === 'chase' ? 1 : 0.35;
        R(S, 'shoulderL', lerp(-0.2, -1.25, reach) + jit(0.9) * 0.15, -0.1, 0.12);
        R(S, 'elbowL', -0.2 - 0.2 * (1 - reach), 0, 0);
        R(S, 'shoulderR', 0.22 + sw * 0.5 + 0.1 * lurch, 0, -0.22); R(S, 'elbowR', -0.06, 0, 0);
        if (rusher) { R(S, 'shoulderL', 0.6 - sw, 0, 0.35); R(S, 'shoulderR', 0.6 + sw, 0, -0.35); R(S, 'elbowL', -0.5, 0, 0); R(S, 'elbowR', -0.5, 0, 0); }
      } else {
        R(S, 'shoulderL', 0.05 + jit(0.5, 1) * 0.06, 0.1, 0.12); R(S, 'elbowL', -0.18, 0, 0);
        R(S, 'shoulderR', 0.1 + jit(0.45, 2) * 0.05, -0.1, -0.16); R(S, 'elbowR', -0.1, 0, 0);
      }
      R(S, 'handL', 0.2, 0, 0); R(S, 'handR', 0.25, 0, 0);
      if (rusher && state !== 'chase' && state !== 'investigate') {
        R(S, 'shoulderL', -0.45 + jit(0.5, 1) * 0.08, 0.2, 0.2); R(S, 'elbowL', -0.35, 0, 0);
        R(S, 'shoulderR', -0.35 + jit(0.45, 2) * 0.08, -0.2, -0.24); R(S, 'elbowR', -0.3, 0, 0);
      }
      if (state === 'attack') {
        // 0..1 wind-up, 1..1.3 strike, 1.3..3 recover
        const up = ap < 1 ? smooth(ap) : ap < 1.3 ? 1 - 1.6 * smooth((ap - 1) / 0.3) : -0.6 + 0.6 * smooth((ap - 1.3) / 1.7);
        if (!warden) { R(S, 'shoulderL', -1.5 - up * 1.3, -0.3, 0.25); R(S, 'elbowL', -0.3 - 0.3 * Math.max(0, up), 0, 0); }
        R(S, 'shoulderR', -1.5 - up * 1.1, 0.3, -0.25);
        R(S, 'elbowR', -0.3 - 0.3 * Math.max(0, up), 0, 0);
        Radd(S, 'torso', -up * 0.25, 0, 0); Radd(S, 'chest', -up * 0.15, 0, 0);
        Radd(S, 'head', up * 0.2, 0, 0);
      }
      if (state === 'flinch') {
        const f = clamp01(st / 0.35), e = Math.sin(f * PI) * (1 - f * 0.3);
        Radd(S, 'torso', -0.5 * e, 0, 0.1 * e); Radd(S, 'chest', -0.2 * e, 0, 0); Radd(S, 'head', -0.5 * e, 0.3 * e, 0.3 * e);
        Radd(S, 'shoulderL', 0.4 * e, 0, 0.3 * e); Radd(S, 'shoulderR', 0.4 * e, 0, -0.3 * e);
      }
      if (state === 'lunge') {
        const wind = st < 0.5 ? smooth(st / 0.5) : 1 - smooth((st - 0.5) / 0.15);
        const leap = st < 0.5 ? 0 : win(st, 0.5, 0.62, 0.8, 1.1);
        S.hp.y -= 0.25 * wind - 0.08 * leap;
        _e.set(0.05 + 0.3 * wind + 0.55 * leap, 0, 0);
        S.hq.setFromEuler(_e);
        Radd(S, 'torso', 0.3 * wind + 0.2 * leap, 0, 0);
        Radd(S, 'head', -0.3 * wind - 0.4 * leap, 0, 0);
        R(S, 'shoulderL', lerp(0.5 * wind, -1.6, leap), 0, 0.2); R(S, 'shoulderR', lerp(0.5 * wind, -1.6, leap), 0, -0.2);
        R(S, 'elbowL', -0.3, 0, 0); R(S, 'elbowR', -0.3, 0, 0);
        const la = lerp(-0.6 * wind, -0.4, leap), lb = lerp(1.2 * wind, 0.3, leap);
        R(S, 'thighL', la, 0, 0.08); R(S, 'kneeL', lb, 0, 0); R(S, 'footL', -la - lb, 0, 0);
        R(S, 'thighR', lerp(-0.2 * wind, 0.5, leap), 0, -0.08); R(S, 'kneeR', lerp(1.0 * wind, 0.4, leap), 0, 0); R(S, 'footR', lerp(-0.5 * wind, 0.3, leap), 0, 0);
      }
      if (warden && state !== 'lunge') {
        // plate held up in guard across the left flank
        chestFrame(rig, S);
        const bash = state === 'attack' ? Math.max(0, Math.sin(Math.min(1, ap / 1.3) * PI)) : 0;
        armIK(rig, S, 1, 0.03 + 0.02 * Math.sin(t * 1.3), 1.06 + 0.1 * bash, 0.3 + 0.2 * bash, 1);
        R(S, 'handL', 0.1, 0, 0);
      }
      break;
    }
    default: {
      // lying states: knockdown → down (on its back, core up) → dead; stomped; burning → ash
      lying = true;
      const fall = state === 'knockdown' ? clamp01(st / 0.6) : state === 'down' || state === 'stomped' || state === 'burning' ? clamp01(st / 0.55) : 1;
      const e = smooth(fall);
      const still = state === 'dead' || state === 'ash';
      const tw = still ? 0 : state === 'knockdown' ? 1 : twitch;
      S.hp.set(0, lerp(baseHips * 0.7, 0.14, e * e), lerp(0, -0.35, e));
      S.hq.setFromEuler(_e.set(lerp(-0.4, -PI / 2 + 0.06, e), 0, lerp(0, -0.25, e)));
      R(S, 'torso', -0.05, 0, 0.05); R(S, 'chest', 0.05, 0.1, 0);
      R(S, 'neck', 0.3, 0.2, 0); R(S, 'head', 0.25, 0.85, 0.2);
      if (state === 'knockdown') {
        // thrown backward: arms flung up, legs kicking
        R(S, 'shoulderL', -2.3 * e, 0, 0.5); R(S, 'elbowL', -0.5, 0, 0); R(S, 'handL', 0.3, 0, 0);
        R(S, 'shoulderR', -2.1 * e, 0, -0.6); R(S, 'elbowR', -0.4, 0, 0); R(S, 'handR', 0.2, 0, 0);
        R(S, 'thighL', -0.7 * e, 0, 0.12); R(S, 'kneeL', 1.1 * e, 0, 0); R(S, 'footL', 0.5, 0, 0);
        R(S, 'thighR', -0.3, 0, -0.1); R(S, 'kneeR', 0.4, 0, 0); R(S, 'footR', 0.6, 0.2, 0);
      } else {
        // down / dead: one arm out, one across the belly, a knee up (down) or dropped (dead)
        const k = state === 'dead' ? 0.35 : 1;
        R(S, 'shoulderL', -0.5 * e, 0, 1.25 * e); R(S, 'elbowL', -0.7, 0, 0); R(S, 'handL', 0.3, 0, 0);
        R(S, 'shoulderR', -0.35 * e, -0.4, -0.18); R(S, 'elbowR', -1.3 * e, 0, 0); R(S, 'handR', 0.2, 0, 0);
        R(S, 'thighL', -0.75 * k * e, 0.2, 0.2); R(S, 'kneeL', 1.3 * k * e, 0, 0); R(S, 'footL', 0.6, 0, 0);
        R(S, 'thighR', -0.1, -0.1, -0.16); R(S, 'kneeR', 0.25, 0, 0); R(S, 'footR', 0.8, 0.3, 0);
      }
      if (tw > 0) {
        Radd(S, 'shoulderL', 0, 0, jit(3) * 0.2 * tw);
        Radd(S, 'head', jit(2.7, 1) * 0.12 * tw, jit(1.9, 2) * 0.2 * tw, 0);
        Radd(S, 'kneeL', Math.max(0, jit(2.2, 3)) * 0.4 * tw, 0, 0);
        Radd(S, 'kneeR', Math.max(0, jit(1.7, 4)) * 0.3 * tw, 0, 0);
      }
      if (state === 'down' && reviving > 0) {
        const r = reviving * reviving;
        Radd(S, 'chest', jit(4.1) * 0.12 * r, 0, jit(3.3, 1) * 0.1 * r);
        Radd(S, 'head', jit(5.3, 2) * 0.3 * r, jit(4.7, 3) * 0.3 * r, 0);
        Radd(S, 'shoulderL', jit(3.9, 4) * 0.35 * r, 0, 0); Radd(S, 'shoulderR', jit(4.4, 5) * 0.35 * r, 0, 0);
        Radd(S, 'thighL', jit(3.1, 6) * 0.15 * r, 0, 0); Radd(S, 'kneeR', Math.abs(jit(3.6, 7)) * 0.35 * r, 0, 0);
        S.hp.y += Math.abs(jit(4.8, 8)) * 0.02 * r;
      }
      if (state === 'stomped') {
        const c = smooth(st / 0.12);
        S.hs.set(1 + 0.2 * c, 1 - 0.62 * c, 1 + 0.12 * c);
        S.hp.y -= 0.03 * c;
        R(S, 'chest', -0.12 * c, 0.1, 0); R(S, 'neck', 0.1, 0.2, 0); R(S, 'head', 0.05, 0.7, 0.1);
        R(S, 'shoulderL', -0.3, 0, 1.35); R(S, 'shoulderR', -0.3, 0, -1.3); R(S, 'elbowL', -0.3, 0, 0); R(S, 'elbowR', -0.4, 0, 0);
        R(S, 'thighL', -0.1, 0, 0.3); R(S, 'kneeL', 0.2, 0, 0); R(S, 'thighR', -0.05, 0, -0.3); R(S, 'kneeR', 0.15, 0, 0);
      }
      if (state === 'burning' || state === 'ash') {
        // writhe, then curl onto the side
        const curl = state === 'ash' ? 1 : smooth((st - 1.2) / 2.5);
        const wr = state === 'burning' ? 1 - curl * 0.8 : 0;
        S.hq.setFromEuler(_e.set(lerp(-PI / 2 + 0.06, -0.25, curl), 0, lerp(-0.25, PI / 2 - 0.1, curl)));
        S.hp.set(0, lerp(0.14, 0.2, curl), -0.3);
        R(S, 'torso', lerp(-0.05, 0.4, curl), 0, 0); R(S, 'chest', lerp(0.05, 0.5, curl), 0, 0);
        R(S, 'neck', lerp(0.3, 0.6, curl), 0, 0); R(S, 'head', lerp(0.25, 0.6, curl), lerp(0.7, 0.1, curl), 0);
        R(S, 'thighL', lerp(0.25, -1.9, curl), 0, 0.1); R(S, 'kneeL', lerp(0.55, 2.3, curl), 0, 0);
        R(S, 'thighR', lerp(-0.15, -1.7, curl), 0, -0.1); R(S, 'kneeR', lerp(0.2, 2.4, curl), 0, 0);
        R(S, 'shoulderL', lerp(-2.0, -1.5, curl) + jit(1.4) * 0.8 * wr, 0, 0.3 + jit(1.1, 1) * 0.5 * wr);
        R(S, 'shoulderR', lerp(-2.0, -1.4, curl) + jit(1.2, 2) * 0.8 * wr, 0, -0.3 + jit(1.3, 3) * 0.5 * wr);
        R(S, 'elbowL', lerp(-0.5, -2.2, curl) + jit(1.6, 4) * 0.5 * wr, 0, 0); R(S, 'elbowR', lerp(-0.5, -2.3, curl), 0, 0);
      }
      break;
    }
  }
  if (!lying) {
    // hurt jolt (legacy field)
    if (hurt > 0) {
      Radd(S, 'torso', -hurt * 0.7, 0, 0);
      Radd(S, 'head', -hurt * 0.5, 0, hurt * 0.4);
    }
    // dropped left shoulder reads in the pose too
    Radd(S, 'shoulderL', 0, 0, 0.04);
  }
  rig.gaitPhase = S.gph;
  commit(rig, S, dt);
}

// ------------------------------------------------------------------ wireframe
// Line copy of any rig (or Object3D) in its current posed world space, for
// the inventory monitor. Works for skinned and plain meshes of any geometry.
export function wireframeClone(rig, color = 0xff3030) {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color });
  const root = rig && rig.root ? rig.root : rig;
  if (!root || !root.isObject3D) return g;
  root.updateMatrixWorld(true);
  const visible = (o) => { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === root) break; } return true; };
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || !visible(o)) return;
    let geo = o.geometry;
    let matrix = o.matrixWorld;
    if (o.isSkinnedMesh) {
      // bake the posed vertices into world space
      const pos = geo.attributes.position;
      const out = new Float32Array(pos.count * 3);
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        o.getVertexPosition(i, v);
        v.applyMatrix4(o.matrixWorld);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
      if (o.geometry.index) geo.setIndex(o.geometry.index);
      matrix = null;
    }
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lineMat);
    e.matrixAutoUpdate = false;
    if (matrix) e.matrix.copy(matrix);
    g.add(e);
  });
  return g;
}
