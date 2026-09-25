// Browser side of scripts/rig-sheet.mjs: poses the rigs and paints labelled
// sheets (large studio views + in-game-camera, low-res "game scale" strips).
import * as THREE from 'three';
import * as CH from '../src/engine/characters.js';
import { Tex } from '../src/engine/textures.js';

THREE.ColorManagement.enabled = false;
const PI = Math.PI;

const gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
gl.outputColorSpace = THREE.LinearSRGBColorSpace;
gl.shadowMap.enabled = true;
gl.shadowMap.type = THREE.BasicShadowMap;
gl.setPixelRatio(1);
document.body.appendChild(gl.domElement);

// ------------------------------------------------------------ scenes
function studioScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x1d2023);
  s.add(new THREE.HemisphereLight(0xd8dee4, 0x2a2622, 1.25));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(2.5, 4, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.2, bottom: -0.5, near: 0.5, far: 12 });
  s.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8e0, 1.3);
  rim.position.set(-3, 3, -3);
  s.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 24), new THREE.MeshLambertMaterial({ color: 0x3a3d40 }));
  floor.rotation.x = -PI / 2;
  floor.receiveShadow = true;
  s.add(floor);
  return s;
}

function gameScene() {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x000000);
  s.add(new THREE.AmbientLight(0x404a52, 1.1));
  s.add(new THREE.HemisphereLight(0x303840, 0x100808, 0.5));
  const tex = Tex.floorPlate();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshLambertMaterial({ map: tex }));
  floor.rotation.x = -PI / 2;
  floor.receiveShadow = true;
  s.add(floor);
  const fill = new THREE.PointLight(0x9ab0c0, 1.4, 5, 1);
  fill.position.set(0, 3.4, 1.6);
  s.add(fill);
  const ceil = new THREE.PointLight(0xd8d0b8, 1.5 * 3.2, 9.6, 1);
  ceil.position.set(1.4, 2.3, -1.2);
  s.add(ceil);
  const spot = new THREE.SpotLight(0xfff0dc, 7, 15, 0.52, 0.55, 1);
  spot.castShadow = true;
  spot.shadow.mapSize.set(512, 512);
  s.add(spot, spot.target);
  s.userData.spot = spot;
  return s;
}

// ------------------------------------------------------------ posing
function poseWren(rig, spec) {
  const s = spec.s || {};
  const frames = spec.frames ?? 45;
  const dt = 1 / 30;
  const speed = s.speed || 0;
  const rate = CH.custodianPhaseRate(speed, s.condition || 0);
  const ph1 = s.phase ?? 0;
  for (let f = 0; f <= frames; f++) {
    const back = (frames - f) * dt;
    const st = { ...s, time: 10 - back, phase: ph1 - rate * back };
    if (s.actionT !== undefined) st.actionT = Math.max(0, s.actionT - back);
    if (s.deadT !== undefined) st.deadT = Math.max(0, s.deadT - back);
    if (s.reload !== undefined) st.reload = s.reload + back * 0.2;
    if (s.hurt !== undefined) st.hurt = Math.max(0, s.hurt - back * 3);
    CH.poseCustodian(rig, st, f === 0 ? 1 : dt);
  }
  const armed = !!(s.aiming || s.reload);
  rig.gun.visible = armed;
  rig.holster.visible = !armed;
  rig.statusLamp.color.setHex([0x6fc3c9, 0xe0c85a, 0xe0862e, 0xff2a3a][Math.min(3, s.condition || 0)]);
}

function poseHollowRig(rig, spec) {
  const frames = spec.frames ?? 40;
  const dt = 1 / 30;
  for (let f = 0; f <= frames; f++) {
    const back = (frames - f) * dt;
    CH.poseHollow(rig, { ...spec.s, time: 10 - back, stateT: Math.max(0, (spec.s.stateT ?? 1) - back), speed: spec.s.speed || 0, phase: (10 - back) * 3 }, f === 0 ? 1 : dt);
  }
  const st = spec.s.state;
  CH.setHollowScorch(rig, st === 'ash' ? 1 : st === 'burning' ? 0.55 : 0);
  const alive = !['down', 'dead', 'stomped', 'ash', 'burning', 'knockdown'].includes(st);
  const g = alive ? 0.9 : st === 'down' ? 0.35 : 0.04;
  rig.glow.color.setRGB(Math.max(0.1, g), 0.1 * g, 0.1 * g);
}

// world-space centre of the posed figure (bone pivots + head top)
const _box = new THREE.Box3(), _p = new THREE.Vector3();
function figureCentre(rig, out = new THREE.Vector3()) {
  rig.root.updateMatrixWorld(true);
  _box.makeEmpty();
  for (const b of rig.bones) if (b !== rig.root) _box.expandByPoint(b.getWorldPosition(_p));
  _box.expandByPoint(rig.head.localToWorld(_p.set(0, 0.2, 0)));
  _box.expandByPoint(rig.footL.localToWorld(_p.set(0, -0.08, 0.1)));
  _box.expandByPoint(rig.footR.localToWorld(_p.set(0, -0.08, 0.1)));
  return _box.getCenter(out);
}

// ------------------------------------------------------------ rendering
const studio = studioScene();
const game = gameScene();
const camS = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
const camG = new THREE.PerspectiveCamera(24, 16 / 9, 0.5, 80);

function renderStudio(rig, w, h, yaw, opts = {}) {
  gl.setSize(w, h, false);
  studio.add(rig.root);
  rig.root.position.set(0, 0, 0);
  rig.root.rotation.y = yaw;
  const ctr = figureCentre(rig);
  const lying = opts.lying ?? ctr.y < 0.55;
  const cy = opts.cy ?? (lying ? ctr.y : 0.9);
  const dist = opts.dist ?? (lying ? 4.4 : 4.2);
  const el = (opts.elev ?? (lying ? 32 : 10)) * PI / 180;
  const tx = opts.cy === undefined ? ctr.x : 0, tz = opts.cy === undefined ? ctr.z : 0;
  camS.aspect = w / h;
  camS.fov = opts.fov ?? 28;
  camS.updateProjectionMatrix();
  camS.position.set(tx + Math.sin(opts.orbit ?? 0) * Math.cos(el) * dist, cy + Math.sin(el) * dist, tz + Math.cos(opts.orbit ?? 0) * Math.cos(el) * dist);
  camS.lookAt(tx, cy, tz);
  gl.setRenderTarget(null);
  gl.render(studio, camS);
  studio.remove(rig.root);
  return gl.domElement;
}

// in-game camera: pitch 62°, FOV 24, distance 17.5, low-res target (lines tall)
function renderGame(rig, lines, yaw) {
  const w = Math.round(lines * 16 / 9), h = lines;
  const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  game.add(rig.root);
  rig.root.position.set(0, 0, 0);
  rig.root.rotation.y = yaw;
  const spot = game.userData.spot;
  spot.visible = rig.kind === 'custodian'; // the flashlight is Wren's
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  spot.position.set(fx * 0.15, 1.45, fz * 0.15);
  spot.target.position.set(fx * 5, 0, fz * 5);
  const pitch = 62 * PI / 180, dist = 17.5;
  camG.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  camG.lookAt(0, 0.6, 0);
  gl.setRenderTarget(rt);
  gl.render(game, camG);
  const ctr = figureCentre(rig).project(camG);
  const px = new Uint8Array(w * h * 4);
  gl.readRenderTargetPixels(rt, 0, 0, w, h, px);
  gl.setRenderTarget(null);
  rt.dispose();
  game.remove(rig.root);
  // flip + posterise (~20 levels) with a light 4x4 Bayer dither, like the planned post
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g2 = c.getContext('2d');
  const img = g2.createImageData(w, h);
  const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const L = 20;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((h - 1 - y) * w + x) * 4, di = (y * w + x) * 4;
      const d = (B[(x & 3) + (y & 3) * 4] / 16 - 0.5) / L;
      for (let k = 0; k < 3; k++) img.data[di + k] = Math.max(0, Math.min(255, Math.round((px[si + k] / 255 + d) * L) / L * 255));
      img.data[di + 3] = 255;
    }
  }
  g2.putImageData(img, 0, 0);
  c.cx = (ctr.x + 1) / 2 * w; c.cy = (1 - ctr.y) / 2 * h;
  return c;
}

// crop the centre of a game-scale frame around the figure and scale up (nearest)
function gameCell(src, crop, scale, dy = 0) {
  const c = document.createElement('canvas');
  c.width = crop * scale; c.height = crop * scale;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  const cx = src.cx ?? src.width / 2, cy = src.cy ?? src.height / 2;
  g.drawImage(src, Math.round(cx - crop / 2), Math.round(cy - crop / 2 + dy), crop, crop, 0, 0, crop * scale, crop * scale);
  return c;
}

// ------------------------------------------------------------ sheet painter
function sheet(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#0c0d0e';
  g.fillRect(0, 0, w, h);
  return { c, g };
}
function label(g, x, y, text, size = 13, color = '#e8e2d4') {
  g.font = `600 ${size}px "DejaVu Sans Mono", monospace`;
  g.fillStyle = color;
  g.fillText(text, x, y);
}
function drawCell(g, img, x, y, w, h, text, sub) {
  g.drawImage(img, x, y, w, h);
  g.strokeStyle = '#2a2d30';
  g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  g.fillStyle = 'rgba(7,8,10,0.78)';
  g.fillRect(x, y, w, 20);
  label(g, x + 6, y + 14, text, 12);
  if (sub) label(g, x + 6, y + h - 7, sub, 10, '#8f8b80');
}

const WREN_POSES = [
  ['IDLE · FRONT', 0, {}],
  ['IDLE · SIDE', PI / 2, {}],
  ['IDLE · BACK', PI, {}],
  ['IDLE · 3/4', 0.65, {}],
  ['WALK · CONTACT', 0.9, { speed: 2.3, phase: 0.05 }],
  ['WALK · PASSING', 0.9, { speed: 2.3, phase: PI / 2 + 0.3 }],
  ['RUN', 1.0, { speed: 4.1, phase: 0.95 }],
  ['TURN IN PLACE', 0.6, { turn: 4.5 }, 8],
  ['LOOK LEFT', 0.3, { look: { yaw: 1.1, pitch: 0 } }],
  ['LOOK RIGHT', 0.3, { look: { yaw: -1.1, pitch: 0.1 } }],
  ['AIM', 0.9, { aiming: true }],
  ['AIM-WALK STRAFE', 0.5, { aiming: true, speed: 1.1, moveLocal: { x: -1, z: 0 }, phase: 0.6 }],
  ['RELOAD', 0.7, { reload: 0.5 }],
  ['IMPAIRED (LIMP)', 0.9, { condition: 1, speed: 1.95, phase: PI + 0.2 }],
  ['FAILING', 0.6, { condition: 2 }],
  ['CRITICAL', 0.6, { condition: 3, speed: 1.4, phase: 0.4 }],
  ['REACH', 0.8, { action: 'reach', actionT: 0.22 }],
  ['REACH LOW', 0.8, { action: 'reachLow', actionT: 0.24 }],
  ['STOMP · IMPACT', 0.9, { action: 'stomp', actionT: 0.3 }],
  ['STOMP · KNEE UP', 0.9, { action: 'stomp', actionT: 0.19 }],
  ['TOOL · FLARE STRIKE', 0.7, { action: 'toolFlare', actionT: 0.34 }],
  ['TOOL · PRONG JAB', 0.9, { action: 'toolProng', actionT: 0.35 }],
  ['HURT (FROM FRONT)', 0.8, { hurt: 1, hurtDir: 0 }, 4],
  ['DEAD', 0.7, { dead: true, deadT: 2.2 }],
];

window.wrenSheet = async () => {
  const W = 1536;
  const cols = 6, cw = 256, ch = 300;
  const rows = Math.ceil(WREN_POSES.length / cols);
  const gameCols = 8, gw = 192;
  const H = 40 + 512 + 20 + rows * ch + 30 + 2 * (gw + 24) + 20;
  const { c, g } = sheet(W, H);
  const rig = CH.buildCustodian();
  label(g, 16, 27, `WREN-3 · RIG SHEET   ${rig.tris} tris · 1 skinned draw call (+ status lamp, gun/holster)   L7 original design`, 16);
  // hero row
  poseWren(rig, { s: {} });
  drawCell(g, renderStudio(rig, 512, 512, 0.55, { cy: 1.0, dist: 4.0, elev: 12 }), 0, 40, 512, 512, 'IDLE · 3/4 FRONT (512)');
  drawCell(g, renderStudio(rig, 512, 512, PI + 0.6, { cy: 1.0, dist: 4.0, elev: 12 }), 512, 40, 512, 512, 'IDLE · 3/4 BACK (512)');
  drawCell(g, renderStudio(rig, 512, 512, 0.35, { cy: 1.52, dist: 1.25, elev: 16, fov: 30 }), 1024, 40, 512, 512, 'HEAD · HAIR, FACE, SERVICE PLATE');
  // pose grid
  let y0 = 40 + 512 + 20;
  WREN_POSES.forEach(([name, yaw, s, frames], i) => {
    poseWren(rig, { s, frames });
    const x = (i % cols) * cw, y = y0 + Math.floor(i / cols) * ch;
    drawCell(g, renderStudio(rig, cw, ch, yaw, name === 'DEAD' ? { dist: 4.2 } : { cy: 0.88, dist: 4.6 }), x, y, cw, ch, name);
  });
  // game-scale strips
  y0 += rows * ch + 30;
  const strip = [
    ['IDLE ↓', 0, {}], ['IDLE →', PI / 2, {}], ['IDLE ↑', PI, {}], ['WALK', 0.8, { speed: 2.3, phase: PI / 2 }],
    ['AIM', -0.9, { aiming: true }], ['FAILING', 0.5, { condition: 2 }], ['REACH LOW', 0.9, { action: 'reachLow', actionT: 0.24 }], ['DEAD', 0.6, { dead: true, deadT: 2.2 }],
  ];
  for (const [lines, crop, scale] of [[270, 48, 4], [360, 64, 3]]) {
    label(g, 16, y0 - 8, `GAME SCALE · ${lines} LINES · camera 62° / FOV 24° / 17.5 m · posterised 20 levels + Bayer · crop ${crop}px ×${scale}`, 12, '#8f8b80');
    strip.forEach(([name, yaw, s], i) => {
      poseWren(rig, { s });
      const src = renderGame(rig, lines, yaw);
      drawCell(g, gameCell(src, crop, scale, 0), i * gw, y0, gw, gw, name);
    });
    y0 += gw + 24;
  }
  return c.toDataURL('image/png');
};

const HOLLOW_STATES = ['dormant', 'idle', 'investigate', 'notice', 'rising', 'chase', 'lunge', 'attack', 'flinch', 'knockdown', 'down', 'stomped', 'burning', 'ash', 'dead'];
const STATE_SPEC = {
  dormant: { stateT: 1 }, idle: { stateT: 2 }, investigate: { stateT: 2, speed: 0.6 }, notice: { stateT: 0.12 },
  rising: { stateT: 0.8 }, chase: { stateT: 2, speed: 1.35 }, lunge: { stateT: 0.62 }, attack: { stateT: 0.3, attackPhase: 0.9 },
  flinch: { stateT: 0.15 }, knockdown: { stateT: 0.9 }, down: { stateT: 2, twitch: 0.4, reviving: 0.6 }, stomped: { stateT: 1 },
  burning: { stateT: 1.2 }, ash: { stateT: 4 }, dead: { stateT: 5 },
};
const VARIANTS = [[0, 'LURCHER · 0'], [1, 'LURCHER · 1'], [2, 'LURCHER · 2'], ['rusher', 'RUSHER'], ['warden', 'WARDEN']];

window.hollowSheet = async () => {
  const cw = 160, ch = 210;
  const W = cw * HOLLOW_STATES.length;
  const heroW = W / VARIANTS.length;
  const gw = 160;
  const H = 40 + 400 + 16 + VARIANTS.length * ch + 36 + gw + 30;
  const { c, g } = sheet(W, H);
  label(g, 16, 27, 'THE HOLLOWS · RIG SHEET   original corrupted custodian chassis · chest core = revive tell', 16);
  VARIANTS.forEach(([v, name], i) => {
    const rig = CH.buildHollow(v);
    poseHollowRig(rig, { s: { state: 'idle', stateT: 2 } });
    drawCell(g, renderStudio(rig, heroW, 400, 0.55, { cy: 1.0, dist: 4.4, elev: 10 }), i * heroW, 40, heroW, 400, `${name} · IDLE 3/4`, `${rig.tris} tris`);
  });
  let y0 = 40 + 400 + 16;
  VARIANTS.forEach(([v, name], r) => {
    const rig = CH.buildHollow(v);
    HOLLOW_STATES.forEach((st, i) => {
      poseHollowRig(rig, { s: { state: st, ...STATE_SPEC[st] } });
      const lying = ['knockdown', 'down', 'stomped', 'burning', 'ash', 'dead', 'dormant'].includes(st);
      drawCell(g, renderStudio(rig, cw, ch, 0.7, lying ? { dist: 4.6, elev: 35 } : { cy: 0.95, dist: 5.0, elev: 10 }), i * cw, y0 + r * ch, cw, ch, `${st.toUpperCase()}`, i === 0 ? name : '');
    });
  });
  y0 += VARIANTS.length * ch + 36;
  label(g, 16, y0 - 10, 'GAME SCALE · 360 LINES · crop 64px ×2.5 — chase and down (core lit) per type', 12, '#8f8b80');
  let i = 0;
  for (const [v, name] of VARIANTS) {
    for (const st of ['chase', 'down']) {
      const rig = CH.buildHollow(v);
      poseHollowRig(rig, { s: { state: st, ...STATE_SPEC[st] } });
      const src = renderGame(rig, 360, st === 'chase' ? 0.6 : 0.9);
      drawCell(g, gameCell(src, 64, 2.5, 0), i * 160, y0, 160, 160, `${name} ${st.toUpperCase()}`);
      i++;
    }
  }
  return c.toDataURL('image/png');
};

// ad-hoc renders for iteration: one spec or an array (laid out in a row)
// spec: { kind:'wren'|variant, yaw, s, w, h, cam:{...}, game:lines, crop, scale, label }
async function one(spec) {
  const rig = spec.kind === 'wren' || spec.kind === undefined ? CH.buildCustodian() : CH.buildHollow(spec.kind);
  if (rig.kind === 'custodian') poseWren(rig, { s: spec.s || {}, frames: spec.frames });
  else poseHollowRig(rig, { s: spec.s || { state: 'idle' } });
  if (spec.game) return gameCell(renderGame(rig, spec.game, spec.yaw || 0), spec.crop || 64, spec.scale || 4, spec.dy ?? 0);
  const src = renderStudio(rig, spec.w || 320, spec.h || 400, spec.yaw || 0, spec.cam || {});
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
window.extra = async (spec) => {
  const list = Array.isArray(spec) ? spec : [spec];
  const cells = [];
  for (const s of list) cells.push([await one(s), s.label || '']);
  const W = cells.reduce((a, [c]) => a + c.width, 0), H = Math.max(...cells.map(([c]) => c.height));
  const { c, g } = sheet(W, H);
  let x = 0;
  for (const [cv, name] of cells) { drawCell(g, cv, x, 0, cv.width, cv.height, name); x += cv.width; }
  return c.toDataURL('image/png');
};

window.__sheetReady = true;
