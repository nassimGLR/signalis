// Builds the station geometry from map data and answers spatial queries
// (collision, line of sight, which room a point is in).
import * as THREE from 'three';
import { psx, psxUniforms } from '../engine/renderer.js';
import { Tex, rng } from '../engine/textures.js';
import { ROOMS, DOORS, LIGHTS, PROPS, GRID_W, GRID_H } from './map.js';
import { buildProp } from './props.js';

export const WALL_H = 2.6;
export const STUB_H = 0.42;
const WALL_T = 0.18;
export const LIGHT_SCALE = 3.2;

// Uniforms driving the dynamic cutaway of walls between camera and player.
export const cutUniforms = {
  uCutZ: { value: 0 },
  uStubH: { value: STUB_H },
};

// PSX material whose vertices drop to stub height when their aCut value lies
// south of (i.e. in front of) the player.
function psxWall(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = psxUniforms.uSnap;
    shader.uniforms.uCutZ = cutUniforms.uCutZ;
    shader.uniforms.uStubH = cutUniforms.uStubH;
    shader.vertexShader = 'uniform vec2 uSnap;\nuniform float uCutZ;\nuniform float uStubH;\nattribute float aCut;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        if (aCut > uCutZ) transformed.y = min(transformed.y, uStubH);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
      {
        vec4 s = gl_Position; s.xyz /= s.w;
        s.xy = floor(s.xy * uSnap + 0.5) / uSnap;
        s.xyz *= gl_Position.w; gl_Position = s;
      }`);
  };
  material.customProgramCacheKey = () => 'psxWall';
  return material;
}

// Accumulates quads into a single BufferGeometry.
class QuadBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.cut = []; this.idx = []; }
  // corners in CCW order as seen from the front; uvs parallel
  quad(p, n, uv, cut = -1e4) {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...p[i]); this.nor.push(...n); this.uv.push(...uv[i]); this.cut.push(cut);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aCut', new THREE.Float32BufferAttribute(this.cut, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const floorTex = {
  plate: () => Tex.floorPlate(), grate: () => Tex.floorGrate(), carpet: () => Tex.floorCarpet(), carpetSlate: () => Tex.floorCarpetSlate(),
  tile: () => Tex.floorTileWhite(), concrete: () => Tex.floorConcrete(),
};
const wallTex = {
  panel: () => Tex.wallPanel(), medical: () => Tex.wallMedical(), concrete: () => Tex.wallConcrete(), wood: () => Tex.wallWood(),
};

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 80;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 384, 80);
  const R = rng(99);
  for (let i = 0; i < 260; i++) {
    const b = 90 + R() * 160;
    g.fillStyle = `rgb(${b},${b},${b})`;
    g.fillRect((R() * 384) | 0, (R() * 60) | 0, 1, 1);
  }
  // gas giant: huge disc rising from below, banded, lit from the left
  const planet = Tex.planet(7).image;
  g.save();
  g.beginPath(); g.arc(210, 150, 130, 0, Math.PI * 2); g.clip();
  g.imageSmoothingEnabled = false;
  g.drawImage(planet, 80, 20, 260, 130);
  // terminator shading
  const sh = g.createLinearGradient(80, 0, 340, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.55, 'rgba(0,0,0,0.1)'); sh.addColorStop(0.85, 'rgba(0,0,0,0.85)'); sh.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = sh; g.fillRect(80, 0, 260, 160);
  g.restore();
  // rings
  g.strokeStyle = 'rgba(220,200,170,0.7)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(210, 36, 190, 12, -0.08, Math.PI * 0.95, Math.PI * 2.05); g.stroke();
  g.strokeStyle = 'rgba(160,140,120,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(210, 36, 170, 9, -0.08, Math.PI * 0.95, Math.PI * 2.05); g.stroke();
  // dither the whole thing into a few tones
  const img = g.getImageData(0, 0, 384, 80);
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < 80; y++) for (let x = 0; x < 384; x++) {
    const i = (y * 384 + x) * 4;
    const t = (bayer[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 40;
    for (let k = 0; k < 3; k++) img.data[i + k] = Math.round((img.data[i + k] + t) / 48) * 48;
  }
  g.putImageData(img, 0, 0);
  // frame and mullions
  g.fillStyle = '#1a1c1e';
  g.fillRect(0, 0, 384, 4); g.fillRect(0, 60, 384, 20);
  for (let x = 0; x <= 384; x += 32) g.fillRect(x - 2, 0, 4, 64);
  g.fillStyle = '#3a3e40'; g.fillRect(0, 62, 384, 2);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.grid = new Array(GRID_W * GRID_H).fill(null);
    this.rooms = {};
    this.doors = {};
    this.lights = [];
    this.propColliders = [];
    this.propParts = {};
    this.hash = new Map();
    this.powered = false;
    this.animated = [];     // props with moving parts (reels, gauge needles)
    this.time = 0;
    this.reelSpinUntil = -1;
    // per-room fill light (ROOMS[k].amb), follows the current room
    this.fill = new THREE.AmbientLight(0x000000, 0);
    scene.add(this.fill);
  }

  idx(x, z) { return z * GRID_W + x; }
  tile(x, z) {
    if (x < 0 || z < 0 || x >= GRID_W || z >= GRID_H) return null;
    return this.grid[this.idx(x, z)];
  }

  build() {
    for (const [key, r] of Object.entries(ROOMS)) {
      for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) this.grid[this.idx(x, z)] = key;
      const group = new THREE.Group();
      group.name = 'room_' + key;
      this.scene.add(group);
      this.rooms[key] = { key, ...r, group, lights: [], neighbours: [], dust: null };
    }
    for (const d of DOORS) {
      const door = { ...d, open: false, t: 0, locked: !!d.lock };
      this.grid[this.idx(d.x, d.z)] = door;
      // passage axis
      const left = this.tile(d.x - 1, d.z), right = this.tile(d.x + 1, d.z);
      door.axis = (typeof left === 'string' && typeof right === 'string') ? 'x' : 'z';
      this.doors[d.id] = door;
      this.rooms[d.a].neighbours.push(d.id);
      this.rooms[d.b].neighbours.push(d.id);
    }
    this.buildGeometry();
    this.buildDoors();
    this.buildLights();
    this.buildProps();
    this.buildDust();
  }

  isFloor(x, z) { return this.tile(x, z) !== null; }

  buildGeometry() {
    const builders = {}; // key: room|mat
    const get = (group, mat) => {
      const k = group + '|' + mat;
      if (!builders[k]) builders[k] = { group, mat, qb: new QuadBuilder() };
      return builders[k].qb;
    };

    const addWalls = (x, z, owner, wallType) => {
      const H = WALL_H;
      const dirs = [
        { dx: 0, dz: -1, side: 'N' }, { dx: 0, dz: 1, side: 'S' },
        { dx: -1, dz: 0, side: 'W' }, { dx: 1, dz: 0, side: 'E' },
      ];
      for (const d of dirs) {
        if (this.isFloor(x + d.dx, z + d.dz)) continue;
        const door = typeof this.tile(x, z) === 'object' ? this.tile(x, z) : null;
        const room = typeof owner === 'string' && this.rooms[owner];
        if (d.side === 'N' && room && room.window) continue; // built separately
        let cut = -1e4;
        if (d.side === 'N') cut = z;               // north walls drop when player is north of them
        if (door && door.axis === 'z' && (d.side === 'E' || d.side === 'W')) cut = z + 1;
        const wallQ = get(owner, 'wall:' + wallType);
        const capQ = get(owner, d.side === 'S' ? 'stubcap' : 'cap');
        const T = WALL_T;
        const vTop = 1;
        if (d.side === 'N') {
          wallQ.quad([[x, 0, z], [x + 1, 0, z], [x + 1, H, z], [x, H, z]], [0, 0, 1], [[0, 0], [1, 0], [1, vTop], [0, vTop]], cut);
          capQ.quad([[x, H, z], [x + 1, H, z], [x + 1, H, z - T], [x, H, z - T]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], cut);
        } else if (d.side === 'S') {
          const h = STUB_H;
          const zz = z + 1;
          wallQ.quad([[x + 1, 0, zz], [x, 0, zz], [x, h, zz], [x + 1, h, zz]], [0, 0, -1], [[0, 0], [1, 0], [1, h / H], [0, h / H]]);
          capQ.quad([[x, h, zz + T], [x + 1, h, zz + T], [x + 1, h, zz], [x, h, zz]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
          capQ.quad([[x, 0, zz + T], [x + 1, 0, zz + T], [x + 1, h, zz + T], [x, h, zz + T]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        } else if (d.side === 'W') {
          wallQ.quad([[x, 0, z + 1], [x, 0, z], [x, H, z], [x, H, z + 1]], [1, 0, 0], [[0, 0], [1, 0], [1, vTop], [0, vTop]], cut);
          capQ.quad([[x - T, H, z + 1], [x, H, z + 1], [x, H, z], [x - T, H, z]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], cut);
          // end face toward camera so wall thickness reads at the bottom corner
          capQ.quad([[x - T, 0, z + 1], [x, 0, z + 1], [x, H, z + 1], [x - T, H, z + 1]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], cut);
        } else {
          wallQ.quad([[x + 1, 0, z], [x + 1, 0, z + 1], [x + 1, H, z + 1], [x + 1, H, z]], [-1, 0, 0], [[0, 0], [1, 0], [1, vTop], [0, vTop]], cut);
          capQ.quad([[x + 1, H, z + 1], [x + 1 + T, H, z + 1], [x + 1 + T, H, z], [x + 1, H, z]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], cut);
          capQ.quad([[x + 1, 0, z + 1], [x + 1 + T, 0, z + 1], [x + 1 + T, H, z + 1], [x + 1, H, z + 1]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], cut);
        }
      }
    };

    // floors & walls per room
    for (const room of Object.values(this.rooms)) {
      const fq = get(room.key, 'floor:' + room.floor);
      for (let z = room.z0; z <= room.z1; z++) for (let x = room.x0; x <= room.x1; x++) {
        fq.quad([[x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, 0, z], [x, 0, z]], [0, 1, 0], [[x, -z - 1], [x + 1, -z - 1], [x + 1, -z], [x, -z]]);
        addWalls(x, z, room.key, room.wall);
      }
      if (room.window) this.buildWindow(room);
    }
    // door tiles (owned by the door, shown with either neighbour)
    for (const door of Object.values(this.doors)) {
      const key = 'door_' + door.id;
      const fq = get(key, 'floor:plate');
      const { x, z } = door;
      fq.quad([[x, 0, z + 1], [x + 1, 0, z + 1], [x + 1, 0, z], [x, 0, z]], [0, 1, 0], [[x, -z - 1], [x + 1, -z - 1], [x + 1, -z], [x, -z]]);
      addWalls(x, z, key, 'concrete');
    }

    const mats = {};
    const matFor = (name) => {
      if (mats[name]) return mats[name];
      let m;
      if (name.startsWith('floor:')) m = psx(new THREE.MeshLambertMaterial({ map: floorTex[name.slice(6)]() }));
      else if (name.startsWith('wall:')) m = psxWall(new THREE.MeshLambertMaterial({ map: wallTex[name.slice(5)]() }));
      else if (name === 'cap') m = psxWall(new THREE.MeshBasicMaterial({ color: 0x050505 }));
      else m = psxWall(new THREE.MeshLambertMaterial({ color: 0x2a2627 }));
      mats[name] = m;
      return m;
    };

    this.doorGroups = {};
    for (const { group, mat, qb } of Object.values(builders)) {
      const geo = qb.build();
      if (!geo) continue;
      const m = new THREE.Mesh(geo, matFor(mat));
      m.receiveShadow = true;
      m.castShadow = mat.startsWith('wall:') || mat === 'cap';
      m.frustumCulled = false;
      let parent;
      if (group.startsWith('door_')) {
        const id = group.slice(5);
        if (!this.doorGroups[id]) { this.doorGroups[id] = new THREE.Group(); this.scene.add(this.doorGroups[id]); }
        parent = this.doorGroups[id];
      } else parent = this.rooms[group].group;
      parent.add(m);
    }
  }

  buildWindow(room) {
    const len = room.x1 - room.x0 + 1;
    const mat = psxWall(new THREE.MeshBasicMaterial({ map: windowTexture() }));
    const qb = new QuadBuilder();
    const z = room.z0, x0 = room.x0, x1 = room.x1 + 1;
    qb.quad([[x0, 0, z], [x1, 0, z], [x1, WALL_H, z], [x0, WALL_H, z]], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], z);
    const capQ = new QuadBuilder();
    capQ.quad([[x0, WALL_H, z], [x1, WALL_H, z], [x1, WALL_H, z - WALL_T], [x0, WALL_H, z - WALL_T]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], z);
    const m = new THREE.Mesh(qb.build(), mat);
    m.frustumCulled = false;
    room.group.add(m);
    const cap = new THREE.Mesh(capQ.build(), psxWall(new THREE.MeshBasicMaterial({ color: 0x050505 })));
    cap.frustumCulled = false;
    room.group.add(cap);
    room.windowLen = len;
  }

  buildDoors() {
    const frameMat = psx(new THREE.MeshLambertMaterial({ map: Tex.metal(60, 12) }));
    const lampOff = new THREE.MeshBasicMaterial({ color: 0x300808 });
    for (const door of Object.values(this.doors)) {
      const g = new THREE.Group();
      const tex = Tex.door(door.label, true);
      const leafMatL = psx(new THREE.MeshLambertMaterial({ map: tex }));
      // each leaf shows half the texture
      const leafGeo = (half) => {
        const geo = new THREE.BoxGeometry(0.5, 2.4, 0.12);
        const uv = geo.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setX(i, half * 0.5 + uv.getX(i) * 0.5);
        return geo;
      };
      const leafL = new THREE.Mesh(leafGeo(0), leafMatL);
      const leafR = new THREE.Mesh(leafGeo(1), leafMatL);
      leafL.position.set(-0.25, 1.2, 0); leafR.position.set(0.25, 1.2, 0);
      leafL.castShadow = leafR.castShadow = true;
      const leaves = new THREE.Group();
      leaves.add(leafL, leafR);
      g.add(leaves);
      // frame header & lamp
      const header = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 0.3), frameMat);
      header.position.set(0, 2.49, 0);
      g.add(header);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.32), lampOff.clone());
      lamp.position.set(0, 2.49, 0);
      g.add(lamp);
      g.position.set(door.x + 0.5, 0, door.z + 0.5);
      if (door.axis === 'x') g.rotation.y = Math.PI / 2;
      door.mesh = g; door.leafL = leafL; door.leafR = leafR; door.lamp = lamp; door.leaves = leaves;
      if (!this.doorGroups[door.id]) { this.doorGroups[door.id] = new THREE.Group(); this.scene.add(this.doorGroups[door.id]); }
      this.doorGroups[door.id].add(g);
      this.setDoorLamp(door);
    }
  }

  setDoorLamp(door) {
    const c = door.open ? 0x70e8d8 : door.locked ? 0xff2020 : 0xffb040;
    door.lamp.material.color.setHex(c);
  }

  buildLights() {
    const housing = psx(new THREE.MeshLambertMaterial({ map: Tex.metal(46, 6) }));
    for (const L of LIGHTS) {
      const light = new THREE.PointLight(L.color, 0, L.d * 1.6, 1);
      light.position.set(L.x, L.y ?? 2.3, L.z);
      const room = this.rooms[L.room];
      room.group.add(light);
      const entry = {
        light, base: L.i * LIGHT_SCALE, flicker: L.flicker || 0, pulse: L.pulse || 0, pulseDepth: L.pulseDepth ?? 0.5,
        power: L.power || 'always', room: L.room, seed: Math.random() * 100,
      };
      this.lights.push(entry);
      room.lights.push(entry);
      // Ceiling lights get a lamp housing on the nearest north or side wall
      // (there is no ceiling in view to hang a fixture from).
      if ((L.y ?? 2.3) >= 2) {
        const mount = this.wallMount(room, L.x, L.z);
        if (mount) {
          const g = new THREE.Group();
          g.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.12), housing));
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.04, 0.03), new THREE.MeshBasicMaterial({ color: L.color }));
          strip.position.set(0, -0.045, 0.05);
          g.add(strip);
          g.position.set(mount.x, 2.32, mount.z);
          g.rotation.y = mount.rot;
          room.group.add(g);
          entry.fixture = strip;
        }
      }
    }
  }

  // Where to put a lamp housing for a ceiling light at (x, z): the nearest
  // north or side wall within reach, or null (south walls are cut away).
  wallMount(room, x, z) {
    const opts = [
      { d: room.window ? Infinity : z - room.z0, x, z: room.z0 + 0.07, rot: 0 },
      { d: x - room.x0, x: room.x0 + 0.07, z, rot: Math.PI / 2 },
      { d: room.x1 + 1 - x, x: room.x1 + 1 - 0.07, z, rot: -Math.PI / 2 },
    ];
    const narrow = room.x1 - room.x0 < 3;
    let best = null;
    for (const o of opts) if (!best || o.d < best.d) best = o;
    if (!best || (best.d > 1.4 && !narrow)) return null;
    // keep housings off door tiles
    const tx = Math.floor(best.x + (best.rot === Math.PI / 2 ? -0.5 : best.rot === -Math.PI / 2 ? 0.5 : 0));
    const tz = Math.floor(best.z + (best.rot === 0 ? -0.5 : 0));
    const t = this.tile(tx, tz);
    if (t && typeof t === 'object') return null;
    return best;
  }

  buildProps() {
    for (const p of PROPS) {
      const { obj, colliders, parts } = buildProp(p);
      this.rooms[p.room].group.add(obj);
      for (const c of colliders) this.addCollider(c);
      if (parts) {
        this.propParts[p.room + ':' + p.t + ':' + p.x + ':' + p.z] = parts;
        if (parts.reelL || parts.needle) this.animated.push({ room: p.room, t: p.t, parts, seed: p.x * 1.7 + p.z });
      }
      obj.traverse((o) => { if (o.isMesh) { o.receiveShadow = true; } });
    }
  }

  parts(room, t) {
    const key = Object.keys(this.propParts).find((k) => k.startsWith(room + ':' + t + ':'));
    if (!key && t === 'saveTerminal') return this.parts(room, 'backupDeck');
    if (!key && t === 'trunk') return this.parts(room, 'pneumaticLocker');
    return key ? this.propParts[key] : null;
  }

  // Backup decks: spin the reels (and show WRITING) for `seconds`.
  // Call with 0 to stop. Reels in every quiet room follow the same clock,
  // so the caller doesn't need to know which deck is in view.
  spinReels(seconds = 1.2) {
    this.reelSpinUntil = seconds > 0 ? this.time + seconds : -1;
  }

  buildDust() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `uniform float uTime; attribute float seed; varying float vA;
        void main(){ vec3 p = position;
          p.x += sin(uTime*0.13 + seed*6.28)*0.4; p.y += sin(uTime*0.07 + seed*12.0)*0.3; p.z += cos(uTime*0.11 + seed*3.1)*0.4;
          vA = 0.10 + 0.22*sin(uTime*0.5 + seed*20.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); gl_PointSize = 1.0; }`,
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(0.85,0.85,0.8), max(0.0, vA)); }',
    });
    this.dustMat = mat;
    for (const room of Object.values(this.rooms)) {
      const n = Math.floor((room.x1 - room.x0 + 1) * (room.z1 - room.z0 + 1) * 0.45);
      const pos = new Float32Array(n * 3), seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = room.x0 + Math.random() * (room.x1 - room.x0 + 1);
        pos[i * 3 + 1] = 0.3 + Math.random() * 2.0;
        pos[i * 3 + 2] = room.z0 + Math.random() * (room.z1 - room.z0 + 1);
        seed[i] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      room.group.add(pts);
    }
  }

  // ---------- colliders ----------
  addCollider(c) {
    this.propColliders.push(c);
    for (let x = Math.floor(c.x0); x <= Math.floor(c.x1); x++) {
      for (let z = Math.floor(c.z0); z <= Math.floor(c.z1); z++) {
        const k = x + ',' + z;
        if (!this.hash.has(k)) this.hash.set(k, []);
        this.hash.get(k).push(c);
      }
    }
  }

  solidTile(x, z) {
    const t = this.tile(x, z);
    if (t === null) return true;
    if (typeof t === 'object') return !t.open || t.t < 0.8;
    return false;
  }

  // Push a circle out of walls, closed doors and props.
  resolve(pos, r) {
    for (let iter = 0; iter < 3; iter++) {
      const tx = Math.floor(pos.x), tz = Math.floor(pos.z);
      for (let z = tz - 1; z <= tz + 1; z++) for (let x = tx - 1; x <= tx + 1; x++) {
        if (this.solidTile(x, z)) this.pushOut(pos, r, x, z, x + 1, z + 1);
        const list = this.hash.get(x + ',' + z);
        if (list) for (const c of list) this.pushOut(pos, r, c.x0, c.z0, c.x1, c.z1);
      }
    }
  }

  pushOut(pos, r, x0, z0, x1, z1) {
    const cx = Math.max(x0, Math.min(pos.x, x1));
    const cz = Math.max(z0, Math.min(pos.z, z1));
    let dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) return;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x += dx / d * (r - d); pos.z += dz / d * (r - d);
    } else {
      const pens = [pos.x - x0 + r, x1 - pos.x + r, pos.z - z0 + r, z1 - pos.z + r];
      const m = Math.min(...pens);
      if (m === pens[0]) pos.x = x0 - r; else if (m === pens[1]) pos.x = x1 + r;
      else if (m === pens[2]) pos.z = z0 - r; else pos.z = z1 + r;
    }
  }

  // Grid DDA line-of-sight. Returns distance to first blocking tile or Infinity.
  raycast(x0, z0, dx, dz, maxDist) {
    const len = Math.hypot(dx, dz);
    dx /= len; dz /= len;
    let tx = Math.floor(x0), tz = Math.floor(z0);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / dx), tDeltaZ = Math.abs(1 / dz);
    let tMaxX = dx > 0 ? (tx + 1 - x0) / dx : (x0 - tx) / -dx;
    let tMaxZ = dz > 0 ? (tz + 1 - z0) / dz : (z0 - tz) / -dz;
    if (!isFinite(tMaxX)) tMaxX = Infinity;
    if (!isFinite(tMaxZ)) tMaxZ = Infinity;
    let t = 0;
    while (t < maxDist) {
      if (tMaxX < tMaxZ) { t = tMaxX; tMaxX += tDeltaX; tx += stepX; }
      else { t = tMaxZ; tMaxZ += tDeltaZ; tz += stepZ; }
      if (t > maxDist) break;
      if (this.solidTile(tx, tz)) return t;
    }
    return Infinity;
  }

  lineOfSight(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    if (d < 0.01) return true;
    return this.raycast(ax, az, bx - ax, bz - az, d) === Infinity;
  }

  roomAt(x, z) {
    const t = this.tile(Math.floor(x), Math.floor(z));
    return typeof t === 'string' ? t : null;
  }

  doorAt(x, z) {
    const t = this.tile(Math.floor(x), Math.floor(z));
    return t && typeof t === 'object' ? t : null;
  }

  // ---------- per-frame ----------
  updateVisibility(current, playerZ) {
    const visible = new Set([current]);
    for (const id of this.rooms[current].neighbours) {
      const d = this.doors[id];
      if (d.open) visible.add(d.a === current ? d.b : d.a);
    }
    for (const r of Object.values(this.rooms)) r.group.visible = visible.has(r.key);
    for (const d of Object.values(this.doors)) {
      const show = visible.has(d.a) || visible.has(d.b);
      this.doorGroups[d.id].visible = show;
      // doors seen from behind (player north of a z-axis door) drop to stub height
      if (d.axis === 'z') {
        const cut = playerZ < d.z + 0.4;
        d.mesh.scale.y = cut ? STUB_H / 2.4 : 1;
      }
    }
    this.visible = visible;
    cutUniforms.uCutZ.value = playerZ + 0.6;
    if (current !== this.current) {
      this.current = current;
      const amb = ROOMS[current] && ROOMS[current].amb;
      if (amb) { this.fill.color.setHex(amb[0]); this.fill.intensity = amb[1]; } else this.fill.intensity = 0;
    }
  }

  updateLights(time) {
    for (const e of this.lights) {
      const powerOk = e.power === 'always' || (e.power === 'main') === this.powered;
      // lights for the other power state leave the scene's light list entirely
      e.light.visible = powerOk;
      const on = powerOk && this.visible && this.visible.has(e.room);
      if (!on) { e.light.intensity = 0; if (e.fixture) e.fixture.visible = powerOk; continue; }
      let k = 1;
      if (e.flicker) {
        const n = Math.sin(time * 37 + e.seed) * Math.sin(time * 23.3 + e.seed * 2) * Math.sin(time * 3.1 + e.seed);
        if (n > 1 - e.flicker * 1.4) k = 0.08;
        else if (Math.sin(time * 0.9 + e.seed) > 0.97) k = 0.5;
      }
      if (e.pulse) k *= 1 - e.pulseDepth * (0.5 - 0.5 * Math.sin(time * Math.PI * e.pulse * 2 + e.seed));
      e.light.intensity = e.base * k;
      if (e.fixture) { e.fixture.visible = true; e.fixture.material.color.copy(e.light.color).multiplyScalar(0.3 + 0.7 * k); }
    }
    if (this.dustMat) this.dustMat.uniforms.uTime.value = time;
    this.animateProps(time);
  }

  animateProps(time) {
    const dt = Math.min(0.1, Math.max(0, time - this.time));
    this.time = time;
    const spinning = time < this.reelSpinUntil;
    for (const a of this.animated) {
      if (this.visible && !this.visible.has(a.room)) continue;
      const p = a.parts;
      if (p.reelL) {
        // supply reel turns slower than the take-up reel; idle decks creep
        const w = spinning ? 9 : 0;
        p.reelL.rotation.y += dt * w * 0.8;
        p.reelR.rotation.y += dt * w * 1.25;
        if (p.screen && p.screenWrite) p.screen.material = spinning ? p.screenWrite : p.screenReady;
        if (p.lamp) p.lamp.visible = spinning ? Math.sin(time * 18) > 0 : Math.sin(time * 2.2 + a.seed) > -0.6;
      }
      if (p.needle) {
        p.needle.rotation.z = 0.35 + Math.sin(time * 0.7 + a.seed) * 0.05 + Math.sin(time * 5.3 + a.seed) * 0.015;
        if (p.pip) p.pip.visible = Math.sin(time * 1.3 + a.seed) > -0.8;
      }
    }
  }

  updateDoors(dt) {
    for (const d of Object.values(this.doors)) {
      const target = d.open ? 1 : 0;
      if (d.t !== target) {
        d.t += Math.sign(target - d.t) * dt * 1.6;
        d.t = Math.max(0, Math.min(1, d.t));
        const s = d.t * 0.46;
        d.leafL.position.x = -0.25 - s;
        d.leafR.position.x = 0.25 + s;
      }
    }
  }

  setPowered(on) {
    this.powered = on;
  }
}
