// Game orchestration: state machine, interactions, combat, camera, saving.
import * as THREE from 'three';
import { Renderer } from '../engine/renderer.js';
import { Input } from '../engine/input.js';
import { audio } from '../engine/audio.js';
import { Tex } from '../engine/textures.js';
import { World } from './world.js';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Inventory, ITEMS } from './items.js';
import { ROOMS, PICKUPS, ENEMIES, FIXTURES, PLAYER_START, SECTORS } from './map.js';
import { INTRO, EXAMINE, ENDING } from './story.js';
import { UI } from '../ui/ui.js';
import { buildItemModel } from '../ui/items3d.js';
import { M } from './props.js';
import { Controls, CAM, FIXTURE_VERB } from './controls.js';

const SAVE_KEY = 'lethe7-save';
const SAVE_VERSION = 2;
const RELAY_CODE = '7304';
const MAG = 8;
const CYCLE = '11 406';

// Presentation timings (plan §7.2).
const CUT_OUT = 0.09;          // threshold cut: fade to black on a room change…
const CUT_IN = 0.16;           // …snap the camera, fade back in
const DEATH_SPLIT = 0.25;      // red split held over the death freeze
const DEATH_COLLAPSE = 1.4;    // let the fall play out (the rig's death is 1.4 s)
const DEATH_SWEEP = 0.3;       // signal-loss band down the screen
const DEATH_BLACK = 0.8;       // hard black before the NO RESPONSE screen
const CHASE_TEAR_R = 4;        // m: a chasing Hollow this close tears a few rows
const CHASE_TEAR = 0.06;
// Condition level (STABLE, IMPAIRED, FAILING, CRITICAL) → UI grade and post.
const LOWHP_UI = [0, 0.12, 0.35, 0.7];
const CRITICAL_POST = [0, 0, 0.5, 1];
const HEART_S = [0, 0, 1.6, 0.9];
// World pickups: models from items3d, scaled up to read at the game camera.
const PICKUP_R = 0.14;
const PICKUP_LAY = { keycard: [-Math.PI / 2, 0], photo: [-Math.PI / 2, 0], obol: [-Math.PI / 2, 0], pistol: [Math.PI / 2, 0], nanite: [0, Math.PI / 2] };
const PICKUP_LIFT = 0.28;      // a little self-light so small things read on dark floors
// Bracket verbs for the new fixtures (the rest come from controls.js).
const FIXTURE_LABEL = { save: 'BACKUP', box: 'LOCKER' };
// Map ticks once a door has been tried (ui.js draws them).
const LOCK_STATE = { breaker: 'sealed', power: 'sealed', code: 'locked', keycard: 'item', obol: 'item' };

export class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.ui = new UI(this.input);
    this.interactProviders = [() => this.pickupCandidates(), () => this.fixtureCandidates(), () => this.doorCandidates()];
    this.controls = new Controls(this); // mouse-first controls, cursor overlay (workstream C)
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.5, 80);
    this.renderer.onResize = (a) => { this.camera.aspect = a; this.camera.updateProjectionMatrix(); if (this.titleCam) { this.titleCam.aspect = a; this.titleCam.updateProjectionMatrix(); } };
    this.renderer.onResize(this.renderer.aspect);
    this.mode = 'boot';
    this.time = 0;
    this.fadeAnim = null;
    this.fadeValue = 1;      // the scripted fade; the post multiplies in the threshold cut
    this.cut = null;
    this.dying = null;
    this.shake = 0;
    this.damageFlash = 0;
    this.glitchPulse = 0;
    this.tint = 0;
    this.tintTarget = 0;
    this.heartT = 0;
    this.clankT = 8;
    this.condLevel = -1;
    this.bannerT = -1e9;
    this.muffled = false;
    this.hasTool = false;
    this.sectorSeen = {};
    this.equip = {};         // { weapon?, tool? }: item id, null = stowed on purpose, absent = first carried
    this.applySettings(this.ui.settings);
    this.ui.onSettings = (s) => this.applySettings(s);
    this.buildTitleScene();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // Settings v2 (plan §3.4): the renderer takes the video keys (res, where the
  // legacy default 270 means AUTO; pixelPerfect, crt, grain, reduceFlash), the
  // audio takes the volume. Controls read their keys live from ui.settings.
  applySettings(s) {
    this.renderer.setOptions(s);
    audio.volume = s.volume ?? 0.8;
    const crt = document.getElementById('crt');
    if (crt) crt.style.display = s.crt ? '' : 'none';
  }

  // ------------------------------------------------------------------ flow
  async start() {
    this.fadeValue = 0;
    this.renderer.uniforms.uFade.value = 0;
    await this.ui.boot();
    audio.init();
    this.titleLoop();
  }

  async titleLoop() {
    this.mode = 'title';
    this.ui.showHud(false);
    audio.setMusic('none');
    audio.setAmbience(0.35);
    audio.setStatic(0);
    audio.sting();
    this.fade(1, 2.5);
    const choice = await this.ui.title(this.hasSave());
    await this.fade(0, 0.8);
    if (choice === 'new') await this.newGame();
    else if (choice === 'continue') await this.loadGame();
  }

  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
  }

  async newGame() {
    this.setupLevel(null);
    this.mode = 'cutscene';
    audio.setAmbience(0.15);
    audio.radioBurst(0.8);
    this.fadeValue = 0;
    await this.ui.typed(INTRO, { black: true });
    this.mode = 'play';
    this.ui.showHud(true);
    audio.setAmbience(0.6);
    this.glitchPulse = 1.2;
    audio.radioBurst(0.6);
    await this.fade(1, 2.2);
    this.showSector(ROOMS[this.state.currentRoom].sector);
    await this.script(async () => {
      await this.wait(0.4);
      await this.ui.say(EXAMINE.wake, 'WREN');
      if (document.body.classList.contains('touching')) this.hint('controls-touch', 'Tap the floor to go, tap a thing to use it · stick to walk · <b>ACT</b> interact');
      else this.hint('controls', 'Hold [LMB] to walk toward the pointer · click to go or use · [F] interact · [Tab] inventory');
    });
  }

  async loadGame() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
    if (!data) return this.titleLoop();
    this.setupLevel(data);
    this.mode = 'play';
    this.ui.showHud(true);
    audio.setAmbience(ROOMS[this.state.currentRoom].safe ? 0.15 : 0.6, this.state.powered);
    this.glitchPulse = 1;
    audio.radioBurst(0.5);
    await this.fade(1, 1.4);
    this.ui.toast('BACKUP RESTORED');
  }

  // Save format v2: v1 plus door tries, sector plans and the equipped items.
  // v1 saves still load (setupLevel fills the gaps).
  saveGame() {
    const s = this.state;
    const data = {
      v: SAVE_VERSION,
      player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, hp: this.player.hp },
      inv: this.inv.serialize(),
      flags: s.flags,
      powered: s.powered,
      taken: [...s.taken],
      doors: Object.fromEntries(Object.values(this.world.doors).map((d) => [d.id, { open: d.open, locked: d.locked }])),
      enemies: Object.fromEntries(this.enemies.map((e) => [e.id, e.state === 'dead' || (e.state === 'down' && (!e.def.revive || e.revived)) ? 'dead' : e.active ? 'alive' : 'inactive'])),
      visited: [...s.visited],
      tried: [...s.tried],
      plans: [...s.plans],
      equip: { ...this.equip },
      time: Date.now(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }

  // ------------------------------------------------------------------ level
  setupLevel(save) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 18, 34);
    this.scene = scene;
    this.ambient = new THREE.AmbientLight(0x404a52, 1.1);
    scene.add(this.ambient);
    // neutral ground bounce: no warm cast on the pre-power floors (D1 note)
    this.hemi = new THREE.HemisphereLight(0x303840, 0x0c0c10, 0.5);
    scene.add(this.hemi);

    this.world = new World(scene);
    this.world.build();
    this.player = new Player(scene);
    this.inv = new Inventory();
    this.state = {
      flags: { relay: { levers: [false, false, false, false] } },
      powered: false,
      taken: new Set(),
      visited: new Set(),
      tried: new Map(),   // door id → 'open' | 'locked' | 'item' | 'sealed', once Wren has tried it
      plans: new Set(),   // sector codes whose plan terminal she has read
      currentRoom: 'A',
    };
    this.equip = {};
    this.player.onReloadDone = () => this.finishReload();

    if (save) {
      this.player.setPosition(save.player.x, save.player.z, save.player.yaw);
      this.player.hp = save.player.hp;
      this.inv.load(save.inv);
      this.state.flags = save.flags;
      this.state.powered = save.powered;
      this.state.taken = new Set(save.taken);
      this.state.visited = new Set(save.visited);
      this.state.plans = new Set(save.plans || []);
      this.equip = { ...(save.equip || {}) };
      for (const [id, d] of Object.entries(save.doors)) {
        const door = this.world.doors[id];
        door.open = d.open; door.locked = d.locked; door.t = d.open ? 1 : 0;
        door.leafL.position.x = -0.25 - door.t * 0.46; door.leafR.position.x = 0.25 + door.t * 0.46;
        this.world.setDoorLamp(door);
      }
      // v1 saves have no door tries: every door she opened counts as tried
      this.state.tried = new Map(save.tried || Object.entries(save.doors).filter(([, d]) => d.open).map(([id]) => [id, 'open']));
    } else {
      this.player.setPosition(PLAYER_START.x, PLAYER_START.z, PLAYER_START.rot);
    }
    this.world.setPowered(this.state.powered);
    if (this.state.flags.fuseIn) { const parts = this.world.parts('J', 'relayPanel'); if (parts) parts.fuse.visible = true; }
    if (this.state.flags.breaker) { const parts = this.world.parts('A', 'breaker'); if (parts) { parts.lever.rotation.x = -0.6; parts.lamp.material = M.emissiveGreen(); } }
    if (this.state.powered) this.applyRelayVisual();

    // enemies
    this.enemies = ENEMIES.map((def) => {
      const e = new Enemy(scene, def);
      const st = save && save.enemies[def.id];
      if (st === 'dead') e.kill();
      else if (st === 'alive' && def.spawn) e.activate();
      else if (!save && def.spawn && this.state.powered) e.activate();
      return e;
    });

    // pickups
    this.pickups = [];
    for (const p of PICKUPS) {
      if (this.state.taken.has(p.id)) continue;
      this.pickups.push(this.makePickup(p));
    }

    const r = this.world.roomAt(this.player.pos.x, this.player.pos.z) || 'A';
    this.state.currentRoom = r;
    this.state.visited.add(r);
    this.world.updateVisibility(r, this.player.pos.z);
    this.camTarget = new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z);
    this.updateCamera(1, true);
    this.particles = new Particles(scene);
    this.scripting = false;
    this.cut = null;
    this.dying = null;
    this.sectorSeen = {};
    this.condLevel = -1;     // forces the UI grade and post to re-read the condition
    this.syncToolClass();
    this.ui.roomName(ROOMS[r].name); // silent: only the pause screen's LOC line reads it
    audio.setMusic(ROOMS[r].safe ? 'quiet' : 'none');
  }

  // World pickups use the same models as the inventory (items3d), scaled up
  // so they read at the game camera and laid down where they would lie flat.
  // Documents stay loose sheets of paper. A faint glint marks items that are
  // out of reach; in reach, the controls' white brackets take over.
  makePickup(p) {
    const g = new THREE.Group();
    const y = p.y ?? 0;
    if (p.file) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), M.paper());
      mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = 0.3;
      mesh.position.y = 0.01;
      g.add(mesh);
    } else {
      const model = buildItemModel(p.item);
      const holder = new THREE.Group();
      const lay = PICKUP_LAY[p.item];
      if (lay) model.rotation.set(lay[0], 0, lay[1]);
      model.traverse((o) => {
        for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
          if (!m.emissive || m.emissive.getHex() !== 0) continue;
          m.emissive.copy(m.color).multiplyScalar(PICKUP_LIFT);
          if (m.map) m.emissiveMap = m.map;
        }
      });
      holder.add(model);
      holder.scale.setScalar(THREE.MathUtils.clamp(PICKUP_R / (model.userData.radius || 0.1), 1, 4));
      holder.rotation.y = hash01(p.id) * Math.PI * 2;
      holder.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(holder);
      holder.position.y = 0.004 - box.min.y;   // rest on the floor or desk top
      g.add(holder);
    }
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: Tex.glint(), transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    glint.position.y = 0.34;
    glint.renderOrder = 10;
    g.add(glint);
    g.position.set(p.x, y, p.z);
    this.world.rooms[p.room].group.add(g);
    return { def: p, obj: g, glint, seed: hash01(p.id + '*') * 10 };
  }

  applyRelayVisual() {
    const parts = this.world.parts('J', 'relayPanel');
    if (!parts) return;
    parts.lamps.forEach((l) => { l.material = M.emissiveAmber(); });
    parts.fuse.visible = true;
  }

  // ------------------------------------------------------------------ helpers
  wait(s) { return new Promise((r) => setTimeout(r, s * 1000)); }

  fade(to, dur) {
    return new Promise((resolve) => {
      if (this.fadeAnim) this.fadeAnim.resolve();
      this.fadeAnim = { from: this.fadeValue, to, dur, t: 0, resolve };
    });
  }

  async script(fn) {
    if (this.scripting) return;
    this.scripting = true;
    try { await fn(); } finally { this.scripting = false; }
  }

  get paused() { return this.ui.busy || this.scripting || this.mode !== 'play'; }

  // ------------------------------------------------------------------ frame
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.input.pollPad();

    if (this.fadeAnim) {
      const f = this.fadeAnim;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      this.fadeValue = f.from + (f.to - f.from) * k;
      if (k >= 1) { this.fadeAnim = null; f.resolve(); }
    }
    this.renderer.uniforms.uFade.value = this.fadeValue;

    this.ui.update(dt);

    if (this.mode === 'title' || this.mode === 'boot') {
      this.updateTitle(dt);
      const u = this.renderer.uniforms;
      u.uGlitch.value = 0.08 + Math.max(0, Math.sin(this.time * 0.7)) ** 20 * 0.8;
      u.uTint.value = 0;
      u.uRedAlert.value = 0;
      u.uDamage.value = 0;
      // nothing from a game in progress carries over to the title
      u.uMenu.value = 0; u.uCritical.value = 0; u.uTear.value = 0; u.uSweep.value = -1; u.uFringe.value = 0;
      this.setMuffle(false);
      this.renderer.render(this.titleScene, this.titleCam, this.time);
    } else if (this.scene) {
      if (this.mode === 'play' && !this.paused) this.update(dt);
      else if (this.mode === 'play') this.idleUpdate(dt);
      this.updatePost(dt);
      this.renderer.render(this.scene, this.camera, this.time);
    }
    this.input.endFrame();
  }

  // world keeps breathing (lights, doors) while menus are open
  idleUpdate(dt) {
    this.world.updateLights(this.time);
    this.world.updateDoors(dt);
    this.updateGlints(dt);
    this.ui.prompt(null);
    this.ui.ammo(false);
    this.controls.paused(dt);
  }

  update(dt) {
    const input = this.input;
    const P = this.player;
    const C = this.controls;
    // death: the world holds still for two frames under a red split
    if (this.dying && this.dying.freeze > 0) { this.dying.freeze--; return; }
    C.begin(dt);

    // menus (none once she is down)
    if (input.pause && !P.dead) { this.openPause(); return; }
    if (input.inventory && !P.dead) { this.openInventory('items'); return; }
    if (input.map && !P.dead) { this.openInventory('map'); return; }

    // controls: mouse walk / click-to-go / use, aim and focus (see controls.js)
    const weapon = this.currentWeapon();
    const cmd = C.update(dt, weapon);

    const room = this.state.currentRoom;
    const surface = { plate: 'plate', grate: 'grate', carpet: 'carpet', tile: 'plate', concrete: 'plate' }[ROOMS[room].floor];
    P.update(dt, { ...cmd, hasWeapon: !!weapon, enemies: this.enemies }, this.world, surface);

    // combat
    if (P.aiming && input.fire) this.fire();
    else if (input.reload && weapon) this.startReload();

    // enemies
    for (const e of this.enemies) {
      if (!e.onHitPlayer) e.onHitPlayer = () => { this.damageFlash = 1; this.shake = 0.35; this.glitchPulse = 0.8; };
      e.update(dt, P, this.world, this.enemies);
    }

    // room tracking
    const r = this.world.roomAt(P.pos.x, P.pos.z);
    if (r && r !== this.state.currentRoom) this.enterRoom(r);
    this.world.updateVisibility(this.state.currentRoom, P.pos.z);
    this.world.updateLights(this.time);
    this.world.updateDoors(dt);
    this.updateGlints(dt);
    this.particles.update(dt);

    // interactables: F / E / pad A (the mouse uses things through controls.update)
    C.interactStep();

    // HUD: the aim readout is drawn by the cursor overlay
    this.ui.ammo(false);

    // atmosphere
    let threat = 0;
    for (const e of this.enemies) {
      if (!e.active || !(e.threatening || e.state === 'dormant' || e.state === 'idle')) continue;
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
      const w = e.threatening ? 1 : 0.35;
      threat = Math.max(threat, Math.max(0, 1 - d / 9) * w);
    }
    // threat feeds the radio static only; the picture glitches for events
    this.threat = threat;
    audio.setStatic(threat);
    this.clankT -= dt;
    if (this.clankT <= 0) { this.clankT = 10 + Math.random() * 20; if (!ROOMS[room].safe) audio.distantClank(); }

    // heartbeat while FAILING (slow) or CRITICAL
    const beat = P.dead ? 0 : HEART_S[P.conditionLevel];
    if (beat) { this.heartT -= dt; if (this.heartT <= 0) { this.heartT = beat; audio.heartbeat(); } } else this.heartT = 0;

    // death: freeze, let the fall play out, then the signal-loss sequence
    if (P.dead && !this.dying) this.startDeath();
    if (this.dying && P.deadT >= DEATH_COLLAPSE) { this.mode = 'dying'; this.dying.t = 0; }

    this.updateCamera(dt);
    C.lateUpdate(dt);
  }

  // Pickup glints: faint (25 %) and only while the item is out of reach.
  updateGlints(dt) {
    const P = this.player;
    for (const p of this.pickups) {
      const g = p.glint;
      const d = P ? Math.hypot(p.def.x - P.pos.x, p.def.z - P.pos.z) : 99;
      const target = d > 1.15 ? 0.25 * (0.45 + 0.55 * Math.max(0, Math.sin(this.time * 2.3 + p.seed))) : 0;
      g.material.opacity += (target - g.material.opacity) * Math.min(1, dt * 6);
      g.visible = g.material.opacity > 0.01;
      if (!g.visible) continue;
      g.quaternion.copy(this.camera.quaternion);
      const k = 0.6 + 0.4 * Math.sin(this.time * 4 + p.seed);
      g.scale.setScalar(0.6 + k * 0.5);
      g.rotation.z = this.time * 0.5;
    }
  }

  // Post: glitches are for events only (hits, kills, memories, power, death).
  // Ambient threat never tears the picture; a Hollow chasing close by gives a
  // few single-row tears. uMenu and the audio muffle follow an open menu;
  // uCritical and the UI grade follow the condition level.
  updatePost(dt) {
    const u = this.renderer.uniforms;
    const P = this.player;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    this.glitchPulse = Math.max(0, this.glitchPulse - dt * 1.5);
    this.tint += (this.tintTarget - this.tint) * Math.min(1, dt * 1.5);
    u.uDamage.value = this.damageFlash;
    u.uGlitch.value = Math.min(1, this.glitchPulse);
    u.uTint.value = this.tint;
    u.uRedAlert.value = 0;

    // a chasing Hollow within 4 m: a few torn rows, stronger as it closes in
    let tear = 0;
    if (this.mode === 'play' && P && !P.dead && !this.ui.busy) {
      for (const e of this.enemies) {
        if (!e.active || !['chase', 'lunge', 'attack'].includes(e.state)) continue;
        const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
        if (d < CHASE_TEAR_R) tear = Math.max(tear, CHASE_TEAR * Math.min(1, (CHASE_TEAR_R - d) / 2));
      }
    }
    u.uTear.value += (tear - u.uTear.value) * Math.min(1, dt * 8);
    if (u.uTear.value < 0.002) u.uTear.value = 0;

    // menus: a drained, darker world and a muffled world bus
    const menu = this.menuDim();
    u.uMenu.value += ((menu ? 1 : 0) - u.uMenu.value) * Math.min(1, dt * 18);
    if (!menu && u.uMenu.value < 0.004) u.uMenu.value = 0;
    this.setMuffle(menu);

    // condition: renderer grade every frame, the UI grade and banner on change
    if (P) {
      const lvl = P.conditionLevel;
      u.uCritical.value += (CRITICAL_POST[lvl] - u.uCritical.value) * Math.min(1, dt * 3);
      if (lvl !== this.condLevel) {
        if (lvl === 3 && this.condLevel >= 0 && this.condLevel < 3 && !P.dead && this.time - this.bannerT > 20) {
          this.bannerT = this.time;
          if (this.ui.banner) this.ui.banner('INTEGRITY FAILURE IMMINENT');
          audio.heartbeat();
          this.heartT = HEART_S[3];
        }
        this.condLevel = lvl;
        this.ui.lowHp(LOWHP_UI[lvl]);
      }
    }

    // threshold cut: out to black, snap the camera, back in
    let cutMul = 1;
    if (this.cut) {
      const c = this.cut;
      c.t += dt;
      if (c.t < CUT_OUT) cutMul = 1 - c.t / CUT_OUT;
      else {
        if (!c.snapped) { c.snapped = true; this.updateCamera(dt, true); }
        cutMul = Math.min(1, (c.t - CUT_OUT) / CUT_IN);
        if (cutMul >= 1) this.cut = null;
      }
    }

    this.updateDeathPost(dt, u);
    u.uFade.value = this.fadeValue * cutMul;
  }

  // Menus that dim the world: any non-passive screen except the inline
  // choice row in the text box (a yes/no shouldn't drain the room).
  menuDim() {
    const m = this.ui.modal;
    return !!m && !m.passive && !(m.el && m.el.classList && m.el.classList.contains('catcher'));
  }

  setMuffle(on) {
    if (on === this.muffled) return;
    this.muffled = on;
    audio.menuMuffle(on);
  }

  // ------------------------------------------------------------------ camera
  // ---- controls (workstream C) ----
  // A steep, narrow camera (nearly orthographic) framed on the current room.
  // A room smaller than the view is centred along that axis; a larger one
  // clamps the view so its edge stays within 1 m of the walls. The pointer
  // (or the facing, without a mouse) leads it slightly.
  updateCamera(dt, snap = false) {
    const P = this.player;
    const cam = this.camera;
    if (cam.fov !== CAM.fov) { cam.fov = CAM.fov; cam.updateProjectionMatrix(); }
    const pitch = THREE.MathUtils.degToRad(CAM.pitch);
    // pull back on narrow (portrait) screens so rooms still fit across
    const dist = CAM.dist * Math.min(1.9, Math.max(1, 1.15 / cam.aspect));

    // lead
    let lx = 0, lz = 0;
    const C = this.controls, m = this.input.mouse;
    const gp = !snap && C && C.cursorActive && this.input.lastDevice === 'kb' && m.inWindow && this.mode === 'play' && !this.paused ? C.groundAt(0) : null;
    if (gp) {
      // measured from the view centre, not from Wren, so the camera moving
      // doesn't shift what's under a still pointer (no feedback loop)
      const k = P.aiming ? 0.25 : 0.15;
      lx = (gp.x - this.camTarget.x) * k; lz = (gp.z - this.camTarget.z) * k;
    } else {
      const ahead = P.aiming ? 1.2 : 0.9 * Math.min(1, P.speed / 2);
      lx = Math.sin(P.yaw) * ahead; lz = Math.cos(P.yaw) * ahead;
    }
    const ll = Math.hypot(lx, lz);
    if (ll > 1.6) { lx *= 1.6 / ll; lz *= 1.6 / ll; }

    // room framing
    let tx = P.pos.x + lx, tz = P.pos.z + lz;
    const room = this.world && this.world.rooms[this.state.currentRoom];
    if (room) {
      const half = THREE.MathUtils.degToRad(cam.fov) / 2;
      const camY = CAM.lookY + Math.sin(pitch) * dist, camOff = Math.cos(pitch) * dist;
      const vTop = camOff - camY / Math.tan(pitch - half);
      const vBot = camOff - camY / Math.tan(pitch + half);
      const halfW = (camY / Math.sin(pitch)) * Math.tan(half) * cam.aspect;
      const frame = (t, lo, hi, vlo, vhi) => {
        if (hi - lo <= vhi - vlo) return (lo + hi) / 2 - (vlo + vhi) / 2;
        return Math.min(hi + CAM.margin - vhi, Math.max(lo - CAM.margin - vlo, t));
      };
      tx = frame(tx, room.x0, room.x1 + 1, -halfW, halfW);
      // the north wall stands up into the frame; the south wall is a stub
      tz = frame(tz, room.z0 - 2.6 / Math.tan(pitch), room.z1 + 1.2, vTop, vBot);
    }
    if (this._camRoom !== this.state.currentRoom) { this._camRoom = this.state.currentRoom; this._camBlend = 0.35; }
    this._camBlend = Math.max(0, (this._camBlend || 0) - dt);
    const rate = this._camBlend > 0 ? 10 : 3.2;
    if (snap) this.camTarget.set(tx, 0, tz);
    else {
      const k = 1 - Math.exp(-dt * rate);
      this.camTarget.x += (tx - this.camTarget.x) * k;
      this.camTarget.z += (tz - this.camTarget.z) * k;
    }
    cam.position.set(
      this.camTarget.x,
      CAM.lookY + Math.sin(pitch) * dist,
      this.camTarget.z + Math.cos(pitch) * dist,
    );
    cam.lookAt(this.camTarget.x, CAM.lookY, this.camTarget.z);
    if (this.scene && this.scene.fog) { this.scene.fog.near = dist + 4; this.scene.fog.far = dist + 20; }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * 0.25;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
    cam.updateMatrixWorld();
  }

  // Aim direction from the pointer, on the chest-height plane.
  mouseGroundDir() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(this.input.mouse.nx, this.input.mouse.ny), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const d = new THREE.Vector2(hit.x - this.player.pos.x, hit.z - this.player.pos.z);
    return d.lengthSq() > 0.01 ? d : null;
  }

  // World point → CSS pixels (harness / overlay helper).
  worldToScreen(x, y, z) {
    const p = this.controls.worldToScreen(x, y, z);
    return { x: p.x, y: p.y };
  }

  // Controller snapshot for harnesses (plan §3.8).
  get ctl() { return this.controls.snapshot(); }

  hint(id, html) {
    if (this.ui.hint) return this.ui.hint(id, html);
    this.ui.toast(html.replace(/\[([^\]]{1,12})\]/g, '<b>$1</b>'));
    return true;
  }

  nearestTarget(dir, maxAngle = Math.PI) {
    const P = this.player;
    let best = null, bestScore = Infinity;
    for (const e of this.enemies) {
      if (!e.alive || !e.active) continue;
      if (e.state === 'dormant' && !dir) continue;
      const dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 13 || !this.world.lineOfSight(P.pos.x, P.pos.z, e.pos.x, e.pos.z)) continue;
      let ang = 0;
      if (dir) {
        const dl = Math.hypot(dir.x, dir.y) || 1;
        ang = Math.acos(Math.max(-1, Math.min(1, (dx * dir.x + dz * dir.y) / (d * dl))));
        if (ang > maxAngle) continue;
      }
      const score = d + ang * 4;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------ combat
  fire() {
    const P = this.player;
    const w = this.currentWeapon();
    if (!w || P.fireCd > 0 || P.reloadT > 0) return;
    if (w.loaded <= 0) {
      audio.dryFire();
      P.fireCd = 0.3;
      if (this.inv.count('ammo') > 0) this.startReload();
      else this.hint('no-ammo', 'No rounds left. What can\'t be shot can sometimes be walked around.');
      return;
    }
    w.loaded--;
    P.fireCd = 0.36;
    audio.gunshot();
    P.flashMuzzle(this.camera);
    this.shake = Math.max(this.shake, 0.18);
    this.glitchPulse = Math.max(this.glitchPulse, 0.12);
    // focus: a settled box hits harder, crits more and doesn't wander
    const { focus: f, locked } = this.controls.shot();
    const spread = locked && f >= 0.8 ? 0 : THREE.MathUtils.degToRad(2) * (1 - f) * (Math.random() * 2 - 1);
    const o = P.muzzleWorld();
    const dx = Math.sin(P.yaw + spread), dz = Math.cos(P.yaw + spread);
    const wallDist = this.world.raycast(o.x, o.z, dx, dz, 30);
    let hit = null, hitT = wallDist;
    for (const e of this.enemies) {
      const t = e.rayHit(o.x, o.z, dx, dz);
      if (t !== null && t < hitT) { hitT = t; hit = e; }
    }
    const end = new THREE.Vector3(o.x + dx * Math.min(hitT, 30), o.y, o.z + dz * Math.min(hitT, 30));
    this.particles.tracer(o, end);
    if (hit) {
      const crit = Math.random() < 0.05 + 0.30 * f * f;
      let dmg = 14 + 12 * f + Math.floor(Math.random() * 4);
      if (crit) { dmg *= 2.2; this.glitchPulse = Math.max(this.glitchPulse, 0.25); }
      const killed = hit.takeHit(Math.round(dmg), P.yaw, { crit, focus: f });
      this.particles.burst(end, 0x3a0608, 14, 2.2);
      this.particles.burst(end, 0xff3020, 4, 3);
      if (killed) this.glitchPulse = 0.5;
    } else if (wallDist < 30) {
      this.particles.burst(end, 0xffe0a0, 8, 3);
      audio.impact(false);
    }
    if (w.loaded === 0 && this.controls.settings.autoReload && this.inv.count('ammo') > 0) this.startReload();
  }

  startReload() {
    const P = this.player;
    const w = this.currentWeapon();
    if (!w || P.reloadT > 0 || w.loaded >= MAG) return;
    if (this.inv.count('ammo') <= 0) { audio.dryFire(); return; } // the readout says 00; no log line
    P.reloadT = 1.1;
    audio.reload();
  }

  finishReload() {
    const w = this.currentWeapon();
    if (!w) return;
    const need = MAG - w.loaded;
    const got = this.inv.remove('ammo', need);
    w.loaded += got;
  }

  // ------------------------------------------------------------------ rooms
  enterRoom(r) {
    const prev = ROOMS[this.state.currentRoom];
    const first = !this.state.visited.has(r);
    this.state.currentRoom = r;
    this.state.visited.add(r);
    this.ui.roomName(ROOMS[r].name); // silent: only the pause screen's LOC line reads it
    this.thresholdCut();
    if (ROOMS[r].sector && (!prev || prev.sector !== ROOMS[r].sector)) this.showSector(ROOMS[r].sector);
    audio.setMusic(ROOMS[r].safe ? 'quiet' : 'none');
    audio.setAmbience(ROOMS[r].safe ? 0.15 : 0.6, this.state.powered);
    if (first && r === 'M') this.script(() => this.ui.say(EXAMINE.enter_M, 'WREN'));
    if (first && r === 'G') this.script(async () => { await this.wait(0.6); await this.ui.say(['The concourse. Emergency lighting only.', 'Something is sitting against the far wall.'], 'WREN'); });
  }

  // A room change through a door is a hard cut: out to black in 90 ms, the
  // door relay latches, the camera snaps to the new room's frame, back in
  // 160 ms (updatePost runs the timeline).
  thresholdCut() {
    this.cut = { t: 0, snapped: false };
    audio.latch();
  }

  // Sector title card on entering a sector: the first time, and again only
  // after a while away, so walking back and forth doesn't repeat it.
  showSector(code) {
    const s = SECTORS[code];
    if (!s || !this.ui.sectorCard) return;
    const last = this.sectorSeen[code];
    if (last !== undefined && this.time - last < 90) return;
    this.sectorSeen[code] = this.time;
    this.ui.sectorCard({ code: s.code, name: s.name, gloss: s.gloss });
  }

  // ------------------------------------------------------------------ interaction
  // ---- controls (workstream C) ----
  // Interactables come from `this.interactProviders`, each () => Candidate[]
  // (plan §3.8): { id, kind, x, y, z, r (reach), size (m), label, red?, run }.
  // Only things in the rooms currently on screen are offered.
  interactCandidates() {
    const out = [];
    for (const provide of this.interactProviders) {
      const list = provide();
      if (list) for (const c of list) out.push(c);
    }
    return out;
  }

  pickupCandidates() {
    const vis = this.world.visible;
    const out = [];
    for (const p of this.pickups) {
      const d = p.def;
      if (vis && !vis.has(d.room)) continue;
      if (!p.cand) {
        p.cand = {
          id: d.id, kind: 'pickup', room: d.room, x: d.x, y: (d.y ?? 0) + 0.12, z: d.z, r: 0.75, size: 0.42,
          label: d.file ? 'READ' : 'TAKE', run: () => this.takePickup(p),
        };
      }
      out.push(p.cand);
    }
    return out;
  }

  fixtureCandidates() {
    const vis = this.world.visible;
    const cache = this._fixtureCands || (this._fixtureCands = new Map());
    const out = [];
    for (const f of FIXTURES) {
      if (vis && !vis.has(f.room)) continue;
      let c = cache.get(f);
      if (!c) {
        const label = f.plan ? 'READ PLAN' : FIXTURE_LABEL[f.kind] || FIXTURE_VERB[f.kind] || 'EXAMINE';
        const big = f.r >= 1.5;
        c = {
          id: f.id, kind: 'fixture', room: f.room, x: f.x, y: big ? 1.2 : 0.9, z: f.z, r: f.r,
          size: Math.max(0.55, Math.min(1.4, f.r * 0.8)), label, run: () => this.fixture(f),
        };
        cache.set(f, c);
      }
      out.push(c);
    }
    return out;
  }

  doorCandidates() {
    const vis = this.world.visible;
    const out = [];
    for (const d of Object.values(this.world.doors)) {
      if (d.open) continue;
      if (vis && !vis.has(d.a) && !vis.has(d.b)) continue;
      if (!d.cand) d.cand = { id: d.id, kind: 'door', door: d, x: d.x + 0.5, y: 1.25, z: d.z + 0.5, r: 1.0, size: 1.0, run: () => this.useDoor(d) };
      d.cand.label = d.locked ? 'EXAMINE' : 'OPEN';
      out.push(d.cand);
    }
    return out;
  }

  // Facing-nearest interactable in reach (keyboard / pad rules): { label, run } | null.
  findInteractable() {
    this.controls.cands = this.interactCandidates();
    const P = this.player;
    for (const c of this.controls.cands) c.dist = Math.hypot(c.x - P.pos.x, c.z - P.pos.z);
    return this.controls.facingTarget();
  }

  removePickup(p) {
    p.obj.parent.remove(p.obj);
    this.pickups.splice(this.pickups.indexOf(p), 1);
    this.state.taken.add(p.def.id);
  }

  // Documents open in the reader (it logs "FILED — DOC-00n" on close). Items
  // are announced in the text box, not the log: the screen stays silent.
  async takePickup(p) {
    const d = p.def;
    if (d.file) {
      this.removePickup(p);
      const isNew = this.inv.addFile(d.file);
      await this.ui.document(d.file, isNew);
      if (isNew && d.file === 'bulletin') await this.ui.say(['Seven, three, zero, four. The relay room code.'], 'WREN');
      if (isNew && d.file === 'final') await this.ui.say(['The communications array. Whatever she left, it\'s waiting up there.'], 'WREN');
      return;
    }
    if (!this.inv.canAdd(d.item, 1)) { await this.ui.say(EXAMINE.inv_full, 'WREN'); return; }
    const left = this.inv.add(d.item, d.qty);
    audio.pickup();
    const lines = [this.stowedLine(d.item, d.qty - left)];
    if (left > 0) {
      d.qty = left;
      lines.push('No room for the rest.');
      await this.ui.say(lines, 'WREN');
      return;
    }
    this.removePickup(p);
    this.syncToolClass();
    if (d.item === 'photo') {
      lines.push('A photograph, tucked under a pillow.');
      await this.ui.say(lines, 'WREN');
      await this.playMemory('window');
      return;
    }
    if (d.item === 'obol') lines.push('A silver coin with a boat on it. It was left here on purpose.', 'FOR W.');
    await this.ui.say(lines, 'WREN');
  }

  stowedLine(id, n = 1) {
    const def = ITEMS[id];
    return `Stowed ${def ? def.name : id.toUpperCase()}${n > 1 ? ' ×' + n : ''}.`;
  }

  async playMemory(key) {
    this.tintTarget = 1;
    this.glitchPulse = 1.4;
    audio.radioBurst(0.8);
    audio.setMusic('memory');
    await this.fade(0, 0.8);
    await this.ui.memory(key);
    this.tintTarget = 0;
    this.tint = 0;
    audio.setMusic(ROOMS[this.state.currentRoom].safe ? 'quiet' : 'none');
    this.glitchPulse = 1;
    await this.fade(1, 1.2);
  }

  // Every try is recorded for the map (state.tried): a door she opened reads
  // open; one that stayed shut reads by its lock (key/code → item or locked,
  // no power → sealed).
  async useDoor(d) {
    const F = this.state.flags;
    const tried = this.state.tried;
    const shut = () => { if (tried.get(d.id) !== 'open') tried.set(d.id, LOCK_STATE[d.lock] || 'locked'); };
    if (d.locked) {
      switch (d.lock) {
        case 'breaker':
          if (!F.breaker) { shut(); audio.locked(); await this.ui.say(EXAMINE.door_breaker, 'WREN'); return; }
          break;
        case 'code': {
          shut();
          audio.locked();
          await this.ui.say(EXAMINE.door_code);
          const ok = await this.ui.keypad(RELAY_CODE);
          if (!ok) return;
          break;
        }
        case 'keycard':
          if (!this.inv.has('keycard')) { shut(); audio.locked(); await this.ui.say(EXAMINE.door_keycard); return; }
          this.inv.remove('keycard');
          this.ui.toast('USED — <b>SECURITY KEYCARD</b>');
          break;
        case 'power':
          if (!this.state.powered) { shut(); audio.locked(); await this.ui.say(d.bulkhead ? EXAMINE.door_power_bulkhead : EXAMINE.door_power, 'WREN'); return; }
          break;
        case 'obol': {
          if (!this.inv.has('obol')) { shut(); audio.locked(); await this.ui.say(EXAMINE.door_obol, 'WREN'); return; }
          shut();
          const c = await this.ui.choice('The slot is exactly the size of the coin. FARE.', [
            { label: 'PAY THE OBOL', value: 'pay' }, { label: 'KEEP IT', value: 'keep' },
          ]);
          if (c !== 'pay') return;
          this.inv.remove('obol');
          audio.click(0, 3000, 0.4); audio.click(0.3, 800, 0.3);
          await this.wait(0.6);
          break;
        }
      }
      d.locked = false;
    }
    d.open = true;
    tried.set(d.id, 'open');
    this.world.setDoorLamp(d);
    audio.door(true);
  }

  // A door unlocked by something she did elsewhere (breaker, main power):
  // if she has already tried it, the map shows it as passable now.
  unlockDoor(d) {
    d.locked = false;
    this.world.setDoorLamp(d);
    if (this.state.tried.has(d.id)) this.state.tried.set(d.id, 'open');
  }

  async fixture(f) {
    const F = this.state.flags;
    const say = (k, who = 'WREN') => this.ui.say(EXAMINE[k], who);
    switch (f.kind) {
      case 'examine':
        if (f.plan) return this.readPlan(f);
        return say(f.text);
      case 'locker_pistol':
        if (F.pistol) return say('locker_taken');
        if (!this.inv.canAdd('pistol')) return say('inv_full');
        F.pistol = true;
        this.inv.add('pistol', 1);
        this.inv.weapon().loaded = MAG;
        audio.pickup();
        await this.ui.say([this.stowedLine('pistol'), 'A sidearm in the locker, still in its holster. Fully loaded.', 'Someone expected me to need this.'], 'WREN');
        this.hint('aim', 'Hold [RMB] or [Space] to ready · [LMB] or [J] to fire · wait for the box to close');
        return;
      case 'breaker': {
        if (F.breaker) return say('breaker_done');
        F.breaker = true;
        const parts = this.world.parts('A', 'breaker');
        if (parts) { parts.lever.rotation.x = -0.6; parts.lamp.material = M.emissiveGreen(); }
        audio.thud(0.5, 90); audio.click(0.05, 1500, 0.4);
        this.unlockDoor(this.world.doors.dAB);
        this.glitchPulse = 0.4;
        return say('breaker_done');
      }
      case 'save': return this.backupDeck(f);
      case 'box':
        if (!F.lockerSeen) { F.lockerSeen = true; await this.ui.say(EXAMINE.box_note, 'WREN'); }
        audio.pneumatic();
        await this.ui.storage({ inv: this.inv, capacity: 24 });
        this.syncToolClass();
        return;
      case 'locker_keycard':
        if (F.keycard) return say('locker_taken');
        if (!this.inv.canAdd('keycard')) return say('inv_full');
        F.keycard = true;
        this.inv.add('keycard');
        audio.pickup();
        return this.ui.say([this.stowedLine('keycard'), 'A uniform jacket hangs inside. Clipped to the pocket: a security keycard.', 'VARGA. The photo has been scratched away.'], 'WREN');
      case 'cabinet_fuse':
        if (F.fuse) return say('cabinet_empty');
        if (!this.inv.canAdd('fuse')) return say('inv_full');
        F.fuse = true;
        this.inv.add('fuse');
        audio.pickup();
        return this.ui.say([this.stowedLine('fuse'), 'A row of fuse cartridges, all blackened. All but one.'], 'WREN');
      case 'relay': return this.relay();
      case 'memory_window':
        // the handover memory; saves from before the rename carry memPromise
        if (F.memHandover || F.memPromise) return this.ui.say(['Halcyon IV. Enormous. Patient.', 'I keep my eyes on the stars around it instead.'], 'WREN');
        F.memHandover = true;
        await this.ui.say(['The planet fills the window.', 'I have stood exactly here before. I know I have.'], 'WREN');
        await this.playMemory('handover');
        return;
      case 'console': return this.finale();
    }
  }

  // The tape backup deck: a choice in the text box, then the reels turn and
  // the tape spools for 1.2 s before the backup is written.
  async backupDeck() {
    this.hint('backup-deck', 'The backup deck writes your progress to tape. The pneumatic locker keeps what you can\'t carry.');
    const c = await this.ui.choice('BACKUP DECK. Write a backup?', [
      { label: 'WRITE BACKUP', value: 'yes' }, { label: 'CANCEL', value: 'no' },
    ]);
    if (c !== 'yes') return;
    this.world.spinReels(1.2);
    audio.tapeSpool(1.2);
    await this.wait(1.2);
    if (this.saveGame()) this.ui.toast('BACKUP WRITTEN');
    else this.ui.toast('DECK FAULT — TAPE NOT WRITTEN');
  }

  // Sector plan terminals: the sector's rooms go on the map.
  async readPlan(f) {
    const had = this.state.plans.has(f.plan);
    this.state.plans.add(f.plan);
    audio.click(0, 2200, 0.2);
    await this.ui.say(EXAMINE[f.text], 'WREN');
    if (!had) {
      this.ui.toast(`MAP UPDATED — <b>SECTOR ${f.plan}</b>`);
      this.hint('map', 'Sector plans show on the map · [M]');
    }
  }

  async relay() {
    const F = this.state.flags;
    if (this.state.powered) return this.ui.say(EXAMINE.relay_done, 'WREN');
    if (!F.fuseIn) {
      if (!this.inv.has('fuse')) return this.ui.say(EXAMINE.relay_nofuse, 'WREN');
      this.inv.remove('fuse');
      F.fuseIn = true;
      const parts = this.world.parts('J', 'relayPanel');
      if (parts) parts.fuse.visible = true;
      audio.click(0, 1200, 0.5); audio.thud(0.3, 120);
      await this.ui.say(['The fuse seats with a click.', 'Now the load has to be balanced across all five lines.'], 'WREN');
    }
    const ok = await this.ui.relay(F.relay);
    if (ok) await this.powerOn();
  }

  async powerOn() {
    this.state.powered = true;
    this.world.setPowered(true);
    this.applyRelayVisual();
    for (const id of ['dGF', 'dGK']) this.unlockDoor(this.world.doors[id]);
    audio.powerUp();
    this.glitchPulse = 1.5;
    this.shake = 0.5;
    audio.setAmbience(0.6, true);
    await this.wait(2.4);
    this.damageFlash = 0.2;
    for (const e of this.enemies) {
      if (e.def.spawn === 'power' && e.state !== 'dead') {
        e.activate();
        if (e.id === 'e_J1') { e.setState('rising'); audio.screech(0.6); }
      }
    }
    await this.ui.say([...EXAMINE.power_on, 'The bulkhead to the east wing will have power now.'], 'WREN');
  }

  async finale() {
    if (this.state.flags.ending) return this.ui.say(EXAMINE.console_done, 'WREN');
    await this.ui.say([
      { who: '', t: 'The console is looping a recording. A woman\'s voice, very tired, counting slowly — no. Not counting.' },
      { who: '', t: 'Saying a name. Over and over. Mine.' },
      { who: 'WREN', t: 'She left this here so I would come.' },
      { who: 'WREN', t: 'To answer, I have to replace it with my own signal.' },
    ]);
    const ok = await this.ui.wave();
    if (!ok) return;
    this.state.flags.ending = true;
    this.saveGame();
    await this.ending();
  }

  async ending() {
    this.mode = 'cutscene';
    audio.radioBurst(1.5);
    this.glitchPulse = 2;
    this.shake = 0.6;
    audio.powerUp();
    await this.wait(1.5);
    await this.fade(0, 2);
    this.ui.showHud(false);
    audio.setMusic('memory');
    audio.setStatic(0);
    await this.ui.typed(ENDING, { black: true, skippable: false, art: 'ending' });
    await this.ui.typed([
      { t: 'LETHE-7', cls: 'hd' },
      { t: 'END OF SIGNAL', cls: 'dim', pause: 800 },
      { t: '' },
      { t: 'Thank you for playing.', cls: 'voice' },
    ], { black: true });
    audio.setMusic('none');
    this.scene = null;
    this.titleLoop();
  }

  // Debug/test helper: jump somewhere without triggering room scripts.
  debugTeleport(x, z, yaw = 0) {
    this.player.setPosition(x, z, yaw);
    this.controls.reset();
    const r = this.world.roomAt(x, z);
    if (r) { this.state.currentRoom = r; this.state.visited.add(r); }
    this.world.updateVisibility(this.state.currentRoom, z);
    this.updateCamera(1, true);
  }

  // ------------------------------------------------------------------ menus
  async openInventory(tab) {
    await this.script(async () => {
      await this.ui.inventory(this.inventoryCtx(), tab);
    });
    this.syncToolClass();
  }

  // The Custodian OS context (plan §3.3): the base fields plus condition,
  // equipment, combining, discarding and what the map knows.
  inventoryCtx() {
    const G = this;
    return {
      inv: this.inv, player: this.player, doors: this.world.doors,
      visited: this.state.visited, currentRoom: this.state.currentRoom,
      actions: (i) => this.itemActions(i),
      conditionLevel: this.player.conditionLevel,
      equipped: {
        get weapon() { return G.equippedSlot('weapon'); },
        set weapon(i) { G.setEquipped('weapon', i); },
        get tool() { return G.equippedSlot('tool'); },
        set tool(i) { G.setEquipped('tool', i); },
      },
      equip: (i) => this.equipSlot(i),
      combine: (i, j) => this.combineItems(i, j),
      discard: (i) => this.discardItem(i),
      map: { plans: this.state.plans, tried: this.state.tried, markers: this.mapMarkers() },
      cycle: CYCLE,
    };
  }

  itemActions(i) {
    const s = this.inv.slots[i];
    const def = ITEMS[s.id];
    const P = this.player;
    const acts = [];
    if (def.kind === 'heal') {
      acts.push({
        label: 'USE',
        fn: () => {
          if (P.hp >= P.maxHp) { this.ui.toast('INTEGRITY FULL — NOT USED'); return; }
          P.heal(def.heal);
          this.inv.remove(s.id, 1);
          audio.blip(440, 0.3, 'sine', 0.06); audio.blip(660, 0.4, 'sine', 0.05, 0.12);
          this.ui.toast(`USED — <b>${def.name}</b>`);
        },
      });
    }
    if (def.kind === 'weapon') {
      acts.push({
        label: 'RELOAD',
        fn: () => { const r = this.loadWeapon(s); this.ui.toast(r.msg); },
      });
    }
    if (s.id === 'photo') acts.push({ label: 'REMEMBER', fn: async () => { await this.playMemory('window'); return 'close'; } });
    return acts;
  }

  // ---- equipment: the item id per kind; null = stowed on purpose, absent =
  // the first one carried (so a sidearm picked up is ready to use)
  equippedSlot(kind) {
    const want = this.equip[kind];
    if (want === null) return null;
    const slots = this.inv.slots;
    if (want) { const i = slots.findIndex((s) => s && s.id === want); if (i >= 0) return i; }
    const i = slots.findIndex((s) => s && ITEMS[s.id] && ITEMS[s.id].kind === kind);
    return i >= 0 ? i : null;
  }

  setEquipped(kind, i) {
    const s = i == null ? null : this.inv.slots[i];
    this.equip[kind] = s ? s.id : null;
    this.syncToolClass();
  }

  equipSlot(i) {
    const s = this.inv.slots[i];
    if (!s || !ITEMS[s.id]) return;
    const kind = ITEMS[s.id].kind === 'tool' ? 'tool' : 'weapon';
    this.setEquipped(kind, this.equippedSlot(kind) === i ? null : i);
    audio.click(0, 1800, 0.25);
  }

  currentWeapon() {
    const i = this.equippedSlot('weapon');
    return i == null ? null : this.inv.slots[i];
  }

  // body.has-tool shows the touch TOOL button while a tool is equipped.
  syncToolClass() {
    const on = !!this.inv && this.equippedSlot('tool') != null;
    if (on === this.hasTool) return;
    this.hasTool = on;
    document.body.classList.toggle('has-tool', on);
  }

  // Top up a weapon's magazine from carried rounds (the dragged stack first).
  loadWeapon(w, fromSlot = -1) {
    if (!w) return { ok: false, msg: 'NO WEAPON' };
    const need = MAG - (w.loaded || 0);
    if (need <= 0) return { ok: false, msg: 'MAGAZINE FULL' };
    let got = 0;
    const src = this.inv.slots[fromSlot];
    if (src && ITEMS[src.id] && ITEMS[src.id].kind === 'ammo') {
      got = Math.min(need, src.qty);
      src.qty -= got;
      if (src.qty <= 0) this.inv.slots[fromSlot] = null;
    }
    got += this.inv.remove('ammo', need - got);
    if (!got) return { ok: false, msg: 'NO AMMUNITION' };
    w.loaded = (w.loaded || 0) + got;
    audio.reload();
    return { ok: true, msg: `LOADED — ${String(w.loaded).padStart(2, '0')} / ${String(MAG).padStart(2, '0')}` };
  }

  // Drag one item onto another: rounds onto the sidearm load it; two part
  // stacks of the same thing become one. Anything else doesn't fit.
  combineItems(i, j) {
    const inv = this.inv, a = inv.slots[i], b = inv.slots[j];
    if (!a || !b || i === j) return { ok: false };
    const da = ITEMS[a.id], db = ITEMS[b.id];
    if (!da || !db) return { ok: false };
    if (da.kind === 'ammo' && db.kind === 'weapon') return this.loadWeapon(b, i);
    if (da.kind === 'weapon' && db.kind === 'ammo') return this.loadWeapon(a, j);
    if (a.id === b.id && da.stack > 1) {
      const move = Math.min(a.qty, da.stack - b.qty);
      if (move <= 0) return { ok: false, msg: 'STACK FULL' };
      b.qty += move; a.qty -= move;
      if (a.qty <= 0) inv.slots[i] = null;
      return { ok: true, msg: `STACKED — ${da.name} ×${b.qty}` };
    }
    return { ok: false };
  }

  // Throw an item away. Key items, memories and the sidearm stay.
  discardItem(i) {
    const s = this.inv.slots[i];
    const def = s && ITEMS[s.id];
    if (!def || ['key', 'memory', 'weapon'].includes(def.kind)) return false;
    this.inv.slots[i] = null;
    audio.softThunk(0, 90, 0.12);
    this.syncToolClass();
    return true;
  }

  // Map markers: items seen (in rooms she has entered) and not taken, the
  // backup decks and lockers she knows of, and fixtures still to be used.
  mapMarkers() {
    const S = this.state, F = S.flags, out = [];
    const known = (room) => S.visited.has(room) || S.plans.has(ROOMS[room] && ROOMS[room].sector);
    for (const p of this.pickups) if (S.visited.has(p.def.room)) out.push({ x: p.def.x, z: p.def.z, kind: 'item' });
    const pending = {
      locker_pistol: !F.pistol, locker_keycard: !F.keycard, cabinet_fuse: !F.fuse, breaker: !F.breaker,
      relay: !S.powered, console: !F.ending, memory_window: !(F.memHandover || F.memPromise),
    };
    for (const f of FIXTURES) {
      if (f.kind === 'save' && known(f.room)) out.push({ x: f.x, z: f.z, kind: 'save' });
      else if (f.kind === 'box' && known(f.room)) out.push({ x: f.x, z: f.z, kind: 'fixture' });
      else if (pending[f.kind] && S.visited.has(f.room)) out.push({ x: f.x, z: f.z, kind: 'fixture' });
    }
    return out;
  }

  async openPause() {
    await this.script(async () => {
      const r = await this.ui.pause();
      if (r === 'title') {
        await this.fade(0, 0.6);
        this.scene = null;
        this.mode = 'title';
        this.titleLoop();
      }
    });
  }

  // ------------------------------------------------------------------ death
  // Plan §7.2: the frame freezes for two frames under a red split, the fall
  // plays out, a signal-loss band sweeps down the screen (0.3 s), the picture
  // cuts to hard black for 0.8 s, and then the quiet NO RESPONSE screen.
  startDeath() {
    this.dying = { freeze: 2, split: DEATH_SPLIT, t: 0, black: false, menu: false };
    this.damageFlash = 1;
    this.shake = Math.max(this.shake, 0.3);
    this.cut = null;
    audio.setMusic('none');
  }

  updateDeathPost(dt, u) {
    const D = this.dying;
    u.uFringe.value = 0;
    u.uSweep.value = -1;
    if (!D) return;
    if (D.split > 0) {
      u.uFringe.value = this.ui.settings && this.ui.settings.reduceFlash ? 1 : 3;
      if (!D.freeze) D.split = Math.max(0, D.split - dt);
    }
    if (this.mode !== 'dying') return;
    D.t += dt;
    if (D.t < DEATH_SWEEP) {
      if (!D.swept) { D.swept = true; audio.radioBurst(0.35); audio.setStatic(0.8); }
      u.uSweep.value = D.t / DEATH_SWEEP;
      u.uTear.value = Math.max(u.uTear.value, 0.5);
      return;
    }
    if (!D.black) {
      D.black = true;
      this.fadeAnim = null;
      this.fadeValue = 0;
      u.uTear.value = 0;
      audio.setStatic(0);
      audio.setAmbience(0);
    }
    if (D.t >= DEATH_SWEEP + DEATH_BLACK && !D.menu) { D.menu = true; this.onDeath(); }
  }

  async onDeath() {
    const choice = await this.ui.death(this.hasSave());
    if (choice === 'load') await this.loadGame();
    else { this.scene = null; this.titleLoop(); }
  }

  // ------------------------------------------------------------------ title scene
  buildTitleScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x000000);
    this.titleScene = s;
    this.titleCam = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 400);
    this.titleCam.position.set(0, 0, 30);
    const tex = Tex.planet(7).clone();
    tex.needsUpdate = true;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(14, 32, 20), new THREE.MeshLambertMaterial({ map: tex }));
    planet.position.set(10, -8, -20);
    planet.rotation.z = 0.35;
    s.add(planet);
    this.titlePlanet = planet;
    // rings
    const rc = document.createElement('canvas'); rc.width = 128; rc.height = 4;
    const rg = rc.getContext('2d');
    for (let x = 0; x < 128; x++) { const a = (Math.sin(x * 0.7) * 0.5 + 0.5) * (x > 20 && x < 120 ? 0.8 : 0); rg.fillStyle = `rgba(220,200,170,${a})`; rg.fillRect(x, 0, 1, 4); }
    const rt = new THREE.CanvasTexture(rc);
    rt.magFilter = rt.minFilter = THREE.NearestFilter;
    const ringGeo = new THREE.RingGeometry(17, 28, 64, 1);
    const pos = ringGeo.attributes.position, uv = ringGeo.attributes.uv;
    for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (r - 17) / 11, 0.5); }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshLambertMaterial({ map: rt, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -1.35;
    planet.add(ring);
    const sun = new THREE.DirectionalLight(0xfff0e0, 3.2);
    sun.position.set(-30, 10, 10);
    s.add(sun);
    s.add(new THREE.AmbientLight(0x101418, 1));
    // stars
    const n = 900, sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1), r = 150;
      sp[i * 3] = Math.sin(ph) * Math.cos(th) * r; sp[i * 3 + 1] = Math.sin(ph) * Math.sin(th) * r; sp[i * 3 + 2] = Math.cos(ph) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    s.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xcfd6d8, size: 1, sizeAttenuation: false })));
    // the station: a small ring with spokes, silhouetted against the planet
    const st = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2c2e });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.28, 6, 24), dark);
    st.add(torus);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.4, 0.12), dark);
      spoke.rotation.z = i * Math.PI / 4;
      st.add(spoke);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.6, 8), dark);
    hub.rotation.x = Math.PI / 2;
    st.add(hub);
    const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    beacon.position.set(0, 0, 0.9);
    st.add(beacon);
    this.titleBeacon = beacon;
    st.position.set(-3, 2.5, 4);
    st.rotation.set(0.9, 0.4, 0);
    s.add(st);
    this.titleStation = st;
  }

  updateTitle(dt) {
    if (!this.titlePlanet) return;
    this.titlePlanet.rotation.y += dt * 0.02;
    this.titleStation.rotation.z += dt * 0.08;
    this.titleBeacon.visible = Math.sin(this.time * 3) > 0.6;
    const t = this.time * 0.05;
    this.titleCam.position.set(Math.sin(t) * 2, Math.cos(t * 0.7) * 1, 30);
    this.titleCam.lookAt(2, 0, 0);
  }
}

// Minimal CPU particle system rendered as screen-space pixels.
class Particles {
  constructor(scene) {
    this.max = 400;
    this.pos = new Float32Array(this.max * 3);
    this.col = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;
    // tracer line
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.tracerLine = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xfff0c0, transparent: true }));
    this.tracerLine.frustumCulled = false;
    this.tracerLine.visible = false;
    scene.add(this.tracerLine);
    this.tracerT = 0;
    for (let k = 0; k < this.max; k++) this.pos[k * 3 + 1] = -100;
  }

  burst(at, color, n, speed) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.i; this.i = (this.i + 1) % this.max;
      this.pos[i * 3] = at.x; this.pos[i * 3 + 1] = at.y; this.pos[i * 3 + 2] = at.z;
      this.vel[i * 3] = (Math.random() - 0.5) * speed;
      this.vel[i * 3 + 1] = Math.random() * speed * 0.8;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.life[i] = 0.4 + Math.random() * 0.6;
    }
  }

  tracer(a, b) {
    const arr = this.tracerLine.geometry.attributes.position.array;
    arr[0] = a.x; arr[1] = a.y; arr[2] = a.z; arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
    this.tracerLine.geometry.attributes.position.needsUpdate = true;
    this.tracerLine.visible = true;
    this.tracerT = 0.05;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3] *= 0.3; this.vel[i * 3 + 2] *= 0.3; this.vel[i * 3 + 1] = 0; }
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -100;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.tracerT -= dt;
    this.tracerLine.visible = this.tracerT > 0;
  }
}

// Stable 0..1 from a string (pickup yaw and glint phase stay put across loads).
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}
