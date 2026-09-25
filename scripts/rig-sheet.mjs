// Character rig sheet + numeric checks.
//   node scripts/rig-sheet.mjs            checks + both sheets
//   node scripts/rig-sheet.mjs --checks   numeric checks only
//   node scripts/rig-sheet.mjs --sheets   sheets only
// Writes shots/rig-sheet.png (WREN-3) and shots/rig-hollows.png. Prints
// PASS/FAIL lines and exits 1 on any failure.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import * as THREE from 'three';
import v8 from 'node:v8';
import vm from 'node:vm';
import * as CH from '../src/engine/characters.js';
import { WREN_POSES, HOLLOW_STATES as SHEET_STATES, LYING_STATES, STATE_SPEC, poseWren, poseHollowRig } from './rig-poses.mjs';

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
const HOLLOW_STATES = SHEET_STATES;
const PI = Math.PI;

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

// AST lint: allocation syntax in any function reachable from the per-frame
// pose entry points of characters.js. Returns null if TypeScript's parser is
// unavailable (it is only used as a parser here).
function poseAllocLint() {
  let ts;
  try { ts = require('typescript'); } catch { try { ts = require('/opt/node22/lib/node_modules/typescript'); } catch { return null; } }
  const file = process.env.LINT_FILE || path.join(ROOT, 'src/engine/characters.js'); // LINT_FILE: self-test the lint on another copy
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const fns = new Map();
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) fns.set(st.name.text, st);
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) fns.set(d.name.text, d.initializer);
      }
    }
  }
  const ALLOC_METHODS = new Set(['clone', 'map', 'filter', 'slice', 'concat', 'split', 'join', 'bind', 'from', 'keys', 'values', 'entries', 'assign', 'create', 'toFixed', 'toString', 'push', 'splice', 'reduce', 'forEach', 'fill', 'stringify']);
  const roots = ['poseCustodian', 'poseHollow', 'custodianPhaseRate', 'hollowPhaseRate'];
  const seen = new Set(), queue = [...roots], issues = [];
  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name) || !fns.has(name)) continue;
    seen.add(name);
    const fn = fns.get(name);
    const flag = (n, what) => issues.push(`${name}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${what}`);
    const visit = (n) => {
      if (n !== fn && (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n))) flag(n, 'closure');
      else if (ts.isNewExpression(n)) flag(n, 'new');
      else if (ts.isArrayLiteralExpression(n)) flag(n, 'array literal');
      else if (ts.isObjectLiteralExpression(n)) flag(n, 'object literal');
      else if (ts.isSpreadElement(n) || ts.isSpreadAssignment(n)) flag(n, 'spread');
      else if (ts.isTemplateExpression(n)) flag(n, 'template string');
      else if (ts.isForOfStatement(n) || ts.isForInStatement(n)) flag(n, 'for-of/in');
      else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken && (ts.isStringLiteral(n.left) || ts.isStringLiteral(n.right))) flag(n, 'string concat');
      else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ALLOC_METHODS.has(n.expression.name.text)) flag(n, '.' + n.expression.name.text + '()');
      if (ts.isIdentifier(n) && fns.has(n.text) && !seen.has(n.text)) queue.push(n.text);
      ts.forEachChild(n, visit);
    };
    visit(fn);
  }
  if (!seen.has('poseCustodian') || !seen.has('poseHollow') || seen.size < 20) issues.push(`lint reached only ${seen.size} functions`);
  return issues;
}

// --heap-child: steady-state new-space growth per pose call, printed as JSON
function heapChild() {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const newSpace = () => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space').space_used_size;
  const perCall = (fn) => {
    for (let i = 0; i < 20000; i++) fn(i);
    const res = [];
    for (let c = 0; c < 12; c++) {
      if (c % 4 === 0) gc();
      const n0 = newSpace();
      for (let i = 0; i < 20000; i++) fn(c * 20000 + i);
      const d = newSpace() - n0;
      if (d >= 0) res.push(d / 20000); // a chunk that saw a scavenge is skipped
    }
    return res.length ? Math.min(...res) : NaN;
  };
  const cases = [];
  {
    const r = CH.buildCustodian();
    const st = { speed: 2.3, phase: 0, time: 0, aiming: false, look: { yaw: 0.3, pitch: 0 }, condition: 1, moveLocal: { x: 0.3, z: 0.9 }, hurt: 0, hurtDir: 0.5, recoil: 0, reload: 0, action: null, actionT: 0 };
    cases.push(['custodian walk/aim', (i) => { st.time = i / 60; st.phase = i * 0.1; st.aiming = i % 200 < 100; st.hurt = (i % 90) / 90; st.recoil = (i % 7) / 7; CH.poseCustodian(r, st, 1 / 60); }]);
    const r2 = CH.buildCustodian();
    const st2 = { speed: 0, time: 0, reload: 0, action: 'stomp', actionT: 0, condition: 3 };
    cases.push(['custodian reload/actions', (i) => { st2.time = i / 60; st2.reload = 1.1 - (i % 66) / 60; st2.actionT = (i % 33) / 60; st2.action = i % 400 < 200 ? 'stomp' : 'toolFlare'; CH.poseCustodian(r2, st2, 1 / 60); }]);
    const r3 = CH.buildCustodian();
    const st3 = { dead: true, deadT: 0, time: 0 };
    cases.push(['custodian death', (i) => { st3.time = i / 60; st3.deadT = (i % 120) / 60; CH.poseCustodian(r3, st3, 1 / 60); }]);
  }
  for (const [v, states] of [[0, ['chase', 'idle', 'attack']], ['warden', ['idle', 'down', 'dormant', 'rising']], ['rusher', ['lunge', 'knockdown', 'stomped', 'ash']]]) {
    const h = CH.buildHollow(v);
    const st = { state: 'idle', stateT: 0, time: 0, speed: 1.2, phase: 0, hurt: 0, attackPhase: 0, twitch: 0.5, reviving: 0.5 };
    cases.push([`hollow ${v}`, (i) => { st.state = states[Math.floor(i / 300) % states.length]; st.stateT = (i % 300) / 60; st.time = i / 60; st.attackPhase = (i % 180) / 60; CH.poseHollow(h, st, 1 / 60); }]);
  }
  const only = +(process.argv[process.argv.indexOf('--heap-child') + 1] ?? -1);
  console.log(JSON.stringify(cases.map(([n, fn], i) => [n, only < 0 || only === i ? perCall(fn) : null])));
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

  // muzzle height while aiming: neutral, and swept over hurt 0..1 (from four
  // directions) x recoil 0..1, standing and aim-walking, STABLE and CRITICAL
  {
    const r = CH.buildCustodian();
    let lo = 9, hi = -9, worst = '';
    const v = new THREE.Vector3();
    const levels = [0, 0.25, 0.5, 0.75, 1];
    for (const cond of [0, 3]) {
      for (const walk of [false, true]) {
        for (const hurtDir of [0, PI / 2, -PI / 2, PI]) {
          for (const hurt of levels) {
            for (const recoil of levels) {
              const st = { aiming: true, condition: cond, hurt, hurtDir, recoil, speed: walk ? 1.1 : 0, moveLocal: walk ? { x: 1, z: 0 } : null };
              for (let i = 0; i < 40; i++) { st.time = i / 30; st.phase = i / 30 * CH.custodianPhaseRate(st.speed); CH.poseCustodian(r, st, i === 0 ? 1 : 1 / 30); }
              r.root.updateMatrixWorld(true);
              const y = r.muzzle.getWorldPosition(v).y;
              if (y < lo || y > hi) worst = JSON.stringify({ cond, walk, hurt, hurtDir: +hurtDir.toFixed(2), recoil });
              lo = Math.min(lo, y); hi = Math.max(hi, y);
            }
          }
        }
      }
    }
    (lo >= 1.15 && hi <= 1.35 ? pass : fail)('muzzle-height-aiming', `y ${lo.toFixed(3)}..${hi.toFixed(3)} (1.15..1.35) over hurt 0..1 x 4 dirs x recoil 0..1, idle/aim-walk, cond 0/3; extreme at ${worst}`);
  }

  // floor contact: no pose sinks through the floor (skinned min vertex y), and
  // resting poses actually rest on it
  {
    const ext = { min: 0, max: 0 };
    const bad = [];
    let lowest = 9;
    const r = CH.buildCustodian();
    for (const [name, , s, frames] of WREN_POSES) {
      poseWren(r, { s, frames });
      CH.bodyExtentY(r, ext);
      lowest = Math.min(lowest, ext.min);
      if (ext.min < -0.03) bad.push(`WREN ${name} ${ext.min.toFixed(3)}`);
      if (s.dead && ext.min > 0.02) bad.push(`WREN ${name} floats ${ext.min.toFixed(3)}`);
    }
    for (const v of HOLLOW_VARIANTS) {
      const h = CH.buildHollow(v);
      for (const st of SHEET_STATES) {
        poseHollowRig(h, { s: { state: st, ...STATE_SPEC[st] } });
        CH.bodyExtentY(h, ext);
        lowest = Math.min(lowest, ext.min);
        if (ext.min < -0.03) bad.push(`${v} ${st} ${ext.min.toFixed(3)}`);
        if ((st === 'dormant' || LYING_STATES.includes(st)) && ext.min > 0.03) bad.push(`${v} ${st} floats ${ext.min.toFixed(3)}`);
      }
    }
    (bad.length ? fail : pass)('floor-contact', bad.length ? bad.join('; ') : `${WREN_POSES.length} Wren poses + ${HOLLOW_VARIANTS.length}x${SHEET_STATES.length} Hollow states; lowest vertex ${lowest.toFixed(3)} (≥ -0.03), dormant/lying/dead rest within 3 cm`);
  }

  // Warden plate: never below the floor; flat on the floor once the body is down
  {
    const h = CH.buildHollow('warden');
    const box = new THREE.Box3();
    const bad = [], seen = [];
    for (const st of SHEET_STATES) {
      poseHollowRig(h, { s: { state: st, ...STATE_SPEC[st] } });
      h.root.updateMatrixWorld(true);
      box.setFromObject(h.plate);
      const lying = LYING_STATES.includes(st) || st === 'dormant';
      if (box.min.y < -0.02) bad.push(`${st} min ${box.min.y.toFixed(2)}`);
      if (lying && box.max.y > 0.35) bad.push(`${st} max ${box.max.y.toFixed(2)}`);
      if (lying) seen.push(`${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)}`);
    }
    (bad.length ? fail : pass)('warden-plate', bad.length ? bad.join('; ') : `min y ≥ -0.02 in all ${SHEET_STATES.length} states; lying/dormant plate y ${[...new Set(seen)].join(' ')} (≤ 0.35)`);
  }

  // transitions: every frame of state timelines (crossfades included) stays
  // above the floor, body and Warden plate
  {
    const ext = { min: 0, max: 0 };
    const box = new THREE.Box3();
    const timeline = [['dormant', 1], ['rising', 1.6], ['chase', 1], ['knockdown', 1], ['down', 2], ['rising', 1.6], ['idle', 0.5], ['lunge', 1.1], ['attack', 1], ['flinch', 0.4], ['down', 1], ['stomped', 0.6], ['dead', 1], ['idle', 0.5], ['burning', 4], ['ash', 1]];
    let worstBody = 9, worstPlate = 9, where = '', whereP = '';
    for (const v of HOLLOW_VARIANTS) {
      const h = CH.buildHollow(v);
      let t = 0, first = true;
      for (const [state, dur] of timeline) {
        for (let st = 0; st < dur; st += 1 / 30) {
          t += 1 / 30;
          CH.poseHollow(h, { state, stateT: st, time: t, speed: state === 'chase' ? 1.3 : 0, attackPhase: (st * 3) % 3, twitch: 0.5, reviving: state === 'down' ? st / 2 : 0 }, first ? 1 : 1 / 30);
          first = false;
          CH.bodyExtentY(h, ext);
          if (ext.min < worstBody) { worstBody = ext.min; where = `${v} ${state} @${st.toFixed(2)}`; }
          if (h.plate) {
            h.root.updateMatrixWorld(true);
            box.setFromObject(h.plate);
            if (box.min.y < worstPlate) { worstPlate = box.min.y; whereP = `${state} @${st.toFixed(2)}`; }
          }
        }
      }
    }
    (worstBody >= -0.03 && worstPlate >= -0.03 ? pass : fail)('floor-transitions', `state timeline x ${HOLLOW_VARIANTS.length} types, every frame: body min ${worstBody.toFixed(3)} (${where}), Warden plate min ${worstPlate.toFixed(3)} (${whereP}) (≥ -0.03)`);
  }

  // lying states read differently (mean bone distance), stomped head is crushed
  {
    const pos = (h) => { h.root.updateMatrixWorld(true); return h.bones.slice(1).map((b) => b.getWorldPosition(new THREE.Vector3())); };
    const headSpan = (h) => {
      const m = h.body, p = m.geometry.attributes.position, si = m.geometry.attributes.skinIndex, v = new THREE.Vector3();
      let lo = 9, hi = -9;
      h.root.updateMatrixWorld(true);
      for (let i = 0; i < p.count; i++) if (h.bones[si.getX(i)] === h.head) { m.getVertexPosition(i, v); lo = Math.min(lo, v.y); hi = Math.max(hi, v.y); }
      return hi - lo;
    };
    const names = ['knockdown', 'down', 'stomped', 'dead'];
    let minD = 9, pair = '', flat = 9;
    for (const v of HOLLOW_VARIANTS) {
      const h = CH.buildHollow(v);
      const P = {}, span = {};
      for (const st of names) { poseHollowRig(h, { s: { state: st, ...STATE_SPEC[st], twitch: 0, reviving: 0 } }); P[st] = pos(h); span[st] = headSpan(h); }
      for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
          const a = P[names[i]], b = P[names[j]];
          const d = a.reduce((acc, p, k) => acc + p.distanceTo(b[k]), 0) / a.length;
          if (d < minD) { minD = d; pair = `${v} ${names[i]}/${names[j]}`; }
        }
      }
      flat = Math.min(flat, 1 - span.stomped / span.down);
    }
    (minD > 0.08 ? pass : fail)('lying-states-distinct', `closest pair ${pair}: mean bone distance ${minD.toFixed(3)} m (> 0.08)`);
    (flat > 0.3 ? pass : fail)('stomped-head-flat', `stomped head ${(flat * 100).toFixed(0)}% flatter (vertical) than down (> 30%)`);
  }

  // rig.height = posed standing height (brackets / focus boxes frame it)
  {
    const ext = { min: 0, max: 0 };
    const bad = [], info = [];
    const w = CH.buildCustodian();
    poseWren(w, { s: {} });
    CH.bodyExtentY(w, ext);
    info.push(`wren ${w.height}/${ext.max.toFixed(3)}`);
    if (Math.abs(w.height - ext.max) > 0.02) bad.push('wren');
    for (const v of HOLLOW_VARIANTS) {
      const h = CH.buildHollow(v);
      poseHollowRig(h, { s: { state: 'idle', ...STATE_SPEC.idle } });
      CH.bodyExtentY(h, ext);
      info.push(`${v} ${h.height}/${ext.max.toFixed(3)}`);
      if (Math.abs(h.height - ext.max) > 0.02 || !(h.nominalHeight > h.height)) bad.push(String(v));
    }
    (bad.length ? fail : pass)('rig-height-posed', `rig.height / posed idle top: ${info.join(', ')} (±0.02)`);
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

  // pose functions allocate nothing per call.
  // (1) strict + deterministic: an AST lint of every function reachable from
  //     the per-frame entry points — no `new`, array/object literals, closures,
  //     spreads, template strings, for-of iterators or allocating methods.
  // (2) runtime: steady-state new-space growth per call (min over 20k-call
  //     chunks). V8 still boxes some doubles at helper calls it does not
  //     inline (~0-400 B/call depending on the JIT's inlining budget; about
  //     half the pre-pass figure), so this gate only catches gross per-call
  //     object churn such as a new Vector3 per bone.
  {
    const issues = poseAllocLint();
    if (issues === null) console.log('SKIP pose-alloc-lint (typescript not found)');
    else (issues.length ? fail : pass)('pose-alloc-lint', issues.length ? issues.slice(0, 12).join('; ') : 'no allocation syntax in the pose call graph (poseCustodian, poseHollow, phase-rate helpers)');
    // measured in fresh processes (one per case) with synchronous TurboFan
    // compiles, so the figure is reproducible: this process has just fed the
    // pose functions deliberately malformed input (NaN sweep), which leaves
    // their type feedback generic and is not what the game does
    const res = [];
    for (let c = 0; c < 6; c++) {
      const out = execFileSync(process.execPath, ['--no-concurrent-recompilation', fileURLToPath(import.meta.url), '--heap-child', String(c)], { encoding: 'utf8' });
      res.push(JSON.parse(out.trim().split('\n').pop())[c]);
    }
    const bad = res.filter(([, b]) => !(b < 512));
    (bad.length ? fail : pass)('pose-heap-steady', res.map(([n, b]) => `${n} ${Number.isFinite(b) ? b.toFixed(0) : 'n/a'}`).join(', ') + ' B/call new-space (< 512; the residual is V8 boxing doubles at non-inlined helper calls, not objects — see pose-alloc-lint)');
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

if (args.has('--heap-child')) { heapChild(); process.exit(0); }
if (doChecks) runChecks();
if (doSheets) await renderSheets();
if (failed) { console.log(`${failed} check(s) failed`); process.exit(1); }
