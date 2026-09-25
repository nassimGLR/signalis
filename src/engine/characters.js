// Low-poly articulated humanoids built from boxes, with procedural animation.
// Rig hierarchy: root → hips → (torso → chest → neck/head, shoulders → elbows)
//                            → (thighs → knees → feet)
import * as THREE from 'three';
import { psx } from './renderer.js';
import { Tex } from './textures.js';

function mat(color, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  return psx(m);
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function pivot(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Custodian unit "WREN-3": charcoal work coverall, bone shoulder panels, red
// armband, chin-length silver hair with a side part.
export function buildCustodian() {
  const suit = mat(0x3a3f44);
  const suitDark = mat(0x24282c);
  const panel = mat(0xc9c2b0);
  const skin = mat(0xd8cfc6);
  const hair = mat(0x9ca2aa);
  const hairDark = mat(0x747a82);
  const band = mat(0xa0181e);
  const boots = mat(0x141516);
  const eye = new THREE.MeshBasicMaterial({ color: 0x9fe8ff });
  const belt = mat(0x5a4a38);

  const rig = { root: new THREE.Group() };
  const { root } = rig;
  rig.hips = pivot(root, 0, 0.92, 0);
  rig.hips.add(box(0.36, 0.16, 0.22, suitDark, 0, 0, 0));
  rig.hips.add(box(0.38, 0.05, 0.24, belt, 0, 0.07, 0));

  rig.torso = pivot(rig.hips, 0, 0.08, 0);
  rig.torso.add(box(0.34, 0.26, 0.2, suit, 0, 0.13, 0));
  rig.chest = pivot(rig.torso, 0, 0.26, 0);
  rig.chest.add(box(0.4, 0.26, 0.23, suit, 0, 0.1, 0));
  rig.chest.add(box(0.42, 0.07, 0.25, panel, 0, 0.22, 0));   // shoulder yoke
  rig.chest.add(box(0.1, 0.12, 0.02, panel, -0.1, 0.08, 0.12)); // chest pocket
  rig.chest.add(box(0.03, 0.2, 0.02, suitDark, 0.03, 0.06, 0.118)); // zip

  rig.neck = pivot(rig.chest, 0, 0.26, 0);
  rig.neck.add(box(0.1, 0.08, 0.1, skin, 0, 0.03, 0));
  rig.neck.add(box(0.2, 0.05, 0.18, suit, 0, -0.01, 0)); // collar
  rig.head = pivot(rig.neck, 0, 0.08, 0);
  rig.head.add(box(0.2, 0.24, 0.22, skin, 0, 0.12, 0));
  // eyes
  rig.head.add(box(0.045, 0.025, 0.01, eye, -0.05, 0.13, 0.112));
  rig.head.add(box(0.045, 0.025, 0.01, eye, 0.05, 0.13, 0.112));
  // hair: cap, fringe swept to one side, chin-length sides and back
  rig.head.add(box(0.24, 0.07, 0.25, hair, 0, 0.255, -0.005));
  rig.head.add(box(0.15, 0.06, 0.04, hair, 0.035, 0.205, 0.115));
  rig.head.add(box(0.07, 0.04, 0.04, hairDark, -0.08, 0.215, 0.115));
  rig.head.add(box(0.04, 0.2, 0.22, hair, -0.12, 0.12, -0.01));
  rig.head.add(box(0.04, 0.2, 0.22, hair, 0.12, 0.12, -0.01));
  rig.head.add(box(0.24, 0.22, 0.05, hairDark, 0, 0.13, -0.12));

  const arm = (side) => {
    const s = pivot(rig.chest, side * 0.25, 0.19, 0);
    s.add(box(0.12, 0.08, 0.14, panel, 0, 0.0, 0));
    s.add(box(0.1, 0.28, 0.11, suit, 0, -0.15, 0));
    if (side < 0) s.add(box(0.108, 0.07, 0.118, band, 0, -0.12, 0));
    const e = pivot(s, 0, -0.29, 0);
    e.add(box(0.09, 0.26, 0.1, suit, 0, -0.12, 0));
    e.add(box(0.08, 0.08, 0.09, skin, 0, -0.29, 0));
    return [s, e];
  };
  [rig.shoulderL, rig.elbowL] = arm(-1);
  [rig.shoulderR, rig.elbowR] = arm(1);

  const leg = (side) => {
    const t = pivot(rig.hips, side * 0.1, -0.04, 0);
    t.add(box(0.14, 0.42, 0.15, suit, 0, -0.2, 0));
    const k = pivot(t, 0, -0.42, 0);
    k.add(box(0.12, 0.36, 0.13, suit, 0, -0.17, 0));
    k.add(box(0.13, 0.14, 0.14, boots, 0, -0.33, 0));
    const f = pivot(k, 0, -0.42, 0);
    f.add(box(0.12, 0.07, 0.22, boots, 0, 0.0, 0.04));
    return [t, k, f];
  };
  [rig.thighL, rig.kneeL, rig.footL] = leg(-1);
  [rig.thighR, rig.kneeR, rig.footR] = leg(1);

  // sidearm (hidden until equipped)
  const gunMat = mat(0x1d1f22);
  rig.gun = new THREE.Group();
  rig.gun.add(box(0.05, 0.08, 0.2, gunMat, 0, -0.04, 0.06));
  rig.gun.add(box(0.045, 0.1, 0.05, gunMat, 0, -0.1, -0.01));
  rig.gun.position.set(0, -0.3, 0.03);
  rig.elbowR.add(rig.gun);
  rig.gun.visible = false;
  rig.muzzle = new THREE.Object3D();
  rig.muzzle.position.set(0, -0.04, 0.17);
  rig.gun.add(rig.muzzle);

  rig.eyeLight = eye;
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  return rig;
}

// Corrupted custodians — "Hollows". Same chassis, scorched and wrong.
export function buildHollow(variant = 0) {
  const tones = [0x2c2a2a, 0x33302c, 0x2a2e30];
  const suit = mat(tones[variant % 3]);
  const torn = mat(0x1a1818);
  const skin = mat(0x8a7f78);
  const rot = mat(0x4a1c1e);
  const glow = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  const hair = mat(variant === 1 ? 0x2a2420 : 0x6a6660);

  const rig = { root: new THREE.Group() };
  const { root } = rig;
  rig.hips = pivot(root, 0, 0.9, 0);
  rig.hips.add(box(0.36, 0.16, 0.22, torn));
  rig.torso = pivot(rig.hips, 0, 0.08, 0);
  rig.torso.add(box(0.34, 0.26, 0.2, suit, 0, 0.13, 0));
  rig.chest = pivot(rig.torso, 0, 0.26, 0);
  rig.chest.add(box(0.4, 0.27, 0.23, suit, 0, 0.1, 0));
  rig.chest.add(box(0.16, 0.14, 0.03, rot, 0.06, 0.06, 0.115)); // wound
  rig.chest.add(box(0.05, 0.05, 0.02, glow, 0.07, 0.07, 0.13));  // core breach
  rig.neck = pivot(rig.chest, 0, 0.26, 0);
  rig.neck.add(box(0.1, 0.08, 0.1, skin, 0, 0.03, 0));
  rig.head = pivot(rig.neck, 0, 0.08, 0);
  rig.head.add(box(0.2, 0.24, 0.22, skin, 0, 0.12, 0));
  rig.head.add(box(0.21, 0.09, 0.08, rot, 0.02, 0.18, 0.08)); // cracked face plate
  rig.head.add(box(0.05, 0.03, 0.01, glow, -0.05, 0.13, 0.115));
  rig.head.add(box(0.24, 0.08, 0.24, hair, 0, 0.26, -0.01));
  rig.head.add(box(0.24, 0.2, 0.05, hair, 0, 0.13, -0.12));

  const arm = (side) => {
    const s = pivot(rig.chest, side * 0.25, 0.19, 0);
    s.add(box(0.1, 0.3, 0.11, suit, 0, -0.15, 0));
    const e = pivot(s, 0, -0.29, 0);
    e.add(box(0.09, 0.27, 0.1, side > 0 ? torn : suit, 0, -0.12, 0));
    e.add(box(0.09, 0.1, 0.09, skin, 0, -0.3, 0));
    return [s, e];
  };
  [rig.shoulderL, rig.elbowL] = arm(-1);
  [rig.shoulderR, rig.elbowR] = arm(1);
  const leg = (side) => {
    const t = pivot(rig.hips, side * 0.1, -0.04, 0);
    t.add(box(0.14, 0.42, 0.15, suit, 0, -0.2, 0));
    const k = pivot(t, 0, -0.42, 0);
    k.add(box(0.12, 0.36, 0.13, torn, 0, -0.17, 0));
    const f = pivot(k, 0, -0.42, 0);
    f.add(box(0.12, 0.07, 0.22, torn, 0, 0.0, 0.04));
    return [t, k, f];
  };
  [rig.thighL, rig.kneeL, rig.footL] = leg(-1);
  [rig.thighR, rig.kneeR, rig.footR] = leg(1);
  rig.glow = glow;
  return rig;
}

const lerp = (a, b, t) => a + (b - a) * t;

function setRot(o, x = 0, y = 0, z = 0, k = 1) {
  o.rotation.x = lerp(o.rotation.x, x, k);
  o.rotation.y = lerp(o.rotation.y, y, k);
  o.rotation.z = lerp(o.rotation.z, z, k);
}

// Pose driver for the custodian. `s` = { speed, phase, aiming, aimPitch, hurt,
// dead, deadT, limp, time, reload }
export function poseCustodian(rig, s, dt) {
  const k = Math.min(1, dt * 14);
  const t = s.time;
  const ph = s.phase;
  const walk = Math.min(1, s.speed / 2.2);
  const run = Math.max(0, Math.min(1, (s.speed - 2.4) / 1.6));

  if (s.dead) {
    const d = Math.min(1, s.deadT * 1.6);
    rig.hips.position.y = lerp(0.92, 0.14, d);
    setRot(rig.hips, -Math.PI / 2 * d, 0, 0.2 * d, 1);
    setRot(rig.head, 0.3 * d, 0.4 * d, 0, k);
    setRot(rig.shoulderL, -0.3 * d, 0, 0.9 * d, k);
    setRot(rig.shoulderR, -1.2 * d, 0, -0.4 * d, k);
    setRot(rig.thighL, 0.2 * d, 0, 0, k); setRot(rig.thighR, -0.1 * d, 0, 0, k);
    setRot(rig.kneeL, 0.3 * d, 0, 0, k); setRot(rig.kneeR, 0.1 * d, 0, 0, k);
    return;
  }

  const limp = s.limp ? 1 : 0;
  const swing = Math.sin(ph) * (0.55 * walk + 0.25 * run);
  const bob = Math.abs(Math.cos(ph)) * (0.035 * walk + 0.03 * run);
  const breathe = Math.sin(t * 1.8) * 0.012;

  rig.hips.position.y = 0.92 - bob * (1 + limp) + breathe * 0.3 - limp * Math.max(0, Math.sin(ph)) * 0.04;
  setRot(rig.hips, 0, Math.sin(ph) * 0.12 * walk, limp * 0.06, k);
  setRot(rig.torso, 0.06 * walk + 0.12 * run + limp * 0.1, -Math.sin(ph) * 0.18 * walk, 0, k);
  setRot(rig.chest, breathe, 0, 0, k);

  setRot(rig.thighL, swing, 0, 0, k);
  setRot(rig.thighR, -swing * (1 - limp * 0.4), 0, 0, k);
  setRot(rig.kneeL, Math.max(0, -Math.sin(ph - 1.2)) * (0.8 * walk + 0.5 * run), 0, 0, k);
  setRot(rig.kneeR, Math.max(0, -Math.sin(ph + Math.PI - 1.2)) * (0.8 * walk + 0.5 * run) * (1 - limp * 0.5), 0, 0, k);
  setRot(rig.footL, 0, 0, 0, k); setRot(rig.footR, 0, 0, 0, k);

  if (s.aiming) {
    const p = s.aimPitch || 0;
    setRot(rig.shoulderR, -Math.PI / 2 + p, 0.12, 0, k);
    setRot(rig.elbowR, 0, 0, 0, k);
    setRot(rig.shoulderL, -Math.PI / 2 + 0.15 + p, -0.55, 0, k);
    setRot(rig.elbowL, -0.35, 0, 0, k);
    setRot(rig.torso, 0.02, 0.18, 0, k);
    setRot(rig.head, -0.05, -0.12, 0, k);
    if (s.recoil) rig.shoulderR.rotation.x -= s.recoil * 0.5;
  } else if (s.reload > 0) {
    setRot(rig.shoulderR, -0.9, 0.2, 0, k);
    setRot(rig.elbowR, -0.9, 0, 0, k);
    setRot(rig.shoulderL, -0.8, -0.3, 0, k);
    setRot(rig.elbowL, -1.0 + Math.sin(t * 14) * 0.2, 0, 0, k);
    setRot(rig.head, 0.35, 0, 0, k);
  } else {
    setRot(rig.shoulderL, -swing * 0.8, 0, 0.06, k);
    setRot(rig.shoulderR, swing * 0.8 * (1 - limp * 0.6), 0, -0.06 - limp * 0.1, k);
    setRot(rig.elbowL, -0.15 - 0.4 * run, 0, 0, k);
    setRot(rig.elbowR, -0.15 - 0.4 * run, 0, 0, k);
    setRot(rig.head, limp * 0.15 + Math.sin(t * 0.7) * 0.02, Math.sin(t * 0.4) * 0.05 * (1 - walk), 0, k);
  }
  if (s.hurt > 0) {
    rig.torso.rotation.x -= s.hurt * 0.5;
    rig.head.rotation.x -= s.hurt * 0.4;
  }
}

// Hollow pose: jerky, uneven, head lolling, one arm dragging.
export function poseHollow(rig, s, dt) {
  const k = Math.min(1, dt * 10);
  const t = s.time;
  const jitter = (f) => (Math.sin(t * f * 7.1) * Math.sin(t * f * 3.3 + 1.7)) ;
  const twitch = s.twitch || 0;

  if (s.state === 'down' || s.state === 'dead') {
    const d = Math.min(1, s.stateT * 1.8);
    rig.hips.position.y = lerp(rig.hips.position.y, 0.14, d);
    setRot(rig.hips, -Math.PI / 2 * d, 0, -0.3 * d, k);
    setRot(rig.head, 0.5, 0.6, 0, k);
    setRot(rig.shoulderL, -2.6 * d, 0, 0.4, k);
    setRot(rig.shoulderR, -0.4, 0, -0.9 * d, k);
    setRot(rig.thighL, 0.3 * d, 0, 0, k); setRot(rig.kneeL, 0.6 * d, 0, 0, k);
    setRot(rig.thighR, -0.2, 0, 0, k); setRot(rig.kneeR, 0.2, 0, 0, k);
    if (s.state === 'down' && twitch > 0) rig.shoulderL.rotation.z += jitter(3) * 0.2 * twitch;
    return;
  }
  if (s.state === 'dormant') {
    // slumped against the wall, knees up
    rig.hips.position.y = 0.2;
    setRot(rig.hips, 0, 0, 0, 1);
    setRot(rig.torso, -0.35, 0, 0.1, k);
    setRot(rig.chest, 0.3, 0, 0, k);
    setRot(rig.head, 0.7 + jitter(0.4) * 0.05 * twitch, 0.4, 0.2, k);
    setRot(rig.thighL, -1.3, 0.2, 0, k); setRot(rig.kneeL, 1.6, 0, 0, k);
    setRot(rig.thighR, -1.1, -0.3, 0, k); setRot(rig.kneeR, 1.2, 0, 0, k);
    setRot(rig.shoulderL, 0.2, 0, 0.3, k); setRot(rig.elbowL, -0.6, 0, 0, k);
    setRot(rig.shoulderR, 0.1, 0, -0.2, k); setRot(rig.elbowR, -0.2, 0, 0, k);
    return;
  }
  if (s.state === 'rising') {
    const r = Math.min(1, s.stateT / 1.6);
    const e = r * r * (3 - 2 * r);
    rig.hips.position.y = lerp(0.2, 0.9, e);
    setRot(rig.hips, 0, 0, 0, 1);
    setRot(rig.torso, lerp(-0.35, 0.5, Math.sin(e * Math.PI)) , 0, 0, k);
    setRot(rig.head, lerp(0.7, 0.2, e) + jitter(2) * 0.3, jitter(1.3) * 0.5, 0, 1);
    setRot(rig.thighL, lerp(-1.3, 0, e), 0, 0, k); setRot(rig.kneeL, lerp(1.6, 0.1, e), 0, 0, k);
    setRot(rig.thighR, lerp(-1.1, 0, e), 0, 0, k); setRot(rig.kneeR, lerp(1.2, 0.1, e), 0, 0, k);
    setRot(rig.shoulderL, -0.4 * e, 0, 0.3, k); setRot(rig.shoulderR, 0.2, 0, -0.2, k);
    return;
  }

  const walk = Math.min(1, s.speed / 1.4);
  const ph = s.phase;
  const swing = Math.sin(ph) * 0.45 * walk;
  rig.hips.position.y = 0.88 - Math.abs(Math.cos(ph)) * 0.05 * walk;
  setRot(rig.hips, 0, 0, Math.sin(ph) * 0.12 * walk, k);
  setRot(rig.torso, 0.35 + jitter(0.5) * 0.05, 0, 0.15, k);
  setRot(rig.chest, 0.1, 0, 0, k);
  // head lolls and snaps
  const snap = Math.sin(t * 2.3) > 0.93 ? jitter(3) * 0.8 : 0;
  setRot(rig.head, 0.45 + snap * 0.3, 0.3 + snap, 0.5 + jitter(0.7) * 0.2, snap ? 1 : k);
  setRot(rig.thighL, swing, 0, 0, k);
  setRot(rig.thighR, -swing * 0.6, 0.1, 0, k);
  setRot(rig.kneeL, Math.max(0, -Math.sin(ph - 1.2)) * 0.7 * walk, 0, 0, k);
  setRot(rig.kneeR, 0.2 + Math.max(0, -Math.sin(ph + 2)) * 0.4 * walk, 0, 0, k);

  if (s.state === 'attack') {
    const a = s.attackPhase; // 0..1 windup, 1..2 strike, 2..3 recover
    const up = a < 1 ? a : a < 1.3 ? 1 - (a - 1) / 0.3 * 1.6 : -0.6 + (a - 1.3) * 0.35;
    setRot(rig.shoulderL, -1.5 - up * 1.3, -0.3, 0.2, 1);
    setRot(rig.shoulderR, -1.5 - up * 1.1, 0.3, -0.2, 1);
    setRot(rig.elbowL, -0.3, 0, 0, k); setRot(rig.elbowR, -0.3, 0, 0, k);
    setRot(rig.torso, 0.35 - up * 0.3, 0, 0, 1);
  } else {
    // one arm reaching, one arm dragging
    setRot(rig.shoulderL, -1.1 + jitter(0.9) * 0.15, -0.1, 0.1, k);
    setRot(rig.elbowL, -0.2, 0, 0, k);
    setRot(rig.shoulderR, 0.2 + swing * 0.3, 0, -0.25, k);
    setRot(rig.elbowR, -0.05, 0, 0, k);
  }
  if (s.hurt > 0) {
    rig.torso.rotation.x -= s.hurt * 0.9;
    rig.head.rotation.x -= s.hurt * 0.6;
    rig.head.rotation.z += s.hurt * 0.4;
  }
}

// Wireframe copy of a rig for the inventory status monitor.
export function wireframeClone(rig, color = 0xff3030) {
  const g = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({ color });
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((o) => {
    if (o.isMesh && o.geometry.type === 'BoxGeometry') {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), lineMat);
      e.matrixAutoUpdate = false;
      e.matrix.copy(o.matrixWorld);
      g.add(e);
    }
  });
  return g;
}

export { mat, box };
export const planetTex = () => Tex.planet();
