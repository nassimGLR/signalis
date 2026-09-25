// Hollows — corrupted custodian units. Dormant ones sit slumped until you get
// close; idle ones stand and twitch. Both hunt by sight and by sound.
import * as THREE from 'three';
import { buildHollow, poseHollow } from '../engine/characters.js';
import { audio } from '../engine/audio.js';

const R = 0.32;
const SPEED = 1.35;

export class Enemy {
  constructor(scene, def) {
    this.def = def;
    this.id = def.id;
    this.room = def.room;
    this.rig = buildHollow(def.variant || 0);
    scene.add(this.rig.root);
    this.pos = new THREE.Vector3(def.x, 0, def.z);
    this.yaw = (def.rot || 0) * Math.PI / 2;
    this.hp = 60;
    this.state = def.state;          // dormant | idle | rising | chase | attack | down | dead
    this.stateT = 0;
    this.time = Math.random() * 10;
    this.phase = 0;
    this.speed = 0;
    this.hurt = 0;
    this.path = null;
    this.pathT = 0;
    this.groanT = 2 + Math.random() * 4;
    this.attackPhase = 0;
    this.hitDone = false;
    this.revived = false;
    this.twitch = 1;
    this.active = !def.spawn;
    this.rig.root.visible = this.active;
    this.sync();
  }

  get alive() { return this.active && this.state !== 'dead' && this.state !== 'down'; }
  get threatening() { return this.active && ['chase', 'attack', 'rising'].includes(this.state); }

  sync() {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  setState(s) { this.state = s; this.stateT = 0; }

  activate() {
    this.active = true;
    this.rig.root.visible = true;
  }

  kill() {
    this.active = true;
    this.state = 'dead';
    this.stateT = 10;
    this.rig.root.visible = true;
    poseHollow(this.rig, { state: 'dead', stateT: 10, time: 0 }, 1);
    this.sync();
  }

  // Ray (2D) vs body circle. Returns distance or null.
  rayHit(ox, oz, dx, dz) {
    if (!this.active || this.state === 'down' || this.state === 'dead') return null;
    const px = this.pos.x - ox, pz = this.pos.z - oz;
    const t = px * dx + pz * dz;
    if (t < 0) return null;
    const cx = px - dx * t, cz = pz - dz * t;
    const d2 = cx * cx + cz * cz;
    const rr = this.state === 'dormant' ? 0.5 : R + 0.08;
    if (d2 > rr * rr) return null;
    return t - Math.sqrt(rr * rr - d2);
  }

  takeHit(dmg, fromYaw) {
    if (!this.alive) return;
    this.hp -= dmg;
    this.hurt = 1;
    audio.impact(true);
    if (this.state === 'dormant' || this.state === 'idle') { this.setState('rising'); if (this.state === 'rising' && this.def.state === 'idle') this.setState('chase'); }
    if (this.hp <= 0) {
      this.setState('down');
      audio.collapse();
      audio.groan(0, 0.2, 0.6);
      return true;
    }
    // stagger: knock back a touch
    this.pos.x += Math.sin(fromYaw) * 0.12;
    this.pos.z += Math.cos(fromYaw) * 0.12;
    if (this.state === 'attack') this.setState('chase');
    return false;
  }

  update(dt, player, world, others) {
    if (!this.active) return;
    this.time += dt;
    this.stateT += dt;
    this.hurt = Math.max(0, this.hurt - dt * 4);
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const playerRoom = world.roomAt(player.pos.x, player.pos.z);
    const sameArea = playerRoom === this.room || (world.visible && world.visible.has(this.room) && dist < 9);
    const canSee = !player.dead && dist < 11 && sameArea && world.lineOfSight(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
    const pan = Math.max(-1, Math.min(1, dx / -8));

    switch (this.state) {
      case 'dormant':
        this.twitch = dist < 7 ? 1 : 0.2;
        if (this.def.wake === 0) break; // woken by script
        if (canSee && dist < (this.def.wake || 4)) {
          this.setState('rising');
          audio.groan(pan, 0.3, 0.8);
        }
        break;
      case 'idle':
        if (canSee && dist < 8.5) { this.setState('chase'); audio.groan(pan, 0.3); }
        break;
      case 'rising':
        if (this.stateT > 1.6) this.setState('chase');
        this.faceToward(dx, dz, dt, 3);
        break;
      case 'chase': {
        if (player.dead) { this.speed *= 0.9; break; }
        this.groanT -= dt;
        if (this.groanT <= 0) { this.groanT = 3 + Math.random() * 5; audio.groan(pan, Math.max(0.05, 0.3 - dist * 0.02)); }
        if (dist < 1.15 && canSee) { this.setState('attack'); this.attackPhase = 0; this.hitDone = false; audio.screech(pan); break; }
        // steer: straight if visible, otherwise follow a grid path
        let tx = player.pos.x, tz = player.pos.z;
        if (!canSee) {
          this.pathT -= dt;
          if (this.pathT <= 0 || !this.path) { this.path = this.findPath(world, player); this.pathT = 0.5; }
          if (this.path && this.path.length) {
            const [nx, nz] = this.path[0];
            if (Math.hypot(nx + 0.5 - this.pos.x, nz + 0.5 - this.pos.z) < 0.35) this.path.shift();
            if (this.path.length) { tx = this.path[0][0] + 0.5; tz = this.path[0][1] + 0.5; }
          } else if (dist > 14) { this.speed *= 0.9; break; }
        }
        const mx = tx - this.pos.x, mz = tz - this.pos.z;
        const ml = Math.hypot(mx, mz) || 1;
        // lurching gait: speed surges with the step cycle
        const surge = 0.65 + 0.55 * Math.max(0, Math.sin(this.phase));
        this.speed += (SPEED * surge - this.speed) * Math.min(1, dt * 6);
        if (this.hurt > 0.3) this.speed *= 0.3;
        this.pos.x += mx / ml * this.speed * dt;
        this.pos.z += mz / ml * this.speed * dt;
        this.faceToward(mx, mz, dt, 5);
        break;
      }
      case 'attack': {
        this.speed = 0;
        this.attackPhase = this.stateT / 0.55; // windup 0.55s, strike, recover
        if (this.attackPhase < 1) this.faceToward(dx, dz, dt, 6);
        if (this.attackPhase >= 1 && !this.hitDone) {
          this.hitDone = true;
          const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
          const facingDot = (dx * fx + dz * fz) / (dist || 1);
          if (dist < 1.5 && facingDot > 0.4) {
            if (player.damage(16 + Math.floor(Math.random() * 8))) {
              player.pos.x += fx * 0.35; player.pos.z += fz * 0.35;
              world.resolve(player.pos, 0.28);
              if (this.onHitPlayer) this.onHitPlayer();
            }
          }
        }
        if (this.attackPhase > 3) this.setState('chase');
        break;
      }
      case 'down':
        this.speed = 0;
        this.twitch = Math.max(0, 1 - this.stateT / 4);
        if (this.def.revive && !this.revived && this.stateT > 14) {
          this.revived = true;
          this.hp = 40;
          this.setState('rising');
          audio.groan(pan, 0.35, 0.7);
        } else if (!this.def.revive || this.revived) {
          if (this.stateT > 4) this.setState('dead');
        }
        break;
      case 'dead':
        this.speed = 0;
        break;
    }

    // separation & collision
    if (this.alive && this.state !== 'dormant') {
      for (const o of others) {
        if (o === this || !o.alive || o.state === 'dormant') continue;
        const sx = this.pos.x - o.pos.x, sz = this.pos.z - o.pos.z;
        const d = Math.hypot(sx, sz);
        if (d < R * 2 && d > 0.001) { this.pos.x += sx / d * (R * 2 - d) * 0.5; this.pos.z += sz / d * (R * 2 - d) * 0.5; }
      }
      if (!player.dead) {
        const d = Math.hypot(dx, dz);
        if (d < R + 0.3 && d > 0.001) { this.pos.x -= dx / d * (R + 0.3 - d); this.pos.z -= dz / d * (R + 0.3 - d); }
      }
      world.resolve(this.pos, R);
      const r = world.roomAt(this.pos.x, this.pos.z);
      if (r) this.room = r;
    }

    this.phase += dt * this.speed * 2.6;
    this.sync();
    poseHollow(this.rig, {
      state: this.state, stateT: this.stateT, time: this.time, speed: this.speed, phase: this.phase,
      hurt: this.hurt, attackPhase: this.attackPhase, twitch: this.twitch,
    }, dt);
    // core glow flickers
    const g = this.alive ? 0.6 + 0.4 * Math.sin(this.time * 17) * Math.sin(this.time * 5.3) : Math.max(0, 0.3 - this.stateT * 0.1);
    this.rig.glow.color.setRGB(1 * Math.max(0.1, g), 0.1 * g, 0.1 * g);
  }

  faceToward(dx, dz, dt, rate) {
    const target = Math.atan2(dx, dz);
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, dt * rate);
  }

  // BFS over walkable tiles toward the player's tile.
  findPath(world, player) {
    const sx = Math.floor(this.pos.x), sz = Math.floor(this.pos.z);
    const gx = Math.floor(player.pos.x), gz = Math.floor(player.pos.z);
    if (sx === gx && sz === gz) return [];
    const key = (x, z) => x + z * 1000;
    const prev = new Map([[key(sx, sz), null]]);
    const q = [[sx, sz]];
    let found = false, n = 0;
    while (q.length && n < 900) {
      const [x, z] = q.shift(); n++;
      if (x === gx && z === gz) { found = true; break; }
      for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + ddx, nz = z + ddz, k = key(nx, nz);
        if (prev.has(k) || world.solidTile(nx, nz)) continue;
        prev.set(k, [x, z]);
        q.push([nx, nz]);
      }
    }
    if (!found) return null;
    const path = [];
    let cur = [gx, gz];
    while (cur && !(cur[0] === sx && cur[1] === sz)) { path.unshift(cur); cur = prev.get(key(cur[0], cur[1])); }
    return path;
  }
}
