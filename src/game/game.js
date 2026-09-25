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
import { ROOMS, PICKUPS, ENEMIES, FIXTURES, PLAYER_START } from './map.js';
import { INTRO, EXAMINE, ENDING } from './story.js';
import { UI } from '../ui/ui.js';
import { M } from './props.js';

const SAVE_KEY = 'lethe7-save';
const RELAY_CODE = '7304';
const MAG = 8;

export class Game {
  constructor() {
    this.canvas = document.getElementById('view');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas);
    this.ui = new UI(this.input);
    this.camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.5, 80);
    this.renderer.onResize = (a) => { this.camera.aspect = a; this.camera.updateProjectionMatrix(); if (this.titleCam) { this.titleCam.aspect = a; this.titleCam.updateProjectionMatrix(); } };
    this.renderer.onResize(this.renderer.aspect);
    this.mode = 'boot';
    this.time = 0;
    this.fadeAnim = null;
    this.shake = 0;
    this.damageFlash = 0;
    this.glitchPulse = 0;
    this.tint = 0;
    this.tintTarget = 0;
    this.heartT = 0;
    this.clankT = 8;
    this.applySettings(this.ui.settings);
    this.ui.onSettings = (s) => this.applySettings(s);
    this.buildTitleScene();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  applySettings(s) {
    const u = this.renderer.uniforms;
    u.uScan.value = s.crt ? 0.35 : 0;
    u.uCurve.value = s.crt ? 0.035 : 0;
    document.getElementById('crt').style.display = s.crt ? '' : 'none';
    this.renderer.setLowHeight(s.res);
  }

  // ------------------------------------------------------------------ flow
  async start() {
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
    this.renderer.uniforms.uFade.value = 0;
    await this.ui.typed(INTRO, { black: true });
    this.mode = 'play';
    this.ui.showHud(true);
    audio.setAmbience(0.6);
    this.glitchPulse = 1.2;
    audio.radioBurst(0.6);
    await this.fade(1, 2.2);
    await this.script(async () => {
      await this.wait(0.4);
      await this.ui.say(EXAMINE.wake, 'WREN');
      this.ui.toast('Objective: <b>find out who woke you</b>');
      if (document.body.classList.contains('touching')) this.ui.toast('<b>STICK</b> move · <b>ACT</b> interact · <b>AIM</b> + <b>FIRE</b> to shoot');
      else this.ui.toast('<b>WASD</b> move · <b>SHIFT</b> run · <b>E</b> interact · <b>TAB</b> inventory');
    });
  }

  async loadGame() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { data = null; }
    if (!data) return this.titleLoop();
    this.setupLevel(data);
    this.mode = 'play';
    this.ui.showHud(true);
    audio.setAmbience(0.6, this.state.powered);
    this.glitchPulse = 1;
    audio.radioBurst(0.5);
    await this.fade(1, 1.4);
    this.ui.toast('STATE RESTORED');
  }

  saveGame() {
    const s = this.state;
    const data = {
      v: 1,
      player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw, hp: this.player.hp },
      inv: this.inv.serialize(),
      flags: s.flags,
      powered: s.powered,
      taken: [...s.taken],
      doors: Object.fromEntries(Object.values(this.world.doors).map((d) => [d.id, { open: d.open, locked: d.locked }])),
      enemies: Object.fromEntries(this.enemies.map((e) => [e.id, e.state === 'dead' || (e.state === 'down' && (!e.def.revive || e.revived)) ? 'dead' : e.active ? 'alive' : 'inactive'])),
      visited: [...s.visited],
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
    this.hemi = new THREE.HemisphereLight(0x303840, 0x100808, 0.5);
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
      currentRoom: 'A',
    };
    this.player.onReloadDone = () => this.finishReload();

    if (save) {
      this.player.setPosition(save.player.x, save.player.z, save.player.yaw);
      this.player.hp = save.player.hp;
      this.inv.load(save.inv);
      this.state.flags = save.flags;
      this.state.powered = save.powered;
      this.state.taken = new Set(save.taken);
      this.state.visited = new Set(save.visited);
      for (const [id, d] of Object.entries(save.doors)) {
        const door = this.world.doors[id];
        door.open = d.open; door.locked = d.locked; door.t = d.open ? 1 : 0;
        door.leafL.position.x = -0.25 - door.t * 0.46; door.leafR.position.x = 0.25 + door.t * 0.46;
        this.world.setDoorLamp(door);
      }
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
    this.deathShown = false;
    this.ui.roomName(ROOMS[r].name);
    audio.setMusic(ROOMS[r].safe ? 'quiet' : 'none');
  }

  makePickup(p) {
    const g = new THREE.Group();
    const y = p.y ?? 0;
    let mesh;
    const matBasic = (c) => new THREE.MeshLambertMaterial({ color: c });
    if (p.file) {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.36), M.paper());
      mesh.rotation.x = -Math.PI / 2; mesh.rotation.z = 0.3;
      mesh.position.y = 0.01;
    } else if (p.item === 'ammo') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.18), matBasic(0x8a7a50));
      mesh.position.y = 0.07;
    } else if (p.item === 'sealant') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.26, 7), matBasic(0xa02830));
      mesh.position.y = 0.13;
    } else if (p.item === 'nanite') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 6), new THREE.MeshBasicMaterial({ color: 0x9ff0ff }));
      mesh.position.y = 0.08;
    } else if (p.item === 'photo') {
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.16), new THREE.MeshLambertMaterial({ color: 0xd8d0c0 }));
      mesh.rotation.x = -Math.PI / 2; mesh.position.y = 0.01;
    } else if (p.item === 'obol') {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.015, 10), new THREE.MeshLambertMaterial({ color: 0xc8ccd0 }));
      mesh.position.y = 0.01;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), matBasic(0x888888));
    }
    g.add(mesh);
    const glint = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ map: Tex.glint(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    glint.position.y = 0.3;
    glint.renderOrder = 10;
    g.add(glint);
    g.position.set(p.x, y, p.z);
    this.world.rooms[p.room].group.add(g);
    return { def: p, obj: g, glint, seed: Math.random() * 10 };
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
      this.fadeAnim = { from: this.renderer.uniforms.uFade.value, to, dur, t: 0, resolve };
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
      this.renderer.uniforms.uFade.value = f.from + (f.to - f.from) * k;
      if (k >= 1) { this.fadeAnim = null; f.resolve(); }
    }

    this.ui.update(dt);

    if (this.mode === 'title' || this.mode === 'boot') {
      this.updateTitle(dt);
      this.renderer.uniforms.uGlitch.value = 0.08 + Math.max(0, Math.sin(this.time * 0.7)) ** 20 * 0.8;
      this.renderer.uniforms.uTint.value = 0;
      this.renderer.uniforms.uRedAlert.value = 0;
      this.renderer.uniforms.uDamage.value = 0;
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
  }

  update(dt) {
    const input = this.input;
    const P = this.player;

    // menus
    if (input.pause) { this.openPause(); return; }
    if (input.inventory && !P.dead) { this.openInventory('items'); return; }
    if (input.map && !P.dead) { this.openInventory('map'); return; }

    // controls
    const weapon = this.inv.weapon();
    const aimHeld = input.aim;
    if (aimHeld && !this.aimWasHeld) { this.mouseAim = input.mouse.right; this.autoAimDone = false; }
    if (!aimHeld) this.mouseAim = false;
    if (aimHeld && input.mouse.moved) this.mouseAim = true;
    this.aimWasHeld = aimHeld;

    const move = input.moveVector();
    let aimDir = null;
    if (aimHeld && weapon) {
      const stick = input.aimStick();
      if (stick) aimDir = new THREE.Vector2(stick.x, stick.y);
      else if (this.mouseAim) aimDir = this.mouseGroundDir();
      else if (Math.hypot(move.x, move.y) < 0.2 && !this.autoAimDone) {
        const t = this.nearestTarget(null);
        if (t) aimDir = new THREE.Vector2(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
        this.autoAimDone = true;
      }
      // soft aim assist
      const base = aimDir || (Math.hypot(move.x, move.y) > 0.2 ? new THREE.Vector2(move.x, move.y) : new THREE.Vector2(Math.sin(P.aimYaw), Math.cos(P.aimYaw)));
      const t = this.nearestTarget(base, 0.2);
      if (t) aimDir = new THREE.Vector2(t.pos.x - P.pos.x, t.pos.z - P.pos.z);
    }
    input.mouse.moved = false;

    const room = this.state.currentRoom;
    const surface = { plate: 'plate', grate: 'grate', carpet: 'carpet', tile: 'plate', concrete: 'plate' }[ROOMS[room].floor];
    P.update(dt, {
      move, run: input.run, aim: aimHeld, hasWeapon: !!weapon, aimDir, enemies: this.enemies,
    }, this.world, surface);

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

    // interactables
    const it = P.dead ? null : this.findInteractable();
    this.ui.prompt(it ? it.label : null);
    if (it && input.interact) this.script(() => it.run());

    // HUD
    if (weapon) this.ui.ammo(P.aiming || P.reloadT > 0, weapon.loaded, this.inv.count('ammo'));
    else this.ui.ammo(false);

    // atmosphere
    let threat = 0;
    for (const e of this.enemies) {
      if (!e.active || !(e.threatening || e.state === 'dormant' || e.state === 'idle')) continue;
      const d = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
      const w = e.threatening ? 1 : 0.35;
      threat = Math.max(threat, Math.max(0, 1 - d / 9) * w);
    }
    this.threat = threat;
    audio.setStatic(threat);
    this.clankT -= dt;
    if (this.clankT <= 0) { this.clankT = 10 + Math.random() * 20; if (!ROOMS[room].safe) audio.distantClank(); }

    const crit = P.hp <= 33 && !P.dead;
    this.ui.lowHp(crit ? 0.6 + Math.sin(this.time * 4) * 0.2 : P.hp <= 66 ? 0.15 : 0);
    if (crit) { this.heartT -= dt; if (this.heartT <= 0) { this.heartT = 0.9; audio.heartbeat(); } }

    // death
    if (P.dead && P.deadT > 2.2 && !this.deathShown) { this.deathShown = true; this.onDeath(); }

    this.updateCamera(dt);
  }

  updateGlints(dt) {
    for (const p of this.pickups) {
      p.glint.quaternion.copy(this.camera.quaternion);
      const k = 0.6 + 0.4 * Math.sin(this.time * 4 + p.seed);
      p.glint.scale.setScalar(0.6 + k * 0.6);
      p.glint.material.opacity = 0.4 + 0.6 * Math.max(0, Math.sin(this.time * 2.3 + p.seed));
      p.glint.rotation.z = this.time * 0.5;
    }
  }

  updatePost(dt) {
    const u = this.renderer.uniforms;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    this.glitchPulse = Math.max(0, this.glitchPulse - dt * 1.5);
    this.tint += (this.tintTarget - this.tint) * Math.min(1, dt * 1.5);
    u.uDamage.value = this.damageFlash;
    u.uGlitch.value = Math.min(1, (this.threat || 0) * 0.35 + this.glitchPulse + (Math.random() < 0.002 ? 0.5 : 0));
    u.uTint.value = this.tint;
    const crit = this.player && this.player.hp <= 33 && !this.player.dead;
    u.uRedAlert.value = crit ? 0.18 + 0.12 * Math.sin(this.time * 4) : 0;
  }

  // ------------------------------------------------------------------ camera
  updateCamera(dt, snap = false) {
    const P = this.player;
    const look = new THREE.Vector3(P.pos.x, 0, P.pos.z);
    const ahead = P.aiming ? 1.6 : 0.9 * Math.min(1, P.speed / 2);
    look.x += Math.sin(P.yaw) * ahead;
    look.z += Math.cos(P.yaw) * ahead;
    if (snap) this.camTarget.copy(look);
    else this.camTarget.lerp(look, Math.min(1, dt * 3.2));
    const pitch = THREE.MathUtils.degToRad(58);
    // pull back on narrow (portrait) screens so rooms still fit across
    const dist = 14.5 * Math.min(1.9, Math.max(1, 1.15 / this.camera.aspect));
    this.camera.position.set(
      this.camTarget.x,
      this.camTarget.y + Math.sin(pitch) * dist,
      this.camTarget.z + Math.cos(pitch) * dist,
    );
    this.camera.lookAt(this.camTarget.x, 0.6, this.camTarget.z);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const s = this.shake * 0.25;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
    }
  }

  mouseGroundDir() {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(this.input.mouse.nx, this.input.mouse.ny), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    const d = new THREE.Vector2(hit.x - this.player.pos.x, hit.z - this.player.pos.z);
    return d.lengthSq() > 0.01 ? d : null;
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
    const w = this.inv.weapon();
    if (!w || P.fireCd > 0 || P.reloadT > 0) return;
    if (w.loaded <= 0) {
      audio.dryFire();
      P.fireCd = 0.3;
      if (this.inv.count('ammo') > 0) this.startReload();
      else this.ui.toast('Out of ammunition.');
      return;
    }
    w.loaded--;
    P.fireCd = 0.36;
    audio.gunshot();
    P.flashMuzzle(this.camera);
    this.shake = Math.max(this.shake, 0.18);
    this.glitchPulse = Math.max(this.glitchPulse, 0.12);
    const o = P.muzzleWorld();
    const dx = Math.sin(P.yaw), dz = Math.cos(P.yaw);
    const wallDist = this.world.raycast(o.x, o.z, dx, dz, 30);
    let hit = null, hitT = wallDist;
    for (const e of this.enemies) {
      const t = e.rayHit(o.x, o.z, dx, dz);
      if (t !== null && t < hitT) { hitT = t; hit = e; }
    }
    const end = new THREE.Vector3(o.x + dx * Math.min(hitT, 30), o.y, o.z + dz * Math.min(hitT, 30));
    this.particles.tracer(o, end);
    if (hit) {
      const killed = hit.takeHit(19 + Math.floor(Math.random() * 8), P.yaw);
      this.particles.burst(end, 0x3a0608, 14, 2.2);
      this.particles.burst(end, 0xff3020, 4, 3);
      if (killed) this.glitchPulse = 0.5;
    } else if (wallDist < 30) {
      this.particles.burst(end, 0xffe0a0, 8, 3);
      audio.impact(false);
    }
  }

  startReload() {
    const P = this.player;
    const w = this.inv.weapon();
    if (!w || P.reloadT > 0 || w.loaded >= MAG) return;
    if (this.inv.count('ammo') <= 0) { this.ui.toast('No ammunition.'); return; }
    P.reloadT = 1.1;
    audio.reload();
  }

  finishReload() {
    const w = this.inv.weapon();
    if (!w) return;
    const need = MAG - w.loaded;
    const got = this.inv.remove('ammo', need);
    w.loaded += got;
  }

  // ------------------------------------------------------------------ rooms
  enterRoom(r) {
    const first = !this.state.visited.has(r);
    this.state.currentRoom = r;
    this.state.visited.add(r);
    this.ui.roomName(ROOMS[r].name);
    audio.setMusic(ROOMS[r].safe ? 'quiet' : 'none');
    audio.setAmbience(ROOMS[r].safe ? 0.15 : 0.6, this.state.powered);
    if (first && r === 'M') this.script(() => this.ui.say(EXAMINE.enter_M, 'WREN'));
    if (first && r === 'G') this.script(async () => { await this.wait(0.6); await this.ui.say(['The concourse. Emergency lighting only.', 'Something is sitting against the far wall.'], 'WREN'); });
  }

  // ------------------------------------------------------------------ interaction
  findInteractable() {
    const P = this.player;
    const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
    let best = null, bestD = Infinity;
    const consider = (x, z, r, label, run) => {
      const dx = x - P.pos.x, dz = z - P.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > r + 0.35) return;
      const facing = d < 0.5 ? 1 : (dx * fx + dz * fz) / d;
      if (facing < 0.1) return;
      const score = d - facing * 0.5;
      if (score < bestD) { bestD = score; best = { label, run }; }
    };
    for (const p of this.pickups) {
      const d = p.def;
      consider(d.x, d.z, 0.75, d.file ? 'READ' : 'TAKE', () => this.takePickup(p));
    }
    for (const f of FIXTURES) {
      if (f.room !== this.state.currentRoom) continue;
      const label = { save: 'RECORD', box: 'OPEN TRUNK', relay: 'PANEL', console: 'ARRAY CONSOLE' }[f.kind] || 'EXAMINE';
      consider(f.x, f.z, f.r, label, () => this.fixture(f));
    }
    for (const d of Object.values(this.world.doors)) {
      if (d.open) continue;
      const cx = d.x + 0.5, cz = d.z + 0.5;
      consider(cx, cz, 1.0, d.locked ? 'EXAMINE DOOR' : 'OPEN', () => this.useDoor(d));
    }
    return best;
  }

  removePickup(p) {
    p.obj.parent.remove(p.obj);
    this.pickups.splice(this.pickups.indexOf(p), 1);
    this.state.taken.add(p.def.id);
  }

  async takePickup(p) {
    const d = p.def;
    if (d.file) {
      this.removePickup(p);
      const isNew = this.inv.addFile(d.file);
      await this.ui.document(d.file, isNew);
      if (d.file === 'bulletin') this.ui.toast('Relay code noted: <b>7-3-0-4</b>');
      if (d.file === 'final') this.ui.toast('Objective: <b>reach the communications array</b>');
      return;
    }
    if (!this.inv.canAdd(d.item, 1)) { await this.ui.say(EXAMINE.inv_full, 'WREN'); return; }
    const left = this.inv.add(d.item, d.qty);
    audio.pickup();
    const name = ITEMS[d.item].name;
    this.ui.toast(`OBTAINED: <b>${name}</b>${d.qty > 1 ? ' ×' + (d.qty - left) : ''}`);
    if (left > 0) { d.qty = left; this.ui.toast('Not enough room for the rest.'); return; }
    this.removePickup(p);
    if (d.item === 'photo') {
      await this.ui.say(['A photograph, tucked under a pillow.'], 'WREN');
      await this.playMemory('window');
    }
    if (d.item === 'obol') {
      await this.ui.say(['A silver coin with a boat on it. It was left here on purpose.', 'FOR W.'], 'WREN');
    }
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

  async useDoor(d) {
    const F = this.state.flags;
    if (d.locked) {
      switch (d.lock) {
        case 'breaker':
          if (!F.breaker) { audio.locked(); await this.ui.say(EXAMINE.door_breaker, 'WREN'); return; }
          break;
        case 'code': {
          audio.locked();
          await this.ui.say(EXAMINE.door_code);
          const ok = await this.ui.keypad(RELAY_CODE);
          if (!ok) return;
          break;
        }
        case 'keycard':
          if (!this.inv.has('keycard')) { audio.locked(); await this.ui.say(EXAMINE.door_keycard); return; }
          this.inv.remove('keycard');
          this.ui.toast('Used <b>SECURITY KEYCARD</b> — discarded.');
          break;
        case 'power':
          if (!this.state.powered) { audio.locked(); await this.ui.say(d.bulkhead ? EXAMINE.door_power_bulkhead : EXAMINE.door_power, 'WREN'); return; }
          break;
        case 'obol': {
          if (!this.inv.has('obol')) { audio.locked(); await this.ui.say(EXAMINE.door_obol, 'WREN'); return; }
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
    this.world.setDoorLamp(d);
    audio.door(true);
  }

  async fixture(f) {
    const F = this.state.flags;
    const say = (k, who = 'WREN') => this.ui.say(EXAMINE[k], who);
    switch (f.kind) {
      case 'examine': return say(f.text);
      case 'locker_pistol':
        if (F.pistol) return say('locker_taken');
        F.pistol = true;
        this.inv.add('pistol', 1);
        this.inv.weapon().loaded = MAG;
        audio.pickup();
        this.ui.toast('OBTAINED: <b>P-17 SIDEARM</b> [8]');
        await this.ui.say(['A sidearm in the locker, still in its holster. Fully loaded.', 'Someone expected me to need this.'], 'WREN');
        this.ui.toast('Hold <b>RIGHT MOUSE</b> or <b>SPACE</b> to aim · <b>CLICK</b> or <b>F</b> to fire');
        return;
      case 'breaker': {
        if (F.breaker) return say('breaker_done');
        F.breaker = true;
        const parts = this.world.parts('A', 'breaker');
        if (parts) { parts.lever.rotation.x = -0.6; parts.lamp.material = M.emissiveGreen(); }
        audio.thud(0.5, 90); audio.click(0.05, 1500, 0.4);
        const door = this.world.doors.dAB;
        door.locked = false;
        this.world.setDoorLamp(door);
        this.glitchPulse = 0.4;
        return say('breaker_done');
      }
      case 'save': {
        const c = await this.ui.choice('MNEMONIC RECORDER. Record current state?', [
          { label: 'RECORD', value: 'yes' }, { label: 'CANCEL', value: 'no' },
        ]);
        if (c !== 'yes') return;
        audio.radioBurst(0.3);
        this.glitchPulse = 0.6;
        if (this.saveGame()) this.ui.toast('STATE RECORDED');
        else this.ui.toast('RECORDER FAULT — storage unavailable');
        return;
      }
      case 'box':
        await this.ui.say(EXAMINE.box_note, 'WREN');
        await this.ui.storage({ inv: this.inv });
        return;
      case 'locker_keycard':
        if (F.keycard) return say('locker_taken');
        if (!this.inv.canAdd('keycard')) return say('inv_full');
        F.keycard = true;
        this.inv.add('keycard');
        audio.pickup();
        this.ui.toast('OBTAINED: <b>SECURITY KEYCARD</b>');
        return this.ui.say(['A uniform jacket hangs inside. Clipped to the pocket: a security keycard.', 'VARGA. The photo has been scratched away.'], 'WREN');
      case 'cabinet_fuse':
        if (F.fuse) return say('cabinet_empty');
        if (!this.inv.canAdd('fuse')) return say('inv_full');
        F.fuse = true;
        this.inv.add('fuse');
        audio.pickup();
        this.ui.toast('OBTAINED: <b>BREAKER FUSE</b>');
        return this.ui.say(['A row of fuse cartridges, all blackened. All but one.'], 'WREN');
      case 'relay': return this.relay();
      case 'memory_window':
        if (F.memPromise) return this.ui.say(['Halcyon IV. Enormous. Patient.', 'I keep my eyes on the stars around it instead.'], 'WREN');
        F.memPromise = true;
        await this.ui.say(['The planet fills the window.', 'I have stood exactly here before. I know I have.'], 'WREN');
        await this.playMemory('promise');
        return;
      case 'console': return this.finale();
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
    for (const id of ['dGF', 'dGK']) {
      const d = this.world.doors[id];
      d.locked = false;
      this.world.setDoorLamp(d);
    }
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
    await this.ui.say(EXAMINE.power_on, 'WREN');
    this.ui.toast('Objective: <b>east corridor bulkhead is open</b>');
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
    const r = this.world.roomAt(x, z);
    if (r) { this.state.currentRoom = r; this.state.visited.add(r); }
    this.world.updateVisibility(this.state.currentRoom, z);
    this.updateCamera(1, true);
  }

  // ------------------------------------------------------------------ menus
  async openInventory(tab) {
    await this.script(async () => {
      await this.ui.inventory({
        inv: this.inv, player: this.player, doors: this.world.doors,
        visited: this.state.visited, currentRoom: this.state.currentRoom,
        actions: (i) => this.itemActions(i),
      }, tab);
    });
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
          if (P.hp >= P.maxHp) { this.ui.toast('Integrity already nominal.'); return; }
          P.hp = Math.min(P.maxHp, P.hp + def.heal);
          this.inv.remove(s.id, 1);
          audio.blip(440, 0.3, 'sine', 0.06); audio.blip(660, 0.4, 'sine', 0.05, 0.12);
          this.ui.toast(`Used <b>${def.name}</b>.`);
        },
      });
    }
    if (s.id === 'pistol') {
      acts.push({
        label: 'RELOAD',
        fn: () => {
          if (s.loaded >= MAG) { this.ui.toast('Magazine is full.'); return; }
          const got = this.inv.remove('ammo', MAG - s.loaded);
          if (!got) { this.ui.toast('No ammunition.'); return; }
          s.loaded += got;
          audio.reload();
        },
      });
    }
    if (s.id === 'photo') acts.push({ label: 'REMEMBER', fn: async () => { await this.playMemory('window'); return 'close'; } });
    return acts;
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

  async onDeath() {
    audio.setStatic(0.6);
    this.glitchPulse = 2;
    await this.wait(0.5);
    const choice = await this.ui.death(this.hasSave());
    audio.setStatic(0);
    await this.fade(0, 0.6);
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
