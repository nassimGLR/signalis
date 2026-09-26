// Mouse-first controls for WREN-3 (plan §6): hold to walk toward the pointer,
// click the floor to go there, click a thing to walk up and use it; RMB to
// ready and LMB to fire with a focus box; F / E / pad A to interact. WASD and
// the pad stay full equivalents.
//
// The game calls, per frame while playing:
//   begin() → update(dt, weapon) → [player/world update] → interactStep()
//   → [camera] → lateUpdate(dt)
// and paused(dt) on frames where the game is paused.
import * as THREE from 'three';
import { Nav, doorFace } from './nav.js';
import { PLAYER_R } from './player.js';
import { Cursor } from '../ui/cursor.js';
import { audio } from '../engine/audio.js';

const HOLD_MS = 220;          // press longer than this = hold-walk
const SLOW_CLICK_MS = 450;    // …but released within this, on the spot, it was a click
const CLICK_PX = 8;
const HOLD_DEADZONE = 0.45;   // m: pointer this close to Wren = stand
const ARRIVE_EPS = 0.18;      // m: waypoint reached
const FINAL_EPS = 0.08;       // m: destination reached
const HOVER_PX = 42;          // at 720 px tall
const LOCK_PX = 60;
const REST_MS = 250;          // pointer still this long → Wren turns to it
const RUN_FAR = 4.5;
const REACH_PAD = 0.35;       // reach = r + this (as findInteractable always had)
const DEFAULTS = {
  movement: 'mouse', aimCursor: 'always', faceCursor: true, runFar: false, showPath: false,
  sprint: 'hold', aimMode: 'hold', swapAim: false, autoReload: false, reduceFlash: false,
};
const BONE = 0xe8e2d4;

// Camera (used by game.updateCamera): pitch and FOV in degrees, distances in metres.
export const CAM = { pitch: 62, fov: 24, dist: 17.5, lookY: 0.6, margin: 1.0 };
// Bracket verbs for fixtures (anything not listed reads EXAMINE).
export const FIXTURE_VERB = {
  save: 'RECORD', box: 'OPEN', relay: 'OPERATE', console: 'OPERATE', breaker: 'OPERATE',
  locker_pistol: 'OPEN', locker_keycard: 'OPEN', cabinet_fuse: 'OPEN', memory_window: 'LOOK',
};

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));


export class Controls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.cursor = new Cursor(game.input);
    this.cursor.source = () => this.cursorState();
    this.world = null;
    this.nav = null;
    this.scene = null;
    this.lastT = -1;
    this.lastHp = null;
    this.runToggle = false;
    this.aimToggle = false;
    this.cursorActive = false;   // the mouse moved since the last key/stick movement
    this.cands = [];
    this.hover = null;
    this.kbTarget = null;
    this.aim = { active: false, lock: null, focus: 0, los: true, mouse: false, ticked: false, releaseT: -1e9, stickHeld: false };
    this.markerT = 0;
    this.gameState = { mode: 'game', kind: 'idle', label: '', brackets: [], focus: null, readout: null, pointer: true };
    this.ray = new THREE.Raycaster();
    this.v2 = new THREE.Vector2();
    this.v3 = new THREE.Vector3();
    this.v3b = new THREE.Vector3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.reset();
  }

  get settings() { return { ...DEFAULTS, ...(this.game.ui.settings || {}) }; }

  // Clear any walk, hold, pending use and marks (level load, teleport).
  reset() {
    this.mode = 'idle';
    this.path = [];
    this.dest = null;
    this.pending = null;
    this.act = null;
    this.runPath = false;
    this.press = null;
    this.doorWait = null;
    this.stuck = null;
    this.hover = null;
    this.ownScript = false;
    this.markerT = 0;
    if (this.marker) this.marker.visible = false;
    if (this.pathLine) this.pathLine.visible = false;
  }

  cancel(flash = false) {
    this.mode = 'idle';
    this.path = [];
    this.pending = null;
    this.act = null;
    this.doorWait = null;
    this.stuck = null;
    this.dest = null;
    if (flash) this.cursor.flashNo();
  }

  // ------------------------------------------------------------------ level
  attach() {
    const G = this.game;
    if (this.world === G.world && this.scene === G.scene) return;
    this.world = G.world;
    this.scene = G.scene;
    this.nav = new Nav(G.world, { agentR: PLAYER_R });
    // destination marker: a floor square with a small cross, bone white
    const s = 0.25, c = 0.07;
    const pts = [
      -s, 0, -s, s, 0, -s, s, 0, -s, s, 0, s, s, 0, s, -s, 0, s, -s, 0, s, -s, 0, -s,
      -c, 0, 0, c, 0, 0, 0, 0, -c, 0, 0, c,
    ];
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.marker = new THREE.LineSegments(mg, new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.marker.position.y = 0.02;
    this.marker.renderOrder = 6;
    this.marker.visible = false;
    this.marker.frustumCulled = false;
    this.scene.add(this.marker);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(64 * 3), 3));
    this.pathLine = new THREE.Line(pg, new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 0.35, depthWrite: false, fog: false }));
    this.pathLine.frustumCulled = false;
    this.pathLine.visible = false;
    this.pathLine.renderOrder = 5;
    this.scene.add(this.pathLine);
    this.reset();
    this.lastHp = null;
    // warm the search up at level load so the first click isn't a JIT outlier
    const P = G.player;
    if (P) {
      for (const [dx, dz] of [[4, 0], [-4, 3], [0, -6]]) this.nav.find(P.pos, { x: P.pos.x + dx, z: P.pos.z + dz });
      this.nav.stats.maxMs = 0; this.nav.stats.queries = 0;
    }
  }

  // ------------------------------------------------------------------ picking
  canvasRect() { return this.input.canvasRect(); }

  // World → CSS px (viewport), accounting for a letterboxed canvas.
  worldToScreen(x, y, z, out = { x: 0, y: 0, behind: false }) {
    const r = this.canvasRect();
    const v = this.v3.set(x, y, z).project(this.game.camera);
    out.x = r.left + (v.x + 1) / 2 * r.width;
    out.y = r.top + (1 - v.y) / 2 * r.height;
    out.behind = v.z > 1;
    return out;
  }

  // Screen pixels per metre at a world point (for sizing brackets).
  pxPerMetre(x, y, z) {
    const cam = this.game.camera;
    const d = this.v3b.set(x, y, z).distanceTo(cam.position);
    const r = this.canvasRect();
    return (r.height / 2) / (d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
  }

  rayAt(nx, ny) {
    this.v2.set(nx, ny);
    this.ray.setFromCamera(this.v2, this.game.camera);
    return this.ray.ray;
  }

  // Pointer ∩ horizontal plane y = h.
  groundAt(h = 0) {
    const m = this.input.mouse;
    const ray = this.rayAt(m.nx, m.ny);
    this.plane.constant = -h;
    const hit = new THREE.Vector3();
    return ray.intersectPlane(this.plane, hit) ? hit : null;
  }

  // First walkable floor point along the pointer ray: walks the ray down from
  // wall height so a click on a wall face or a desk top lands at its foot.
  pickFloor() {
    const w = this.world;
    const m = this.input.mouse;
    const ray = this.rayAt(m.nx, m.ny);
    const hit = new THREE.Vector3();
    for (let h = 2.6; h >= -0.001; h -= 0.1) {
      this.plane.constant = -Math.max(0, h);
      if (!ray.intersectPlane(this.plane, hit)) continue;
      if (this.floorOk(hit.x, hit.z)) {
        // keep descending while it stays walkable, to land where the ray meets the floor
        let best = hit.clone();
        for (let h2 = h - 0.1; h2 >= -0.001; h2 -= 0.1) {
          this.plane.constant = -Math.max(0, h2);
          if (!ray.intersectPlane(this.plane, hit) || !this.floorOk(hit.x, hit.z)) break;
          best = hit.clone();
        }
        best.y = 0;
        return best;
      }
    }
    void w;
    return null;
  }

  floorOk(x, z) {
    const w = this.world;
    const vis = w.visible;
    const r = w.roomAt(x, z);
    if (r) return !vis || vis.has(r);
    const d = w.doorAt(x, z);
    return !!(d && d.open && (!vis || vis.has(d.a) || vis.has(d.b)));
  }

  // Nearest candidate to the pointer within HOVER_PX (bracket box counts as 0).
  pickHover() {
    const m = this.input.mouse;
    const r = this.canvasRect();
    const k = r.height / 720;
    let best = null, bestD = HOVER_PX * k, bestW = Infinity;
    const P = this.game.player;
    const p = { x: 0, y: 0, behind: false };
    for (const c of this.cands) {
      this.worldToScreen(c.x, c.y, c.z, p);
      if (p.behind) continue;
      const half = Math.max(7, (c.size || 0.5) * this.pxPerMetre(c.x, c.y, c.z) / 2);
      const dx = Math.max(0, Math.abs(m.x - p.x) - half), dy = Math.max(0, Math.abs(m.y - p.y) - half);
      const d = Math.hypot(dx, dy);
      const wd = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      if (d < bestD - 0.5 || (Math.abs(d - bestD) <= 0.5 && wd < bestW)) { best = c; bestD = d; bestW = wd; }
    }
    return best;
  }

  // Keyboard / pad target: facing-nearest in reach (findInteractable rules).
  facingTarget() {
    const P = this.game.player;
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    let best = null, bestS = Infinity;
    for (const c of this.cands) {
      const dx = c.x - P.pos.x, dz = c.z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > c.r + REACH_PAD) continue;
      const facing = d < 0.5 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.1) continue;
      const s = d - facing * 0.5;
      if (s < bestS) { bestS = s; best = c; }
    }
    return best;
  }

  // The live Hollow nearest the pointer within LOCK_PX of its projected body.
  enemyAtCursor(current = null) {
    const G = this.game, P = G.player, m = this.input.mouse;
    const r = this.canvasRect();
    const lim = LOCK_PX * r.height / 720;
    const a = { x: 0, y: 0, behind: false }, b = { x: 0, y: 0, behind: false };
    let best = null, bestD = Infinity, curD = Infinity;
    for (const e of G.enemies) {
      if (!e.alive || !e.active) continue;
      if (Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) > 13) continue;
      const h = e.rig && e.rig.height ? e.rig.height : 1.8;
      this.worldToScreen(e.pos.x, 0.1, e.pos.z, a);
      this.worldToScreen(e.pos.x, h, e.pos.z, b);
      if (a.behind || b.behind) continue;
      // distance from the pointer to the feet–head segment
      const sx = b.x - a.x, sy = b.y - a.y;
      const L2 = sx * sx + sy * sy || 1;
      const t = Math.max(0, Math.min(1, ((m.x - a.x) * sx + (m.y - a.y) * sy) / L2));
      let d = Math.hypot(m.x - (a.x + sx * t), m.y - (a.y + sy * t));
      if (e === current) curD = d;
      if (!e.threatening) d += 8; // prefer the ones already coming
      if (d < bestD) { bestD = d; best = e; }
    }
    // hysteresis: keep the current lock unless clearly off it
    if (current && curD <= lim * 1.5 && (!best || best === current || bestD > curD * 0.6)) return current;
    return bestD <= lim ? best : null;
  }

  // ------------------------------------------------------------------ frame
  begin(dt) {
    const G = this.game;
    this.attach();
    // any frame without a gameplay update (menus, dialogue, cutscenes) means
    // the mouse edges and held buttons from then are not ours
    const fresh = this.lastT >= 0 && Math.abs(G.time - this.lastT - dt) < 1e-4 && !this.wasPaused;
    if (!fresh) this.input.consumeMouse();
    this.wasPaused = false;
  }

  paused(dt) {
    this.attach();
    this.wasPaused = true;
    this.lastT = this.game.time;
    const G = this.game;
    // a modal or a script we didn't start ends any walk or hold
    if (!this.ownScript && (this.mode !== 'idle' || this.act)) this.cancel();
    if (this.mode === 'hold') this.mode = 'idle';
    this.hover = null;
    if (this.aim.active) { this.aim.active = false; this.aim.lock = null; this.aim.releaseT = performance.now(); }
    this.aimToggle = false; // a toggled ready stance doesn't survive a menu
    this.updateMarker(dt);
    void G;
  }

  // Returns the player command: { move, run, aim, aimDir, faceDir, lookDir, strafe }.
  update(dt, weapon) {
    const G = this.game, I = this.input, P = G.player, m = I.mouse;
    const S = this.settings;
    this.lastT = G.time;
    I.swapButtons = !!S.swapAim;
    this.cursor.reduceFlash = !!S.reduceFlash;
    const now = performance.now();
    const mouseMode = S.movement !== 'keys';
    const pointer = I.lastDevice === 'kb' && !document.body.classList.contains('touching');

    const cmd = { move: { x: 0, y: 0 }, run: false, aim: false, aimDir: null, faceDir: null, lookDir: null, strafe: true };

    // taking a hit or dying drops whatever the mouse was doing
    if (this.lastHp !== null && P.hp < this.lastHp - 0.01) this.cancel();
    this.lastHp = P.hp;
    if (P.dead) { this.cancel(); this.hover = null; this.aim.active = false; this.aim.lock = null; return cmd; }

    const movedNow = m.moved;
    if (movedNow) this.cursorActive = true;
    m.moved = false;

    // run: hold or toggle
    if (S.sprint === 'toggle') {
      if (I.hit('ShiftLeft', 'ShiftRight') || I.padEdge.has('b')) this.runToggle = !this.runToggle;
    } else this.runToggle = false;
    const runKey = S.sprint === 'toggle' ? this.runToggle : I.run;

    // keys / stick
    const kb = I.moveVector();
    const kbMag = Math.hypot(kb.x, kb.y);
    if (kbMag > 0.2) {
      if (this.mode !== 'idle' || this.act) this.cancel();
      this.cursorActive = false;
    }

    // interactables
    this.cands = G.interactCandidates ? G.interactCandidates() : [];
    for (const c of this.cands) {
      c.dist = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
      c.inReach = c.dist <= c.r + REACH_PAD;
    }
    this.kbTarget = this.facingTarget();

    // ---- aim
    const aimDir = this.updateAim(dt, S, weapon, pointer, movedNow);
    const aiming = this.aim.active;

    // ---- mouse walking
    const go = I.goButton;
    if (m.hit[go]) this.press = { t: now, aimed: aiming };
    // A press that outlived the hold threshold but ended quickly, where it
    // began, was a deliberate slow click: go there (the short nudge it may
    // have started becomes the start of that walk).
    const slowClick = !m.click[go] && m.up[go] && m.upOk[go] && m.upMs[go] <= SLOW_CLICK_MS
      && m.upDist[go] <= CLICK_PX && !!this.press && !this.press.aimed;
    if (this.mode === 'hold' && !I.held(go)) this.mode = 'idle';
    this.hover = ((pointer && m.inside && m.inWindow) || m.tap) && !aiming && this.mode !== 'hold' ? this.pickHover() : null;
    const clicked = ((m.click[go] || m.tap) && !(this.press && this.press.aimed && !m.tap)) || slowClick;
    const dbl = !slowClick && (m.dbl[go] || (m.tap && m.dbl[0]));
    if (this.press && !m.down[go]) this.press = null;
    if (!aiming && mouseMode && this.press && !this.press.aimed && I.held(go) && now - this.press.t >= HOLD_MS && this.mode !== 'hold') {
      this.cancel();
      this.mode = 'hold';
      this.holdPinned = 0;
      this.holdRoute = null;
    }
    if (clicked && !aiming && !this.act) this.onClick(dbl, runKey, mouseMode);

    // ---- produce the move
    let move = null, run = false;
    if (aiming) {
      // aim-walk comes from keys / stick only; the mouse aims
      move = kb;
      cmd.strafe = !!(this.aim.lock || this.aim.mouse || I.aimStick());
    } else if (kbMag > 0.2) {
      move = kb; run = runKey;
    } else if (this.act) {
      move = { x: 0, y: 0 };
      cmd.faceDir = this.stepAct(dt);
      cmd.faceRate = 12;
    } else if (this.mode === 'hold') {
      const gp = this.groundAt(0);
      move = { x: 0, y: 0 };
      // Pressed into something (little of the push turns into motion) for
      // 0.25 s: route round it on the nav grid toward the pointer while the
      // button stays down. With no way on (a wall with the pointer in the
      // dark beyond it, a shut door) she stands, facing the pointer.
      const detour = this.holdPinned >= 0.25;
      if (movedNow && !detour) this.holdPinned = 0;
      else if (P.speed > 0.5 && P.moveSpeed < 0.35 * P.speed) this.holdPinned = (this.holdPinned || 0) + dt;
      else if (this.holdPinned < 0.25) this.holdPinned = 0;
      if (gp) {
        const vx = gp.x - P.pos.x, vz = gp.z - P.pos.z;
        const d = Math.hypot(vx, vz);
        if (d <= HOLD_DEADZONE) { this.holdRoute = null; if (d > 0.05) cmd.faceDir = { x: vx, y: vz }; }
        else if (!(this.holdPinned >= 0.25)) { this.holdRoute = null; move = { x: vx / d, y: vz / d }; run = runKey || (S.runFar && d > RUN_FAR); }
        else {
          const step = this.holdDetour(dt, gp, movedNow);
          if (step === 'direct') { this.holdPinned = 0; move = { x: vx / d, y: vz / d }; run = runKey || (S.runFar && d > RUN_FAR); }
          else if (step) { move = step; run = runKey || (S.runFar && d > RUN_FAR); }
          else cmd.faceDir = { x: vx, y: vz };
        }
      }
    } else if (this.mode === 'path') {
      const r = this.followPath(dt);
      move = r.move; run = this.runPath || runKey;
      if (r.face) { cmd.faceDir = r.face; cmd.faceRate = 10; }
    }
    if (!move) move = { x: 0, y: 0 };

    // ---- idle facing and head look toward a resting pointer
    const idle = !aiming && this.mode === 'idle' && !this.act && kbMag <= 0.2;
    if (pointer && mouseMode && S.faceCursor && this.cursorActive && m.inside) {
      const gp = this.groundAt(0);
      if (gp) {
        const vx = gp.x - P.pos.x, vz = gp.z - P.pos.z;
        const d = Math.hypot(vx, vz);
        if (d > 0.5 && !aiming) cmd.lookDir = { x: vx, y: vz, dist: d };
        if (idle && d > 0.6 && now - m.movedAt >= REST_MS && !cmd.faceDir) cmd.faceDir = { x: vx, y: vz };
      }
    }
    if (!cmd.lookDir && !aiming && this.kbTarget && this.kbTarget.kind !== 'door') {
      const t = this.kbTarget;
      cmd.lookDir = { x: t.x - P.pos.x, y: t.z - P.pos.z, dist: t.dist };
    }

    cmd.move = move;
    cmd.run = run;
    cmd.aim = aiming;
    cmd.aimDir = aimDir;
    return cmd;
  }

  // Hold-walk detour: the route toward the pointer's ground point, refreshed
  // every 0.3 s (0.1 s while the pointer moves). Returns a unit move toward
  // the next waypoint, 'direct' when the way is a straight, unsnapped line
  // again, or null when there is no way on.
  holdDetour(dt, gp, movedNow) {
    const P = this.game.player;
    const h = this._hold || (this._hold = { t: 0 });
    h.t -= dt;
    if (!this.holdRoute || h.t <= 0 || (movedNow && h.t < 0.2)) {
      h.t = 0.3;
      this.holdRoute = this.nav.find(P.pos, gp, { agentR: PLAYER_R, snap: 1.0 }) || [];
      const r = this.holdRoute;
      if (r.length === 1 && !r[0].door && Math.hypot(r[0].x - gp.x, r[0].z - gp.z) < 0.3) return 'direct';
      // a route that ends no nearer the pointer (it's in a wall or the dark
      // beyond one) is no way on: stand, don't shuffle along the wall
      const end = r[r.length - 1];
      if (end && Math.hypot(end.x - gp.x, end.z - gp.z) > Math.hypot(P.pos.x - gp.x, P.pos.z - gp.z) - HOLD_DEADZONE) r.length = 0;
    }
    const r = this.holdRoute;
    while (r.length) {
      const w = r[0];
      const shut = w.door && !(w.door.open && w.door.t >= 0.8);
      if (!shut && Math.hypot(w.x - P.pos.x, w.z - P.pos.z) < ARRIVE_EPS) { r.shift(); continue; }
      break;
    }
    if (!r.length) return null;
    const w = r[0];
    const vx = w.x - P.pos.x, vz = w.z - P.pos.z, d = Math.hypot(vx, vz);
    // a shut door on the way: walk up to it and stand (holding never opens doors)
    if (w.door && !(w.door.open && w.door.t >= 0.8) && d < 0.3) return null;
    if (d < 1e-3) return null;
    return { x: vx / d, y: vz / d };
  }

  // ------------------------------------------------------------------ aim
  updateAim(dt, S, weapon, pointer, movedNow) {
    const G = this.game, I = this.input, P = G.player, m = I.mouse, A = this.aim;
    // pressing the ready button always drops a walk or a pending use, even
    // with nothing to ready (plan §6.3)
    if (m.hit[I.readyButton] && !m.stale[I.readyButton] && (this.mode !== 'idle' || this.act)) this.cancel();
    let held = I.aim;
    if (S.aimMode === 'toggle') {
      const rb = I.readyButton;
      if ((m.hit[rb] && !m.stale[rb]) || I.hit('Space', 'KeyK') || I.padEdge.has('lt')) this.aimToggle = !this.aimToggle;
      held = this.aimToggle;
    }
    const canAim = !!weapon && !P.dead && !P.action && P.reloadT <= 0;
    if (!weapon) this.aimToggle = false;
    const want = held && canAim;
    if (want && !A.active) {
      A.active = true;
      A.focus = 0;
      A.ticked = false;
      // readied with the mouse button → the pointer aims; with Space / LT →
      // lock the nearest threat, until the mouse moves
      A.mouse = pointer && I.held(I.readyButton);
      this.cancel();
      A.lock = A.mouse ? this.enemyAtCursor(null) : G.nearestTarget(null);
    } else if (!want && A.active) {
      A.active = false;
      A.lock = null;
      A.releaseT = performance.now();
    }
    if (!A.active) { A.focus = Math.max(0, A.focus - dt * 2); return null; }

    if (!A.mouse && pointer && movedNow) A.mouse = true;
    const prev = A.lock;
    const stick = I.aimStick();
    if (A.mouse) {
      // re-pick only when the pointer moves: the camera shifting under a
      // still pointer must not steal the lock
      if (movedNow || !A.lock) A.lock = this.enemyAtCursor(A.lock);
    } else if (stick && Math.hypot(stick.x, stick.y) > 0.6) {
      if (!A.stickHeld) {
        const t = G.nearestTarget(new THREE.Vector2(stick.x, stick.y), 0.6);
        if (t) A.lock = t;
      }
      A.stickHeld = true;
    } else A.stickHeld = false;
    // the box and the laser must agree: when another Hollow stands in the
    // line of fire, the shot will hit that one, so the lock moves to it
    const blocker = P.laserHit;
    if (A.lock && blocker && blocker !== A.lock && blocker.alive && blocker.active) A.lock = blocker;
    // drop a lock that went down or out of range
    if (A.lock && (!A.lock.alive || !A.lock.active || Math.hypot(A.lock.pos.x - P.pos.x, A.lock.pos.z - P.pos.z) > 13)) {
      A.lock = A.mouse ? null : G.nearestTarget(null);
    }
    if (A.lock !== prev) { A.focus = 0; A.ticked = false; }

    let dir = null;
    if (A.lock) dir = new THREE.Vector2(A.lock.pos.x - P.pos.x, A.lock.pos.z - P.pos.z);
    else if (A.mouse) dir = G.mouseGroundDir();
    else if (stick) dir = new THREE.Vector2(stick.x, stick.y);
    A.los = A.lock ? G.world.lineOfSight(P.pos.x, P.pos.z, A.lock.pos.x, A.lock.pos.z) : true;

    // focus builds while the sights settle
    const planted = P.speed < 0.2;
    const facingOk = !dir || Math.abs(wrap(Math.atan2(dir.x, dir.y) - P.yaw)) < 0.3;
    const cap = A.lock ? 1 : 0.5;
    if (A.los && facingOk && P.aiming) A.focus = Math.min(cap, A.focus + (planted ? 0.85 : 0.35) * dt);
    else if (!A.los) A.focus = Math.max(0, A.focus - 0.6 * dt);
    if (A.focus > cap) A.focus = cap;
    if (A.lock && A.focus >= 0.95 && !A.ticked) { A.ticked = true; audio.blip(1480, 0.03, 'sine', 0.035); }
    return dir;
  }

  // A shot was fired: returns {focus, locked} for damage, then settles the box.
  shot() {
    const A = this.aim;
    const r = { focus: A.focus, locked: !!A.lock };
    A.focus *= 0.4;
    A.ticked = false;
    return r;
  }

  // ------------------------------------------------------------------ clicks
  // Line of sight from (x, z) to where a thing is used from. A closed door
  // blocks the ray to its own centre, so a door is tested at its face on
  // that side instead.
  useLos(t, x, z) {
    const w = this.world;
    if (t.kind === 'door' && t.door) {
      const f = doorFace(t.door, x, z);
      return w.lineOfSight(x, z, f.x, f.z);
    }
    return w.lineOfSight(x, z, t.x, t.z);
  }

  onClick(dbl, runKey, mouseMode) {
    const G = this.game, P = G.player;
    const run = runKey || dbl;
    const t = this.hover;
    if (t) {
      if (t.inReach && this.useLos(t, P.pos.x, P.pos.z)) { this.startAct(t); return; }
      if (!mouseMode) { this.cursor.flashNo(); return; }
      this.goToTarget(t, run);
      return;
    }
    if (!mouseMode) return;
    const p = this.pickFloor();
    if (!p) { this.cursor.flashNo(); audio.click(0, 420, 0.06); return; }
    if (!this.goToPoint(p, run)) { this.cursor.flashNo(); audio.click(0, 420, 0.06); }
  }

  goToPoint(p, run, opts = {}) {
    const P = this.game.player;
    const path = this.nav.find(P.pos, p, { agentR: PLAYER_R, ...opts });
    if (!path || !path.length) return false;
    this.cancel();
    this.mode = 'path';
    this.path = path;
    this.dest = { x: path[path.length - 1].x, z: path[path.length - 1].z };
    this.runPath = run;
    this.stuck = { t: 0, x: P.pos.x, z: P.pos.z, repathed: false };
    if (!opts.noMarker) this.showMarker(this.dest.x, this.dest.z);
    return true;
  }

  goToTarget(t, run) {
    const G = this.game, P = G.player;
    if (t.kind === 'door' && t.door && !t.door.locked) {
      // an unlocked door: walk through it to just beyond, opening it on the way
      const d = t.door;
      const cx = d.x + 0.5, cz = d.z + 0.5;
      let bx = cx, bz = cz;
      if (d.axis === 'x') bx += P.pos.x < cx ? 1.1 : -1.1; else bz += P.pos.z < cz ? 1.1 : -1.1;
      if (this.goToPoint({ x: bx, z: bz }, run, { noMarker: false })) return;
      this.cursor.flashNo();
      return;
    }
    // stand on Wren's side of it, within reach
    const targetDoor = t.kind === 'door' ? t.door : null;
    const spot = this.nav.approach(t, P.pos, t.r + REACH_PAD - 0.05, { agentR: PLAYER_R, targetDoor });
    const ok = this.goToPoint(spot || { x: t.x, z: t.z }, run, {
      targetDoor, snap: Math.max(1, t.r + 0.3), noMarker: true, exact: !!(spot && spot.exact),
    });
    if (!ok) { this.cursor.flashNo(); return; }
    this.pending = t;
  }

  // ------------------------------------------------------------------ walking a path
  followPath(dt) {
    const G = this.game, P = G.player;
    const out = { move: { x: 0, y: 0 }, face: null };
    // a pending use: stop as soon as it's in reach
    const t = this.pending;
    if (t) {
      const d = Math.hypot(t.x - P.pos.x, t.z - P.pos.z);
      if (d <= t.r + REACH_PAD - 0.1 && this.useLos(t, P.pos.x, P.pos.z)) {
        this.startAct(t);
        return out;
      }
    }
    // waiting for a door we opened
    if (this.doorWait) {
      const d = this.doorWait;
      out.face = { x: d.x + 0.5 - P.pos.x, y: d.z + 0.5 - P.pos.z };
      if (d.open && d.t >= 0.8) { this.doorWait = null; this.stuck = { t: 0, x: P.pos.x, z: P.pos.z, repathed: true }; } else if (!d.open && !this.ownScript) { this.cancel(true); }
      return out;
    }
    // drop reached waypoints
    while (this.path.length) {
      const w = this.path[0];
      const last = this.path.length === 1;
      const d = Math.hypot(w.x - P.pos.x, w.z - P.pos.z);
      if (w.door && !(w.door.open && w.door.t >= 0.8)) {
        const dd = Math.hypot(w.door.x + 0.5 - P.pos.x, w.door.z + 0.5 - P.pos.z);
        if (d <= 0.3 || dd <= 1.15) { this.openDoor(w.door); this.path.shift(); return out; }
        break;
      }
      if (d < (last ? FINAL_EPS : ARRIVE_EPS)) { this.path.shift(); continue; }
      break;
    }
    if (!this.path.length) {
      // arrived
      const pend = this.pending;
      this.mode = 'idle';
      this.dest = null;
      this.stuck = null;
      if (pend) {
        this.pending = null;
        const d = Math.hypot(pend.x - P.pos.x, pend.z - P.pos.z);
        if (d <= pend.r + REACH_PAD) this.startAct(pend); else this.cursor.flashNo();
      }
      return out;
    }
    const w = this.path[0];
    const vx = w.x - P.pos.x, vz = w.z - P.pos.z;
    const d = Math.hypot(vx, vz) || 1;
    // ease in to the destination and to door thresholds so she doesn't overshoot
    const shut = w.door && !(w.door.open && w.door.t >= 0.8);
    const ease = this.path.length === 1 || shut ? Math.min(1, d / 0.6) : 1;
    out.move = { x: vx / d * ease, y: vz / d * ease };

    // stuck: little progress for 0.5 s → repath once, then give up
    const s = this.stuck;
    if (s) {
      s.t += dt;
      if (s.t >= 0.5) {
        const moved = Math.hypot(P.pos.x - s.x, P.pos.z - s.z);
        if (moved < 0.05) {
          if (!s.repathed && this.dest) {
            const dest = this.dest, pend = this.pending, runPath = this.runPath;
            // dest is the last waypoint of a route already found, so it's a
            // spot she fits on: end exactly there again
            const p = this.nav.find(P.pos, dest, { agentR: PLAYER_R, targetDoor: pend && pend.kind === 'door' ? pend.door : null, exact: true });
            if (p && p.length) { this.path = p; this.pending = pend; this.runPath = runPath; this.stuck = { t: 0, x: P.pos.x, z: P.pos.z, repathed: true }; return out; }
          }
          this.cancel(true);
          return { move: { x: 0, y: 0 }, face: null };
        }
        s.t = 0; s.x = P.pos.x; s.z = P.pos.z;
      }
    }
    return out;
  }

  openDoor(d) {
    const G = this.game;
    this.doorWait = d;
    if (d.open) return;
    if (d.locked) { this.cancel(true); return; }
    this.ownScript = true;
    Promise.resolve(G.script(() => G.useDoor(d))).catch((e) => console.error(e)).finally(() => { this.ownScript = false; });
  }

  // ------------------------------------------------------------------ using a thing
  startAct(t) {
    const P = this.game.player;
    this.mode = 'idle';
    this.path = [];
    this.dest = null;
    this.pending = null;
    this.stuck = null;
    let action = null;
    if (t.kind === 'pickup') action = t.y < 0.5 ? 'reachLow' : 'reach';
    else if (t.kind === 'door' || (t.kind === 'fixture' && t.label !== 'EXAMINE')) action = 'reach';
    if (t.action !== undefined) action = t.action;
    this.act = { c: t, t: 0, phase: 'face', action };
    void P;
  }

  // Face the target, play the reach, then run its script.
  stepAct(dt) {
    const G = this.game, P = G.player, a = this.act;
    const c = a.c;
    a.t += dt;
    const face = { x: c.x - P.pos.x, y: c.z - P.pos.z };
    if (a.phase === 'face') {
      const err = Math.abs(wrap(Math.atan2(face.x, face.y) - P.yaw));
      if (err < 0.3 || a.t > 0.25 || Math.hypot(face.x, face.y) < 0.3) {
        a.phase = 'reach';
        a.t = 0;
        if (a.action && P.playAction) P.playAction(a.action);
        else a.phase = 'run';
      }
      return face;
    }
    if (a.phase === 'reach') {
      if (P.action && a.t < 0.8) return face;
      a.phase = 'run';
    }
    // run the thing's script; a door we opened this way is walked through
    this.act = null;
    this.ownScript = true;
    const through = c.kind === 'door' && c.door ? c.door : null;
    const wasOpen = through ? through.open : false;
    Promise.resolve(G.script(() => c.run())).catch((e) => console.error(e)).finally(() => {
      this.ownScript = false;
      if (through && !wasOpen && through.open && this.mode === 'idle' && !this.act) {
        const d = through, cx = d.x + 0.5, cz = d.z + 0.5;
        let bx = cx, bz = cz;
        if (d.axis === 'x') bx += P.pos.x < cx ? 1.1 : -1.1; else bz += P.pos.z < cz ? 1.1 : -1.1;
        this.goToPoint({ x: bx, z: bz }, false);
      }
    });
    return face;
  }

  // ------------------------------------------------------------------ keyboard / pad use
  interactStep() {
    const G = this.game, I = this.input, P = G.player;
    const it = P.dead ? null : this.kbTarget;
    G.ui.prompt(it ? it.label : null);
    if (!I.interact || P.dead || G.scripting) return;
    // the pointed-at thing wins if it's in reach and the pointer is in use
    const h = this.hover;
    const fresh = this.cursorActive && performance.now() - I.mouse.movedAt < 2000;
    const t = h && h.inReach && fresh ? h : it;
    if (!t) return;
    this.cancel();
    G.script(() => t.run());
  }

  // ------------------------------------------------------------------ marks
  showMarker(x, z) {
    if (!this.marker) return;
    this.marker.position.set(x, 0.02, z);
    this.marker.visible = true;
    this.markerT = 0;
  }

  updateMarker(dt) {
    if (!this.marker) return;
    this.markerT += dt;
    const active = this.mode === 'path' && this.dest;
    let op;
    if (active) op = Math.max(0.35, 1 - (this.markerT / 0.6) * 0.65);
    else op = this.marker.visible ? Math.max(0, this.marker.material.opacity - dt / 0.6) : 0;
    this.marker.material.opacity = op;
    this.marker.visible = op > 0.01;
    if (active) this.marker.position.set(this.dest.x, 0.02, this.dest.z);
    // optional path line
    const show = active && this.settings.showPath && this.path.length > 0;
    this.pathLine.visible = !!show;
    if (show) {
      const P = this.game.player;
      const arr = this.pathLine.geometry.attributes.position.array;
      let n = 0;
      arr[n++] = P.pos.x; arr[n++] = 0.03; arr[n++] = P.pos.z;
      for (const w of this.path) { if (n >= arr.length - 3) break; arr[n++] = w.x; arr[n++] = 0.03; arr[n++] = w.z; }
      this.pathLine.geometry.setDrawRange(0, n / 3);
      this.pathLine.geometry.attributes.position.needsUpdate = true;
    }
  }

  // After the camera moved: project everything the overlay draws.
  lateUpdate(dt) {
    const G = this.game, I = this.input, P = G.player, m = I.mouse, A = this.aim;
    const S = this.settings;
    this.updateMarker(dt);
    const st = this.gameState;
    st.mode = 'game';
    st.brackets.length = 0;
    const pad = I.lastDevice === 'pad';
    const pointer = I.lastDevice === 'kb';
    const keyGlyph = pad ? 'A' : pointer && !this.cursorActive ? 'F' : null;
    const p = { x: 0, y: 0, behind: false };
    if (!P.dead && !A.active) {
      for (const c of this.cands) {
        const hovered = c === this.hover;
        const isKb = c === this.kbTarget;
        if (!c.inReach && !hovered) continue;
        this.worldToScreen(c.x, c.y, c.z, p);
        if (p.behind) continue;
        const px = (c.size || 0.5) * this.pxPerMetre(c.x, c.y, c.z);
        st.brackets.push({
          // the hovered one's label rides on the pointer instead
          x: p.x, y: p.y, w: px, h: px, label: hovered && st.pointer !== false ? '' : c.label, red: !!c.red, hovered,
          alpha: hovered ? (c.inReach ? 1 : 0.5) : 0.8,
          far: hovered && !c.inReach, door: c.kind === 'door' && c.inReach,
          key: isKb && keyGlyph ? keyGlyph : null,
          // label priority when labels crowd: the key target, then nearest first
          pri: isKb ? -1 : c.dist,
        });
      }
    }
    // focus box around the readied target
    st.focus = null;
    if (A.active && A.lock) {
      const fr = this.focusFrame(A.lock, dt);
      const size = THREE.MathUtils.lerp(2.4, 1.1, A.focus) * fr.body;
      st.focus = { x: fr.x, y: fr.y, size, f: A.focus, solid: A.focus >= 0.95, los: A.los, alpha: 1 };
    } else this._ff = null;
    // aim readout: only while readied (fades after release)
    st.readout = null;
    const w = G.inv && G.inv.weapon ? G.inv.weapon() : null;
    const since = (performance.now() - A.releaseT) / 1000;
    if (w && (A.active || since < 0.4)) {
      const alpha = A.active ? 1 : 1 - since / 0.4;
      let rx, ry;
      if (st.focus) { rx = st.focus.x + st.focus.size / 2 + 18; ry = st.focus.y - st.focus.size / 2 + 12; } else { rx = m.x + 18; ry = m.y; }
      if (!A.active && this._ro) { rx = this._ro.x; ry = this._ro.y; }
      this._ro = { x: rx, y: ry };
      st.readout = { x: rx, y: ry, loaded: w.loaded, reserve: G.inv.count('ammo'), alpha };
    }
    // the pointer glyph
    let kind = 'idle', label = '', red = false;
    if (A.active) kind = 'aim';
    else if (this.mode === 'hold') kind = 'move';
    else if (this.hover) { kind = this.hover.inReach ? 'act' : 'far'; label = this.hover.label; red = !!this.hover.red; }
    st.kind = kind; st.label = label; st.red = red;
    st.spread = A.active && !A.lock ? 10 + 6 * (1 - Math.min(1, A.focus * 2)) : 0;
    const showPtr = S.aimCursor === 'off' ? false : S.aimCursor === 'aiming' ? A.active : true;
    st.pointer = showPtr && m.inWindow;
  }

  // Where the target's body is on screen, whatever its posture (standing,
  // slumped against a wall, hunched): the screen bounds of its crown, chest,
  // hips and feet, a body-wide ring at chest height, and the laser's end dot
  // (the beam ends on the chest), so the dot always lands inside the box.
  // Returns the centre and the side of a square around them. The offset from
  // the feet and the side are smoothed so the walk cycle doesn't make the box
  // breathe; the lock changing snaps it.
  focusFrame(e, dt) {
    const rig = e.rig;
    const base = this.worldToScreen(e.pos.x, 0, e.pos.z, this._fp || (this._fp = { x: 0, y: 0, behind: false }));
    const bx = base.x, by = base.y;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const p = this._fq || (this._fq = { x: 0, y: 0, behind: false });
    const add = (v) => {
      this.worldToScreen(v.x, v.y, v.z, p);
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    };
    const v = this._fv || (this._fv = new THREE.Vector3());
    let hy = 1.1;
    if (rig && rig.root && rig.chest && rig.head) {
      rig.root.updateMatrixWorld(true);
      add(rig.head.localToWorld(v.set(0, 0.24, 0)));
      for (const b of ['chest', 'hips', 'footL', 'footR']) {
        if (!rig[b]) continue;
        add(rig[b].getWorldPosition(v));
        if (b === 'chest') hy = Math.max(0.3, v.y);
      }
    } else {
      add(v.set(e.pos.x, 0, e.pos.z));
      add(v.set(e.pos.x, rig && rig.height ? rig.height : 1.8, e.pos.z));
    }
    // a minimum girth (about a body's width) around the chest
    const r = 0.3;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      add(v.set(e.pos.x + Math.cos(a) * r, hy, e.pos.z + Math.sin(a) * r));
    }
    const P = this.game.player;
    if (P && P.laserHit === e && P.laserDot) add(P.laserDot.position);
    const ox = (x0 + x1) / 2 - bx, oy = (y0 + y1) / 2 - by;
    const body = Math.max(8, x1 - x0, y1 - y0);
    let f = this._ff;
    if (!f || f.id !== e.id) f = this._ff = { id: e.id, ox, oy, body };
    else {
      const k = 1 - Math.exp(-dt * 10);
      f.ox += (ox - f.ox) * k; f.oy += (oy - f.oy) * k; f.body += (body - f.body) * k;
    }
    return { x: bx + f.ox, y: by + f.oy, body: f.body };
  }

  // What the overlay should draw right now.
  cursorState() {
    const G = this.game;
    if (G.mode === 'boot') return BOOT;
    if (G.ui && G.ui.busy) return MENU;
    if (G.mode === 'title') return MENU;
    if (G.mode !== 'play' || !G.scene) return HIDDEN;
    if (G.scripting) return HIDDEN;
    return this.gameState;
  }

  // Debug / harness snapshot (plan §3.8).
  snapshot() {
    const h = this.hover;
    return {
      mode: this.mode,
      acting: !!this.act,
      path: this.path.map((w) => ({ x: w.x, z: w.z, door: w.door ? w.door.id : undefined })),
      dest: this.dest ? { x: this.dest.x, z: this.dest.z } : null,
      pending: this.pending ? this.pending.id : this.act ? this.act.c.id : null,
      hover: h ? { id: h.id, kind: h.kind, label: h.label, inReach: !!h.inReach } : null,
      aim: { active: this.aim.active, lockId: this.aim.lock ? this.aim.lock.id : null, focus: this.aim.focus, los: this.aim.los },
      navMs: this.nav ? this.nav.stats.maxMs : 0,
      kbTarget: this.kbTarget ? this.kbTarget.id : null,
    };
  }
}

const BOOT = { mode: 'boot' };
const MENU = { mode: 'menu' };
const HIDDEN = { mode: 'hidden' };
