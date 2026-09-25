// Character rig sheet + numeric checks.
//   node scripts/rig-sheet.mjs            checks + both sheets
//   node scripts/rig-sheet.mjs --checks   numeric checks only
//   node scripts/rig-sheet.mjs --sheets   sheets only
// Writes shots/rig-sheet.png (WREN-3) and shots/rig-hollows.png. Prints
// PASS/FAIL lines and exits 1 on any failure.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as THREE from 'three';
import * as CH from '../src/engine/characters.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'shots');
const args = new Set(process.argv.slice(2));
const doChecks = !args.has('--sheets');
const doSheets = !args.has('--checks');
let failed = 0;
const pass = (n, info = '') => console.log(`PASS ${n}${info ? '  ' + info : ''}`);
const fail = (n, why) => { failed++; console.log(`FAIL ${n}: ${why}`); };

// ----------------------------------------------------------------- checks
const HOLLOW_VARIANTS = [0, 1, 2, 'rusher', 'warden'];
const HOLLOW_STATES = ['dormant', 'idle', 'investigate', 'notice', 'rising', 'chase', 'lunge', 'attack', 'flinch', 'knockdown', 'down', 'stomped', 'burning', 'ash', 'dead'];

function rigStats(rig) {
  let tris = 0, calls = 0, visibleCalls = 0;
  rig.root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    calls++;
    let vis = true;
    for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (vis) visibleCalls++;
  });
  return { tris, calls, visibleCalls };
}

function finiteRig(rig) {
  let ok = true;
  rig.root.updateMatrixWorld(true);
  rig.root.traverse((o) => { for (const v of o.matrixWorld.elements) if (!Number.isFinite(v)) ok = false; });
  return ok;
}

function runChecks() {
  // budgets
  const wren = CH.buildCustodian();
  const ws = rigStats(wren);
  (ws.tris <= 1800 ? pass : fail)('wren-tris', `${ws.tris} tris (≤1800)`);
  (ws.calls <= 8 ? pass : fail)('wren-draw-calls', `${ws.calls} meshes, ${ws.visibleCalls} visible by default (≤8)`);
  for (const v of HOLLOW_VARIANTS) {
    const h = CH.buildHollow(v);
    const hs = rigStats(h);
    (hs.tris <= 1500 ? pass : fail)(`hollow-${v}-tris`, `${hs.tris} tris (≤1500)`);
    (hs.calls <= 8 ? pass : fail)(`hollow-${v}-draw-calls`, `${hs.calls} meshes (≤8)`);
    if (!h.glow || !h.glow.color || !h.core || (v === 'warden' && !h.plate)) fail(`hollow-${v}-fields`, 'missing glow/core/plate');
  }
  // contract fields
  const need = ['root', 'hips', 'torso', 'chest', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'thighL', 'thighR', 'kneeL', 'kneeR', 'footL', 'footR', 'gun', 'muzzle', 'lamp', 'handL', 'handR', 'holster', 'statusLamp'];
  const miss = need.filter((k) => !wren[k]);
  miss.length ? fail('wren-contract', 'missing ' + miss.join(',')) : pass('wren-contract');
  const chain = (a, b) => wren[b].parent === wren[a];
  const links = [['root', 'hips'], ['hips', 'torso'], ['torso', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['chest', 'shoulderL'], ['shoulderL', 'elbowL'], ['hips', 'thighL'], ['thighL', 'kneeL'], ['kneeL', 'footL']];
  const bad = links.filter(([a, b]) => !chain(a, b));
  bad.length ? fail('wren-hierarchy', bad.map((l) => l.join('→')).join(' ')) : pass('wren-hierarchy');
  (wren.gun.visible === false ? pass : fail)('gun-hidden-by-default');
  (typeof CH.custodianPhaseRate === 'function' && CH.STOMP_IMPACT_T === 0.3 && CH.TOOL_STRIKE_T === 0.35 && typeof CH.setHollowScorch === 'function' ? pass : fail)('new-exports');

  // muzzle height while aiming
  {
    const r = CH.buildCustodian();
    let lo = 9, hi = -9;
    for (let i = 0; i < 60; i++) {
      CH.poseCustodian(r, { aiming: true, time: i / 30, speed: 0 }, i === 0 ? 1 : 1 / 30);
      r.root.updateMatrixWorld(true);
      const y = r.muzzle.getWorldPosition(new THREE.Vector3()).y;
      if (i > 20) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    }
    (lo >= 1.15 && hi <= 1.35 ? pass : fail)('muzzle-height-aiming', `y ${lo.toFixed(3)}..${hi.toFixed(3)} (1.15..1.35)`);
  }

  // foot slide: synthetic walk / run using custodianPhaseRate
  for (const [label, speed, cond, mv, foreignRate] of [['walk', 2.3, 0], ['slow', 1.2, 0], ['run', 4.1, 0], ['limp', 2.3 * 0.85, 1], ['failing', 2.3 * 0.72, 2],
    ['aim-strafe', 1.2, 0, { x: 1, z: 0 }], ['aim-backpedal', 1.0, 0, { x: 0, z: -1 }], ['aim-diagonal', 1.2, 0, { x: -0.7, z: 0.7 }],
    ['legacy-cadence', 2.3, 0, null, (v) => v * 1.9]]) {
    const r = CH.buildCustodian();
    const dt = 1 / 60;
    let phase = 0, z = 0, x = 0;
    const ml = mv ? Math.hypot(mv.x, mv.z) : 1;
    const heel = new THREE.Vector3(), toe = new THREE.Vector3();
    const planted = { L: { heel: null, toe: null }, R: { heel: null, toe: null } };
    let worst = 0, stances = 0, lowest = 9;
    for (let f = 0; f < 60 * 6; f++) {
      phase += dt * (foreignRate ? foreignRate(speed) : CH.custodianPhaseRate(speed, cond)); // legacy: a caller not using custodianPhaseRate
      if (mv) { x += speed * dt * mv.x / ml; z += speed * dt * mv.z / ml; } else z += speed * dt;
      r.root.position.set(x, 0, z);
      CH.poseCustodian(r, mv ? { speed, phase, time: f * dt, aiming: true, moveLocal: mv } : { speed, phase, time: f * dt, condition: cond }, f === 0 ? 1 : dt);
      r.root.updateMatrixWorld(true);
      if (f < 60) continue;
      for (const side of ['L', 'R']) {
        const foot = r['foot' + side];
        heel.set(0, -0.08, -0.066).applyMatrix4(foot.matrixWorld);
        toe.set(0, -0.08, 0.15).applyMatrix4(foot.matrixWorld);
        lowest = Math.min(lowest, heel.y, toe.y);
        for (const [key, p] of [['heel', heel], ['toe', toe]]) {
          const onGround = p.y < 0.012;
          const st = planted[side];
          if (onGround) {
            if (!st[key]) { st[key] = p.clone(); if (key === 'heel') stances++; }
            else worst = Math.max(worst, Math.hypot(p.x - st[key].x, p.z - st[key].z));
          } else st[key] = null;
        }
      }
    }
    const ok = worst <= 0.05 && lowest > -0.02;
    (ok ? pass : fail)(`foot-slide-${label}`, `max drift ${worst.toFixed(3)} m over ~${stances} stances @ ${speed.toFixed(2)} m/s; lowest sole ${lowest.toFixed(3)}`);
  }

  // hollow gait: chase with the enemy's surging speed (internal phase keeps feet planted)
  for (const v of HOLLOW_VARIANTS) {
    const h = CH.buildHollow(v);
    const dt = 1 / 60;
    let z = 0, t = 0;
    const p = new THREE.Vector3();
    const planted = {};
    let worst = 0;
    for (let f = 0; f < 60 * 6; f++) {
      t += dt;
      const speed = 1.35 * (0.65 + 0.55 * Math.max(0, Math.sin(t * 3.5)));
      z += speed * dt;
      h.root.position.set(0, 0, z);
      CH.poseHollow(h, { state: 'chase', stateT: t, time: t, speed, phase: t * 3 }, f === 0 ? 1 : dt);
      h.root.updateMatrixWorld(true);
      if (f < 60) continue;
      for (const side of ['L', 'R']) {
        for (const [key, lz] of [['heel', -0.06], ['toe', 0.15]]) {
          p.set(0, -0.07, lz).applyMatrix4(h['foot' + side].matrixWorld);
          const k = side + key;
          if (p.y < 0.012 && h.footDown[side]) { if (!planted[k]) planted[k] = p.clone(); else worst = Math.max(worst, Math.hypot(p.x - planted[k].x, p.z - planted[k].z)); } else planted[k] = null;
        }
      }
    }
    (worst <= 0.05 ? pass : fail)(`hollow-${v}-foot-slide`, `max stance drift ${worst.toFixed(3)} m (chase, surging 0.9–1.6 m/s; the Lurcher's dragged foot scrapes by design)`);
  }

  // NaN sweep: every state x 200 frames at random dt in [0.016, 0.1]
  let rnd = 12345;
  const R = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const wrenStates = [
    {}, { speed: 2.3 }, { speed: 4.1 }, { aiming: true }, { aiming: true, speed: 1, moveLocal: { x: 1, z: 0 } },
    { aiming: true, speed: 1, moveLocal: { x: 0, z: -1 } }, { reload: 0.8 }, { condition: 1, speed: 2 }, { condition: 2, speed: 1.6 },
    { condition: 3 }, { action: 'reach' }, { action: 'reachLow' }, { action: 'stomp' }, { action: 'toolFlare' }, { action: 'toolProng' },
    { turn: 4 }, { look: { yaw: 2, pitch: -1 } }, { hurt: 1, hurtDir: 1.2 }, { dead: true }, { limp: true, speed: 2 },
    { speed: NaN, phase: undefined, aimPitch: 'x', action: 'bogus', condition: 9 },
  ];
  let nanBad = 0;
  for (const st of wrenStates) {
    const r = CH.buildCustodian();
    let t = 0, ph = 0, at = 0, dt0 = 0;
    for (let f = 0; f < 200; f++) {
      const dt = 0.016 + R() * 0.084;
      t += dt; at += dt; dt0 += dt;
      ph += dt * CH.custodianPhaseRate(st.speed || 0);
      if (at > 0.7) at = 0;
      CH.poseCustodian(r, { ...st, time: t, phase: st.phase === undefined && 'phase' in st ? undefined : ph, actionT: at, deadT: dt0, reload: st.reload ? Math.max(0, 1.1 - at * 1.5) : 0, recoil: R() }, dt);
    }
    if (!finiteRig(r)) { nanBad++; console.log('  NaN in custodian state', JSON.stringify(st)); }
  }
  for (const v of HOLLOW_VARIANTS) {
    for (const state of [...HOLLOW_STATES, 'bogus']) {
      const h = CH.buildHollow(v);
      let t = 0, stT = 0;
      for (let f = 0; f < 200; f++) {
        const dt = 0.016 + R() * 0.084;
        t += dt; stT += dt;
        CH.poseHollow(h, { state, stateT: stT, time: t, speed: R() * 2, phase: t * 3, hurt: R() < 0.1 ? 1 : 0, attackPhase: (stT * 2) % 3, twitch: R(), reviving: R() }, dt);
      }
      CH.setHollowScorch(h, R());
      if (!finiteRig(h)) { nanBad++; console.log('  NaN in hollow', v, state); }
    }
  }
  (nanBad === 0 ? pass : fail)('no-nan', `${wrenStates.length} custodian states + ${HOLLOW_VARIANTS.length}x${HOLLOW_STATES.length + 1} hollow states x 200 frames`);

  // state switching every frame (blend pops must stay finite)
  {
    const h = CH.buildHollow(0);
    for (let f = 0; f < 300; f++) CH.poseHollow(h, { state: HOLLOW_STATES[f % HOLLOW_STATES.length], stateT: (f % 7) * 0.1, time: f / 30 }, 1 / 30);
    (finiteRig(h) ? pass : fail)('hollow-state-thrash');
  }

  // wireframe
  {
    const r = CH.buildCustodian();
    CH.poseCustodian(r, { speed: 2, phase: 1 }, 1);
    const w = CH.wireframeClone(r, 0xe6e0d0);
    let segs = 0;
    w.traverse((o) => { if (o.isLineSegments) segs += o.geometry.attributes.position.count / 2; });
    (w.isGroup && segs > 50 ? pass : fail)('wireframe-segments', `${segs} segments`);
    const h = CH.buildHollow('warden');
    let hs = 0;
    CH.wireframeClone(h).traverse((o) => { if (o.isLineSegments) hs += o.geometry.attributes.position.count / 2; });
    (hs > 50 ? pass : fail)('wireframe-hollow', `${hs} segments`);
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    let bs = 0;
    CH.wireframeClone({ root: box }).traverse((o) => { if (o.isLineSegments) bs += o.geometry.attributes.position.count / 2; });
    (bs === 12 ? pass : fail)('wireframe-any-mesh', `${bs} segments for a box`);
  }

  // dt = 1 snaps; pose cost
  {
    const r = CH.buildCustodian();
    CH.poseCustodian(r, { aiming: true }, 1);
    const a = r.shoulderR.rotation.x;
    CH.poseCustodian(r, { aiming: true }, 1);
    (Math.abs(a - r.shoulderR.rotation.x) < 1e-6 && a < -0.5 ? pass : fail)('snap-dt1', `shoulderR.x ${a.toFixed(3)}`);
    const N = 20000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) CH.poseCustodian(r, { speed: 2.3, phase: i * 0.1, time: i / 60, aiming: i % 200 < 100, look: { yaw: 0.3, pitch: 0 }, condition: 1 }, 1 / 60);
    const ms = (performance.now() - t0) / N;
    (ms < 0.05 ? pass : fail)('pose-cost-custodian', `${(ms * 1000).toFixed(1)} µs/call`);
    const h = CH.buildHollow(0);
    const t1 = performance.now();
    for (let i = 0; i < N; i++) CH.poseHollow(h, { state: 'chase', stateT: i / 60, time: i / 60, speed: 1.3 }, 1 / 60);
    const hms = (performance.now() - t1) / N;
    (hms < 0.05 ? pass : fail)('pose-cost-hollow', `${(hms * 1000).toFixed(1)} µs/call`);
  }
}

// ----------------------------------------------------------------- sheets
async function renderSheets() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  const bundle = await esbuild.build({
    entryPoints: [path.join(ROOT, 'scripts/rig-sheet-page.js')],
    bundle: true, format: 'iife', write: false, target: 'es2020', minify: false,
  });
  const js = bundle.outputFiles[0].text;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#000}</style></head><body><script>${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
  await mkdir(OUT, { recursive: true });
  const tmp = path.join(OUT, '.rig-sheet.html');
  await writeFile(tmp, html);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + tmp);
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 60000 });
  const which = process.env.SHEET || 'both';
  for (const [name, fn] of [['rig-sheet', 'wrenSheet'], ['rig-hollows', 'hollowSheet']]) {
    if (which !== 'both' && which !== name) continue;
    const t0 = Date.now();
    const url = await page.evaluate(async (f) => window[f](), fn);
    await writeFile(path.join(OUT, name + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log(`[rig-sheet] shots/${name}.png (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
  if (process.env.EXTRA) {
    const url = await page.evaluate(async (spec) => window.extra(spec), JSON.parse(process.env.EXTRA));
    await writeFile(path.join(OUT, 'rig-extra.png'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('[rig-sheet] shots/rig-extra.png');
  }
  await browser.close();
  errors.length ? fail('sheet-console', errors.slice(0, 5).join(' | ')) : pass('sheet-console', 'no page errors');
}

if (doChecks) runChecks();
if (doSheets) await renderSheets();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
