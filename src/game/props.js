// Low-poly prop builders. Each returns { obj, colliders: [{x0,z0,x1,z1}] }
// with colliders in world space (axis-aligned).
import * as THREE from 'three';
import { psx } from '../engine/renderer.js';
import { Tex } from '../engine/textures.js';
import { buildHollow, poseHollow } from '../engine/characters.js';
import { ROOMS, SECTORS } from './map.js';

const matCache = new Map();
function lam(key, make) {
  if (!matCache.has(key)) matCache.set(key, psx(make()));
  return matCache.get(key);
}

export const M = {
  metal: () => lam('metal', () => new THREE.MeshLambertMaterial({ map: Tex.metal(92, 5) })),
  metalDark: () => lam('metalDark', () => new THREE.MeshLambertMaterial({ map: Tex.metal(46, 6) })),
  metalLight: () => lam('metalLight', () => new THREE.MeshLambertMaterial({ map: Tex.metal(150, 7) })),
  metalRed: () => lam('metalRed', () => new THREE.MeshLambertMaterial({ color: 0xa0262a, map: Tex.metal(200, 8) })),
  wood: () => lam('wood', () => new THREE.MeshLambertMaterial({ map: Tex.wood() })),
  fabricGrey: () => lam('fabricGrey', () => new THREE.MeshLambertMaterial({ map: Tex.fabric(120, 124, 126, 1) })),
  fabricRed: () => lam('fabricRed', () => new THREE.MeshLambertMaterial({ map: Tex.fabric(120, 30, 36, 2) })),
  fabricWhite: () => lam('fabricWhite', () => new THREE.MeshLambertMaterial({ map: Tex.fabric(196, 200, 196, 3) })),
  fabricGreen: () => lam('fabricGreen', () => new THREE.MeshLambertMaterial({ map: Tex.fabric(70, 90, 80, 4) })),
  fabricBlue: () => lam('fabricBlue', () => new THREE.MeshLambertMaterial({ map: Tex.fabric(66, 78, 96, 5) })),
  black: () => lam('black', () => new THREE.MeshLambertMaterial({ color: 0x0c0d0e })),
  glass: () => lam('glass', () => new THREE.MeshBasicMaterial({ map: Tex.cryoGlass(), transparent: true, opacity: 0.85 })),
  paper: () => lam('paper', () => new THREE.MeshLambertMaterial({ map: Tex.paper() })),
  hazard: () => lam('hazard', () => new THREE.MeshLambertMaterial({ map: Tex.hazard() })),
  plant: () => lam('plant', () => new THREE.MeshLambertMaterial({ color: 0x3c4a30, flatShading: true })),
  deadPlant: () => lam('deadPlant', () => new THREE.MeshLambertMaterial({ color: 0x4a3a24, flatShading: true })),
  emissiveRed: () => lam('emRed', () => new THREE.MeshBasicMaterial({ color: 0xff2a22 })),
  emissiveCyan: () => lam('emCyan', () => new THREE.MeshBasicMaterial({ color: 0x7ff0ff })),
  emissiveAmber: () => lam('emAmber', () => new THREE.MeshBasicMaterial({ color: 0xffb060 })),
  emissiveWhite: () => lam('emWhite', () => new THREE.MeshBasicMaterial({ color: 0xe8f0f0 })),
  emissiveGreen: () => lam('emGreen', () => new THREE.MeshBasicMaterial({ color: 0x40ff80 })),
  emissiveTeal: () => lam('emTeal', () => new THREE.MeshBasicMaterial({ color: 0xa6ece4 })),
  emissiveTealDim: () => lam('emTealDim', () => new THREE.MeshBasicMaterial({ color: 0x3f7f7a })),
  lockerPaint: () => lam('lockerPaint', () => new THREE.MeshLambertMaterial({ color: 0x9fb4ae, map: Tex.metal(132, 9) })),
  lockerPaintDark: () => lam('lockerPaintDark', () => new THREE.MeshLambertMaterial({ color: 0x8a9e98, map: Tex.metal(96, 10) })),
  bone: () => lam('bone', () => new THREE.MeshLambertMaterial({ color: 0xd8d0bc, map: Tex.metal(200, 11) })),
  brass: () => lam('brass', () => new THREE.MeshLambertMaterial({ color: 0xb89a58, map: Tex.metal(170, 12) })),
};

function mesh(geo, material, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
const B = (w, h, d, material, x, y, z, cast) => mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, cast);
const C = (r, h, material, x, y, z, seg = 8) => mesh(new THREE.CylinderGeometry(r, r, h, seg), material, x, y, z);

// Screen material — MeshBasic so it glows in the dark.
function screenMat(lines, color, seed) {
  return lam('screen' + lines.join() + color + seed, () => new THREE.MeshBasicMaterial({ map: Tex.screen(lines, color, seed) }));
}
function texMat(key, tex, basic = false, extra = {}) {
  return lam(key, () => basic
    ? new THREE.MeshBasicMaterial({ map: tex, ...extra })
    : new THREE.MeshLambertMaterial({ map: tex, ...extra }));
}

// Collider helper for a w×d footprint centred at (x, z), rotated by quarter turns.
function footprint(x, z, w, d, r = 0) {
  const rw = r % 2 ? d : w, rd = r % 2 ? w : d;
  return { x0: x - rw / 2, z0: z - rd / 2, x1: x + rw / 2, z1: z + rd / 2 };
}

// r: quarter turns. Prop local "front" faces +z (south, toward camera) at r=0.
function place(g, p) {
  g.position.set(p.x, p.y || 0, p.z);
  g.rotation.y = -(p.r || 0) * Math.PI / 2 + (p.rot || 0);
  return g;
}

export const BUILDERS = {
  cryoPod(p) {
    const g = new THREE.Group();
    g.add(B(1.3, 0.2, 0.9, M.metalDark(), 0, 0.1, 0));
    g.add(B(1.1, 2.3, 0.18, M.metal(), 0, 1.25, -0.3));
    // capsule body (upright, slight tilt back)
    const body = new THREE.Group();
    body.position.set(0, 0.2, 0);
    body.rotation.x = -0.12;
    g.add(body);
    body.add(B(1.0, 2.1, 0.55, M.metalLight(), 0, 1.05, -0.05));
    if (p.open) {
      body.add(B(0.8, 1.8, 0.1, M.black(), 0, 1.05, 0.23));
      const gel = B(0.7, 1.7, 0.05, M.emissiveCyan(), 0, 1.05, 0.2, false);
      gel.material = lam('gelDim', () => new THREE.MeshBasicMaterial({ color: 0x1f5058 }));
      body.add(gel);
      // lid swung open
      const lid = B(0.85, 1.9, 0.08, M.glass(), 0.62, 1.05, 0.55, false);
      lid.rotation.y = -1.2;
      body.add(lid);
    } else {
      body.add(B(0.8, 1.8, 0.08, M.glass(), 0, 1.05, 0.25, false));
      // frosted silhouette inside
      const sil = B(0.35, 1.2, 0.05, M.black(), 0, 1.15, 0.2, false);
      body.add(sil);
    }
    body.add(B(1.02, 0.12, 0.6, M.metalRed(), 0, 2.12, -0.05));
    body.add(B(0.2, 0.08, 0.02, M.emissiveCyan(), 0.3, 1.95, 0.29, false));
    // hoses
    g.add(C(0.05, 1.4, M.black(), -0.55, 1.2, -0.2));
    g.add(C(0.05, 1.2, M.black(), 0.55, 1.0, -0.2));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z + 0.1, 1.3, 0.9, p.r)] };
  },

  pipes(p) {
    const g = new THREE.Group();
    const len = p.len;
    const y = p.y || 2.2;
    const along = p.axis === 'x';
    for (let i = 0; i < 3; i++) {
      const r = [0.08, 0.05, 0.06][i];
      const off = 0.12 + i * 0.16;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), i === 1 ? M.metalRed() : M.metalDark());
      if (along) { c.rotation.z = Math.PI / 2; c.position.set(p.x + len / 2, y - i * 0.18, p.z + off); }
      else { c.rotation.x = Math.PI / 2; c.position.set(p.x + off, y - i * 0.18, p.z + len / 2); }
      g.add(c);
    }
    // brackets
    for (let s = 1; s < len; s += 3) {
      const b = B(0.08, 0.5, 0.08, M.metalDark(), 0, y - 0.2, 0, false);
      if (along) b.position.set(p.x + s, y - 0.2, p.z + 0.06); else b.position.set(p.x + 0.06, y - 0.2, p.z + s);
      g.add(b);
    }
    return { obj: g, colliders: [] };
  },

  desk(p) {
    const g = new THREE.Group();
    const w = p.w || 1.6;
    const top = p.wood ? M.wood() : M.metal();
    g.add(B(w, 0.06, 0.7, top, 0, 0.75, 0));
    g.add(B(0.05, 0.72, 0.6, M.metalDark(), -w / 2 + 0.05, 0.36, 0));
    g.add(B(0.4, 0.66, 0.6, p.wood ? M.wood() : M.metalDark(), w / 2 - 0.22, 0.36, 0));
    g.add(B(0.3, 0.02, 0.02, M.metalLight(), w / 2 - 0.22, 0.5, 0.31, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, w, 0.7, p.r)] };
  },

  terminal(p) {
    const g = new THREE.Group();
    g.add(B(0.5, 0.36, 0.36, M.metalLight(), 0, 0.2, 0));
    const scr = B(0.4, 0.28, 0.02, screenMat(p.lines || [], p.color || [110, 230, 200], 3), 0, 0.22, 0.19, false);
    g.add(scr);
    g.add(B(0.5, 0.04, 0.22, M.metalDark(), 0, 0.02, 0.32));
    place(g, p);
    return { obj: g, colliders: [] };
  },

  chair(p) {
    const g = new THREE.Group();
    g.add(B(0.45, 0.06, 0.45, M.fabricGrey(), 0, 0.45, 0));
    g.add(B(0.45, 0.5, 0.06, M.fabricGrey(), 0, 0.72, -0.2));
    g.add(C(0.03, 0.42, M.metalDark(), 0, 0.22, 0));
    g.add(B(0.4, 0.03, 0.05, M.metalDark(), 0, 0.02, 0));
    g.add(B(0.05, 0.03, 0.4, M.metalDark(), 0, 0.02, 0));
    place(g, p);
    if (p.fallen) { g.rotation.z = Math.PI / 2; g.position.y = 0.25; }
    return { obj: g, colliders: [footprint(p.x, p.z, 0.4, 0.4)] };
  },

  locker(p) {
    const g = new THREE.Group();
    g.add(B(0.7, 1.95, 0.5, M.metal(), 0, 0.975, 0));
    const door = B(0.62, 1.8, 0.03, p.open ? M.metalDark() : M.metalLight(), 0, 0.98, 0.26, false);
    if (p.open) { door.position.set(0.55, 0.98, 0.45); door.rotation.y = -1.3; g.add(B(0.6, 1.75, 0.02, M.black(), 0, 0.98, 0.24, false)); }
    g.add(door);
    for (let i = 0; i < 3; i++) g.add(B(0.4, 0.02, 0.01, M.black(), 0, 1.7 - i * 0.05, 0.28, false));
    g.add(B(0.04, 0.12, 0.03, M.metalDark(), 0.22, 1.0, 0.29, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.7, 0.5, p.r)] };
  },

  breaker(p) {
    const g = new THREE.Group();
    g.add(B(0.6, 0.8, 0.14, M.metal(), 0, 1.3, 0.07));
    g.add(B(0.5, 0.1, 0.03, M.hazard(), 0, 1.62, 0.15, false));
    const lever = B(0.06, 0.3, 0.06, M.metalRed(), 0.1, 1.2, 0.18, false);
    lever.rotation.x = 0.6;
    g.add(lever);
    const lamp = B(0.07, 0.07, 0.03, M.emissiveRed(), -0.15, 1.35, 0.15, false);
    g.add(lamp);
    place(g, p);
    return { obj: g, colliders: [], parts: { lever, lamp } };
  },

  crate(p) {
    const s = p.s || 0.8;
    const g = new THREE.Group();
    g.add(B(s, s, s, M.metalDark(), 0, s / 2, 0));
    g.add(B(s + 0.02, s * 0.15, s + 0.02, M.metalRed(), 0, s * 0.8, 0, false));
    g.add(B(s * 0.5, s * 0.3, 0.01, M.paper(), 0, s * 0.45, s / 2 + 0.005, false));
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.rot || 0;
    return { obj: g, colliders: [footprint(p.x, p.z, s, s)] };
  },

  decal(p) {
    const s = p.s || 1.5;
    const m = lam('decal' + p.kind + (p.seed || 0), () => new THREE.MeshBasicMaterial({ map: Tex.splat(p.kind, p.seed || Math.floor(p.x * 7 + p.z)), transparent: true, depthWrite: false }));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
    pl.rotation.x = -Math.PI / 2;
    pl.rotation.z = (p.x * 13.7) % 6;
    pl.position.set(p.x, 0.012, p.z);
    pl.renderOrder = 1;
    // lit decals look better — swap to lambert
    pl.material = lam('decalL' + p.kind + Math.floor(p.x * 7 + p.z), () => new THREE.MeshLambertMaterial({ map: Tex.splat(p.kind, Math.floor(p.x * 7 + p.z)), transparent: true, depthWrite: false }));
    return { obj: pl, colliders: [] };
  },

  sign(p) {
    const tex = Tex.sign(p.text, p.red ? [150, 28, 32] : [190, 182, 160], p.red ? [230, 220, 200] : [30, 26, 24], p.gloss || '');
    const m = texMat('sign' + p.text + (p.gloss || ''), tex);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(p.w || 1.4, (p.w || 1.4) / 4), m);
    place(pl, p);
    pl.position.y = p.y || 2.3;
    return { obj: pl, colliders: [] };
  },

  poster(p) {
    const m = texMat('poster' + p.kind, Tex.poster(p.kind), false, { transparent: true, alphaTest: 0.5 });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.0), m);
    place(pl, p);
    pl.position.y = 1.55;
    return { obj: pl, colliders: [] };
  },

  hazardFloor(p) {
    const tex = Tex.hazard().clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.max(1, p.w * 2), 1);
    const m = new THREE.MeshLambertMaterial({ map: tex });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), psx(m));
    pl.rotation.x = -Math.PI / 2;
    if (p.w < p.d) { pl.geometry = new THREE.PlaneGeometry(p.d, p.w); pl.rotation.z = Math.PI / 2; tex.repeat.set(p.d * 2, 1); }
    pl.position.set(p.x + p.w / 2, 0.011, p.z + p.d / 2);
    return { obj: pl, colliders: [] };
  },

  cable(p) {
    const dx = p.x2 - p.x, dz = p.z2 - p.z;
    const len = Math.hypot(dx, dz);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 5), M.black());
    c.rotation.z = Math.PI / 2;
    const g = new THREE.Group();
    g.add(c);
    g.position.set((p.x + p.x2) / 2, 0.035, (p.z + p.z2) / 2);
    g.rotation.y = -Math.atan2(dz, dx);
    return { obj: g, colliders: [] };
  },

  debris(p) {
    const g = new THREE.Group();
    const parts = [[0.9, 0.08, 1.8, 0.4, 0.2, 0, 0.3, 0.2], [1.2, 0.06, 0.7, 0.2, 0.5, 0.4, -0.6, 0.5], [0.3, 1.4, 0.3, -0.5, 0.6, -0.3, 0, 0.8]];
    for (const [w, h, d, x, y, z, rx, rz] of parts) {
      const m = B(w, h, d, M.metal(), x, y, z);
      m.rotation.set(rx, 0.3, rz);
      g.add(m);
    }
    const beam = B(2.2, 0.2, 0.2, M.metalRed(), 0, 1.0, 0.2);
    beam.rotation.z = 0.5;
    g.add(beam);
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [{ x0: 14, z0: 18, x1: 16, z1: 19.6 }] };
  },

  body(p) {
    const rig = buildHollow(1);
    poseHollow(rig, { state: 'dead', stateT: 5, time: 0 }, 1);
    rig.root.position.set(p.x, 0, p.z);
    rig.root.rotation.y = p.rot || 0;
    rig.shoulderL.rotation.set(-2.2, 0, 0.6);
    rig.shoulderR.rotation.set(-2.2, 0, -0.6);
    return { obj: rig.root, colliders: [] };
  },

  // Tape backup deck (the save point). A floor console against the wall: a
  // sloped deck with two reels (they spin while a backup is written), a
  // teal-white status screen and bone keys. No red anywhere on it.
  backupDeck(p) {
    const g = new THREE.Group();
    g.add(B(1.2, 0.86, 0.56, M.metalDark(), 0, 0.43, 0));
    g.add(B(1.22, 0.04, 0.58, M.metal(), 0, 0.87, 0, false));
    // upright back panel with the screen and meters
    g.add(B(1.2, 0.72, 0.14, M.metal(), 0, 1.24, -0.21));
    const screen = B(0.5, 0.25, 0.02, lam('deckReady', () => new THREE.MeshBasicMaterial({ map: Tex.deckScreen('ready') })), -0.26, 1.34, -0.13, false);
    g.add(screen);
    for (let i = 0; i < 2; i++) {
      g.add(B(0.16, 0.1, 0.02, M.black(), 0.16 + i * 0.2, 1.36, -0.13, false));
      g.add(B(0.12, 0.012, 0.022, M.emissiveTealDim(), 0.16 + i * 0.2, 1.34, -0.13, false));
    }
    const lamp = B(0.05, 0.05, 0.03, M.emissiveTeal(), 0.49, 1.5, -0.13, false);
    g.add(lamp);
    // sloped reel deck
    const deck = new THREE.Group();
    deck.position.set(0, 0.95, 0.02);
    deck.rotation.x = 0.62;
    g.add(deck);
    deck.add(B(1.16, 0.06, 0.52, M.metalDark(), 0, 0, 0));
    deck.add(B(1.18, 0.02, 0.04, M.metal(), 0, 0.03, 0.25, false));
    const reelMat = [M.metalLight(), lam('reelFace', () => new THREE.MeshLambertMaterial({ map: Tex.reel(0.7), transparent: true, alphaTest: 0.5 })), M.black()];
    const reelMat2 = [M.metalLight(), lam('reelFace2', () => new THREE.MeshLambertMaterial({ map: Tex.reel(0.25), transparent: true, alphaTest: 0.5 })), M.black()];
    const reelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.03, 18);
    const reelL = new THREE.Mesh(reelGeo, reelMat); reelL.position.set(-0.29, 0.05, -0.05);
    const reelR = new THREE.Mesh(reelGeo, reelMat2); reelR.position.set(0.29, 0.05, -0.05);
    deck.add(reelL, reelR);
    // tape path over the head block
    deck.add(B(0.22, 0.05, 0.07, M.bone(), 0, 0.05, 0.19, false));
    deck.add(B(0.62, 0.012, 0.012, lam('tape', () => new THREE.MeshLambertMaterial({ color: 0x4a3426 })), 0, 0.075, 0.13, false));
    for (let i = 0; i < 5; i++) deck.add(B(0.09, 0.03, 0.06, i === 2 ? M.bone() : M.metalDark(), -0.4 + i * 0.2, 0.04, 0.22, false));
    // stencil plate on the cabinet front
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.14), texMat('signBACKUPЗАПИСЬ', Tex.sign('BACKUP', [180, 176, 160], [28, 30, 30], 'ЗАПИСЬ')));
    plate.position.set(0, 0.62, 0.285);
    g.add(plate);
    place(g, p);
    const screenReady = screen.material;
    const screenWrite = lam('deckWrite', () => new THREE.MeshBasicMaterial({ map: Tex.deckScreen('write') }));
    return { obj: g, colliders: [footprint(p.x, p.z, 1.2, 0.6, p.r)], parts: { reelL, reelR, screen, lamp, screenReady, screenWrite } };
  },

  // Pneumatic locker (shared storage). A wall hatch fed by a tube from the
  // ceiling; the gauge needle breathes. Contents travel between lockers.
  pneumaticLocker(p) {
    const g = new THREE.Group();
    g.add(B(0.9, 1.5, 0.42, M.lockerPaint(), 0, 0.75, 0));
    g.add(B(0.94, 0.06, 0.46, M.metalDark(), 0, 1.53, 0, false));
    g.add(B(0.94, 0.08, 0.46, M.metalDark(), 0, 0.04, 0, false));
    // round hatch: bone rim, darker door, bar handle
    const ring = (r, h, mat, z) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 16), mat); m.rotation.x = Math.PI / 2; m.position.set(0, 0.86, z); m.castShadow = false; return m; };
    g.add(ring(0.31, 0.04, M.bone(), 0.22));
    const hatch = ring(0.26, 0.06, M.lockerPaintDark(), 0.235);
    g.add(hatch);
    g.add(B(0.3, 0.05, 0.05, M.bone(), 0, 0.86, 0.28, false));
    g.add(B(0.06, 0.12, 0.05, M.metalDark(), -0.29, 0.86, 0.23, false));
    // gauge with a moving needle
    const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14), [M.brass(), lam('gaugeFace', () => new THREE.MeshLambertMaterial({ map: Tex.gauge(), transparent: true, alphaTest: 0.5 })), M.black()]);
    gauge.rotation.x = Math.PI / 2; gauge.position.set(-0.28, 1.34, 0.22);
    g.add(gauge);
    const needle = new THREE.Group(); needle.position.set(-0.28, 1.34, 0.24);
    const nm = B(0.012, 0.055, 0.008, M.black(), 0, 0.025, 0, false);
    needle.add(nm); needle.rotation.z = 0.4;
    g.add(needle);
    // plate
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.105), texMat('signLOCKERХРАНЕНИЕ', Tex.sign('LOCKER', [180, 176, 160], [28, 30, 30], 'ХРАНЕНИЕ')));
    plate.position.set(0.14, 1.34, 0.212);
    g.add(plate);
    const pip = B(0.04, 0.04, 0.02, M.emissiveTeal(), 0.36, 1.2, 0.215, false);
    g.add(pip);
    // feed tube up to the ceiling and into the wall
    const tube = C(0.085, 1.1, M.metalLight(), 0.3, 2.08, -0.06, 10);
    g.add(tube);
    for (const y of [1.66, 2.3]) g.add(C(0.11, 0.05, M.metalDark(), 0.3, y, -0.06, 10));
    const bend = C(0.085, 0.3, M.metalLight(), 0.3, 2.55, -0.2, 10); bend.rotation.x = Math.PI / 2;
    g.add(bend);
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.9, 0.44, p.r)], parts: { hatch, needle, pip } };
  },

  // Sector plan terminal: a wall screen showing the sector's floor plan.
  planTerminal(p) {
    const g = new THREE.Group();
    const sec = SECTORS[p.sector] || { code: p.sector, rooms: [] };
    const rects = sec.rooms.map((k) => ({ ...ROOMS[k], here: k === p.room }));
    g.add(B(0.96, 0.8, 0.07, M.metalDark(), 0, 1.5, 0));
    g.add(B(1.0, 0.05, 0.16, M.metal(), 0, 1.92, 0.05, false));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.63), lam('plan' + p.sector + p.room, () => new THREE.MeshBasicMaterial({ map: Tex.plan(p.sector + p.room, rects, 'SECTOR ' + sec.code, 'ПЛАН') })));
    scr.position.set(0, 1.5, 0.037);
    g.add(scr);
    g.add(B(0.5, 0.05, 0.12, M.metalLight(), 0, 1.06, 0.05, false));
    for (let i = 0; i < 4; i++) g.add(B(0.07, 0.025, 0.05, M.bone(), -0.16 + i * 0.105, 1.095, 0.06, false));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.16), texMat('signPLAN' + sec.code, Tex.sign('SECTOR PLAN ' + sec.code, [180, 176, 160], [28, 30, 30], 'ПЛАН СЕКТОРА')));
    plate.position.set(0, 2.08, 0.01);
    g.add(plate);
    place(g, p);
    return { obj: g, colliders: [], parts: { screen: scr } };
  },

  bed(p) {
    const g = new THREE.Group();
    g.add(B(0.95, 0.35, 2.0, M.metalDark(), 0, 0.17, 0));
    g.add(B(0.9, 0.14, 1.95, M.fabricWhite(), 0, 0.41, 0));
    g.add(B(0.92, 0.1, 1.1, p.blanket === 'red' ? M.fabricRed() : M.fabricBlue(), 0, 0.5, 0.35));
    g.add(B(0.6, 0.1, 0.35, M.fabricWhite(), 0, 0.53, -0.7));
    g.add(B(0.95, 0.7, 0.06, M.metalDark(), 0, 0.35, -1.0));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.95, 2.0, p.r)] };
  },

  sideTable(p) {
    const g = new THREE.Group();
    g.add(B(0.6, 0.05, 0.5, M.wood(), 0, 0.58, 0));
    g.add(B(0.55, 0.55, 0.45, M.wood(), 0, 0.28, 0));
    g.add(B(0.4, 0.02, 0.02, M.metalLight(), 0, 0.42, 0.24, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.6, 0.5)] };
  },

  radio(p) {
    const g = new THREE.Group();
    g.add(B(0.42, 0.24, 0.16, M.wood(), 0, 0.12, 0));
    g.add(B(0.2, 0.16, 0.01, lam('grille', () => new THREE.MeshLambertMaterial({ color: 0x302820 })), -0.08, 0.12, 0.085, false));
    g.add(B(0.1, 0.04, 0.01, M.emissiveAmber(), 0.12, 0.16, 0.085, false));
    const ant = C(0.01, 0.4, M.metalLight(), 0.15, 0.4, -0.04);
    ant.rotation.z = -0.4;
    g.add(ant);
    place(g, p);
    return { obj: g, colliders: [] };
  },

  plant(p) {
    const g = new THREE.Group();
    g.add(C(0.2, 0.4, M.metalRed(), 0, 0.2, 0, 7));
    const R = (i) => Math.sin(p.x * 12.3 + i * 7.1);
    for (let i = 0; i < 6; i++) {
      const leaf = B(0.06, 0.6 + R(i) * 0.2, 0.18, i % 3 ? M.deadPlant() : M.plant(), 0, 0.7, 0);
      leaf.rotation.set(0.5 + R(i + 3) * 0.3, i * 1.05, 0);
      leaf.position.set(Math.sin(i * 1.05) * 0.1, 0.65, Math.cos(i * 1.05) * 0.1);
      g.add(leaf);
    }
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.4, 0.4)] };
  },

  rug(p) {
    const m = lam('rug2', () => new THREE.MeshLambertMaterial({ map: Tex.rug() }));
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.d), m);
    pl.rotation.x = -Math.PI / 2;
    pl.position.set(p.x, 0.008, p.z);
    pl.receiveShadow = true;
    return { obj: pl, colliders: [] };
  },

  transformer(p) {
    const g = new THREE.Group();
    g.add(B(1.2, 2.0, 1.2, M.metalDark(), 0, 1.0, 0));
    for (let i = 0; i < 6; i++) g.add(B(1.24, 0.05, 1.24, M.metal(), 0, 0.3 + i * 0.3, 0, false));
    g.add(B(0.5, 0.3, 0.02, M.hazard(), 0, 1.6, 0.61, false));
    g.add(C(0.12, 0.5, M.metalLight(), 0.3, 2.25, 0.3));
    g.add(C(0.12, 0.5, M.metalLight(), -0.3, 2.25, -0.3));
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [footprint(p.x, p.z, 1.2, 1.2)] };
  },

  relayPanel(p) {
    const g = new THREE.Group();
    g.add(B(2.2, 1.9, 0.4, M.metal(), 0, 0.95, 0));
    g.add(B(2.0, 0.9, 0.02, M.metalDark(), 0, 1.3, 0.21, false));
    const lamps = [];
    for (let i = 0; i < 5; i++) {
      const l = B(0.12, 0.12, 0.04, M.black(), -0.7 + i * 0.35, 1.6, 0.22, false);
      g.add(l); lamps.push(l);
    }
    const levers = [];
    for (let i = 0; i < 4; i++) {
      const lv = B(0.08, 0.35, 0.08, M.metalRed(), -0.6 + i * 0.4, 1.05, 0.28, false);
      lv.rotation.x = 0.5;
      g.add(lv); levers.push(lv);
    }
    const socket = B(0.3, 0.2, 0.05, M.black(), 0.75, 0.5, 0.21, false);
    g.add(socket);
    const fuse = C(0.06, 0.24, M.metalLight(), 0.75, 0.5, 0.26);
    fuse.rotation.z = Math.PI / 2; fuse.visible = false;
    g.add(fuse);
    g.add(B(2.2, 0.1, 0.42, M.hazard(), 0, 1.9, 0, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z + 0.1, 2.2, 0.5, p.r)], parts: { lamps, levers, fuse } };
  },

  vending(p) {
    const g = new THREE.Group();
    g.add(B(0.95, 2.0, 0.7, M.metalRed(), 0, 1.0, 0));
    g.add(B(0.6, 1.2, 0.02, lam('vendGlass', () => new THREE.MeshBasicMaterial({ color: 0x1c2a2c })), -0.1, 1.25, 0.36, false));
    for (let r = 0; r < 4; r++) g.add(B(0.56, 0.02, 0.1, M.metalLight(), -0.1, 0.8 + r * 0.28, 0.32, false));
    g.add(C(0.04, 0.08, lam('tin', () => new THREE.MeshLambertMaterial({ color: 0xd09030 })), 0.05, 1.46, 0.3));
    g.add(B(0.18, 0.4, 0.02, M.black(), 0.33, 1.3, 0.36, false));
    g.add(B(0.1, 0.06, 0.02, M.emissiveRed(), 0.33, 1.6, 0.37, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z + 0.05, 0.95, 0.7, p.r)] };
  },

  bench(p) {
    const len = p.len || 2;
    const g = new THREE.Group();
    g.add(B(len, 0.07, 0.4, M.metal(), 0, 0.45, 0));
    g.add(B(0.06, 0.42, 0.34, M.metalDark(), -len / 2 + 0.15, 0.21, 0));
    g.add(B(0.06, 0.42, 0.34, M.metalDark(), len / 2 - 0.15, 0.21, 0));
    place(g, p);
    if (p.fallen) { g.rotation.z = Math.PI / 2 * 0.9; g.rotation.order = 'YXZ'; g.position.y = 0.2; }
    return { obj: g, colliders: [footprint(p.x, p.z, len, 0.4, p.r)] };
  },

  bunk(p) {
    const g = new THREE.Group();
    for (const y of [0.4, 1.4]) {
      g.add(B(2.0, 0.12, 0.9, M.metalDark(), 0, y, 0));
      g.add(B(1.9, 0.12, 0.85, y > 1 ? M.fabricGreen() : M.fabricGrey(), 0, y + 0.12, 0));
      g.add(B(0.4, 0.08, 0.6, M.fabricWhite(), -0.7, y + 0.22, 0));
    }
    for (const x of [-0.97, 0.97]) for (const z of [-0.42, 0.42]) g.add(B(0.05, 1.8, 0.05, M.metal(), x, 0.9, z));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 2.0, 0.9, p.r)] };
  },

  table(p) {
    const g = new THREE.Group();
    g.add(B(p.w, 0.06, p.d, M.metal(), 0, 0.74, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(B(0.06, 0.72, 0.06, M.metalDark(), sx * (p.w / 2 - 0.1), 0.36, sz * (p.d / 2 - 0.1)));
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [footprint(p.x, p.z, p.w, p.d)] };
  },

  lamp(p) {
    const g = new THREE.Group();
    g.add(C(0.08, 0.03, M.metalDark(), 0, 0.015, 0));
    g.add(C(0.015, 0.35, M.metalDark(), 0, 0.2, 0));
    const shade = mesh(new THREE.ConeGeometry(0.14, 0.14, 7, 1, true), M.emissiveAmber(), 0, 0.4, 0, false);
    g.add(shade);
    g.position.set(p.x, p.y || 0, p.z);
    return { obj: g, colliders: [] };
  },

  monitorBank(p) {
    const g = new THREE.Group();
    const seeds = [1, 2, 3, 4, 5, 6];
    let k = 0;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 3; i++) {
        const x = -0.9 + i * 0.9, y = 1.1 + row * 0.55;
        g.add(B(0.8, 0.5, 0.35, M.metalDark(), x, y, -0.05));
        const lines = k === 4 ? ['CAM 07', 'OBS DECK', '1 FIGURE'] : k === 1 ? ['CAM 02', 'NO SIGNAL'] : [];
        const scr = B(0.68, 0.4, 0.01, screenMat(lines, k === 4 ? [255, 90, 80] : [120, 255, 160], seeds[k]), x, y, 0.13, false);
        g.add(scr);
        k++;
      }
    }
    place(g, p);
    return { obj: g, colliders: [] };
  },

  cabinet(p) {
    const g = new THREE.Group();
    const body = p.white ? M.metalLight() : M.metal();
    g.add(B(0.9, 1.6, 0.45, body, 0, 0.8, 0));
    for (let i = 0; i < 3; i++) {
      g.add(B(0.84, 0.46, 0.02, p.white ? M.fabricWhite() : M.metalDark(), 0, 0.3 + i * 0.5, 0.23, false));
      g.add(B(0.2, 0.03, 0.03, M.metalLight(), 0, 0.45 + i * 0.5, 0.25, false));
    }
    if (p.white) g.add(B(0.2, 0.2, 0.01, M.emissiveRed(), 0, 1.45, 0.24, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.9, 0.45, p.r)] };
  },

  rack(p) {
    const g = new THREE.Group();
    g.add(B(1.4, 1.5, 0.2, M.metalDark(), 0, 1.0, -0.05));
    for (let i = 0; i < 4; i++) g.add(B(0.05, 0.9, 0.12, M.metal(), -0.5 + i * 0.33, 1.0, 0.08));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 1.4, 0.3, p.r)] };
  },

  counter(p) {
    const len = p.len || 3;
    const g = new THREE.Group();
    g.add(B(len, 1.0, 0.7, M.metal(), 0, 0.5, 0));
    g.add(B(len + 0.05, 0.06, 0.8, M.metalLight(), 0, 1.02, 0));
    // pyramid of tins
    const tin = lam('tin', () => new THREE.MeshLambertMaterial({ color: 0xd09030 }));
    let n = 0;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 3 - row; i++) {
      g.add(C(0.06, 0.12, tin, -0.5 + i * 0.13 + row * 0.065, 1.11 + row * 0.12, 0, 7)); n++;
    }
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, len, 0.7, p.r)] };
  },

  tray(p) {
    const g = new THREE.Group();
    g.add(B(0.4, 0.03, 0.3, M.metalLight(), 0, 0.79, 0, false));
    g.add(C(0.05, 0.08, lam('tin', () => new THREE.MeshLambertMaterial({ color: 0xd09030 })), 0.1, 0.84, 0, 6));
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.x;
    return { obj: g, colliders: [] };
  },

  medBed(p) {
    const g = new THREE.Group();
    g.add(B(0.9, 0.08, 1.9, M.metalLight(), 0, 0.7, 0));
    g.add(B(0.85, 0.1, 1.8, M.fabricWhite(), 0, 0.78, 0));
    for (const x of [-0.4, 0.4]) for (const z of [-0.85, 0.85]) g.add(B(0.04, 0.7, 0.04, M.metal(), x, 0.35, z));
    g.add(B(0.95, 0.05, 0.08, M.black(), 0, 0.85, -0.2, false));
    g.add(B(0.95, 0.05, 0.08, M.black(), 0, 0.85, 0.5, false));
    // IV stand
    g.add(C(0.02, 1.8, M.metal(), 0.55, 0.9, -0.8));
    g.add(B(0.12, 0.2, 0.06, lam('iv', () => new THREE.MeshBasicMaterial({ color: 0x6a1a1a })), 0.55, 1.7, -0.8, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.9, 1.9, p.r)] };
  },

  curtain(p) {
    const g = new THREE.Group();
    const m = lam('curtain', () => new THREE.MeshLambertMaterial({ color: 0x6a8a86, side: THREE.DoubleSide, flatShading: true }));
    const n = 8;
    for (let i = 0; i < n; i++) {
      const pl = mesh(new THREE.PlaneGeometry(p.len / n + 0.02, 1.7), m, -p.len / 2 + (i + 0.5) * p.len / n, 1.05, (i % 2) * 0.06, true);
      pl.rotation.y = (i % 2 ? 0.4 : -0.4);
      g.add(pl);
    }
    g.add(B(p.len, 0.03, 0.03, M.metal(), 0, 1.95, 0, false));
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [] };
  },

  telescope(p) {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const leg = C(0.02, 1.2, M.metalDark(), Math.sin(i * 2.1) * 0.25, 0.55, Math.cos(i * 2.1) * 0.25, 5);
      leg.rotation.set(Math.cos(i * 2.1) * 0.35, 0, -Math.sin(i * 2.1) * 0.35);
      g.add(leg);
    }
    const tube = C(0.09, 1.1, M.metalLight(), 0, 1.25, -0.2, 8);
    tube.rotation.x = 1.0;
    g.add(tube);
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [footprint(p.x, p.z, 0.6, 0.6)] };
  },

  rail(p) {
    const g = new THREE.Group();
    g.add(B(p.len, 0.05, 0.05, M.metalLight(), p.len / 2, 1.0, 0, false));
    for (let i = 0.5; i < p.len; i += 1.5) g.add(B(0.04, 1.0, 0.04, M.metal(), i, 0.5, 0, false));
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [{ x0: p.x, z0: p.z - 0.1, x1: p.x + p.len, z1: p.z + 0.1 }] };
  },

  shelf(p) {
    const len = p.len || 3;
    const g = new THREE.Group();
    const books = lam('books' + (Math.floor(p.x + p.z) % 4), () => new THREE.MeshLambertMaterial({ map: Tex.books(Math.floor(p.x + p.z) % 4) }));
    books.map.wrapS = THREE.RepeatWrapping;
    g.add(B(len, 2.1, 0.5, M.wood(), 0, 1.05, 0));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.1, 1.9), books);
    face.position.set(0, 1.05, 0.26);
    g.add(face);
    const back = face.clone(); back.rotation.y = Math.PI; back.position.z = -0.26;
    g.add(back);
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z, len, 0.5, p.r)] };
  },

  bookPile(p) {
    const g = new THREE.Group();
    const cols = [0x6a2020, 0x2a3a44, 0x5a5040, 0x304a30];
    for (let i = 0; i < 5; i++) {
      const b = B(0.35, 0.07, 0.25, lam('book' + i % 4, () => new THREE.MeshLambertMaterial({ color: cols[i % 4] })), 0, 0.035 + i * 0.07, 0, false);
      b.rotation.y = Math.sin(i * 2.7 + p.x) * 0.5;
      g.add(b);
    }
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [] };
  },

  commsConsole(p) {
    const g = new THREE.Group();
    g.add(B(3.2, 0.9, 0.9, M.metalDark(), 0, 0.45, 0.1));
    const deck = B(3.2, 0.08, 0.7, M.metal(), 0, 0.95, 0.25);
    deck.rotation.x = 0.35;
    g.add(deck);
    g.add(B(3.4, 2.2, 0.3, M.metal(), 0, 1.6, -0.35));
    const big = B(1.6, 0.9, 0.02, lam('commsScreen', () => new THREE.MeshBasicMaterial({ map: Tex.screen(['BEACON: LOOP', 'SRC: OSTROV.M', 'CYCLE 10002'], [255, 70, 60], 12) })), 0, 1.75, -0.19, false);
    g.add(big);
    for (const x of [-1.3, 1.3]) g.add(B(0.6, 0.6, 0.02, screenMat([], [255, 70, 60], x > 0 ? 13 : 14), x, 1.6, -0.19, false));
    for (let i = 0; i < 10; i++) g.add(B(0.12, 0.03, 0.1, i % 3 ? M.black() : M.emissiveRed(), -1.2 + i * 0.27, 1.02, 0.3, false));
    place(g, p);
    return { obj: g, colliders: [footprint(p.x, p.z + 0.1, 3.4, 1.1, p.r)], parts: { screen: big } };
  },

  antennaCore(p) {
    const g = new THREE.Group();
    g.add(C(0.7, 0.3, M.metalDark(), 0, 0.15, 0, 10));
    g.add(C(0.45, 2.4, M.metal(), 0, 1.4, 0, 10));
    for (let i = 0; i < 5; i++) g.add(C(0.5, 0.06, M.metalRed(), 0, 0.6 + i * 0.45, 0, 10));
    const glow = C(0.2, 0.3, M.emissiveRed(), 0, 2.7, 0, 8);
    g.add(glow);
    g.position.set(p.x, 0, p.z);
    return { obj: g, colliders: [footprint(p.x, p.z, 1.3, 1.3)], parts: { glow } };
  },
};

BUILDERS.saveTerminal = BUILDERS.backupDeck;
BUILDERS.trunk = BUILDERS.pneumaticLocker;

export function buildProp(p) {
  const b = BUILDERS[p.t];
  if (!b) { console.warn('unknown prop', p.t); return { obj: new THREE.Group(), colliders: [] }; }
  return b(p);
}
