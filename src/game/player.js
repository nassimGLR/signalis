// WREN-3: movement, aiming, animation, flashlight, condition.
import * as THREE from 'three';
import * as Rig from '../engine/characters.js';
import { audio } from '../engine/audio.js';

const { buildCustodian, poseCustodian } = Rig;
const WALK = 2.3, RUN = 4.1, AIM_WALK = 0.85;
export const PLAYER_R = 0.28;

// Condition bands (plan §3.6): ≥75 STABLE, 50–74 IMPAIRED, 25–49 FAILING, <25 CRITICAL.
const CONDITIONS = ['STABLE', 'IMPAIRED', 'FAILING', 'CRITICAL'];
const SPEED_FACTOR = [1, 0.85, 0.72, 0.62];
const LAMP_COLOUR = [0x6fc3c9, 0xe0c85a, 0xe0862e, 0xff2a3a];
// One-shot actions and their lengths (s).
const ACTIONS = { reach: 0.45, reachLow: 0.45, stomp: 0.55, toolFlare: 0.7, toolProng: 0.5 };
const FACE_TURN = 4; // rad/s when turning toward the resting pointer

// Stride phase rate with no foot sliding (from the rig when it provides one).
function phaseRate(speed, level) {
  const f = Rig.custodianPhaseRate;
  return typeof f === 'function' ? f(speed, level) : Math.PI * speed / 0.66;
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  constructor(scene) {
    this.rig = buildCustodian();
    scene.add(this.rig.root);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.vel = new THREE.Vector2();
    this.hp = 100;
    this.maxHp = 100;
    this.aiming = false;
    this.aimYaw = 0;
    this.reloadT = 0;
    this.hurtT = 0;
    this.hurtDir = 0;
    this.invulnT = 0;
    this.dead = false;
    this.deadT = 0;
    this.phase = 0;
    this.speed = 0;        // commanded ground speed (m/s)
    this.moveSpeed = 0;    // measured speed (drives the gait; 0 when pressed against a wall)
    this.stepPhase = 0;
    this.fireCd = 0;
    this.recoil = 0;
    this.aimPitch = 0;        // rad, + = down: the sights dip toward a low target
    this.laserHit = null;     // the enemy the laser ends on (or null)
    this._laserEnd = new THREE.Vector3();
    this.time = 0;
    this.turnRate = 0;
    this.locked = false;   // controls disabled
    this.action = null;    // current one-shot action name
    this.actionT = 0;
    this.actionDone = null;
    this.heals = [];       // heal-over-time queue: { rate, left }
    this.onStep = null;    // (running) => void, per footfall
    this.onReloadDone = null;
    this._look = { yaw: 0, pitch: 0 };
    this._moveLocal = { x: 0, z: 1 };
    this._enemies = null;
    this._lampPos = new THREE.Vector3();

    // flashlight: a cone from the chest harness lamp
    this.flash = new THREE.SpotLight(0xfff0dc, 7, 15, 0.46, 0.55, 1);
    this.flash.castShadow = true;
    this.flash.shadow.mapSize.set(512, 512);
    this.flash.shadow.camera.near = 0.3;
    this.flash.shadow.camera.far = 16;
    this.flash.shadow.bias = -0.002;
    this.flashTarget = new THREE.Object3D();
    scene.add(this.flash, this.flashTarget);
    this.flash.target = this.flashTarget;

    // faint personal fill so Wren never vanishes entirely into the dark
    this.fill = new THREE.PointLight(0x9ab0c0, 1.4, 5, 1);
    scene.add(this.fill);

    // laser sight
    const lgeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.laser = new THREE.Line(lgeo, new THREE.LineBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.9 }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
    this.laserDot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
    this.laserDot.visible = false;
    scene.add(this.laserDot);

    // muzzle flash
    this.muzzleLight = new THREE.PointLight(0xffc080, 0, 8, 1);
    scene.add(this.muzzleLight);
    this.muzzleSprite = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, depthWrite: false }));
    this.muzzleSprite.visible = false;
    scene.add(this.muzzleSprite);
    this.muzzleT = 0;
  }

  setPosition(x, z, yaw = 0) {
    this.pos.set(x, 0, z);
    this.yaw = this.targetYaw = this.aimYaw = yaw;
    this.speed = this.moveSpeed = 0;
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = yaw;
  }

  get conditionLevel() {
    const h = this.hp / this.maxHp * 100;
    return h >= 75 ? 0 : h >= 50 ? 1 : h >= 25 ? 2 : 3;
  }

  get condition() { return CONDITIONS[this.conditionLevel]; }

  get facing() { return new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw)); }

  muzzleWorld(out = new THREE.Vector3()) {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.muzzle.getWorldPosition(out);
  }

  // Heal now (seconds = 0) or spread over time. Returns the amount queued/applied.
  heal(amount, seconds = 0) {
    if (this.dead || amount <= 0) return 0;
    if (!(seconds > 0)) {
      const before = this.hp;
      this.hp = Math.min(this.maxHp, this.hp + amount);
      return this.hp - before;
    }
    this.heals.push({ rate: amount / seconds, left: amount });
    return amount;
  }

  // Play a one-shot action ('reach', 'reachLow', 'stomp', 'toolFlare',
  // 'toolProng'). Resolves when it ends (or is interrupted).
  playAction(name) {
    if (this.actionDone) { const r = this.actionDone; this.actionDone = null; r(false); }
    if (this.dead) return Promise.resolve(false);
    this.action = name;
    this.actionT = 0;
    this.actionLen = ACTIONS[name] ?? 0.5;
    return new Promise((resolve) => { this.actionDone = resolve; });
  }

  endAction(ok) {
    this.action = null;
    this.actionT = 0;
    if (this.actionDone) { const r = this.actionDone; this.actionDone = null; r(ok); }
  }

  // ctl: { move:{x,y} (y+ = south), run, aim, hasWeapon, aimDir, enemies,
  //        faceDir?:{x,y}, faceRate?: rad/s, lookDir?:{x,y,dist}, strafe? }
  update(dt, ctl, world, surface) {
    this.time += dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 3);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);
    this._enemies = ctl.enemies || null;

    // heal over time
    if (this.heals.length && !this.dead) {
      for (const h of this.heals) {
        const d = Math.min(h.left, h.rate * dt);
        h.left -= d;
        this.hp = Math.min(this.maxHp, this.hp + d);
      }
      this.heals = this.heals.filter((h) => h.left > 1e-4 && this.hp < this.maxHp);
    }

    if (this.dead) {
      this.deadT += dt;
      if (this.action) this.endAction(false);
      poseCustodian(this.rig, { dead: true, deadT: this.deadT, time: this.time }, dt);
      this.laser.visible = this.laserDot.visible = false;
      this.updateLights(dt);
      return;
    }

    const level = this.conditionLevel;
    if (this.action) {
      this.actionT += dt;
      if (this.actionT >= this.actionLen) this.endAction(true);
    }
    const acting = !!this.action;

    let mx = 0, mz = 0, run = false;
    if (!this.locked && !acting) { mx = ctl.move.x; mz = ctl.move.y; run = ctl.run && level < 3; }
    this.aiming = !this.locked && !acting && ctl.aim && ctl.hasWeapon && this.reloadT <= 0;

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && this.onReloadDone) this.onReloadDone();
    }

    const mag = Math.hypot(mx, mz);
    const factor = SPEED_FACTOR[level];
    let targetSpeed = 0;
    let turnCap = Infinity;
    if (this.aiming) {
      if (ctl.aimDir) this.aimYaw = Math.atan2(ctl.aimDir.x, ctl.aimDir.y);
      if (ctl.strafe === false) {
        // keyboard aim with nothing to lock: WASD turns the aim, feet stay planted
        if (mag > 0.2) this.aimYaw = Math.atan2(mx, mz);
      } else if (mag > 0.1) {
        targetSpeed = AIM_WALK * Math.min(1, mag) * factor;
      }
      this.targetYaw = this.aimYaw;
    } else if (mag > 0.1) {
      targetSpeed = (run ? RUN : WALK) * Math.min(1, mag) * factor * (this.reloadT > 0 ? 0.5 : 1);
      this.targetYaw = Math.atan2(mx, mz);
    } else if (ctl.faceDir) {
      this.targetYaw = Math.atan2(ctl.faceDir.x, ctl.faceDir.y);
      turnCap = ctl.faceRate || FACE_TURN;
    }

    // turn
    const prevYaw = this.yaw;
    let dy = wrap(this.targetYaw - this.yaw);
    const turnRate = this.aiming ? 14 : 10;
    let step = dy * Math.min(1, dt * turnRate);
    if (Math.abs(step) > turnCap * dt) step = Math.sign(step) * turnCap * dt;
    this.yaw = wrap(this.yaw + step);
    this.turnRate = dt > 0 ? wrap(this.yaw - prevYaw) / dt : 0;

    // accelerate (stop quickly when the input lets go)
    const accel = targetSpeed < this.speed && targetSpeed < 0.05 ? 25 : 10;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * accel);
    if (this.speed < 0.01) this.speed = 0;
    const px = this.pos.x, pz = this.pos.z;
    let dirx = 0, dirz = 0;
    if (this.speed > 0.05) {
      dirx = mag > 0.1 ? mx / mag : Math.sin(this.yaw);
      dirz = mag > 0.1 ? mz / mag : Math.cos(this.yaw);
      if (this.aiming && mag <= 0.1) { dirx = 0; dirz = 0; }
      const stepLen = this.speed * dt;
      const n = Math.max(1, Math.ceil(stepLen / 0.15));
      for (let i = 0; i < n; i++) {
        this.pos.x += dirx * stepLen / n;
        this.pos.z += dirz * stepLen / n;
        world.resolve(this.pos, PLAYER_R);
      }
    }
    // measured speed drives the gait, so pressing into a wall doesn't walk in place
    const moved = dt > 0 ? Math.hypot(this.pos.x - px, this.pos.z - pz) / dt : 0;
    this.moveSpeed += (Math.min(moved, this.speed * 1.05) - this.moveSpeed) * Math.min(1, dt * 14);
    if (this.speed === 0 && this.moveSpeed < 0.02) this.moveSpeed = 0;

    // animation phase & footsteps
    const gait = this.moveSpeed;
    this.phase += dt * phaseRate(gait, level);
    if (gait > 0.4) {
      const s = Math.floor(this.phase / Math.PI);
      if (s !== this.stepPhase) {
        this.stepPhase = s;
        const running = gait > 3;
        audio.footstep(surface, running);
        if (this.onStep) this.onStep(running);
      }
    }

    // body-space move direction (strafe / backpedal while aiming)
    let moveLocal = null;
    if (gait > 0.05 && (dirx || dirz)) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this._moveLocal.x = dirx * c - dirz * s;
      this._moveLocal.z = dirx * s + dirz * c;
      moveLocal = this._moveLocal;
    }

    // head look (relative to the body; the rig clamps the range)
    let look = null;
    if (ctl.lookDir && !this.aiming && this.reloadT <= 0) {
      const lx = ctl.lookDir.x, lz = ctl.lookDir.y;
      if (lx * lx + lz * lz > 1e-4) {
        this._look.yaw = wrap(Math.atan2(lx, lz) - this.yaw);
        this._look.pitch = 0.5 * Math.atan2(1.5, Math.max(0.5, ctl.lookDir.dist || 2));
        // don't wrench the neck toward something directly behind
        if (Math.abs(this._look.yaw) < 2.2) look = this._look;
      }
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.gun.visible = this.aiming || this.reloadT > 0;
    if (this.rig.holster) this.rig.holster.visible = !!ctl.hasWeapon && !this.rig.gun.visible;
    if (this.rig.statusLamp && this.rig.statusLamp.color) {
      const on = level < 3 || Math.floor(this.time * 2) % 2 === 0; // CRITICAL blinks at 1 Hz
      this.rig.statusLamp.color.setHex(on ? LAMP_COLOUR[level] : 0x2a0508);
    }

    poseCustodian(this.rig, {
      speed: gait, phase: this.phase, aiming: this.aiming, time: this.time,
      hurt: this.hurtT, hurtDir: this.hurtDir, limp: level >= 1, condition: level,
      reload: this.reloadT, recoil: this.recoil, aimPitch: this.aiming ? this.aimPitch : 0,
      moveLocal, turn: this.turnRate, look,
      action: this.action, actionT: this.actionT,
    }, dt);

    this.updateLaser(world, ctl.enemies || [], dt);
    this.updateLights(dt);
  }

  updateLaser(world, enemies, dt = 0.016) {
    if (!this.aiming) { this.laser.visible = this.laserDot.visible = false; this.laserHit = null; this.aimPitch = 0; return; }
    const o = this.muzzleWorld();
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    let dist = Math.min(18, world.raycast(o.x, o.z, dx, dz, 18));
    let hitE = null;
    for (const e of enemies) {
      const t = e.rayHit(o.x, o.z, dx, dz);
      if (t !== null && t < dist) { dist = t; hitE = e; }
    }
    // On a body the beam converges on it and ends on the front of its chest,
    // so it lands on a slumped or crouched target instead of passing over it
    // (or beside it: the gun is off-centre); the sights dip to match.
    const end = this._laserEnd.set(o.x + dx * dist, o.y, o.z + dz * dist);
    if (hitE) {
      const c = hitE.rig && hitE.rig.chest ? hitE.rig.chest.matrixWorld.elements[13] : 1.1;
      end.y = Math.min(o.y, Math.max(0.3, c || 1.1));
      const vx = hitE.pos.x - o.x, vz = hitE.pos.z - o.z, L = Math.hypot(vx, vz);
      if (L > 0.3) { const t = Math.max(0.1, L - 0.2) / L; end.x = o.x + vx * t; end.z = o.z + vz * t; dist = L; }
    }
    const pitch = Math.max(0, Math.min(0.45, Math.atan2(o.y - end.y, Math.max(0.5, dist))));
    this.aimPitch += (pitch - this.aimPitch) * (1 - Math.exp(-dt * 10));
    this.laserHit = hitE;
    const arr = this.laser.geometry.attributes.position.array;
    arr[0] = o.x; arr[1] = o.y; arr[2] = o.z; arr[3] = end.x; arr[4] = end.y; arr[5] = end.z;
    this.laser.geometry.attributes.position.needsUpdate = true;
    this.laser.visible = true;
    this.laserDot.position.copy(end);
    this.laserDot.visible = true;
    this.laser.material.opacity = 0.6 + Math.random() * 0.4;
  }

  updateLights(dt) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (this.rig.lamp) {
      this.rig.root.updateMatrixWorld(true);
      this.rig.lamp.getWorldPosition(this._lampPos);
      this.flash.position.copy(this._lampPos);
    } else {
      this.flash.position.set(this.pos.x + fx * 0.15, 1.45, this.pos.z + fz * 0.15);
    }
    this.flashTarget.position.set(this.pos.x + fx * 5, 0, this.pos.z + fz * 5);
    this.fill.position.set(this.pos.x, 3.4, this.pos.z + 1.6);
    // subtle flashlight flutter
    const f = 1 + Math.sin(this.time * 31) * 0.02 + (Math.random() < 0.004 ? -0.6 : 0);
    this.flash.intensity = (this.dead ? 0 : 7) * f;
    this.muzzleT = Math.max(0, this.muzzleT - dt);
    this.muzzleLight.intensity = this.muzzleT > 0 ? 40 * (this.muzzleT / 0.07) : 0;
    this.muzzleSprite.visible = this.muzzleT > 0.03;
  }

  flashMuzzle(camera) {
    const o = this.muzzleWorld();
    this.muzzleLight.position.copy(o);
    this.muzzleSprite.position.copy(o);
    this.muzzleSprite.position.x += Math.sin(this.yaw) * 0.15;
    this.muzzleSprite.position.z += Math.cos(this.yaw) * 0.15;
    this.muzzleSprite.quaternion.copy(camera.quaternion);
    this.muzzleSprite.rotation.z = Math.random() * Math.PI;
    this.muzzleT = 0.07;
    this.recoil = 1;
  }

  // n: damage. from (optional): {x, z} of the source, for the flinch direction.
  damage(n, from = null) {
    if (this.dead || this.invulnT > 0) return false;
    this.hp = Math.max(0, this.hp - n);
    this.hurtT = 1;
    this.invulnT = 0.6;
    this.reloadT = 0;
    if (this.action) this.endAction(false);
    let src = from;
    if (!src && this._enemies) {
      // the attacker is whoever is closest and in the middle of a strike
      let bd = 2.5;
      for (const e of this._enemies) {
        if (!e.active || !e.alive) continue;
        const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
        if (d < bd) { bd = d; src = e.pos; }
      }
    }
    this.hurtDir = src ? wrap(Math.atan2(src.x - this.pos.x, src.z - this.pos.z) - this.yaw) : 0;
    audio.hurt();
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; this.heals.length = 0; }
    return true;
  }
}
