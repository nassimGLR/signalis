// Headless smoke test: boots the game, plays scripted steps, checks the state
// after each one and saves screenshots to shots/.
//
//   node scripts/shot.mjs [basic|title|walk|full|inv|play|mouse|touch]
//
// Every check prints `PASS <name>` or `FAIL <name>: why`; the process exits 1
// if anything failed (or on a page error). Dialogue and read-only screens are
// always advanced with a click — never Enter, which also means "interact".
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const scenario = process.argv[2] || 'basic';
const out = 'shots';
await mkdir(out, { recursive: true });

const touchMode = scenario === 'touch';
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext(touchMode
  ? { viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }
  : { viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

let failures = 0;
const check = (name, ok, why = '') => {
  console.log(ok ? `PASS ${name}` : `FAIL ${name}: ${why}`);
  if (!ok) failures++;
  return ok;
};
const finish = async () => {
  const pageErrors = errors.filter((e) => e.startsWith('[pageerror]'));
  const other = errors.filter((e) => !e.startsWith('[pageerror]'));
  if (other.length) console.log(other.slice(0, 20).join('\n'));
  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 5).join(' | '));
  if (!errors.length) console.log('no console errors');
  await browser.close();
  console.log(failures ? `${failures} check(s) failed` : 'all checks passed');
  process.exit(failures ? 1 : 0);
};

// ---------------------------------------------------------------- helpers
const W = -Math.PI / 2, EAST = Math.PI / 2, N = Math.PI, S = 0;
const vw = touchMode ? 412 : 1280, vh = touchMode ? 860 : 720;
const PARK = { x: vw - 6, y: vh - 6 };
const g = (fn, arg) => page.evaluate(fn, arg);
const sleep = (ms) => page.waitForTimeout(ms);
const snap = async (name) => { await page.screenshot({ path: `${out}/${scenario}-${name}.png` }); console.log('shot', name); };
const key = async (k, ms = 80) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); };
const until = async (fn, ms = 8000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await g(fn, arg)) return true; await sleep(100); }
  return false;
};
const tp = (x, z, yaw = 0) => g(([x, z, yaw]) => window.__game.debugTeleport(x, z, yaw), [x, z, yaw]);
const park = () => page.mouse.move(PARK.x, PARK.y);
const clickAt = async (x, y) => { if (touchMode) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
const screenOf = (x, y, z) => g(([x, y, z]) => window.__game.worldToScreen(x, y, z), [x, y, z]);
const facts = () => g(() => {
  const G = window.__game;
  return {
    f: G.state.flags, powered: G.state.powered, room: G.state.currentRoom, hp: G.player.hp,
    inv: G.inv.slots.map((s) => s && s.id + ':' + s.qty + (s.loaded !== undefined ? '/' + s.loaded : '')),
    items: G.inv.slots.filter(Boolean).map((s) => s.id), files: G.inv.files, taken: [...G.state.taken],
    pos: { x: +G.player.pos.x.toFixed(2), z: +G.player.pos.z.toFixed(2) },
  };
});
const log = async (label) => console.log(label, JSON.stringify(await facts()));
const ui = () => g(() => {
  const G = window.__game, u = G.ui;
  return {
    play: G.mode === 'play' && !G.paused, mode: G.mode, dlg: !!u.dialogState,
    passive: !!(u.modal && u.modal.passive), modal: !!u.modal,
  };
});
// Advance dialogue / read-only screens with clicks until play resumes, or an
// interactive screen opens (returns 'modal'). `at` is where to click.
const settle = async (ms = 25000, at = { x: vw / 2, y: Math.round(vh * 0.17) }) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await ui();
    if (s.play) return 'play';
    if (s.dlg || s.passive) await clickAt(at.x, at.y);
    else if (s.modal) return 'modal';
    await sleep(120);
  }
  return 'timeout';
};
const walkUntil = async (k, fn, ms = 8000) => { await page.keyboard.down(k); const ok = await until(fn, ms); await page.keyboard.up(k); return ok; };
const F = async () => { await key('KeyF'); await sleep(300); };

// ---------------------------------------------------------------- boot
await page.goto('file://' + path.resolve('dist/index.html'));
await sleep(800);
await clickAt(vw / 2, vh / 2);
await until(() => window.__game.mode === 'title', 8000);
await sleep(1800);
await snap('title');

if (scenario !== 'title') {
  await key('Enter');
  await sleep(1500);
  await snap('intro');
  await key('Escape');
  check('intro → wake dialogue', await until(() => !!window.__game.ui.dialogState, 15000), 'no wake dialogue');
  await sleep(600);
  await snap('wake');
  if (scenario === 'mouse' || scenario === 'touch') {
    // T6: the click that dismisses dialogue must not start a walk. Click on
    // open floor so a bleed-through would visibly path there.
    // (on a phone, pick floor that isn't under the on-screen stick)
    const p = await screenOf(touchMode ? 10.5 : 7.5, 0, touchMode ? 38.4 : 41.5);
    const r = await settle(20000, { x: Math.round(p.x), y: Math.round(p.y) });
    await sleep(700);
    const c = await g(() => ({ ctl: window.__game.ctl, speed: window.__game.player.speed }));
    check('dialog-dismissing click starts no path', r === 'play' && c.ctl.mode === 'idle' && !c.ctl.path.length && c.speed < 0.05, JSON.stringify(c));
  } else {
    check('wake dialogue dismissed', await settle() === 'play');
  }
  await park();
  await sleep(500);
  await snap('cryo');
}

// ---------------------------------------------------------------- tours
if (scenario === 'walk' || scenario === 'full') {
  await walkUntil('KeyS', () => false, 700);
  await snap('walk1');
  const spots = process.env.SPOTS ? JSON.parse(process.env.SPOTS) : [
    ['concourse', 30, 31, 0], ['crew', 22, 25, 0], ['mess', 23, 37, 0], ['security', 33, 25, 0],
    ['quiet', 10, 23.5, 0], ['relay', 8, 31, 0], ['medical', 34.5, 36.5, 0], ['eastcorr', 47, 25, 0],
    ['observation', 55, 20, Math.PI], ['archive', 53.5, 30, 0], ['comms', 47, 5, Math.PI],
  ];
  for (const [name, x, z, yaw] of spots) {
    await tp(x, z, yaw);
    const r = await settle(15000);
    await sleep(900); // camera eases to the room frame
    await snap(name);
    check(`tour ${name}`, r === 'play' && await g(() => !window.__game.ui.modal), r);
  }
}
if (scenario === 'inv' || scenario === 'full') {
  // give her a few things so the item screen isn't empty
  await g(() => { const G = window.__game; if (!G.inv.has('pistol')) { G.inv.add('pistol', 1); G.inv.weapon().loaded = 8; } G.inv.add('ammo', 12); G.inv.add('sealant', 1); if (!G.inv.files.includes('directive')) G.inv.addFile('directive'); });
  const openTab = async (tab, how) => {
    if (how === 'key') await key(tab === 'map' ? 'KeyM' : 'Tab');
    else await g((t) => { window.__game.openInventory(t); }, tab);
    const ok = await until(() => { const u = window.__game.ui; return !!u.modal && !u.modal.passive && !u.dialogState; }, 5000);
    await sleep(700);
    await snap(tab === 'items' ? 'inventory' : tab);
    check(`inventory ${tab} open`, ok);
    await key('Escape');
    const closed = await until(() => !window.__game.ui.modal, 4000);
    check(`inventory ${tab} closed`, closed && await settle(8000) === 'play');
  };
  await openTab('items', 'key');
  await openTab('files', 'call');
  await openTab('map', 'key');
}

// ---------------------------------------------------------------- keyboard playthrough
if (scenario === 'play') {
  const step = async (name, ok, why) => {
    if (!check(name, ok, why || JSON.stringify(await facts()))) { await snap('fail-' + name.replace(/\W+/g, '-')); await finish(); }
  };
  const use = async () => { await park(); await F(); };
  // a keyboard player: the parked mouse shouldn't turn her toward the corner
  await g(() => { window.__game.ui.settings.faceCursor = false; });
  // A: pistol locker, breaker, door
  await tp(4.4, 41.0, W); await use(); await settle();
  await step('pistol', (await facts()).items.includes('pistol'));
  await tp(11.9, 41.2, EAST); await use(); await settle();
  await step('breaker', await g(() => window.__game.state.flags.breaker && !window.__game.world.doors.dAB.locked));
  await tp(12.4, 39.5, EAST); await use(); await settle();
  await step('door C-01 opens', await until(() => window.__game.world.doors.dAB.open, 3000));
  await step('walked into B', await walkUntil('KeyD', () => window.__game.state.currentRoom === 'B'));
  await settle();
  await snap('corridor');
  // quiet room: save
  await tp(10, 21.6, N); await use();
  await step('save prompt', await settle() === 'modal');
  await key('Enter'); await sleep(400); await settle();
  await step('saved', await g(() => !!localStorage.getItem('lethe7-save')));
  // relay door keypad without the code stays locked
  await tp(12.4, 31.5, EAST); await use(); await settle();
  await key('Escape'); await sleep(300); await settle();
  await step('relay door still locked', await g(() => window.__game.world.doors.dJB.locked && !window.__game.world.doors.dJB.open));
  // crew quarters: photo (memory), keycard, letter
  await tp(22.3, 24.2, N); await use(); await sleep(500);
  await snap('photo-dialog'); await settle();
  await step('photo', (await facts()).items.includes('photo'));
  await tp(25.8, 25.9, EAST); await use(); await settle();
  await step('keycard', (await facts()).items.includes('keycard'));
  await tp(21.2, 27.4, N); await use(); await settle();
  await step('letter', (await facts()).files.includes('letter'));
  // concourse fight: wake the slumped hollow and shoot it (Space readies, J fires)
  await tp(33.5, 31, EAST); await settle(); await sleep(300);
  await step('hollow woke', await walkUntil('KeyD', () => window.__game.enemies.find((e) => e.id === 'e_G1').state !== 'dormant'));
  await sleep(600);
  await snap('hollow-rise');
  await page.keyboard.down('Space'); await sleep(500);
  for (let i = 0; i < 8; i++) {
    if (await g(() => !window.__game.enemies.find((e) => e.id === 'e_G1').alive)) break;
    await until(() => window.__game.ctl.aim.focus >= 0.55, 900);
    await key('KeyJ'); await sleep(250);
    if (i === 1) await snap('shooting');
  }
  await page.keyboard.up('Space');
  await sleep(400);
  await step('hollow down (J fires)', await g(() => ['down', 'dead'].includes(window.__game.enemies.find((e) => e.id === 'e_G1').state)));
  await log('after-fight');
  // security: keycard door, fuse, bulletin
  await tp(33.5, 30.3, N); await use(); await settle();
  await step('security door (keycard)', await until(() => window.__game.world.doors.dHG.open, 3000));
  await tp(33.5, 28.3, N); await settle();
  await g(() => { const e = window.__game.enemies.find((e) => e.id === 'e_H1'); e.kill(); });
  await tp(31.0, 24.5, W); await use(); await settle();
  await step('fuse', (await facts()).items.includes('fuse'));
  await tp(32.2, 23.5, N); await use(); await settle();
  await step('bulletin', (await facts()).files.includes('bulletin'));
  // relay: code + fuse + puzzle
  await tp(12.4, 31.5, EAST); await use();
  await step('keypad opens', await settle() === 'modal');
  await sleep(300);
  for (const d of '7304') { await key('Digit' + d); await sleep(120); }
  await until(() => !window.__game.ui.modal, 5000); await settle();
  await step('relay door open', await until(() => window.__game.world.doors.dJB.open, 3000));
  await tp(8.5, 29.5, N); await use();
  await step('relay puzzle', await settle() === 'modal');
  await sleep(300);
  await snap('relay-puzzle');
  await key('Digit1'); await sleep(300); await key('Digit3');
  await step('power restored', await until(() => window.__game.state.powered, 8000));
  await sleep(3500); await settle();
  await snap('power-on');
  // clear the east wing and go through the bulkhead
  await g(() => window.__game.enemies.forEach((e) => { if (['e_J1', 'e_K1', 'e_K2', 'e_I1'].includes(e.id)) e.kill(); }));
  await tp(44.3, 30.5, EAST); await use(); await settle();
  await step('bulkhead E-1 opens', await until(() => window.__game.world.doors.dGK.open, 3000));
  await step('entered K', await walkUntil('KeyD', () => window.__game.state.currentRoom === 'K'));
  await settle();
  // observation memory
  await tp(55, 18, N); await use(); await settle(40000);
  await step('observation memory', await g(() => !!window.__game.state.flags.memPromise));
  // archive desk: the pickups sit on its north edge — stand north of it, facing south
  await tp(53.1, 30.4, S); await use(); await settle();
  await step('obol', (await facts()).items.includes('obol'));
  await tp(54.0, 30.4, S); await use(); await settle();
  await step('journal', (await facts()).files.includes('final'));
  // comms door: pay the obol
  await tp(46.5, 8.4, N); await use();
  await step('fare prompt', await settle() === 'modal');
  await key('Enter');
  await step('comms door opens', await until(() => window.__game.world.doors.dKM.open, 5000));
  await settle();
  await step('entered M', await walkUntil('KeyW', () => window.__game.state.currentRoom === 'M'));
  await settle();
  await snap('comms-room');
  await tp(47, 3.3, N); await use();
  await step('wave puzzle', await settle() === 'modal');
  await sleep(400);
  await snap('wave');
  for (let i = 0; i < 3; i++) { await key('ArrowLeft'); await sleep(100); }
  await key('ArrowDown'); await sleep(100);
  for (let i = 0; i < 2; i++) { await key('ArrowRight'); await sleep(100); }
  await sleep(300);
  await snap('wave-locked');
  await key('KeyE');
  await step('ending', await until(() => window.__game.mode === 'cutscene' && window.__game.state.flags.ending, 6000));
  await sleep(9000);
  await snap('ending');
  await log('end');
}

// ---------------------------------------------------------------- mouse controls (plan §6 acceptance)
if (scenario === 'mouse') {
  const ctl = () => g(() => window.__game.ctl);
  const P = () => g(() => { const p = window.__game.player; return { x: p.pos.x, z: p.pos.z, speed: p.speed, yaw: p.yaw, action: p.action }; });
  const moveTo = async (x, y, z) => { const s = await screenOf(x, y, z); await page.mouse.move(Math.round(s.x), Math.round(s.y), { steps: 4 }); await sleep(250); return s; };
  const fps = async (ms = 2500) => g((ms) => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }), ms);

  // T8: cursor — OS cursor hidden, custom idle cursor drawn
  const cursorInfo = async () => g(() => {
    const cv = document.getElementById('cursor');
    const m = window.__game.input.mouse;
    let lit = 0;
    if (cv) {
      // copy the patch under the pointer, then read the copy
      const dpr = cv.width / window.innerWidth, n = Math.round(17 * dpr);
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = n;
      const tg = tmp.getContext('2d', { willReadFrequently: true });
      tg.drawImage(cv, Math.round((m.x - 8) * dpr), Math.round((m.y - 8) * dpr), n, n, 0, 0, n, n);
      const d = tg.getImageData(0, 0, n, n).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
    }
    return { body: getComputedStyle(document.body).cursor, canvas: getComputedStyle(document.getElementById('view')).cursor, lit };
  });
  await tp(8, 40.5, 0);
  await moveTo(6.5, 0, 41);
  await sleep(400);
  const ci = await cursorInfo();
  check('OS cursor hidden in game', ci.body === 'none' && ci.canvas === 'none', JSON.stringify(ci));
  check('custom cursor drawn', ci.lit > 6, JSON.stringify(ci));
  await snap('cursor-idle');
  const f0 = await fps();
  console.log('fps idle', f0.toFixed(1));

  // T1: click-to-go across the cryo bay, routed around the chair and desk
  await tp(3.9, 42.1, EAST);
  await sleep(900);
  const dest = { x: 8.5, z: 43.3 };
  const ds = await screenOf(dest.x, 0, dest.z);
  await page.mouse.click(Math.round(ds.x), Math.round(ds.y));
  await sleep(150);
  const c1 = await ctl();
  console.log('path', JSON.stringify(c1.path));
  check('click-to-go plans a path', c1.mode === 'path' && c1.path.length >= 2, JSON.stringify(c1));
  const clear = await g((path) => {
    const w = window.__game.world, p0 = window.__game.player.pos;
    let a = { x: p0.x, z: p0.z }; let ok = true;
    for (const b of path) {
      for (let t = 0; t <= 1; t += 0.02) {
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        for (const c of w.propColliders) if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) ok = false;
      }
      a = b;
    }
    return ok;
  }, c1.path);
  check('path stays clear of props', clear);
  await sleep(500);
  await snap('path');
  const arrived = await until(() => window.__game.ctl.mode === 'idle', 8000);
  const p1 = await P();
  console.log('arrival error m', Math.hypot(p1.x - dest.x, p1.z - dest.z).toFixed(3));
  check('click-to-go arrives within 0.25 m', arrived && Math.hypot(p1.x - dest.x, p1.z - dest.z) <= 0.25, JSON.stringify(p1));

  // T1b: double-click runs there; a click into the dark goes nowhere
  await tp(4.2, 38.4, EAST);
  await sleep(900);
  const dd = await screenOf(11, 0, 40);
  await page.mouse.dblclick(Math.round(dd.x), Math.round(dd.y));
  check('double-click runs to the spot', await until(() => window.__game.ctl.mode === 'path' && window.__game.player.speed > 3.5, 3000), JSON.stringify(await P()));
  await until(() => window.__game.ctl.mode === 'idle', 6000);
  const voidPt = await screenOf(1.9, 0, 40.5); // west of the cryo bay: nothing there
  check('void point is on screen', voidPt.x > 2 && voidPt.x < vw - 2 && voidPt.y > 2 && voidPt.y < vh - 2, JSON.stringify(voidPt));
  await page.mouse.click(Math.round(voidPt.x), Math.round(voidPt.y));
  await sleep(300);
  check('click into the dark starts no walk', (await ctl()).mode === 'idle', JSON.stringify(await ctl()));

  // T2: hold LMB toward the east wall: walk, stop at the wall, stop on release
  await tp(8, 40.5, EAST);
  await sleep(800);
  await moveTo(13.3, 0.05, 40.5); // the foot of the east wall
  await page.mouse.down();
  await sleep(700);
  const h1 = await g(() => ({ ctl: window.__game.ctl, x: window.__game.player.pos.x, speed: window.__game.player.speed }));
  await snap('hold');
  check('hold LMB walks toward the pointer', h1.ctl.mode === 'hold' && h1.speed > 1, JSON.stringify(h1));
  await sleep(1300);
  const samples = [];
  for (let i = 0; i < 6; i++) { samples.push(await P()); await sleep(100); }
  const xs = samples.map((s) => s.x), zs = samples.map((s) => s.z);
  const jitter = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  console.log(`hold: x=${xs[0].toFixed(3)} jitter=${jitter.toFixed(4)} m over 0.5 s`);
  check('hold stops at the wall without jitter', xs[0] > 12.4 && jitter < 0.02, `x=${xs[0].toFixed(3)} jitter=${jitter.toFixed(4)}`);
  await page.mouse.up();
  await sleep(200);
  const h2 = await P();
  console.log(`speed 0.2 s after release: ${h2.speed.toFixed(3)}`);
  check('release stops within 0.2 s', h2.speed < 0.05, `speed=${h2.speed.toFixed(3)}`);

  // T3a: in reach of the desk: both items bracketed, the act cursor on one
  await tp(4.6, 41.75, S);
  await sleep(900);
  await moveTo(5.0, 0.92, 42.6);
  const c3b = await ctl();
  check('bracket on in-reach item', c3b.hover && c3b.hover.id === 'p_note_A' && c3b.hover.inReach, JSON.stringify(c3b.hover) + ' at ' + JSON.stringify(await P()));
  await snap('bracket');

  // T3: click a pickup ~6 m away: walk, reach, take
  await tp(10.5, 41.5, W);
  await sleep(900);
  await moveTo(4.2, 0.92, 42.7);
  const c3 = await ctl();
  check('hover picks the pickup (out of reach)', c3.hover && c3.hover.id === 'p_sealant_A' && !c3.hover.inReach, JSON.stringify(c3.hover));
  await snap('far');
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  let sawReach = false;
  const took = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const s = await g(() => ({ a: window.__game.player.action, taken: window.__game.state.taken.has('p_sealant_A') }));
      if (s.a === 'reach' || s.a === 'reachLow') sawReach = true;
      if (s.taken) return true;
      await sleep(60);
    }
    return false;
  })();
  check('click pickup: walks, reaches, takes it', took && sawReach, `took=${took} reach=${sawReach}`);
  await settle();

  // T6b: an examine dialogue dismissed by clicking the floor starts no walk
  await moveTo(3.8, 0.9, 39.6);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  const opened = await until(() => !!window.__game.ui.dialogState, 5000);
  const fl = await screenOf(9, 0, 41);
  const r6 = await settle(15000, { x: Math.round(fl.x), y: Math.round(fl.y) });
  await sleep(600);
  const c6 = await g(() => ({ ctl: window.__game.ctl, speed: window.__game.player.speed }));
  check('clicked fixture talks; dismissing click starts no path', opened && r6 === 'play' && c6.ctl.mode === 'idle' && c6.speed < 0.05, JSON.stringify(c6));

  // T4: click a closed unlocked door: she opens it and walks through
  await tp(14.6, 26.5, N);
  await sleep(1000);
  await moveTo(13.5, 1.25, 23.5);
  const c4 = await ctl();
  check('hover picks the door', c4.hover && c4.hover.id === 'dCB', JSON.stringify(c4.hover));
  await snap('door-hover');
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  const through = await until(() => { const G = window.__game; return G.world.doors.dCB.open && G.state.currentRoom === 'C' && G.ctl.mode === 'idle'; }, 12000);
  const p4 = await P();
  console.log('after door', JSON.stringify({ x: +p4.x.toFixed(2), z: +p4.z.toFixed(2) }));
  check('door opens and she continues through', through && p4.x < 12.8, JSON.stringify(p4));
  await sleep(500);
  await snap('door');

  // T5: ready on the concourse Hollow: lock, focus, red box, fire
  await g(() => { const G = window.__game; if (!G.inv.has('pistol')) { G.inv.add('pistol', 1); G.inv.weapon().loaded = 8; } G.state.flags.pistol = true; });
  await tp(32.6, 30.9, EAST);
  await settle();
  await moveTo(38.5, 0.8, 31.4);
  await sleep(1400); // the camera settles with its pointer lead; point again at where it is now
  await moveTo(38.5, 0.8, 31.4);
  const tPress = await g(() => window.__game.time);
  await page.mouse.down({ button: 'right' });
  const focused = await until(() => { const a = window.__game.ctl.aim; return a.lockId === 'e_G1' && a.focus >= 0.9; }, 4000);
  const tFocus = await g(() => window.__game.time);
  const c5 = await ctl();
  check('RMB locks the Hollow under the pointer', c5.aim.lockId === 'e_G1', JSON.stringify(c5.aim));
  console.log(`focus ${c5.aim.focus.toFixed(2)} after ${(tFocus - tPress).toFixed(2)} s game time`);
  check('focus ≥ 0.9 within 1.3 s (game time)', focused && tFocus - tPress <= 1.3, `focus=${c5.aim.focus.toFixed(2)} t=${(tFocus - tPress).toFixed(2)}s`);
  await until(() => window.__game.ctl.aim.focus >= 0.95, 1500);
  await sleep(150);
  await snap('focus');
  const before = await g(() => window.__game.inv.weapon().loaded);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await sleep(300);
  const after = await g(() => window.__game.inv.weapon().loaded);
  check('LMB fires while readied', after === before - 1, `${before} → ${after}`);
  await snap('fired');
  await page.mouse.up({ button: 'right' });
  await sleep(300);
  const c5b = await ctl();
  check('release clears the ready state', !c5b.aim.active && c5b.mode === 'idle', JSON.stringify(c5b));
  await g(() => window.__game.enemies.forEach((e) => e.kill()));

  // T7: F interacts with the thing she faces
  await tp(4.4, 41.0, W);
  await park();
  await sleep(300);
  await F();
  check('F interacts', await until(() => !!window.__game.ui.dialogState || !!window.__game.ui.modal, 3000));
  await settle();

  // T8b: no custom cursor for touch
  await g(() => document.body.classList.add('touching'));
  await page.mouse.move(640, 400); await sleep(400);
  const ct = await cursorInfo();
  check('no custom pointer with body.touching', ct.lit === 0 && ct.body !== 'none', JSON.stringify(ct));
  await g(() => document.body.classList.remove('touching'));

  // T9: nav cost and frame time
  const navMs = (await ctl()).navMs;
  console.log('nav max ms', navMs.toFixed(2));
  check('A* under 4 ms per query', navMs < 4, navMs.toFixed(2));
  const f1 = await fps();
  console.log('fps after', f1.toFixed(1));
}

// ---------------------------------------------------------------- touch: tap to go / tap to use
if (scenario === 'touch') {
  await g(() => document.body.classList.add('touching'));
  // taps count only on the game view itself, not on the stick or buttons
  const onCanvas = (p) => g(([x, y]) => document.elementFromPoint(x, y) === document.getElementById('view'), [p.x, p.y]);
  await tp(7, 41.5, 0);
  await sleep(900);
  const d = await screenOf(10.5, 0, 38.4);
  check('tap point is on the game view', await onCanvas(d), JSON.stringify(d));
  await page.touchscreen.tap(Math.round(d.x), Math.round(d.y));
  await sleep(250);
  const c = await g(() => window.__game.ctl);
  check('tap on the floor walks there', c.mode === 'path', JSON.stringify(c));
  check('tap arrives', await until(() => window.__game.ctl.mode === 'idle', 8000));
  const pos = await g(() => window.__game.player.pos);
  check('arrived at the tapped spot', Math.hypot(pos.x - 10.5, pos.z - 38.4) < 0.3, JSON.stringify(pos));
  await snap('walked');
  // tap the breaker across the room: walk over, throw it
  await tp(10.2, 38.4, 0);
  await sleep(1200);
  const br = await screenOf(12.5, 0.9, 41.2);
  const inView = br.x > 4 && br.x < vw - 4 && br.y > 4 && br.y < vh - 4 && await onCanvas(br);
  check('breaker is tappable on a phone screen', inView, JSON.stringify(br));
  await page.touchscreen.tap(Math.round(br.x), Math.round(br.y));
  await sleep(250);
  const cb = await g(() => window.__game.ctl);
  check('tap a thing out of reach walks to it', cb.pending === 'f_breaker_A' || cb.acting, JSON.stringify(cb));
  check('…and uses it', await until(() => !!window.__game.state.flags.breaker, 12000), JSON.stringify(await g(() => window.__game.ctl)));
  await snap('used');
  await settle(15000, { x: Math.round(d.x), y: Math.round(d.y) });
  await snap('game');
}

await finish();
