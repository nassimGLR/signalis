// World presentation harness (workstream D1).
// Boots dist/index.html, tours the rooms with a camera matching the controls
// stream's framing (62°, FOV 24°, 17.5 m, room-framed), and writes
// shots/world-*.png. It measures floor and frame luma with
// renderer.debugLuma(), checks pixel-perfect scaling in a screenshot readback,
// checks that no ambient glitch rows are active, and checks the safe-room
// lighting rules. Prints PASS/FAIL lines and exits 1 on any FAIL.
//
// Usage: node scripts/world-shots.mjs [--res=auto|240|270|320|360] [--only=cryo,quiet] [--details] [--size=1280x720]
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const arg = (name, def) => {
  const a = process.argv.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : (process.argv.includes(`--${name}`) ? true : def);
};
const RES = arg('res', 'auto');
const ONLY = arg('only', '') ? String(arg('only')).split(',') : null;
const DETAILS = !!arg('details', false);
const [VW, VH] = String(arg('size', '1280x720')).split('x').map(Number);
const out = 'shots';
await mkdir(out, { recursive: true });

let failed = 0;
const pass = (n, why = '') => console.log(`PASS ${n}${why ? ' — ' + why : ''}`);
const fail = (n, why) => { failed++; console.log(`FAIL ${n}: ${why}`); };

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/fonts\.g(oogleapis|static)|ERR_CERT|net::ERR_/i.test(t)) return; // offline font fetches in older builds
  errors.push(t);
});
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

const g = (fn, a) => page.evaluate(fn, a);
const sleep = (ms) => page.waitForTimeout(ms);
const until = async (fn, ms = 15000, a) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await g(fn, a).catch(() => false)) return true; await sleep(150); }
  return false;
};

await page.goto('file://' + path.resolve('dist/index.html'));
await until(() => !!window.__game, 10000);

// ---- boot → title → new game → play, driven by state rather than sleeps
for (let i = 0; i < 20 && await g(() => window.__game.mode === 'boot'); i++) { await page.mouse.click(VW / 2, VH / 2); await sleep(400); }
await until(() => window.__game.mode === 'title', 10000);
await sleep(600);
for (let i = 0; i < 30 && await g(() => window.__game.mode === 'title'); i++) { await page.keyboard.press('Enter'); await sleep(500); }
// intro: skip it
for (let i = 0; i < 40 && await g(() => window.__game.mode !== 'play'); i++) { await page.keyboard.press('Escape'); await sleep(300); }
if (!await until(() => window.__game.mode === 'play', 20000)) fail('boot', 'never reached play mode');
// drain the wake dialogue
const drain = async () => {
  for (let i = 0; i < 200 && await g(() => window.__game.paused && window.__game.mode === 'play'); i++) {
    const passive = await g(() => { const u = window.__game.ui; return !!u.dialogState || !!(u.modal && u.modal.passive); });
    if (passive) await page.mouse.click(VW / 2, 80);
    else if (await g(() => !!window.__game.ui.modal)) { await page.keyboard.press('Escape'); }
    await sleep(150);
  }
};
await sleep(1500);
await drain();

// ---- presentation setup: CRT off, requested line count, controls-stream camera
await g((res) => {
  const G = window.__game;
  const s = G.ui.settings;
  s.crt = false;
  if (G.applySettings) G.applySettings(s);
  const crt = document.getElementById('crt'); if (crt) crt.style.display = 'none';
  G.renderer.setLowHeight(res === 'auto' ? 'auto' : Number(res));
  if (G.renderer.setPixelPerfect) G.renderer.setPixelPerfect(true);
  // camera per plan §6.8: pitch 62°, FOV 24°, distance 17.5, room-framed follow
  // Hollows hold still for the tour (their update would wake them and attack).
  for (const e of G.enemies) e.update = function () {};
  G.__shotCam = { dist: 17.5, pitch: 62, fov: 24, target: null };
  G.updateCamera = function (dt, snap) {
    const P = this.player, cam = this.camera, o = this.__shotCam;
    cam.fov = o.fov; cam.updateProjectionMatrix();
    const pitch = o.pitch * Math.PI / 180;
    const dist = o.dist * Math.min(1.9, Math.max(1, 1.15 / cam.aspect));
    let tx = o.target ? o.target[0] : P.pos.x, tz = o.target ? o.target[1] : P.pos.z;
    const room = this.world.rooms[this.state.currentRoom];
    if (room && !o.target) {
      const th = Math.tan(o.fov * Math.PI / 360);
      const hz = dist * th / Math.sin(pitch), hx = dist * th * cam.aspect;
      const x0 = room.x0, x1 = room.x1 + 1, z0 = room.z0, z1 = room.z1 + 1;
      tx = (x1 - x0) < 2 * hx ? (x0 + x1) / 2 : Math.max(x0 + hx - 1, Math.min(x1 - hx + 1, tx));
      tz = (z1 - z0) < 2 * hz ? (z0 + z1) / 2 : Math.max(z0 + hz - 1, Math.min(z1 - hz + 1, tz));
    }
    cam.position.set(tx, Math.sin(pitch) * dist, tz + Math.cos(pitch) * dist);
    cam.lookAt(tx, 0, tz);
    if (this.scene && this.scene.fog) { this.scene.fog.near = dist + 4; this.scene.fog.far = dist + 20; }
  };
}, RES);
await sleep(500);

// ---- static data checks (safe rooms: warm light, no red)
const lightCheck = await g(async () => {
  const bad = [];
  const G = window.__game;
  for (const L of G.world.lights) {
    const room = G.world.rooms[L.room];
    if (!room.safe) continue;
    const c = L.light.color;
    if (c.r > 0.5 && c.r > c.g * 1.6) bad.push(`${L.room} #${c.getHexString()}`);
  }
  return bad;
});
if (lightCheck.length) fail('safe-room-light', 'red light in a safe room: ' + lightCheck.join(', '));
else pass('safe-room-light', 'no red lights in quiet rooms');

// ---- pixel-perfect scaling
const pp = await g(() => {
  const R = window.__game.renderer, c = R.canvas;
  const r = c.getBoundingClientRect();
  return { k: R.scale, lowW: R.lowW, lowH: R.lowH, cw: c.width, ch: c.height, css: [r.left, r.top, r.width, r.height], dpr: window.devicePixelRatio };
});
console.log('renderer', JSON.stringify(pp));
if (pp.cw === pp.lowW * pp.k && pp.ch === pp.lowH * pp.k && Number.isInteger(pp.k)) pass('canvas-size', `${pp.cw}×${pp.ch} = ${pp.lowW}×${pp.lowH} × ${pp.k}`);
else fail('canvas-size', JSON.stringify(pp));
if (RES === 'auto' && VW === 1280 && VH === 720) {
  if (pp.lowH === 360 && pp.k === 2) pass('auto-360', '360 lines at 720p'); else fail('auto-360', `got ${pp.lowH} lines, k=${pp.k}`);
}

// Checks that every k×k block of the canvas area in a screenshot is one colour.
async function blockCheck(name) {
  await g(() => { const u = document.getElementById('ui'); if (u) u.style.visibility = 'hidden'; });
  await sleep(120);
  const png = await page.screenshot();
  await g(() => { const u = document.getElementById('ui'); if (u) u.style.visibility = ''; });
  const res = await g(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    const R = window.__game.renderer, r = R.canvas.getBoundingClientRect();
    const k = R.scale / (window.devicePixelRatio || 1);
    let blocks = 0, bad = 0;
    const x0 = Math.round(r.left), y0 = Math.round(r.top);
    for (let by = 0; by + k <= r.height; by += k * 3) {
      for (let bx = 0; bx + k <= r.width; bx += k * 3) {
        const i0 = ((y0 + by) * c.width + (x0 + bx)) * 4;
        let same = true;
        for (let yy = 0; yy < k && same; yy++) for (let xx = 0; xx < k; xx++) {
          const i = ((y0 + by + yy) * c.width + (x0 + bx + xx)) * 4;
          if (d[i] !== d[i0] || d[i + 1] !== d[i0 + 1] || d[i + 2] !== d[i0 + 2]) { same = false; break; }
        }
        blocks++; if (!same) bad++;
      }
    }
    return { blocks, bad };
  }, png.toString('base64'));
  if (res.bad === 0 && res.blocks > 100) pass('pixel-perfect-' + name, `${res.blocks} sampled ${pp.k}×${pp.k} blocks uniform`);
  else fail('pixel-perfect-' + name, `${res.bad}/${res.blocks} blocks not uniform`);
}

// ---- room tour
// [name, x, z, yaw, opts] — opts: powered, target luma on the floor, frame target
const SPOTS = [
  ['cryo', 8.0, 40.2, 0, { floor: 0.16 }],
  ['corridor', 15.0, 33.5, Math.PI, { floor: 0.10 }],
  ['concourse', 31.0, 31.0, Math.PI / 2, { floor: 0.08, glitchCheck: true }],
  ['concourse-powered', 31.0, 31.0, Math.PI / 2, { powered: true, floor: 0.12 }],
  ['quiet', 10.0, 23.6, Math.PI, { floor: 0.18 }],
  ['quiet2', 51.6, 38.6, Math.PI, { floor: 0.18 }],
  ['relay', 8.0, 31.0, Math.PI, { floor: 0.08 }],
  ['relay-powered', 8.0, 31.0, Math.PI, { powered: true, floor: 0.12 }],
  ['crew', 22.0, 25.5, 0, { floor: 0.10 }],
  ['security', 33.0, 25.5, Math.PI, { floor: 0.10 }],
  ['mess', 23.0, 37.5, 0, { floor: 0.10 }],
  ['medical', 34.5, 36.8, 0, { powered: true, floor: 0.16 }],
  ['eastcorr', 47.0, 30.5, Math.PI, { powered: true, floor: 0.10 }],
  ['observation', 55.0, 20.4, Math.PI, { floor: 0.12 }],
  ['archive', 53.5, 29.8, 0, { floor: 0.12 }],
  ['comms', 47.0, 4.6, Math.PI, { powered: true, floor: 0.10 }],
];

const lumaLog = [];
let didBlock = false;
for (const [name, x, z, yaw, o] of SPOTS) {
  if (ONLY && !ONLY.includes(name)) continue;
  await g(([x, z, yaw, powered]) => {
    const G = window.__game;
    G.state.powered = !!powered; G.world.setPowered(!!powered);
    G.__shotCam.target = null; G.__shotCam.dist = 17.5; G.__shotCam.pitch = 62;
    G.debugTeleport(x, z, yaw);
    G.glitchPulse = 0; G.damageFlash = 0;
  }, [x, z, yaw, o.powered]);
  // let lights, doors and the rig settle
  await sleep(1400);
  await drain();
  let glitch = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const before = await g(() => { const u = window.__game.renderer.uniforms; return { gl: u.uGlitch.value, tear: u.uTear ? u.uTear.value : 0 }; });
    await page.screenshot({ path: `${out}/world-${name}.png` });
    const after = await g(() => { const u = window.__game.renderer.uniforms; return { gl: u.uGlitch.value, tear: u.uTear ? u.uTear.value : 0 }; });
    glitch = { gl: Math.max(before.gl, after.gl), tear: Math.max(before.tear, after.tear) };
    if (!o.glitchCheck || (glitch.gl <= 0.14 && glitch.tear <= 0)) break;
    await sleep(300); // a random legacy spike: shoot again
  }
  const L = await g(([]) => {
    const G = window.__game, room = G.world.rooms[G.state.currentRoom];
    const pts = [];
    // 3×3 samples per floor tile, offset so they don't all land on a grate bar
    for (let zz = room.z0; zz <= room.z1; zz++) for (let xx = room.x0; xx <= room.x1; xx++) {
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts.push([xx + (i + 0.37) / 3, 0.0, zz + (j + 0.61) / 3]);
    }
    const r = G.renderer.debugLuma({ points: pts });
    const threat = G.threat || 0;
    return { room: room.key, ...r, threat };
  }, []);
  lumaLog.push({ name, ...L });
  const fl = L.points ? L.points.mean : 0;
  console.log(`shot world-${name}.png  room ${L.room}  floor ${fl.toFixed(3)}  frame ${L.mean.toFixed(3)}  median ${L.median.toFixed(3)}  p90 ${L.p90.toFixed(3)}  black ${(L.dark * 100).toFixed(0)}%`);
  if (o.floor !== undefined) {
    if (fl >= o.floor) pass('luma-' + name, `floor ${fl.toFixed(3)} ≥ ${o.floor}`);
    else fail('luma-' + name, `floor ${fl.toFixed(3)} < ${o.floor}`);
  }
  if (o.glitchCheck) {
    const eff = Math.max(0, glitch.gl - 0.14);
    if (eff <= 0 && glitch.tear <= 0) pass('no-ambient-glitch-' + name, `uGlitch ${glitch.gl.toFixed(3)} (threat ${L.threat.toFixed(2)}) below the event knee`);
    else fail('no-ambient-glitch-' + name, `uGlitch ${glitch.gl.toFixed(3)} tear ${glitch.tear}`);
  }
  if (!didBlock) { await blockCheck(name); didBlock = true; }
}

// ---- close-ups of the new props (camera parked on the prop)
if (DETAILS) {
  const CLOSE = [
    ['detail-backup-deck', 'C', 10.0, 22.4, [10.0, 21.2], 6.5, 48],
    ['detail-locker', 'C', 8.6, 22.4, [8.3, 21.0], 6.0, 48],
    ['detail-plan', 'G', 28.4, 31.4, [28.4, 30.3], 6.0, 40],
    ['detail-posters', 'G', 26.5, 31.2, [27.0, 30.4], 8.0, 45],
    ['detail-corridor-posters', 'B', 15.0, 38.5, [15.0, 36.5], 7.0, 55],
    ['detail-door', 'G', 22.4, 31.4, [22.5, 29.8], 6.0, 42],
    ['detail-deck2', 'N', 51.5, 38.6, [51.2, 37.2], 6.5, 48],
  ];
  for (const [name, room, x, z, tgt, dist, pitch] of CLOSE) {
    if (ONLY && !ONLY.includes(name)) continue;
    await g(([x, z, tgt, dist, pitch]) => {
      const G = window.__game;
      G.__shotCam.target = tgt; G.__shotCam.dist = dist; G.__shotCam.pitch = pitch;
      G.debugTeleport(x, z, Math.PI);
    }, [x, z, tgt, dist, pitch]);
    await sleep(1200);
    await drain();
    await page.screenshot({ path: `${out}/world-${name}.png` });
    console.log(`shot world-${name}.png`);
  }
  await g(() => { const G = window.__game; G.__shotCam.target = null; G.__shotCam.dist = 17.5; G.__shotCam.pitch = 62; });
}

// ---- post effects gallery (--fx): each uniform / option on its own in the cryo bay
if (arg('fx', false)) {
  await g(() => { const G = window.__game; G.state.powered = false; G.world.setPowered(false); G.debugTeleport(8.0, 40.2, 0); });
  await sleep(1200);
  const FX = [
    ['menu', { uMenu: 1 }], ['failing', { uCritical: 0.5 }], ['critical', { uCritical: 1 }],
    ['tear', { uTear: 0.25 }], ['sweep', { uSweep: 0.45 }], ['glitch', { uGlitch: 0.9 }], ['damage', { uDamage: 0.6 }],
    ['memory', { uTint: 1 }], ['crt', { crt: true }], ['grain', { grain: true }],
  ];
  for (const [name, set] of FX) {
    await g((set) => {
      const G = window.__game, u = G.renderer.uniforms;
      G.__fxHold = set;
      // hold the uniforms against the game's per-frame writes
      if (!G.__fxWrapped) {
        G.__fxWrapped = true;
        const up = G.updatePost.bind(G);
        G.updatePost = (dt) => {
          up(dt);
          if (!G.__fxHold) return;
          u.uMenu.value = 0; u.uCritical.value = 0; u.uTear.value = 0; u.uSweep.value = -1;
          for (const [k, v] of Object.entries(G.__fxHold)) if (u[k]) u[k].value = v;
        };
      }
      G.renderer.setOptions({ crt: !!set.crt, grain: !!set.grain });
    }, set);
    await sleep(set.uCritical ? 2600 : 700);
    await page.screenshot({ path: `${out}/world-fx-${name}.png` });
    console.log(`shot world-fx-${name}.png`);
  }
  await g(() => { const G = window.__game; G.__fxHold = { uMenu: 0, uCritical: 0, uTear: 0, uSweep: -1 }; G.renderer.setOptions({ crt: false, grain: false }); });
  await sleep(300);
  await g(() => { window.__game.__fxHold = null; });
}

await writeFile(`${out}/world-luma.json`, JSON.stringify(lumaLog, null, 2));

// ---- audio smoke test: bundle audio.js alone and drive every method
if (!ONLY || ONLY.includes('audio')) {
  const esbuild = await import('esbuild');
  const b = await esbuild.build({
    stdin: { contents: "import { audio } from './src/engine/audio.js'; window.__audio = audio;", resolveDir: path.resolve('.'), loader: 'js' },
    bundle: true, format: 'iife', write: false,
  });
  const ap = await browser.newPage();
  const aerr = [];
  ap.on('pageerror', (e) => aerr.push(e.message));
  ap.on('console', (m) => { if (m.type() === 'error') aerr.push(m.text()); });
  await ap.setContent('<html><body></body></html>');
  await ap.addScriptTag({ content: b.outputFiles[0].text });
  const res = await ap.evaluate(async () => {
    const a = window.__audio;
    const calls = [];
    const run = (name, fn) => { try { fn(); calls.push(name); } catch (e) { calls.push(name + ' THREW ' + e.message); } };
    a.volume = 0.5;
    a.init();
    const legacy = ['uiMove', 'uiSelect', 'uiBack', 'typeTick', 'pickup', 'locked', 'hurt', 'gunshot', 'dryFire', 'reload', 'impact', 'collapse', 'heartbeat', 'powerUp', 'radioBurst', 'distantClank', 'sting'];
    for (const m of legacy) run(m, () => a[m]());
    run('click', () => a.click(0, 2000, 0.2)); run('blip', () => a.blip(800, 0.05, 'square', 0.05)); run('thud', () => a.thud(0.4, 80));
    run('footstep', () => a.footstep('grate')); run('door', () => a.door(true)); run('groan', () => a.groan(0.2)); run('screech', () => a.screech(0));
    run('setAmbience', () => a.setAmbience(0.6, true)); run('setStatic', () => a.setStatic(0.3)); run('setMusic', () => a.setMusic('quiet'));
    run('menuMuffle(on)', () => a.menuMuffle(true)); run('uiSelect muffled', () => a.uiSelect()); run('click muffled', () => a.click(0, 1500, 0.2));
    run('menuMuffle(off)', () => a.menuMuffle(false));
    for (const m of ['latch', 'pneumatic', 'stomp', 'arc']) run(m, () => a[m]());
    run('tapeSpool', () => a.tapeSpool(1.2)); run('flare', () => a.flare(2));
    run('carrier(0.5)', () => a.carrier(0.5)); run('carrier(8)', () => a.carrier(8)); run('carrier(null)', () => a.carrier(null));
    run('setVolume', () => a.setVolume(0.7));
    await new Promise((r) => setTimeout(r, 1500));
    return { calls, state: a.ctx && a.ctx.state, vol: a.volume, muffled: a.muffled };
  });
  const bad = res.calls.filter((c) => c.includes('THREW'));
  if (!bad.length && !aerr.length && res.vol === 0.7) pass('audio-api', `${res.calls.length} calls ok, ctx ${res.state}`);
  else fail('audio-api', bad.concat(aerr).join(' | ') || JSON.stringify(res));
  await ap.close();
}
if (errors.length) fail('console', errors.slice(0, 5).join(' | '));
else pass('console', 'no console errors');
await browser.close();
console.log(failed ? `${failed} FAIL` : 'ALL PASS');
process.exit(failed ? 1 : 0);
