// Hollows — corrupted custodian units (plan §7.2).
//
// They sit slumped (dormant) or stand twitching (idle) until they see or hear
// Wren. Sight is a cone (plus a short all-round sense); hearing comes from the
// game's noise events (footsteps, shots, doors, stomps). An idle Hollow that
// hears something walks over to investigate; one that sees her gives a short
// notice beat, then chases, pathing round props and through doors with the
// controls' A* (nav.find, agentR 0.32). Out of sight for 8 s, it gives up.
//
// Downed is not dead. Every downed body revives unless it is finished (a
// stomp) or burned to ash. The revive clock only runs while Wren is in the
// body's room or a room she can see into; the chest core pulses faintly on a
// body that will get up, and shivers in its last two seconds. A stomped body
// still has a 50 % chance to rise, much later; ash never does.
//
// Hits stagger (85 %, always on a crit); a flinch only cancels an attack still
// in its wind-up. A crit knocks the Hollow flat for 3 s, and it can be
// finished there. Variants: the Rusher lunges from a few metres out; the
// Warden holds a bulkhead plate that soaks frontal fire (±50°, 20 % damage)
// until it swings or is knocked down, so flank it or shock it.
import * as THREE from 'three';
import { buildHollow, poseHollow, setHollowScorch } from '../engine/characters.js';
import { audio } from '../engine/audio.js';
import { ROOMS } from './map.js';

// Tuning (plan §7.2). Times in seconds, distances in metres.
export const HOLLOW = {
  reviveHp: 30,
  reviveMin: 18, reviveMax: 30,          // unfinished bodies
  finishedChance: 0.5,                   // stomped bodies: this chance to rise…
  finishedMin: 60, finishedMax: 100,     // …this much later
  shiver: 2,                             // the "about to rise" shiver
  riseT: 1.6,
  stagger: 0.85, flinchT: 0.35, knock: 0.15, knockdownT: 3,
  noticeT: 0.4, investigateT: 4, loseT: 8,
  sight: 8.5, cone: Math.cos(70 * Math.PI / 180), sense: 2.2,
  attackR: 1.15, attackWind: 0.55,
  agentR: 0.32,
  burnT: 3, burnDps: 10,
  blockCos: Math.cos(50 * Math.PI / 180), blockMul: 0.2,
};

// Per-kind differences: kept light so every fight stays fair.
const KINDS = {
  lurcher: { hp: 55, speed: 1.35, turn: 5, investigate: 0.9, dmg: [16, 23] },
  rusher: { hp: 45, speed: 1.8, turn: 7, investigate: 1.1, dmg: [14, 20], lunge: { min: 2.2, max: 4.6, cd: 3.5, speed: 5.2, dmg: [15, 21] } },
  warden: { hp: 60, speed: 1.05, turn: 2.2, investigate: 0.8, dmg: [20, 26], plate: true },
};

const R = 0.32;
const ALIVE = new Set(['dormant', 'idle', 'investigate', 'notice', 'rising', 'chase', 'lunge', 'attack', 'flinch']);
const THREAT = new Set(['notice', 'rising', 'chase', 'lunge', 'attack', 'flinch']);
const AWARE = new Set(['notice', 'rising', 'chase', 'lunge', 'attack', 'flinch']);
const BODY = new Set(['down', 'knockdown', 'stomped', 'burning', 'ash', 'dead']);
const rand = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Enemy {
  constructor(scene, def) {
    this.def = def;
    this.id = def.id;
    this.room = def.room;
    this.kind = def.variant === 'rusher' || def.variant === 'warden' ? def.variant : 'lurcher';
    this.K = KINDS[this.kind];
    this.rig = buildHollow(def.variant || 0);
    this.scene = scene;
    scene.add(this.rig.root);
    this.pos = new THREE.Vector3(def.x, 0, def.z);
    this.yaw = (def.rot || 0) * Math.PI / 2;
    this.maxHp = this.K.hp;
    this.hp = this.maxHp;
    this.state = def.state;
    this.stateT = 0;
    this.time = Math.random() * 10;
    this.phase = 0;
    this.speed = 0;
    this.hurt = 0;
    this.path = null;
    this.pathT = 0;
    this.pathGoal = new THREE.Vector2(1e9, 1e9);
    this.doorT = 0;
    this.groanT = 2 + Math.random() * 4;
    this.attackPhase = 0;
    this.hitDone = false;
    this.twitch = 1;
    this.lastSeen = null;          // THREE.Vector2: where she was last seen or heard
    this.lostT = 0;
    this.target = new THREE.Vector2(); // investigate target
    this.invT = 0;
    this.afterRise = 'chase';
    this.lungeCd = 0;
    this.lungeYaw = 0;
    this.flinchNext = 'chase';
    this.knockDir = new THREE.Vector2();
    // revive economy
    this.clock = 0;                // revive clock (runs only with Wren near)
    this.reviveAt = 0;
    this.willRevive = false;
    this.finished = false;
    this.burnT = 0;                // flare damage-over-time on a live Hollow
    this.scorch = 0;
    this.reviving = 0;
    this.stats = { hits: 0, flinches: 0, knockdowns: 0, blocked: 0, revives: 0 };
    this.log = [];                 // recent [time, state] transitions (harness)
    this.active = !def.spawn;
    this.rig.root.visible = this.active;
    this.onHitPlayer = null;
    this.fx = null;                // burning glow, made on first use
    this.sync();
    poseHollow(this.rig, { state: this.state, stateT: 5, time: this.time }, 1); // never a bind pose
  }

  // Shown only while its room is on screen (rooms off screen are hidden, and
  // a Hollow standing in one would float in the void).
  syncVisible(world) {
    const shown = this.active && (!world.visible || world.visible.has(this.room));
    this.rig.root.visible = shown;
    if (!shown && this.fx) this.fx.visible = false;
    return shown;
  }

  get alive() { return this.active && ALIVE.has(this.state); }
  get threatening() { return this.active && THREAT.has(this.state); }
  // a body on the floor: can be finished (down, knockdown), burned (and stomped)
  get lying() { return this.active && BODY.has(this.state); }
  get finishable() { return this.active && (this.state === 'down' || this.state === 'knockdown'); }
  get burnable() { return this.active && (this.state === 'down' || this.state === 'knockdown' || this.state === 'stomped'); }
  // will this body get up again (the core-pulse tell)?
  get pending() { return this.active && (this.state === 'knockdown' || ((this.state === 'down' || this.state === 'stomped') && this.willRevive)); }

  sync() {
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
  }

  setState(s) {
    if (s !== this.state) { this.log.push([this.time, s]); if (this.log.length > 24) this.log.shift(); }
    this.state = s;
    this.stateT = 0;
    if (s !== 'attack' && s !== 'lunge') this.attackPhase = 0;
  }

  activate() {
    this.active = true;
    this.rig.root.visible = true;
  }

  // Permanently dead (debug, and v1 saves).
  kill() {
    this.active = true;
    this.state = 'dead';
    this.stateT = 10;
    this.willRevive = false;
    this.rig.root.visible = true;
    poseHollow(this.rig, { state: 'dead', stateT: 10, time: 0 }, 1);
    this.glow(0);
    this.sync();
  }

  // Ray (2D) vs body circle. Returns distance or null.
  rayHit(ox, oz, dx, dz) {
    if (!this.alive) return null;
    const px = this.pos.x - ox, pz = this.pos.z - oz;
    const t = px * dx + pz * dz;
    if (t < 0) return null;
    const cx = px - dx * t, cz = pz - dz * t;
    const d2 = cx * cx + cz * cz;
    const rr = this.state === 'dormant' ? 0.5 : R + 0.08;
    if (d2 > rr * rr) return null;
    return t - Math.sqrt(rr * rr - d2);
  }

  // The Warden's plate is up (and so blocks frontal fire) except while it
  // swings, recovers, flinches or gets up.
  guardUp() {
    if (!this.K.plate || !this.rig.plate) return false;
    if (this.state === 'attack') return this.attackPhase < 1;
    return this.state === 'idle' || this.state === 'investigate' || this.state === 'notice' || this.state === 'chase';
  }

  // Is a shot travelling along `fromYaw` hitting the front of the Hollow?
  frontal(fromYaw) {
    const f = Math.cos(wrap(this.yaw - (fromYaw + Math.PI)));
    return f > HOLLOW.blockCos;
  }

  // dmg: raw damage. fromYaw: the shot's direction of travel. opts: { crit,
  // focus, from:{x,z} (the shooter), stagger (force a flinch, tools) }.
  // Returns true when this hit put it down.
  takeHit(dmg, fromYaw = 0, opts = {}) {
    if (!this.alive) return false;
    let crit = !!opts.crit;
    let blocked = false;
    if (this.guardUp() && this.frontal(fromYaw) && !opts.unblockable) {
      dmg *= HOLLOW.blockMul;
      crit = false;
      blocked = true;
      this.stats.blocked++;
    }
    this.stats.hits++;
    this.hp -= dmg;
    this.hurt = blocked ? 0.3 : 1;
    if (blocked) { audio.impact(false); audio.click(0, 3400, 0.25); } else audio.impact(true);
    const from = opts.from || null;
    if (from) this.seen(from.x, from.z);
    if (this.hp <= 0) {
      if (this.burnT > 0) this.ignited(); else this.goDown();
      return true;
    }
    this.knockDir.set(Math.sin(fromYaw), Math.cos(fromYaw));
    // wake: a hit always tells it where she is
    if (this.state === 'dormant') { this.wake('chase'); return false; }
    if (this.state === 'rising') return false;
    if (blocked) {
      if (this.state === 'idle' || this.state === 'investigate') this.notice();
      return false;
    }
    if (crit) {
      this.stats.knockdowns++;
      this.knockdown();
      return false;
    }
    const staggers = opts.stagger || Math.random() < HOLLOW.stagger;
    if (!staggers) {
      if (this.state === 'idle' || this.state === 'investigate') this.notice();
      return false;
    }
    // a flinch cancels only a wind-up: once the strike (or the leap) is
    // under way it lands anyway
    if (this.state === 'attack' && this.attackPhase >= 1) return false;
    if (this.state === 'lunge' && this.stateT >= 0.5) return false;
    this.stats.flinches++;
    this.flinchNext = 'chase';
    this.setState('flinch');
    this.pos.x += this.knockDir.x * HOLLOW.knock;
    this.pos.z += this.knockDir.y * HOLLOW.knock;
    return false;
  }

  // Down, with the revive clock set.
  goDown() {
    this.hp = 0;
    this.burnT = 0;
    this.finished = false;
    this.willRevive = true;
    this.clock = 0;
    this.reviveAt = rand(HOLLOW.reviveMin, HOLLOW.reviveMax);
    this.speed = 0;
    this.path = null;
    this.setState('down');
    audio.collapse();
    audio.groan(0, 0.2, 0.6);
  }

  // Killed while on fire: it burns out where it falls, and stays ash.
  ignited() {
    this.hp = 0;
    this.burnT = 0;
    this.finished = true;
    this.willRevive = false;
    this.speed = 0;
    this.path = null;
    this.setState('burning');
    audio.collapse();
  }

  knockdown() {
    this.speed = 0;
    this.path = null;
    this.setState('knockdown');
    audio.collapse();
  }

  // Stomped: finished. It may still rise, much later (50 %); the core says so.
  finish() {
    if (!this.finishable) return false;
    this.hp = 0;
    this.finished = true;
    this.willRevive = Math.random() < HOLLOW.finishedChance;
    this.clock = 0;
    this.reviveAt = this.willRevive ? rand(HOLLOW.finishedMin, HOLLOW.finishedMax) : 0;
    this.setState('stomped');
    return true;
  }

  // Cautery flare on a body: it burns, then it is ash for good.
  burn() {
    if (!this.burnable) return false;
    this.hp = 0;
    this.finished = true;
    this.willRevive = false;
    this.setState('burning');
    return true;
  }

  // Cautery flare on a live Hollow in reach: a hard hit, then it keeps burning.
  ignite(dmg, fromYaw, from) {
    if (!this.alive) return false;
    this.burnT = HOLLOW.burnT;
    this.scorch = Math.max(this.scorch, 0.25);
    return this.takeHit(dmg, fromYaw, { from, stagger: true, unblockable: true });
  }

  // Arc prong: knocked flat whatever it was doing (the Warden's plate is no help).
  shock(from) {
    if (!this.alive) return false;
    if (from) this.seen(from.x, from.z);
    this.hp = Math.max(1, this.hp - 5);
    this.hurt = 1;
    this.stats.knockdowns++;
    this.knockdown();
    return true;
  }

  // ---- awareness
  seen(x, z) {
    if (!this.lastSeen) this.lastSeen = new THREE.Vector2();
    this.lastSeen.set(x, z);
    this.lostT = 0;
  }

  wake(after = 'chase') {
    this.afterRise = after;
    this.setState('rising');
    audio.groan(0, 0.3, 0.8);
  }

  notice() {
    if (this.state === 'notice' || this.state === 'chase') return;
    this.setState('notice');
    audio.screech(this.pan || 0);
  }

  investigate(x, z) {
    this.target.set(x, z);
    this.invT = HOLLOW.investigateT;
    this.path = null;
    if (this.state !== 'investigate') this.setState('investigate');
  }

  // A noise at (x, z) with radius r, made in `rooms` (a Set of room keys; a
  // door tile belongs to both of its rooms). Through a doorway (open door
  // between the rooms) it carries half as far; closed doors stop it.
  hear(x, z, r, rooms, world) {
    if (!this.active || !ALIVE.has(this.state)) return false;
    let eff = r;
    if (!rooms.has(this.room)) {
      if (!openBetween(world, rooms, this.room)) return false;
      eff = r / 2;
    }
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > eff) return false;
    switch (this.state) {
      case 'dormant':
        if (this.def.wake === 0 || d > eff / 2) return false;
        this.target.set(x, z);
        this.wake('investigate');
        return true;
      case 'idle':
        this.investigate(x, z);
        return true;
      case 'investigate':
        this.investigate(x, z);
        return true;
      case 'chase':
        if (this.lostT > 0) this.seen(x, z);
        return true;
    }
    return false;
  }

  // What can it perceive of Wren right now?
  perceive(player, world, ctx) {
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const pRoom = (ctx && ctx.playerRoom) || world.roomAt(player.pos.x, player.pos.z);
    const safe = !!(pRoom && ROOMS[pRoom] && ROOMS[pRoom].safe);
    const sameArea = pRoom === this.room || (world.visible && world.visible.has(this.room) && dist < 9);
    const los = !player.dead && !safe && dist < 12 && sameArea && world.lineOfSight(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const dot = dist > 0.01 ? (dx * fx + dz * fz) / dist : 1;
    // unaware: a cone ahead, or close enough to feel; aware: it keeps track
    const see = los && (AWARE.has(this.state) ? true : (dist < HOLLOW.sense || (dist < HOLLOW.sight && dot > HOLLOW.cone)));
    return { dx, dz, dist, los, see, safe, dot };
  }

  // ------------------------------------------------------------------ update
  // ctx: { nav, playerRoom, openDoor(door), noise? }
  update(dt, player, world, others, ctx = {}) {
    if (!this.active) return;
    this.time += dt;
    this.stateT += dt;
    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.lungeCd = Math.max(0, this.lungeCd - dt);
    const P = this.perceive(player, world, ctx);
    const pan = Math.max(-1, Math.min(1, P.dx / -8));
    this.pan = pan;
    const K = this.K;

    // flare burn on a live Hollow
    if (this.burnT > 0 && this.alive) {
      this.burnT -= dt;
      this.hp -= HOLLOW.burnDps * dt;
      this.hurt = Math.max(this.hurt, 0.4);
      if (this.hp <= 0) this.ignited();
    }

    let move = null; // {x, z, speed, rate}: steer toward a point
    switch (this.state) {
      case 'dormant':
        this.speed = 0;
        this.twitch = P.dist < 7 ? 1 : 0.2;
        if (this.def.wake === 0) break; // woken by script
        if (P.los && P.dist < (this.def.wake || 4)) { this.seen(player.pos.x, player.pos.z); this.wake('chase'); }
        break;

      case 'idle':
        this.speed = 0;
        if (P.see && P.dist < HOLLOW.sight) { this.seen(player.pos.x, player.pos.z); this.notice(); }
        break;

      case 'investigate': {
        if (P.see) { this.seen(player.pos.x, player.pos.z); this.notice(); break; }
        this.invT -= dt;
        if (this.invT <= 0) { this.setState('idle'); this.path = null; break; }
        const d = Math.hypot(this.target.x - this.pos.x, this.target.y - this.pos.z);
        if (d > 0.8) {
          const w = this.steer(dt, this.target.x, this.target.y, world, ctx, d > 2.5);
          if (w && !w.wait) move = { x: w.x, z: w.z, speed: K.investigate, rate: 4 };
          else this.speed *= 0.8;
        } else {
          this.speed *= 0.8;
          // look about
          this.yaw += Math.sin(this.time * 0.9) * dt * 0.8;
        }
        break;
      }

      case 'notice':
        this.speed = 0;
        this.faceToward(P.dx, P.dz, dt, 9);
        if (P.see) this.seen(player.pos.x, player.pos.z);
        if (this.stateT >= HOLLOW.noticeT) this.setState('chase');
        break;

      case 'rising':
        this.speed = 0;
        if (P.see) this.seen(player.pos.x, player.pos.z);
        if (this.lastSeen && this.stateT > 0.6) this.faceToward(this.lastSeen.x - this.pos.x, this.lastSeen.y - this.pos.z, dt, 3);
        if (this.stateT > HOLLOW.riseT) {
          if (this.afterRise === 'investigate' && !P.see) this.investigate(this.target.x, this.target.y);
          else if (this.lastSeen || P.see) this.setState('chase');
          else this.setState('idle');
        }
        break;

      case 'chase': {
        if (player.dead) { this.speed *= 0.9; break; }
        this.groanT -= dt;
        if (this.groanT <= 0) { this.groanT = 3 + Math.random() * 5; audio.groan(pan, Math.max(0.05, 0.3 - P.dist * 0.02)); }
        if (P.see) this.seen(player.pos.x, player.pos.z);
        else this.lostT += dt;
        if (this.lostT > HOLLOW.loseT || !this.lastSeen) {
          // lost her: have a look round where she was, then stand
          if (this.lastSeen) this.investigate(this.lastSeen.x, this.lastSeen.y);
          else this.investigate(this.pos.x, this.pos.z);
          break;
        }
        if (P.see && P.dist < HOLLOW.attackR) {
          this.setState('attack'); this.hitDone = false;
          audio.groan(pan, 0.3, 1.35);
          break;
        }
        // the Rusher springs from a few metres out
        const L = K.lunge;
        if (L && P.see && P.dist > L.min && P.dist < L.max && this.lungeCd <= 0 && Math.abs(wrap(Math.atan2(P.dx, P.dz) - this.yaw)) < 0.4) {
          this.setState('lunge'); this.hitDone = false;
          audio.screech(pan);
          break;
        }
        const tx = P.see ? player.pos.x : this.lastSeen.x, tz = P.see ? player.pos.z : this.lastSeen.y;
        const direct = P.see && P.dist < 3;
        const w = direct ? { x: tx, z: tz } : this.steer(dt, tx, tz, world, ctx, true);
        if (!w || w.wait) { this.speed *= 0.85; if (!w && !P.see) this.lostT += dt; break; }
        // lurching gait: speed surges with the step cycle
        const surge = this.kind === 'lurcher' ? 0.65 + 0.55 * Math.max(0, Math.sin(this.phase)) : 1;
        move = { x: w.x, z: w.z, speed: K.speed * surge, rate: K.turn };
        if (!P.see && Math.hypot(tx - this.pos.x, tz - this.pos.z) < 0.6) move = null; // at the spot: nothing here
        break;
      }

      case 'lunge': {
        const L = K.lunge;
        if (this.stateT < 0.5) {
          // wind-up: crouch and aim
          this.speed = 0;
          this.faceToward(P.dx, P.dz, dt, 8);
          this.lungeYaw = this.yaw;
        } else if (this.stateT < 1.1) {
          const k = 1 - (this.stateT - 0.5) / 0.6;
          const v = L.speed * (0.4 + 0.6 * k);
          this.speed = 0;
          this.pos.x += Math.sin(this.lungeYaw) * v * dt;
          this.pos.z += Math.cos(this.lungeYaw) * v * dt;
          if (!this.hitDone && P.dist < 1.05 && P.dot > 0.3 && !player.dead) {
            this.hitDone = true;
            this.strike(player, world, L.dmg, 0.45);
          }
        } else if (this.stateT > 1.45) {
          this.lungeCd = L.cd;
          this.setState('chase');
        }
        break;
      }

      case 'attack': {
        this.speed = 0;
        this.attackPhase = this.stateT / HOLLOW.attackWind; // wind-up, strike at 1, recover to 3
        if (this.attackPhase < 1) this.faceToward(P.dx, P.dz, dt, this.kind === 'warden' ? 4 : 6);
        if (this.attackPhase >= 1 && !this.hitDone) {
          this.hitDone = true;
          if (P.dist < 1.5 && P.dot > 0.4) this.strike(player, world, K.dmg, this.kind === 'warden' ? 0.6 : 0.35);
        }
        if (this.attackPhase > 3) this.setState('chase');
        break;
      }

      case 'flinch':
        this.speed = 0;
        if (this.stateT >= HOLLOW.flinchT) this.setState(this.flinchNext || 'chase');
        break;

      case 'knockdown':
        this.speed = 0;
        this.twitch = 1;
        if (this.stateT >= HOLLOW.knockdownT) { this.afterRise = 'chase'; this.setState('rising'); audio.groan(pan, 0.3, 0.8); }
        break;

      case 'down':
      case 'stomped': {
        this.speed = 0;
        this.twitch = this.state === 'down' ? Math.max(0, 1 - this.stateT / 4) : 0;
        this.reviving = 0;
        if (!this.willRevive) break;
        // the clock only runs while Wren is here (or can see in)
        if (!player.dead && world.visible && world.visible.has(this.room)) this.clock += dt;
        this.reviving = Math.max(0, Math.min(1, (this.clock - (this.reviveAt - HOLLOW.shiver)) / HOLLOW.shiver));
        if (this.clock >= this.reviveAt) this.revive(player, pan);
        break;
      }

      case 'burning':
        this.speed = 0;
        this.twitch = 1;
        this.scorch = Math.max(this.scorch, Math.min(1, this.stateT / HOLLOW.burnT));
        if (this.stateT >= HOLLOW.burnT) { this.scorch = 1; this.setState('ash'); }
        break;

      case 'ash':
      case 'dead':
        this.speed = 0;
        break;
    }

    if (move) {
      const mx = move.x - this.pos.x, mz = move.z - this.pos.z;
      const ml = Math.hypot(mx, mz) || 1;
      this.speed += (move.speed - this.speed) * Math.min(1, dt * 6);
      if (this.hurt > 0.3) this.speed *= 0.3;
      this.pos.x += mx / ml * this.speed * dt;
      this.pos.z += mz / ml * this.speed * dt;
      this.faceToward(mx, mz, dt, move.rate);
    } else if (this.state === 'chase' || this.state === 'investigate') {
      this.speed *= Math.max(0, 1 - dt * 6);
    }

    // separation & collision (standing Hollows only)
    const standing = this.alive && this.state !== 'dormant';
    if (standing) {
      for (const o of others) {
        if (o === this || !o.alive || o.state === 'dormant') continue;
        const sx = this.pos.x - o.pos.x, sz = this.pos.z - o.pos.z;
        const d = Math.hypot(sx, sz);
        if (d < R * 2 && d > 0.001) { this.pos.x += sx / d * (R * 2 - d) * 0.5; this.pos.z += sz / d * (R * 2 - d) * 0.5; }
      }
      if (!player.dead) {
        const d = P.dist;
        if (d < R + 0.3 && d > 0.001) { this.pos.x -= P.dx / d * (R + 0.3 - d); this.pos.z -= P.dz / d * (R + 0.3 - d); }
      }
    }
    if (standing || this.state === 'lunge') {
      world.resolve(this.pos, R);
      const r = world.roomAt(this.pos.x, this.pos.z);
      if (r) this.room = r;
    }

    this.phase += dt * this.speed * 2.6;
    this.sync();
    poseHollow(this.rig, {
      state: this.state, stateT: this.stateT, time: this.time, speed: this.speed, phase: this.phase,
      hurt: this.hurt, attackPhase: this.attackPhase, twitch: this.twitch, reviving: this.reviving,
    }, dt);
    this.updateGlow();
    setHollowScorch(this.rig, this.scorch);
    if (this.syncVisible(world)) this.updateFx(dt, ctx);
  }

  // A strike that connected: damage, a shove, the game's hit reaction.
  strike(player, world, dmg, shove) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    if (player.damage(Math.round(rand(dmg[0], dmg[1] + 1) - 0.5), this.pos)) {
      player.pos.x += fx * shove; player.pos.z += fz * shove;
      world.resolve(player.pos, 0.28);
      if (this.onHitPlayer) this.onHitPlayer(this);
    }
  }

  revive(player, pan = 0) {
    this.hp = HOLLOW.reviveHp;
    this.finished = false;
    this.willRevive = false;
    this.clock = 0;
    this.reviving = 0;
    this.burnT = 0;
    this.stats.revives++;
    this.seen(player.pos.x, player.pos.z);
    this.afterRise = 'chase';
    this.setState('rising');
    audio.groan(pan, 0.35, 0.7);
  }

  // Follow a nav path toward (tx, tz). Returns the point to steer at, or null
  // when there is no way (a locked door, a quiet room, no route).
  steer(dt, tx, tz, world, ctx, urgent) {
    const nav = ctx && ctx.nav;
    if (!nav) return { x: tx, z: tz };
    this.pathT -= dt;
    const moved = Math.hypot(this.pathGoal.x - tx, this.pathGoal.y - tz) > 0.8;
    if (!this.path || this.pathT <= 0 || moved) {
      this.path = nav.find(this.pos, { x: tx, z: tz }, { agentR: HOLLOW.agentR, snap: 1.2 });
      this.pathGoal.set(tx, tz);
      this.pathT = urgent ? 0.6 : 1.2;
      this.doorT = 0;
      if (!this.path) return null;
    }
    const path = this.path;
    while (path.length) {
      const w = path[0];
      const d = Math.hypot(w.x - this.pos.x, w.z - this.pos.z);
      if (w.door) {
        const door = w.door;
        if (ROOMS[door.a].safe || ROOMS[door.b].safe) { this.path = null; return null; }
        if (door.open && door.t >= 0.8) { path.shift(); continue; }
        if (door.locked) { this.path = null; return null; }
        if (d > 0.35) return w;
        // at a closed door: it claws at it, then it gives
        this.doorT += dt;
        if (this.doorT > 0.7 && !door.open && ctx.openDoor) ctx.openDoor(door, this);
        this.faceToward(door.x + 0.5 - this.pos.x, door.z + 0.5 - this.pos.z, dt, 4);
        return WAIT;
      }
      if (d < 0.3 && path.length > 1) { path.shift(); continue; }
      return w;
    }
    return { x: tx, z: tz };
  }

  faceToward(dx, dz, dt, rate) {
    if (Math.abs(dx) + Math.abs(dz) < 1e-5) return;
    const target = Math.atan2(dx, dz);
    const d = wrap(target - this.yaw);
    this.yaw += d * Math.min(1, dt * rate);
  }

  // The chest core: bright and flickering while it stands; on a body, a faint
  // 0.5 Hz pulse if it will get up again (brightening as it shivers), dark
  // if it won't.
  updateGlow() {
    let g;
    if (this.alive) g = 0.6 + 0.4 * Math.sin(this.time * 17) * Math.sin(this.time * 5.3);
    else if (this.state === 'knockdown') g = 0.3 + 0.15 * Math.sin(this.time * 9);
    else if ((this.state === 'down' || this.state === 'stomped') && this.willRevive) {
      g = 0.14 + 0.06 * Math.sin(this.time * Math.PI);
      if (this.reviving > 0) g += this.reviving * (0.45 + 0.25 * Math.sin(this.time * 23));
    } else g = 0;
    this.glow(g);
  }

  glow(g) {
    if (g <= 0) this.rig.glow.color.setRGB(0, 0, 0);
    else this.rig.glow.color.setRGB(Math.max(0.05, g), 0.1 * g, 0.1 * g);
  }

  // Burning: a flickering additive glow over the body, and embers through
  // the game's particles (no real light: adding lights at run time would
  // recompile every material).
  updateFx(dt, ctx) {
    const on = this.state === 'burning' || (this.burnT > 0 && this.alive);
    if (!on) { if (this.fx) this.fx.visible = false; return; }
    if (!this.fx) {
      const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff7a22, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      this.fx = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), mat);
      this.fx.rotation.x = -Math.PI / 2;
      this.fx.renderOrder = 5;
      this.scene.add(this.fx);
      this.emberT = 0;
    }
    const m = this.rig.chest.matrixWorld.elements;
    // flares up, holds, dies down over the last 0.8 s
    const k = this.state === 'burning' ? Math.min(1, this.stateT / 0.25) * (1 - Math.max(0, this.stateT - 2.2) / 0.8) : 0.5;
    this.fx.visible = k > 0;
    this.fx.position.set(m[12] + (Math.random() - 0.5) * 0.06, this.alive ? 0.05 : 0.1, m[14] + (Math.random() - 0.5) * 0.06);
    this.fx.material.opacity = Math.max(0, k) * (0.5 + 0.35 * Math.random());
    this.fx.scale.setScalar(0.7 + 0.45 * Math.random());
    this.emberT -= dt;
    if (this.emberT <= 0 && ctx && ctx.embers && k > 0) {
      this.emberT = 0.09;
      ctx.embers(m[12], m[13], m[14], k);
    }
  }

  // ------------------------------------------------------------------ save
  // Save format v2: bodies keep their place and clock; standing Hollows go
  // back to their post. (v1 stored only 'dead' | 'alive' | 'inactive'.)
  serialize() {
    if (!this.active) return 'inactive';
    if (this.state === 'dead') return 'dead';
    if (this.state === 'ash' || this.state === 'burning') return { s: 'ash', x: r2(this.pos.x), z: r2(this.pos.z), yaw: r2(this.yaw) };
    if (this.state === 'down' || this.state === 'stomped') {
      return { s: this.state, x: r2(this.pos.x), z: r2(this.pos.z), yaw: r2(this.yaw), clock: r2(this.clock), at: r2(this.reviveAt), will: this.willRevive, scorch: r2(this.scorch) };
    }
    return 'alive';
  }

  restore(d) {
    if (d === 'dead') { this.kill(); return; }
    if (d === 'alive') { if (this.def.spawn) this.activate(); return; }
    if (d === 'inactive' || !d || typeof d !== 'object') return;
    this.activate();
    this.pos.set(d.x ?? this.pos.x, 0, d.z ?? this.pos.z);
    this.yaw = d.yaw ?? this.yaw;
    this.hp = 0;
    this.scorch = d.scorch || 0;
    if (d.s === 'ash') {
      this.finished = true; this.willRevive = false; this.scorch = 1;
      this.state = 'ash';
    } else {
      this.state = d.s === 'stomped' ? 'stomped' : 'down';
      this.finished = d.s === 'stomped';
      this.willRevive = d.will !== false;
      this.clock = d.clock || 0;
      this.reviveAt = d.at || rand(HOLLOW.reviveMin, HOLLOW.reviveMax);
    }
    this.stateT = 10;
    this.sync();
    poseHollow(this.rig, { state: this.state, stateT: 10, time: 0 }, 1);
    setHollowScorch(this.rig, this.scorch);
    this.updateGlow();
  }
}

const r2 = (v) => Math.round(v * 100) / 100;

// A soft radial glow for fire (made once; a flat colour if there is no DOM).
let GLOW = null;
function glowTexture() {
  if (GLOW !== null) return GLOW || null;
  if (typeof document === 'undefined') { GLOW = false; return null; }
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,240,200,1)');
  grd.addColorStop(0.25, 'rgba(255,170,70,0.85)');
  grd.addColorStop(0.6, 'rgba(200,60,10,0.35)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  GLOW = new THREE.CanvasTexture(c);
  return GLOW;
}
const WAIT = Object.freeze({ x: 0, z: 0, wait: true });

// Is there an open door between any room in `rooms` and `room`?
function openBetween(world, rooms, room) {
  for (const d of Object.values(world.doors)) {
    if (!d.open) continue;
    if ((d.a === room && rooms.has(d.b)) || (d.b === room && rooms.has(d.a))) return true;
  }
  return false;
}
