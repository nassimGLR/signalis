// WREN-3: movement, aiming, animation, flashlight.
import * as THREE from 'three';
import { buildCustodian, poseCustodian } from '../engine/characters.js';
import { audio } from '../engine/audio.js';

const WALK = 2.3, RUN = 4.1;
export const PLAYER_R = 0.28;

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
    this.invulnT = 0;
    this.dead = false;
    this.deadT = 0;
    this.phase = 0;
    this.speed = 0;
    this.stepPhase = 0;
    this.fireCd = 0;
    this.recoil = 0;
    this.time = 0;
    this.locked = false; // controls disabled

    // flashlight: a cone from the chest
    this.flash = new THREE.SpotLight(0xfff0dc, 7, 15, 0.52, 0.55, 1);
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
    this.laser = new THREE.Line(lgeo, new THREE.LineBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.9 }));
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
    this.laserDot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
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
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = yaw;
  }

  get condition() {
    if (this.hp > 66) return 'STABLE';
    if (this.hp > 33) return 'DAMAGED';
    return 'CRITICAL';
  }

  get facing() { return new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw)); }

  muzzleWorld(out = new THREE.Vector3()) {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.muzzle.getWorldPosition(out);
  }

  // move: {x, y} screen-space intent (y+ = south). surface = floor type for footsteps.
  update(dt, ctl, world, surface) {
    this.time += dt;
    this.hurtT = Math.max(0, this.hurtT - dt * 3);
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6);

    if (this.dead) {
      this.deadT += dt;
      poseCustodian(this.rig, { dead: true, deadT: this.deadT, time: this.time }, dt);
      this.laser.visible = this.laserDot.visible = false;
      this.updateLights(dt);
      return;
    }

    const limp = this.hp <= 33;
    let mx = 0, mz = 0, run = false;
    if (!this.locked) { mx = ctl.move.x; mz = ctl.move.y; run = ctl.run; }
    this.aiming = !this.locked && ctl.aim && ctl.hasWeapon && this.reloadT <= 0;

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && this.onReloadDone) this.onReloadDone();
    }

    const mag = Math.hypot(mx, mz);
    let targetSpeed = 0;
    if (this.aiming) {
      // standing still; turn toward the aim target
      targetSpeed = 0;
      if (ctl.aimDir) this.aimYaw = Math.atan2(ctl.aimDir.x, ctl.aimDir.y);
      else if (mag > 0.2) this.aimYaw = Math.atan2(mx, mz);
      this.targetYaw = this.aimYaw;
    } else if (mag > 0.1) {
      targetSpeed = (run ? RUN : WALK) * Math.min(1, mag) * (limp ? 0.62 : 1) * (this.reloadT > 0 ? 0.5 : 1);
      this.targetYaw = Math.atan2(mx, mz);
    }

    // turn
    let dy = this.targetYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turnRate = this.aiming ? 14 : 10;
    this.yaw += dy * Math.min(1, dt * turnRate);

    // accelerate
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 10);
    if (this.speed > 0.05 && !this.aiming) {
      const dirx = mag > 0.1 ? mx / mag : Math.sin(this.yaw);
      const dirz = mag > 0.1 ? mz / mag : Math.cos(this.yaw);
      const step = this.speed * dt;
      const n = Math.ceil(step / 0.15);
      for (let i = 0; i < n; i++) {
        this.pos.x += dirx * step / n;
        this.pos.z += dirz * step / n;
        world.resolve(this.pos, PLAYER_R);
      }
    }

    // animation phase & footsteps
    const cadence = this.speed > 2.6 ? 1.45 : 1.9;
    this.phase += dt * this.speed * cadence * (limp ? 0.85 : 1);
    if (this.speed > 0.4) {
      const s = Math.floor(this.phase / Math.PI);
      if (s !== this.stepPhase) { this.stepPhase = s; audio.footstep(surface, this.speed > 3); }
    }

    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.gun.visible = this.aiming || this.reloadT > 0;

    poseCustodian(this.rig, {
      speed: this.aiming ? 0 : this.speed, phase: this.phase, aiming: this.aiming, time: this.time,
      hurt: this.hurtT, limp, reload: this.reloadT, recoil: this.recoil,
    }, dt);

    this.updateLaser(world, ctl.enemies || []);
    this.updateLights(dt);
  }

  updateLaser(world, enemies) {
    if (!this.aiming) { this.laser.visible = this.laserDot.visible = false; return; }
    const o = this.muzzleWorld();
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    let dist = Math.min(18, world.raycast(o.x, o.z, dx, dz, 18));
    for (const e of enemies) {
      const t = e.rayHit(o.x, o.z, dx, dz);
      if (t !== null && t < dist) dist = t;
    }
    const end = new THREE.Vector3(o.x + dx * dist, o.y, o.z + dz * dist);
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
    this.flash.position.set(this.pos.x + fx * 0.15, 1.45, this.pos.z + fz * 0.15);
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

  damage(n) {
    if (this.dead || this.invulnT > 0) return false;
    this.hp = Math.max(0, this.hp - n);
    this.hurtT = 1;
    this.invulnT = 0.6;
    this.reloadT = 0;
    audio.hurt();
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; }
    return true;
  }
}
