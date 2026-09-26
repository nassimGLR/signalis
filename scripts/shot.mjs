// Headless smoke test: boots the game, plays scripted steps, checks the state
// after each one and saves screenshots to shots/.
//
//   node scripts/shot.mjs [basic|title|walk|full|inv|play|mouse|touch|mech]
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
// Resolve after n animation frames. The game runs one update per frame, so two
// frames after an event the game has seen it (at any frame rate).
const frames = (n = 2) => g((n) => new Promise((res) => {
  let i = 0;
  const f = () => (++i >= n ? res() : requestAnimationFrame(f));
  requestAnimationFrame(f);
  setTimeout(res, 3000);
}), n);
// A key tap. It waits for the game to take the press before returning, so two
// quick taps of one key can't merge into one on a slow frame.
const key = async (k, ms = 80) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); await frames(2); };
const until = async (fn, ms = 8000, arg) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await g(fn, arg)) return true; await sleep(100); }
  return false;
};
// Wait for the game clock to move on by `sec` (the camera eases and Wren walks
// in game time, which runs slower than wall time on a busy machine).
const gameWait = async (sec, ms = 12000) => {
  const t0 = await g(() => window.__game.time);
  await until((t) => window.__game.time >= t, ms, t0 + sec);
};
// Wait for an outcome that takes game time (a stomp, a burn, a revive): true
// once fn holds, false once `sec` of game time has gone by without it. On a
// busy machine the game runs at a few fps with dt capped, so game time runs
// far slower than wall time; `ms` is only a safety net (menus stop the clock).
const untilG = async (fn, sec, arg, ms = 240000) => {
  const t0 = await g(() => window.__game.time);
  const w0 = Date.now();
  while (Date.now() - w0 < ms) {
    if (await g(fn, arg)) return true;
    if (await g((t) => window.__game.time > t, t0 + sec)) return !!(await g(fn, arg));
    await sleep(100);
  }
  return false;
};
// Teleport, but only to a spot a player could stand on: the world's own
// collider must leave a Wren-sized circle where it is (no standing inside a
// table), on a room tile or an open door.
const tp = async (x, z, yaw = 0) => {
  const ok = await g(([x, z, yaw]) => {
    const G = window.__game, w = G.world, p = { x, z };
    w.resolve(p, 0.28);
    const t = w.tile(Math.floor(x), Math.floor(z));
    const floor = typeof t === 'string' || (t && typeof t === 'object' && t.open);
    G.debugTeleport(x, z, yaw);
    return floor && Math.hypot(p.x - x, p.z - z) < 0.02 ? true : { x: +p.x.toFixed(2), z: +p.z.toFixed(2), floor: !!floor };
  }, [x, z, yaw]);
  if (ok !== true) check(`teleport spot (${x}, ${z}) is somewhere she can stand`, false, 'pushed to ' + JSON.stringify(ok));
};
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

// Hollows: stand 0.75 m beside a body (west of it by default), facing it.
const besideBody = (id, side = -1) => g(([id, side]) => {
  const G = window.__game, e = G.enemies.find((q) => q.id === id), b = G.bodyPos(e);
  G.debugTeleport(b.x + side * 0.75, b.z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
  return b;
}, [id, side]);
const foe = (id) => g((id) => {
  const G = window.__game, e = G.enemies.find((q) => q.id === id);
  return { s: e.state, alive: e.alive, fin: e.finishable, will: e.willRevive, flares: G.inv.count('flare') };
}, id);
// A keyboard fight (Space readies and locks, J fires once the box settles).
// When anything gets within 1.7 m she steps back to whichever of `spots` is
// farthest from it; below 45 hp she uses a sealant. Returns shots fired.
const fight = async (ids, spots, maxShots = 30) => {
  const look = () => g((ids) => {
    const G = window.__game, P = G.player, w = G.inv.weapon();
    const foes = G.enemies.filter((e) => e.alive && e.state !== 'dormant' && (ids.includes(e.id) || (e.threatening && Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) < 10)))
      .map((e) => ({ id: e.id, s: e.state, x: e.pos.x, z: e.pos.z, d: Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z) }));
    // bodies of ours on the floor with nothing standing within 4 m of them
    const bodies = G.enemies.filter((e) => ids.includes(e.id) && e.finishable
      && !foes.some((f) => Math.hypot(f.x - e.pos.x, f.z - e.pos.z) < 4)).map((e) => e.id);
    return { hp: P.hp, dead: P.dead, rounds: G.inv.rounds(), loaded: w ? w.loaded : 0, foes, bodies };
  }, ids);
  let shots = 0;
  await page.keyboard.down('Space');
  for (let n = 0; n < 90 && shots < maxShots; n++) {
    const s = await look();
    if (s.dead) break;
    // finish a body as soon as it's down (its revive clock is already
    // running), before the next one gets close
    if (s.bodies.length) {
      await page.keyboard.up('Space'); await frames(2);
      for (const id of s.bodies) await finishOne(id);
      await page.keyboard.down('Space'); await frames(2);
      continue;
    }
    if (!s.foes.length) break;
    if (s.rounds <= 0) break;
    if (s.foes.some((f) => f.d < 1.7)) {
      let best = spots[0], bd = -1;
      for (const p of spots) { const m = Math.min(...s.foes.map((f) => Math.hypot(f.x - p[0], f.z - p[1]))); if (m > bd) { bd = m; best = p; } }
      const near = s.foes.reduce((a, b) => (Math.hypot(a.x - best[0], a.z - best[1]) < Math.hypot(b.x - best[0], b.z - best[1]) ? a : b));
      await tp(best[0], best[1], Math.atan2(near.x - best[0], near.z - best[1]));
      await frames(2);
      continue;
    }
    if (s.hp < 45) await g(() => { const G = window.__game, i = G.inv.slots.findIndex((q) => q && q.id === 'sealant'); if (i >= 0) G.itemActions(i).find((a) => a.label === 'USE').fn(); });
    const ready = await until(() => { const a = window.__game.ctl.aim; return a.active && !!a.lockId && a.focus >= 0.6; }, 1600);
    if (!ready) continue;
    const before = await g(() => window.__game.inv.rounds());
    await key('KeyJ');
    if ((await g(() => window.__game.inv.rounds())) < before) shots++;
    await sleep(100);
  }
  await page.keyboard.up('Space');
  await frames(2);
  return shots;
};
// Finish every downed body in `ids` (F: FINISH); a stomped one whose core
// says it will rise again gets a flare (F: BURN) when she has one.
const finishOne = async (id) => {
  for (let k = 0; k < 4; k++) {
    await settle(8000); // F may have picked up something lying beside the body
    const e = await foe(id);
    await untilG(() => !window.__game.player.action, 2);
    if (e.fin) {
      await besideBody(id); await frames(3);
      await key('KeyF');
      await untilG((id) => window.__game.enemies.find((q) => q.id === id).state === 'stomped', 3, id);
      await frames(4);
    } else if (e.s === 'stomped' && e.will && e.flares > 0) {
      await besideBody(id); await frames(3);
      await key('KeyF');
      await untilG((id) => window.__game.enemies.find((q) => q.id === id).state === 'ash', 6, id);
    } else break;
  }
};
const finishAll = async (ids) => { for (const id of ids) await finishOne(id); };
const gone = (ids) => g((ids) => ids.every((id) => ['stomped', 'ash', 'dead'].includes(window.__game.enemies.find((e) => e.id === id).state)), ids);
// Fight and finish until every one of `ids` is stomped or ash (a body can
// get up again mid-fight; then it is fought again). Returns shots fired.
const clearOut = async (ids, spots) => {
  let shots = 0;
  for (let pass = 0; pass < 4 && !(await gone(ids)); pass++) {
    shots += await fight(ids, spots);
    await finishAll(ids);
  }
  return shots;
};

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

// ---------------------------------------------------------------- puzzle helpers
// Each one reads the device state back after every key and presses again
// until it matches, so a slow or busy machine can't desync the sequence.

// Keypad: type the code; the base keypad shows the entry, so check it digit by
// digit where it can be read. A DENY resets the entry, so retry from scratch.
const enterCode = async (code) => {
  const shown = () => g(() => { const d = document.querySelector('.keypad .disp'); return d ? d.textContent : null; });
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!(await g(() => !!window.__game.ui.modal))) return true;
    for (let i = 0; i < code.length; i++) {
      await key('Digit' + code[i]);
      const t = await shown();
      if (t !== null && i < code.length - 1 && !t.startsWith(code.slice(0, i + 1))) break;
    }
    if (await until(() => !window.__game.ui.modal, 2500)) return true;
    await sleep(1000); // DENY → the entry clears itself
  }
  return false;
};
// Relay: throw each lever that isn't where the solution wants it, then check it moved.
const setLevers = async (want) => {
  for (let i = 0; i < want.length; i++) {
    for (let n = 0; n < 4; n++) {
      const lv = await g(() => window.__game.state.flags.relay.levers.map(Boolean));
      if (lv[i] === want[i]) break;
      await key('Digit' + (i + 1));
      await until(([i, v]) => !!window.__game.state.flags.relay.levers[i] === v, 1500, [i, want[i]]);
    }
  }
  const lv = await g(() => window.__game.state.flags.relay.levers.map(Boolean));
  return want.every((v, i) => lv[i] === v);
};
// Oscilloscope: read both knobs (B's device face or the base panel), select
// the one that is off, and turn it one notch at a time until both match.
const waveKnobs = () => g(() => {
  let parts = [...document.querySelectorAll('.knob-u')].map((u) => [u, u.querySelector('.kv')]);
  if (!parts.length) parts = [...document.querySelectorAll('.wave .knob')].map((u) => [u, u.querySelector('.v')]);
  return { vals: parts.map(([, v]) => (v ? parseInt(v.textContent, 10) : NaN)), sel: parts.findIndex(([u]) => u.classList.contains('sel')) };
});
const tuneWave = async (target) => {
  let ws = await waveKnobs();
  for (let n = 0; n < 40 && !(ws.vals[0] === target[0] && ws.vals[1] === target[1]); n++) {
    if (ws.vals.length < 2 || ws.vals.some(Number.isNaN)) break;
    const want = ws.vals[0] !== target[0] ? 0 : 1;
    if (ws.sel !== want) await key('ArrowDown');
    else await key(ws.vals[want] > target[want] ? 'ArrowLeft' : 'ArrowRight');
    ws = await waveKnobs();
  }
  return ws;
};

// ---------------------------------------------------------------- keyboard playthrough
if (scenario === 'play') {
  const step = async (name, ok, why) => {
    if (!check(name, ok, why || JSON.stringify(await facts()))) { await snap('fail-' + name.replace(/\W+/g, '-')); await finish(); }
  };
  const use = async () => { await park(); await F(); };
  // a keyboard player: the parked mouse shouldn't turn her toward the corner
  await g(() => { window.__game.ui.settings.faceCursor = false; });
  // A: sealant on the desk, pistol locker, breaker, door
  await tp(4.2, 41.95, S); await use(); await settle();
  await step('sealant', (await facts()).items.includes('sealant'));
  await tp(4.4, 41.0, W); await use(); await settle();
  await step('pistol', (await facts()).items.includes('pistol'));
  await tp(11.9, 41.2, EAST); await use(); await settle();
  await step('breaker', await g(() => window.__game.state.flags.breaker && !window.__game.world.doors.dAB.locked));
  await tp(12.4, 39.5, EAST); await use(); await settle();
  await step('door C-01 opens', await until(() => window.__game.world.doors.dAB.open, 3000));
  await step('walked into B', await walkUntil('KeyD', () => window.__game.state.currentRoom === 'B'));
  await settle();
  await snap('corridor');
  // the rounds by the body at the south end of the corridor
  await tp(15.3, 43.9, S); await use(); await settle();
  await step('rounds (B)', await g(() => window.__game.state.taken.has('p_ammo_B')));
  // quiet room: a flare, then save
  await tp(9.2, 24.15, S); await use(); await settle();
  await step('flare (C)', (await facts()).items.includes('flare'));
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
  // concourse fight: wake the slumped Hollow and shoot it (Space readies, J
  // fires); the shots bring the one standing further east. Then finish both.
  await tp(33.5, 31, EAST); await settle(); await sleep(300);
  await step('hollow woke', await walkUntil('KeyD', () => window.__game.enemies.find((e) => e.id === 'e_G1').state !== 'dormant'));
  await sleep(600);
  await snap('hollow-rise');
  const G_SPOTS = [[25.5, 31], [29, 30.6], [32.5, 31.4], [36, 30.6]];
  let shotsFired = await fight(['e_G1'], G_SPOTS, 2);
  await snap('shooting');
  shotsFired += await clearOut(['e_G1', 'e_G2'], G_SPOTS);
  await step('concourse Hollows down (J fires)', await g(() => ['e_G1', 'e_G2'].every((id) => !window.__game.enemies.find((e) => e.id === id).alive)));
  await step('both finished (F: FINISH)', await g(() => ['e_G1', 'e_G2'].every((id) => ['stomped', 'ash'].includes(window.__game.enemies.find((e) => e.id === id).state))));
  await snap('finished');
  await log('after-fight');
  // security: keycard door, the Hollow inside, fuse, bulletin, rounds, the
  // receiver module and a flare
  await tp(33.5, 30.3, N); await use(); await settle();
  await step('security door (keycard)', await until(() => window.__game.world.doors.dHG.open, 3000));
  await tp(33.5, 28.3, N); await settle();
  shotsFired += await clearOut(['e_H1'], [[31, 23.6], [36.2, 23.6], [31, 27.9], [36.3, 27.4]]);
  await step('security Hollow down', await g(() => !window.__game.enemies.find((e) => e.id === 'e_H1').alive));
  await tp(31.0, 24.5, W); await use(); await settle();
  await step('fuse', (await facts()).items.includes('fuse'));
  await tp(32.2, 23.5, N); await use(); await settle();
  await step('bulletin', (await facts()).files.includes('bulletin'));
  await tp(36.3, 27.45, S); await use(); await settle();
  await step('rounds (H)', await g(() => window.__game.state.taken.has('p_ammo_H')));
  await tp(34.5, 23.5, N); await use(); await settle();
  await step('receiver module', await g(() => window.__game.radio.has));
  await key('KeyT'); // switch it off for the rest of the route
  await tp(36.0, 23.7, S); await use(); await settle();
  await step('flare (H)', await g(() => window.__game.state.taken.has('p_flare_H')));
  // relay: code + fuse + puzzle
  await tp(12.4, 31.5, EAST); await use();
  await step('keypad opens', await settle() === 'modal');
  await sleep(300);
  await step('keypad code accepted', await enterCode('7304'));
  await until(() => !window.__game.ui.modal, 5000); await settle();
  await step('relay door open', await until(() => window.__game.world.doors.dJB.open, 3000));
  await tp(12.2, 29.55, N); await use(); await settle();
  await step('rounds (J)', await g(() => window.__game.state.taken.has('p_ammo_J')));
  await tp(8.5, 29.5, N); await use();
  await step('relay puzzle', await settle() === 'modal');
  await sleep(300);
  await snap('relay-puzzle');
  await step('relay levers set', await setLevers([true, false, true, false]));
  await step('power restored', await until(() => window.__game.state.powered, 8000));
  await sleep(3500); await settle();
  await snap('power-on');
  // the power wakes the one in the relay room
  shotsFired += await clearOut(['e_J1'], [[5.6, 29.3], [8.5, 30.8], [11.2, 29.3], [6.5, 32.6]]);
  await step('relay Hollow down', await g(() => !window.__game.enemies.find((e) => e.id === 'e_J1').alive));
  await tp(6.4, 32.0, S); await use(); await settle();
  await step('prong (J)', (await facts()).items.includes('prong'));
  // through the bulkhead into the east wing
  await tp(44.3, 30.5, EAST); await use(); await settle();
  await step('bulkhead E-1 opens', await until(() => window.__game.world.doors.dGK.open, 3000));
  await step('entered K', await walkUntil('KeyD', () => window.__game.state.currentRoom === 'K'));
  await settle();
  // the one down the corridor: shoot it from the south end (well out of
  // earshot of the Warden at the north end)
  await tp(46.9, 40.8, N); await settle();
  shotsFired += await clearOut(['e_K2'], [[46.6, 43.9], [47.3, 42.2], [46.7, 39.5], [47.2, 37.5]]);
  await step('corridor Hollow down', await g(() => !window.__game.enemies.find((e) => e.id === 'e_K2').alive));
  // the Warden by the array door: an arc prong, then finish it
  await g(() => { const G = window.__game; G.setEquipped('tool', G.inv.slots.findIndex((q) => q && q.id === 'prong')); });
  await tp(46.8, 15.5, N); await frames(2);
  await key('KeyC');
  await step('prong knocks the Warden down', await untilG(() => window.__game.enemies.find((e) => e.id === 'e_K1').state === 'knockdown', 2));
  await snap('warden-prong');
  await finishAll(['e_K1']);
  await step('Warden finished', await g(() => ['stomped', 'ash'].includes(window.__game.enemies.find((e) => e.id === 'e_K1').state)));
  await settle();
  // observation memory
  await tp(55, 18, N); await use(); await settle(40000);
  await step('observation memory', await g(() => { const f = window.__game.state.flags; return !!(f.memHandover || f.memPromise); }));
  // six clip points are full (sealant, sidearm, rounds, prong, photo, flare):
  // leave the photograph in the quiet room's pneumatic locker
  await tp(50.0, 37.7, N); await use();
  await step('locker opens', await settle() === 'modal');
  await g(() => { const G = window.__game; G.inv.store(G.inv.slots.findIndex((q) => q && q.id === 'photo')); });
  await sleep(300);
  await key('Escape');
  await until(() => !window.__game.ui.modal, 4000); await settle();
  await step('photo left in the locker', await g(() => !window.__game.inv.has('photo') && window.__game.inv.box.some((b) => b.id === 'photo')));
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
  const ws = await tuneWave([4, 3]);
  await step('wave aligned', ws.vals[0] === 4 && ws.vals[1] === 3, JSON.stringify(ws));
  await sleep(300);
  await snap('wave-locked');
  await key('KeyE');
  await step('ending', await until(() => window.__game.mode === 'cutscene' && window.__game.state.flags.ending, 6000));
  await sleep(9000);
  await snap('ending');
  await log('end');
  // economy (plan §7.2): she fought what stood on the route, took the rounds
  // lying on it, and should end with few left
  const left = await g(() => window.__game.inv.rounds());
  console.log(`economy: ${shotsFired} shots fired, ${left} rounds left at the end`);
  check('ammo economy: 0–12 rounds left at the end of the route', left >= 0 && left <= 12, `${left} left`);
}

// ---------------------------------------------------------------- mouse controls (plan §6 acceptance)
if (scenario === 'mouse') {
  const ctl = () => g(() => window.__game.ctl);
  const P = () => g(() => { const p = window.__game.player; return { x: p.pos.x, z: p.pos.z, speed: p.speed, yaw: p.yaw, action: p.action }; });
  const moveTo = async (x, y, z) => { const s = await screenOf(x, y, z); await page.mouse.move(Math.round(s.x), Math.round(s.y), { steps: 4 }); await sleep(150); await frames(3); return s; };
  // Labels never sit on another label or on another bracket; the pointer's
  // verb may sit inside the hovered bracket but not on its corner arms.
  const layoutCheck = () => g(() => {
    const L = window.__game.controls.cursor.layout;
    const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
    const corners = (b, a) => [
      { x0: b.x0, y0: b.y0, x1: b.x0 + a, y1: b.y0 + a }, { x0: b.x1 - a, y0: b.y0, x1: b.x1, y1: b.y0 + a },
      { x0: b.x0, y0: b.y1 - a, x1: b.x0 + a, y1: b.y1 }, { x0: b.x1 - a, y0: b.y1 - a, x1: b.x1, y1: b.y1 },
    ];
    const bad = [];
    L.labels.forEach((r, i) => {
      L.labels.forEach((q, j) => { if (j > i && hit(r, q)) bad.push(`label ${i} × label ${j}`); });
      L.boxes.forEach((b, j) => {
        if (j === r.owner) return;
        if (r.owner === -1 && j === L.hov) { if (corners(b, L.arm).some((c) => hit(r, c))) bad.push('pointer label × hovered corner'); } else if (hit(r, b)) bad.push(`label ${i} × box ${j}`);
      });
    });
    return { labels: L.labels.length, boxes: L.boxes.length, hov: L.hov, bad };
  });
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
  await gameWait(0.9);
  const dest = { x: 8.5, z: 43.3 };
  const ds = await screenOf(dest.x, 0, dest.z);
  await page.mouse.click(Math.round(ds.x), Math.round(ds.y));
  await until(() => window.__game.ctl.mode === 'path', 4000);
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
  await gameWait(0.5);
  await snap('path');
  const arrived = await until(() => window.__game.ctl.mode === 'idle', 20000);
  const p1 = await P();
  console.log('arrival error m', Math.hypot(p1.x - dest.x, p1.z - dest.z).toFixed(3));
  check('click-to-go arrives within 0.25 m', arrived && Math.hypot(p1.x - dest.x, p1.z - dest.z) <= 0.25, JSON.stringify(p1));

  // T1b: double-click runs there; a click into the dark goes nowhere
  await tp(4.2, 38.4, EAST);
  await gameWait(0.9);
  const dd = await screenOf(11, 0, 40);
  await page.mouse.dblclick(Math.round(dd.x), Math.round(dd.y));
  check('double-click runs to the spot', await until(() => window.__game.ctl.mode === 'path' && window.__game.player.speed > 3.5, 6000), JSON.stringify(await P()));
  await until(() => window.__game.ctl.mode === 'idle', 15000);
  const voidPt = await screenOf(1.9, 0, 40.5); // west of the cryo bay: nothing there
  check('void point is on screen', voidPt.x > 2 && voidPt.x < vw - 2 && voidPt.y > 2 && voidPt.y < vh - 2, JSON.stringify(voidPt));
  await page.mouse.click(Math.round(voidPt.x), Math.round(voidPt.y));
  await sleep(150); await frames(3);
  check('click into the dark starts no walk', (await ctl()).mode === 'idle', JSON.stringify(await ctl()));

  // T1c: a slow, deliberate click (320 ms, on the spot) is still a click
  await tp(4.2, 38.4, EAST);
  await gameWait(0.9);
  const sd = { x: 9, z: 39 };
  const sc = await screenOf(sd.x, 0, sd.z);
  await page.mouse.move(Math.round(sc.x), Math.round(sc.y));
  await sleep(100); await frames(2);
  await page.mouse.down(); await sleep(320); await page.mouse.up();
  const slowPath = await until(() => window.__game.ctl.mode === 'path', 4000);
  const slowArr = slowPath && await until(() => window.__game.ctl.mode === 'idle', 15000);
  const ps = await P();
  console.log('slow click arrival error m', Math.hypot(ps.x - sd.x, ps.z - sd.z).toFixed(3));
  check('slow click (320 ms) walks to the spot', slowArr && Math.hypot(ps.x - sd.x, ps.z - sd.z) <= 0.3, JSON.stringify({ slowPath, ps }));

  // T1d: pressing RMB drops a walk, even with nothing to ready
  await tp(4.2, 38.4, EAST);
  await gameWait(0.9);
  const rd = await screenOf(11, 0, 40);
  await page.mouse.click(Math.round(rd.x), Math.round(rd.y));
  const walking = await until(() => window.__game.ctl.mode === 'path', 4000);
  await page.mouse.down({ button: 'right' });
  await until(() => window.__game.ctl.mode === 'idle', 3000);
  const cr = await ctl();
  await page.mouse.up({ button: 'right' });
  const hasGun = await g(() => window.__game.inv.has('pistol'));
  check('RMB press cancels a walk (no weapon)', walking && !hasGun && cr.mode === 'idle' && !cr.path.length, JSON.stringify({ walking, hasGun, mode: cr.mode, path: cr.path.length }));

  // T2: hold LMB toward the east wall: walk, stop at the wall, stop on release
  await tp(8, 40.5, EAST);
  await gameWait(0.8);
  await moveTo(13.3, 0.05, 40.5); // the foot of the east wall
  await page.mouse.down();
  await until(() => window.__game.ctl.mode === 'hold' && window.__game.player.speed > 1, 5000);
  const h1 = await g(() => ({ ctl: window.__game.ctl, x: window.__game.player.pos.x, speed: window.__game.player.speed }));
  await snap('hold');
  check('hold LMB walks toward the pointer', h1.ctl.mode === 'hold' && h1.speed > 1, JSON.stringify(h1));
  await until(() => window.__game.player.pos.x > 12.4, 12000);
  await gameWait(0.6);
  // sample for at least 0.5 s of game time
  const samples = [];
  const tS = await g(() => window.__game.time);
  for (let i = 0; i < 60 && (samples.length < 6 || await g((t) => window.__game.time < t + 0.5, tS)); i++) { samples.push(await P()); await sleep(100); }
  const xs = samples.map((s) => s.x), zs = samples.map((s) => s.z);
  const jitter = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  console.log(`hold: x=${xs[0].toFixed(3)} jitter=${jitter.toFixed(4)} m over 0.5 s`);
  check('hold stops at the wall without jitter', xs[0] > 12.4 && jitter < 0.02, `x=${xs[0].toFixed(3)} jitter=${jitter.toFixed(4)}`);
  await page.mouse.up();
  await gameWait(0.2, 4000);
  const h2 = await P();
  console.log(`speed 0.2 s after release: ${h2.speed.toFixed(3)}`);
  check('release stops within 0.2 s', h2.speed < 0.05, `speed=${h2.speed.toFixed(3)}`);
  check('a long hold is not read as a click', (await ctl()).mode === 'idle', JSON.stringify(await ctl()));

  // T3a: in reach of the desk: both items bracketed, the act cursor on one
  await tp(4.6, 41.75, S);
  await park();
  await gameWait(0.9); await frames(2);
  const l0 = await layoutCheck();
  console.log('brackets at rest', JSON.stringify(l0));
  check('bracket labels at rest don\'t collide', l0.boxes >= 2 && l0.labels >= 2 && !l0.bad.length, JSON.stringify(l0));
  await snap('brackets-rest');
  await moveTo(5.0, 0.92, 42.6);
  const c3b = await ctl();
  check('bracket on in-reach item', c3b.hover && c3b.hover.id === 'p_note_A' && c3b.hover.inReach, JSON.stringify(c3b.hover) + ' at ' + JSON.stringify(await P()));
  const l1 = await layoutCheck();
  check('hovered bracket: labels don\'t collide', l1.hov >= 0 && !l1.bad.length, JSON.stringify(l1));
  await snap('bracket');

  // T3: click a pickup ~6 m away: walk, reach, take
  await tp(10.5, 41.5, W);
  await gameWait(0.9);
  await moveTo(4.2, 0.92, 42.7);
  const c3 = await ctl();
  check('hover picks the pickup (out of reach)', c3.hover && c3.hover.id === 'p_sealant_A' && !c3.hover.inReach, JSON.stringify(c3.hover));
  await snap('far');
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  let sawReach = false;
  const took = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
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
  await gameWait(0.6, 4000);
  const c6 = await g(() => ({ ctl: window.__game.ctl, speed: window.__game.player.speed }));
  check('clicked fixture talks; dismissing click starts no path', opened && r6 === 'play' && c6.ctl.mode === 'idle' && c6.speed < 0.05, JSON.stringify(c6));

  // T4: click a closed unlocked door: she opens it and walks through
  await tp(14.6, 26.5, N);
  await gameWait(1.0);
  await moveTo(13.5, 1.25, 23.5);
  const c4 = await ctl();
  check('hover picks the door', c4.hover && c4.hover.id === 'dCB', JSON.stringify(c4.hover));
  const l4 = await layoutCheck();
  check('door verb clear of the bracket corners', !l4.bad.length, JSON.stringify(l4));
  await snap('door-hover');
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  const through = await until(() => { const G = window.__game; return G.world.doors.dCB.open && G.state.currentRoom === 'C' && G.ctl.mode === 'idle'; }, 25000);
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
  await gameWait(1.4); // the camera settles with its pointer lead; point again at where it is now
  await moveTo(38.5, 0.8, 31.4);
  const tPress = await g(() => window.__game.time);
  await page.mouse.down({ button: 'right' });
  const focused = await until(() => { const a = window.__game.ctl.aim; return a.lockId === 'e_G1' && a.focus >= 0.9; }, 15000);
  const tFocus = await g(() => window.__game.time);
  const c5 = await ctl();
  check('RMB locks the Hollow under the pointer', c5.aim.lockId === 'e_G1', JSON.stringify(c5.aim));
  console.log(`focus ${c5.aim.focus.toFixed(2)} after ${(tFocus - tPress).toFixed(2)} s game time`);
  check('focus ≥ 0.9 within 1.3 s (game time)', focused && tFocus - tPress <= 1.3, `focus=${c5.aim.focus.toFixed(2)} t=${(tFocus - tPress).toFixed(2)}s`);
  await until(() => window.__game.ctl.aim.focus >= 0.95, 5000);
  await gameWait(0.15, 3000);
  // the box wraps the body: the laser's end dot, the head, chest and feet sit inside it
  const fb = await g(() => {
    const G = window.__game, f = G.controls.gameState.focus, d = G.player.laserDot;
    const e = G.enemies.find((x) => x.id === G.ctl.aim.lockId);
    if (!f || !d || !d.visible || !e) return { ok: false, why: 'no box, laser or lock' };
    const r = (v) => Math.round(v);
    const half = f.size / 2;
    const inside = (q, pad) => Math.abs(q.x - f.x) <= half - pad && Math.abs(q.y - f.y) <= half - pad;
    const at = (o) => { const m = o.matrixWorld.elements; return G.worldToScreen(m[12], m[13], m[14]); };
    const p = G.worldToScreen(d.position.x, d.position.y, d.position.z);
    const parts = {};
    for (const b of ['head', 'chest', 'footL', 'footR']) { const q = at(e.rig[b]); parts[b] = [r(q.x), r(q.y), inside(q, 2)]; }
    const ok = inside(p, 3) && Object.values(parts).every((q) => q[2]);
    return { ok, dot: [r(p.x), r(p.y)], parts, box: [r(f.x), r(f.y), r(f.size)], state: e.state };
  });
  console.log('focus box', JSON.stringify(fb));
  check('focus box wraps the target (laser end and body inside)', fb.ok, JSON.stringify(fb));
  await snap('focus');
  const before = await g(() => window.__game.inv.weapon().loaded);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  await until((b) => window.__game.inv.weapon().loaded !== b, 4000, before);
  const after = await g(() => window.__game.inv.weapon().loaded);
  check('LMB fires while readied', after === before - 1, `${before} → ${after}`);
  await snap('fired');
  await page.mouse.up({ button: 'right' });
  await until(() => !window.__game.ctl.aim.active, 4000);
  const c5b = await ctl();
  check('release clears the ready state', !c5b.aim.active && c5b.mode === 'idle', JSON.stringify(c5b));
  await g(() => window.__game.enemies.forEach((e) => e.kill()));

  // T4b: a locked door is clicked like any other door. The keypad door, up
  // close (the shut leaf blocks sight of its own centre) and from across the
  // corridor: the bracket says what trying it will do, and it is tried.
  const tryLocked = async (x, z, yaw, doorId, label) => {
    await tp(x, z, yaw);
    await gameWait(0.9);
    const d = await g((id) => window.__game.world.doors[id], doorId);
    await moveTo(d.x + 0.5, 1.25, d.z + 0.5);
    const h = await ctl();
    await page.mouse.down(); await sleep(60); await page.mouse.up();
    const tried = await untilG(() => !!window.__game.ui.dialogState || !!window.__game.ui.modal, 15);
    return { h, tried };
  };
  const up = await tryLocked(14.5, 31.5, W, 'dJB');
  check('locked door hover says ENTER CODE', up.h.hover && up.h.hover.id === 'dJB' && up.h.hover.label === 'ENTER CODE', JSON.stringify(up.h.hover));
  const kpUp = up.tried && await settle() === 'modal' && await g(() => !!document.querySelector('.kp'));
  check('click the keypad door in reach: the keypad opens', kpUp, JSON.stringify({ tried: up.tried, ctl: await ctl() }));
  await key('Escape'); await until(() => !window.__game.ui.modal, 4000); await settle();
  const far = await tryLocked(14.8, 34.5, N, 'dJB');
  const kpFar = far.tried && await settle() === 'modal' && await g(() => !!document.querySelector('.kp'));
  check('click the keypad door from across the corridor: she walks up and tries it', kpFar, JSON.stringify({ tried: far.tried, p: await P() }));
  await snap('locked-door');
  await key('Escape'); await until(() => !window.__game.ui.modal, 4000); await settle();
  // the keycard door, holding the keycard: it opens
  await g(() => { const G = window.__game; if (!G.inv.has('keycard')) G.inv.add('keycard', 1); });
  await tp(33.5, 31.2, N);
  await gameWait(0.9);
  await moveTo(33.5, 1.25, 29.5);
  const hk = await ctl();
  check('keycard door hover says USE KEYCARD', hk.hover && hk.hover.id === 'dHG' && hk.hover.label === 'USE KEYCARD', JSON.stringify(hk.hover));
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  check('click the keycard door holding the keycard: it opens', await untilG(() => window.__game.world.doors.dHG.open, 12), JSON.stringify({ ctl: await ctl(), p: await P() }));
  await settle();

  // T3b: every pickup and fixture has a spot she can click it from (nav
  // approach: a cell centre, or failing that a finer spot she fits on)
  const audit = await g(() => {
    const G = window.__game, w = G.world, nav = G.controls.nav;
    const vis = w.visible; w.visible = null;
    const cands = [...G.pickupCandidates(), ...G.fixtureCandidates()];
    w.visible = vis;
    const bad = [], fine = [];
    for (const c of cands) {
      const r = w.rooms[c.room];
      const from = { x: (r.x0 + r.x1 + 1) / 2, z: (r.z0 + r.z1 + 1) / 2 };
      const spot = nav.approach(c, from, c.r + 0.3, { agentR: 0.28 });
      if (!spot) bad.push(c.id);
      else if (spot.exact) fine.push(c.id);
    }
    return { n: cands.length, bad, fine };
  });
  console.log('click-reach audit', JSON.stringify(audit));
  check('every pickup and fixture is click-reachable', audit.n > 20 && !audit.bad.length, JSON.stringify(audit));
  // …and the tight ones really work by mouse: rounds at the back of a desk
  const tight = async (id, x, z, yaw) => {
    await tp(x, z, yaw);
    await gameWait(0.9);
    const c = await g((id) => { const p = window.__game.pickups.find((q) => q.def.id === id); return p ? { x: p.def.x, y: (p.def.y ?? 0) + 0.12, z: p.def.z } : null; }, id);
    if (!c) return 'gone';
    await moveTo(c.x, c.y, c.z);
    const h = await ctl();
    await page.mouse.down(); await sleep(60); await page.mouse.up();
    const ok = await untilG((id) => window.__game.state.taken.has(id), 12, id);
    await settle();
    return ok ? 'taken' : JSON.stringify({ hover: h.hover, ctl: await ctl(), p: await P() });
  };
  const t1 = await tight('p_ammo_H', 34.2, 27.2, EAST);
  check('click rounds at the back of the security desk: taken', t1 === 'taken', t1);
  const t2 = await tight('p_letter_D', 21.5, 28.4, N);
  check('click the letter on the crew table: taken', t2 === 'taken', t2);

  // T7: F interacts with the thing she faces
  await tp(4.4, 41.0, W);
  await park();
  await sleep(300);
  await F();
  check('F interacts', await until(() => !!window.__game.ui.dialogState || !!window.__game.ui.modal, 6000));
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

// ---------------------------------------------------------------- mechanics (plan §7.2, D2)
// Revive economy, finishing, burning, stagger, noise, variants, tools,
// healing over time, the receiver and save v2. Hollows are staged with the
// Enemy API; the player acts through real key presses (F, C, T, the wheel)
// wherever the mechanic is hers. Minutes of game time use game.debugSim().
if (scenario === 'mech') {
  await g(() => { window.__game.ui.settings.faceCursor = false; });
  await park();
  const E = (id) => g((id) => {
    const e = window.__game.enemies.find((q) => q.id === id);
    return { s: e.state, hp: +e.hp.toFixed(1), clock: +e.clock.toFixed(2), at: +e.reviveAt.toFixed(1), will: e.willRevive, rev: +e.reviving.toFixed(2), glow: +e.rig.glow.color.r.toFixed(3), scorch: +e.scorch.toFixed(2), log: e.log.map((l) => l[1]), burnT: +e.burnT.toFixed(2), stats: e.stats };
  }, id);
  // one Hollow in a given state; every other one dead and out of the way
  const stage = (id, o) => g(([id, o]) => {
    const G = window.__game;
    for (const e of G.enemies) if (e.id !== id && !(o.keep || []).includes(e.id) && e.state !== 'dead') e.kill();
    const e = G.enemies.find((q) => q.id === id);
    e.active = true; e.rig.root.visible = true;
    e.hp = o.hp ?? e.maxHp; e.burnT = 0; e.scorch = 0; e.finished = false; e.willRevive = false; e.clock = 0;
    e.lastSeen = null; e.lostT = 0; e.path = null; e.hurt = 0; e.lungeCd = 0;
    e.pos.set(o.x, 0, o.z); e.yaw = o.yaw ?? 0; e.room = G.world.roomAt(o.x, o.z) || e.room;
    e.setState(o.state || 'idle');
    if (o.seen) e.seen(o.seen[0], o.seen[1]);
    e.log.length = 0;
    e.stats = { hits: 0, flinches: 0, knockdowns: 0, blocked: 0, revives: 0 };
    if (o.wren) G.debugTeleport(o.wren[0], o.wren[1], o.wren[2] ?? 0);
    G.player.hp = 100;
    G.player.heals.length = 0;
  }, [id, o]);
  const down = (id) => g((id) => { const G = window.__game, e = G.enemies.find((q) => q.id === id); e.takeHit(999, 0, { from: { x: G.player.pos.x, z: G.player.pos.z } }); return G.time; }, id);
  const give = (id, n) => g(([id, n]) => { const G = window.__game; G.inv.add(id, n); const i = G.inv.slots.findIndex((s) => s && s.id === id); if (G.equippedSlot('tool') !== i && (id === 'flare' || id === 'prong')) G.setEquipped('tool', i); }, [id, n]);
  const simUntil = (sec, id, fn) => g(([sec, id, fn]) => {
    const G = window.__game, e = G.enemies.find((q) => q.id === id);
    const f = new Function('e', 'G', 'return (' + fn + ')');
    return G.debugSim(sec, { until: () => f(e, G) });
  }, [sec, id, fn]);
  // one action at a time: wait for the last one (a stomp, a tool) to end
  const actIdle = () => until(() => !window.__game.player.action, 3000);
  const actionSeen = async (name, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await g((n) => window.__game.player.action === n, name)) return true; await sleep(40); }
    return false;
  };

  // ---- revive: a downed body gets up after 18–30 s while Wren is in the room
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST] });
  const tDown = await down('e_G1');
  const d0 = await E('e_G1');
  check('downed Hollow lies with a revive clock (18–30 s)', d0.s === 'down' && d0.will && d0.at >= 18 && d0.at <= 30, JSON.stringify(d0));
  const glows = [];
  await gameWait(0.3);
  for (let i = 0; i < 12; i++) { glows.push((await E('e_G1')).glow); await sleep(150); }
  check('revive tell: its core pulses faintly (0.08–0.20)', Math.min(...glows) >= 0.07 && Math.max(...glows) <= 0.21 && Math.max(...glows) - Math.min(...glows) > 0.01, glows.join(','));
  await snap('down');
  // watch it in game time: up to 31 s after it went down (a wall-clock
  // budget fails whenever the machine is slow, not when the game is wrong)
  let shiver = 0, rose = false;
  const tW = Date.now();
  while (Date.now() - tW < 400000) {
    const q = await E('e_G1');
    shiver = Math.max(shiver, q.rev);
    if (q.s === 'rising') { rose = true; break; }
    if (await g((t) => window.__game.time > t, tDown + 31.5)) break;
    await sleep(120);
  }
  const tRose = await g(() => window.__game.time);
  console.log(`revived after ${(tRose - tDown).toFixed(1)} s game time (clock target ${d0.at})`);
  check('downed Hollow revives after 18–30 s with Wren in the room', rose && tRose - tDown >= 17.5 && tRose - tDown <= 31, `rose=${rose} after ${(tRose - tDown).toFixed(1)} s`);
  check('it shivers in the last seconds before it rises', shiver > 0.2, `max reviving ${shiver}`);
  await sleep(400);
  await snap('revive');
  check('a revived Hollow has 30 hp', (await E('e_G1')).hp === 30, JSON.stringify(await E('e_G1')));

  // ---- the clock only runs while Wren is here
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST] });
  await down('e_G1');
  await tp(8, 40.5, 0); // the cryo bay, far away
  await simUntil(60, 'e_G1', "e.state !== 'down'");
  const c1 = await E('e_G1');
  check('revive clock stands still while Wren is elsewhere (60 s)', c1.s === 'down' && c1.clock < 0.5, JSON.stringify(c1));
  await tp(34.5, 31, EAST);
  const back = await simUntil(40, 'e_G1', "e.state === 'rising'");
  check('…and runs again when she comes back', (await E('e_G1')).s === 'rising', `after ${back.toFixed(1)} s: ` + JSON.stringify(await E('e_G1')));

  // ---- FINISH (F): a stomp, no ammo; it doesn't get up within 30 s
  await g(() => { const G = window.__game; if (!G.inv.has('pistol')) { G.inv.add('pistol', 1); G.inv.weapon().loaded = 8; } G.state.flags.pistol = true; });
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST] });
  await down('e_G1');
  await besideBody('e_G1');
  await gameWait(0.3);
  const kb = await g(() => { const G = window.__game; const c = G.hollowCandidates()[0]; return { kb: G.ctl.kbTarget, label: c && c.label, red: c && c.red }; });
  check('a downed body offers FINISH (red) to F', kb.kb === 'h_e_G1' && kb.label === 'FINISH' && kb.red, JSON.stringify(kb));
  const r0 = await g(() => window.__game.inv.rounds());
  await actIdle(); await key('KeyF');
  const stomped = await actionSeen('stomp');
  await gameWait(0.2);
  await snap('stomp');
  await untilG(() => window.__game.enemies.find((q) => q.id === 'e_G1').state === 'stomped', 3);
  const s1 = await E('e_G1');
  check('F plays the stomp and finishes it', stomped && s1.s === 'stomped', JSON.stringify({ stomped, s: s1.s }));
  check('finishing costs no ammo', (await g(() => window.__game.inv.rounds())) === r0);
  await simUntil(30, 'e_G1', "e.state !== 'stomped'");
  const s2 = await E('e_G1');
  check('a stomped body does not rise within 30 s', s2.s === 'stomped', JSON.stringify(s2));
  await gameWait(0.3);
  const s3 = await E('e_G1');
  check('stomped: its core tells its fate (faint pulse if it will rise, dark if not)', s3.will ? s3.glow >= 0.07 : s3.glow === 0, JSON.stringify({ will: s3.will, glow: s3.glow }));
  // over many stomps, about half would rise again (much later)
  const half = await g(() => {
    const G = window.__game, e = G.enemies.find((q) => q.id === 'e_G1');
    let n = 0, late = true;
    for (let i = 0; i < 400; i++) { e.setState('down'); if (!e.finish()) return -1; if (e.willRevive) { n++; if (e.reviveAt < 60 || e.reviveAt > 100) late = false; } }
    return late ? n / 400 : -1;
  });
  check('a finished body still rises one time in two, 60–100 s later', half >= 0.4 && half <= 0.6, String(half));

  // ---- FINISH by mouse: click the body's bracket from a few metres away
  await g(() => { window.__game.ui.settings.faceCursor = true; });
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [35.6, 31, EAST] });
  await down('e_G1');
  await gameWait(1.0);
  const bp = await g(() => { const G = window.__game, b = G.bodyPos(G.enemies.find((q) => q.id === 'e_G1')); return G.worldToScreen(b.x, 0.3, b.z); });
  await page.mouse.move(Math.round(bp.x), Math.round(bp.y), { steps: 3 }); await sleep(200); await frames(3);
  const hov = await g(() => window.__game.ctl.hover);
  await page.mouse.down(); await sleep(60); await page.mouse.up();
  const clickStomp = await untilG(() => window.__game.enemies.find((q) => q.id === 'e_G1').state === 'stomped', 15);
  check('clicking a body walks over and FINISHes it', hov && hov.id === 'h_e_G1' && hov.label === 'FINISH' && clickStomp, JSON.stringify({ hov, clickStomp }));
  await park();
  await g(() => { window.__game.ui.settings.faceCursor = false; });

  // ---- flare: burn a body to ash (C), which never rises
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST] });
  await down('e_G1');
  await give('flare', 2);
  await besideBody('e_G1');
  await gameWait(0.3);
  const f0 = await g(() => window.__game.inv.count('flare'));
  await actIdle(); await key('KeyC');
  const flared = await actionSeen('toolFlare');
  await untilG(() => window.__game.enemies.find((q) => q.id === 'e_G1').state === 'burning', 3);
  await gameWait(0.8);
  await snap('burning');
  const burnt = await untilG(() => window.__game.enemies.find((q) => q.id === 'e_G1').state === 'ash', 6);
  check('C with the flare burns a body (toolFlare → burning → ash), one flare used', flared && burnt && (await g(() => window.__game.inv.count('flare'))) === f0 - 1, JSON.stringify({ flared, burnt }));
  await gameWait(0.3);
  await snap('ash');
  await simUntil(120, 'e_G1', "e.state !== 'ash'");
  const a1 = await E('e_G1');
  check('ash never rises (120 s simulated), core dark, fully scorched', a1.s === 'ash' && a1.glow === 0 && a1.scorch === 1, JSON.stringify(a1));
  // a finished body with a flare in hand reads BURN
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST] });
  await down('e_G1');
  await g(() => window.__game.enemies.find((q) => q.id === 'e_G1').finish());
  const bl = await g(() => { const c = window.__game.hollowCandidates().find((q) => q.id === 'h_e_G1'); return c && c.label; });
  check('a finished body offers BURN while she carries a flare', bl === 'BURN', String(bl));

  // ---- stagger: 85 % of hits flinch (always on a crit, which knocks it down)
  const st = await g(() => {
    const G = window.__game, e = G.enemies.find((q) => q.id === 'e_G1');
    let fl = 0;
    for (let i = 0; i < 200; i++) { e.hp = 999; e.setState('chase'); e.takeHit(5, 0, {}); if (e.state === 'flinch') fl++; }
    let kd = 0;
    for (let i = 0; i < 20; i++) { e.hp = 999; e.setState('chase'); e.takeHit(5, 0, { crit: true }); if (e.state === 'knockdown') kd++; }
    return { rate: fl / 200, kd };
  });
  console.log('flinch rate', st.rate, 'crit knockdowns', st.kd, '/ 20');
  check('stagger: 70–95 % of hits flinch (200 hits)', st.rate >= 0.7 && st.rate <= 0.95, String(st.rate));
  check('a crit always knocks it down', st.kd === 20, String(st.kd));
  // a knocked-down Hollow can be finished; left alone it gets up in ~3 s
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST], seen: [34.5, 31] });
  await g(() => { const e = window.__game.enemies.find((q) => q.id === 'e_G1'); e.takeHit(5, 0, { crit: true }); });
  const kdl = await g(() => { const c = window.__game.hollowCandidates().find((q) => q.id === 'h_e_G1'); return c && c.label; });
  const kdT = await simUntil(6, 'e_G1', "e.state !== 'knockdown'");
  check('knockdown: FINISH offered, and it rises after ~3 s', kdl === 'FINISH' && (await E('e_G1')).s === 'rising' && kdT >= 2.9 && kdT <= 3.2, JSON.stringify({ kdl, kdT, s: (await E('e_G1')).s }));

  // ---- a flinch cancels only the wind-up
  await stage('e_G1', { x: 35.6, z: 31, state: 'chase', yaw: -Math.PI / 2, wren: [34.6, 31, EAST], seen: [34.6, 31] });
  const wu = await g(() => {
    const G = window.__game, e = G.enemies.find((q) => q.id === 'e_G1');
    e.setState('attack'); e.hitDone = false; e.stateT = 0.15; e.attackPhase = 0.27;
    e.takeHit(1, Math.PI / 2, { stagger: true });
    return { s: e.state, hp: G.player.hp };
  });
  await gameWait(0.5);
  const wu2 = await g(() => ({ hp: window.__game.player.hp, log: window.__game.enemies.find((q) => q.id === 'e_G1').log.map((l) => l[1]) }));
  check('a flinch in the wind-up cancels the strike (no damage)', wu.s === 'flinch' && wu2.hp === 100, JSON.stringify({ wu, wu2 }));
  const sw = await g(() => {
    const G = window.__game, e = G.enemies.find((q) => q.id === 'e_G1');
    e.setState('attack'); e.hitDone = true; e.stateT = 0.62; e.attackPhase = 1.13;
    e.takeHit(1, Math.PI / 2, { stagger: true });
    const s = e.state;
    e.setState('idle'); G.debugTeleport(20, 31, Math.PI / 2);
    return s;
  });
  check('…but not a strike already under way', sw === 'attack', sw);

  // ---- noise: running 6 m behind an idle Hollow → it investigates within 0.5 s
  await stage('e_E1', { x: 23, z: 34.0, yaw: Math.PI, state: 'idle', wren: [23.2, 40.0, EAST] });
  await gameWait(0.3);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('KeyD');
  await until(() => window.__game.player.speed > 3, 3000);
  const tRun = await g(() => window.__game.time);
  const inv = await untilG(() => window.__game.enemies.find((q) => q.id === 'e_E1').log.some((l) => l[1] === 'investigate'), 2);
  const tInv = await g(() => window.__game.time);
  await page.keyboard.up('KeyD'); await page.keyboard.up('ShiftLeft');
  const n1 = await E('e_E1');
  console.log(`investigate ${(tInv - tRun).toFixed(2)} s after she started running; log ${n1.log.join('>')}`);
  check('running 6 m behind an idle Hollow: it investigates within 0.5 s', inv && tInv - tRun <= 0.5 && n1.log[0] === 'investigate', JSON.stringify({ dt: tInv - tRun, log: n1.log }));
  await stage('e_E1', { x: 23, z: 34.0, yaw: Math.PI, state: 'idle', wren: [23.2, 39.0, EAST] });
  await gameWait(0.3);
  await page.keyboard.down('KeyD');
  await gameWait(1.2);
  await page.keyboard.up('KeyD');
  const n2 = await E('e_E1');
  check('walking 5 m behind it does not', !n2.log.length, JSON.stringify(n2.log));
  // seen from the front: a notice beat before the chase
  await stage('e_E1', { x: 23, z: 34.0, yaw: 0, state: 'idle', wren: [23.2, 39.0, N] });
  await untilG(() => window.__game.enemies.find((q) => q.id === 'e_E1').log.some((l) => l[1] === 'chase'), 3);
  const n3 = await E('e_E1');
  check('seeing her: a notice beat, then the chase', n3.log[0] === 'notice' && n3.log[1] === 'chase', JSON.stringify(n3.log));
  await g(() => window.__game.enemies.find((q) => q.id === 'e_E1').kill());
  // a shot wakes a dormant one within half its radius
  await stage('e_E2', { x: 18.7, z: 40.6, yaw: Math.PI / 2, state: 'dormant', wren: [24.2, 40.0, EAST] });
  await g(() => { const w = window.__game.inv.weapon(); w.loaded = Math.max(1, w.loaded); });
  await page.keyboard.down('Space'); await gameWait(0.4);
  await key('KeyJ');
  await page.keyboard.up('Space');
  await untilG(() => window.__game.enemies.find((q) => q.id === 'e_E2').log.some((l) => l[1] === 'rising'), 2);
  check('a shot wakes a dormant Hollow 5.5 m away', (await E('e_E2')).log.includes('rising'), JSON.stringify(await E('e_E2')));
  await g(() => window.__game.enemies.find((q) => q.id === 'e_E2').kill());
  // out of sight 8 s: it gives up and investigates where she was (pathing there with nav)
  await stage('e_G1', { x: 40, z: 31, state: 'chase', seen: [34, 31], wren: [8, 40.5, 0] });
  const lost = await g(() => {
    const G = window.__game, e = G.enemies.find((q) => q.id === 'e_G1');
    let pathed = false;
    const t = G.debugSim(14, { until: () => { if (e.path && e.path.length) pathed = true; return e.state === 'investigate'; } });
    return { t, pathed, s: e.state, x: e.pos.x };
  });
  check('a chaser loses her after 8 s out of sight (nav path to where she was)', lost.s === 'investigate' && lost.t >= 7.9 && lost.t <= 9.5 && lost.pathed, JSON.stringify(lost));

  // ---- variants: the Rusher lunges; the Warden's plate soaks frontal fire
  await stage('e_E3', { x: 23, z: 34.4, yaw: 0, state: 'chase', seen: [23.1, 38.0], wren: [23.1, 38.0, N] });
  const lunged = await untilG(() => window.__game.enemies.find((q) => q.id === 'e_E3').log.some((l) => l[1] === 'lunge'), 3);
  await gameWait(0.45);
  await snap('lunge');
  check('the Rusher lunges from ~3.6 m', lunged, JSON.stringify(await E('e_E3')));
  await g(() => { window.__game.enemies.find((q) => q.id === 'e_E3').kill(); window.__game.debugTeleport(20, 36, 0); });
  await stage('e_K1', { x: 47, z: 21.6, yaw: 0, state: 'chase', seen: [47, 25], wren: [47, 25, N] });
  const wd = await g(() => {
    const e = window.__game.enemies.find((q) => q.id === 'e_K1');
    const r = {};
    e.hp = 60; e.setState('chase'); e.takeHit(50, Math.PI, {}); r.front = 60 - e.hp; r.blocked = e.stats.blocked;
    e.hp = 60; e.setState('chase'); e.takeHit(50, Math.PI * 0.6, {}); r.side = 60 - e.hp;
    e.hp = 60; e.setState('chase'); e.takeHit(50, 0, {}); r.back = 60 - e.hp;
    e.hp = 60; e.setState('attack'); e.stateT = 0.9; e.attackPhase = 1.6; e.takeHit(50, Math.PI, {}); r.open = 60 - e.hp;
    e.hp = 60; e.setState('chase'); e.takeHit(20, Math.PI, { crit: true }); r.critFront = e.state;
    e.hp = 60; e.setState('chase');
    return r;
  });
  console.log('warden', JSON.stringify(wd));
  check('Warden: frontal fire (±50°) does 20 %, no crit knockdown', Math.abs(wd.front - 10) < 0.01 && wd.blocked === 1 && wd.critFront !== 'knockdown', JSON.stringify(wd));
  check('…from the side or behind, or while it swings, full damage', wd.side === 50 && wd.back === 50 && wd.open === 50, JSON.stringify(wd));
  await gameWait(0.3);
  await snap('warden');

  // ---- arc prong: C knocks down everything within 1.8 m; then FINISH
  await give('prong', 2);
  await stage('e_K1', { x: 47, z: 20, yaw: 0, state: 'chase', seen: [47, 21.4], wren: [47, 21.4, N] });
  const p0 = await g(() => window.__game.inv.count('prong'));
  await actIdle(); await key('KeyC');
  const pr = await actionSeen('toolProng');
  await untilG(() => window.__game.enemies.find((q) => q.id === 'e_K1').state === 'knockdown', 2);
  await gameWait(0.3);
  await snap('prong');
  const k1 = await E('e_K1');
  check('C with the prong: the Warden in reach is knocked down, one prong used', pr && k1.s === 'knockdown' && (await g(() => window.__game.inv.count('prong'))) === p0 - 1, JSON.stringify({ pr, s: k1.s }));
  await besideBody('e_K1', 1);
  await gameWait(0.2);
  await actIdle(); await key('KeyF');
  check('a knocked-down Hollow can be finished', await untilG(() => window.__game.enemies.find((q) => q.id === 'e_K1').state === 'stomped', 3), JSON.stringify(await E('e_K1')));
  check('touch TOOL button shows with a tool equipped (body.has-tool)', await g(() => document.body.classList.contains('has-tool')));
  check('aim readout carries the tool count', await g(() => { const G = window.__game; return G.toolReadout() === 'PRONG ×1'; }), await g(() => window.__game.toolReadout()));

  // ---- flare on a live Hollow in reach: 45 now, then it burns
  // (dormant: it wakes as she arrives and takes 1.6 s to stand, so its first
  // swing can't cut her strike short)
  await stage('e_G1', { x: 37.4, z: 31, yaw: -Math.PI / 2, state: 'dormant', wren: [36.1, 31, EAST] });
  await give('flare', 1);
  await g(() => { const G = window.__game; G.setEquipped('tool', G.inv.slots.findIndex((s) => s && s.id === 'flare')); });
  await actIdle(); await key('KeyC');
  await untilG(() => window.__game.enemies.find((q) => q.id === 'e_G1').stats.hits > 0, 2.5);
  const fl = await E('e_G1');
  const flDiag = await g(() => { const G = window.__game; return { eq: G.equippedId('tool'), flares: G.inv.count('flare'), tgt: !!G.flareTarget(), act: G.player.action, busy: G.ui.busy, sc: G.scripting, inv: G.inv.slots.map((q) => q && q.id + ':' + q.qty) }; });
  await g(() => window.__game.debugTeleport(30, 31, Math.PI / 2));
  // the burn (HOLLOW.burnT) takes seconds of game time: wait in game time
  const ashed = await untilG(() => window.__game.enemies.find((q) => q.id === 'e_G1').state === 'ash', 6);
  check('flare on a Hollow in reach: 45 damage, then it burns out to ash', fl.hp <= 10.5 && ashed, JSON.stringify({ fl, ashed, flDiag }));
  await g(() => { const G = window.__game; G.enemies.forEach((e) => { if (e.alive) e.kill(); }); });

  // ---- healing: sealant over 8 s, the ampoule at once
  await g(() => { const G = window.__game; G.player.hp = 40; G.inv.add('sealant', 1); G.inv.add('nanite', 1); });
  const h0 = await g(() => { const G = window.__game; const i = G.inv.slots.findIndex((s) => s && s.id === 'sealant'); G.itemActions(i).find((a) => a.label === 'USE').fn(); return { hp: G.player.hp, t: G.time }; });
  await gameWait(1.0);
  const h1 = await g(() => window.__game.player.hp);
  await gameWait(8.0, 20000);
  const h2 = await g(() => window.__game.player.hp);
  console.log(`sealant: ${h0.hp} → ${h1.toFixed(1)} after 1 s → ${h2.toFixed(1)} after 9 s`);
  check('sealant heals +40 over 8 s (not at once)', h0.hp === 40 && h1 > 42 && h1 < 52 && h2 >= 79.5 && h2 <= 80.5, JSON.stringify({ h0, h1, h2 }));
  const h3 = await g(() => { const G = window.__game; G.player.hp = 30; const i = G.inv.slots.findIndex((s) => s && s.id === 'nanite'); G.itemActions(i).find((a) => a.label === 'USE').fn(); return G.player.hp; });
  check('the ampoule restores at once', h3 === 100, String(h3));

  // ---- the receiver: take the module in Security, T toggles, tune to the loop
  await g(() => { const G = window.__game; G.enemies.forEach((e) => { if (e.state !== 'dead') e.kill(); }); G.inv.slots = G.inv.slots.map((s) => (s && ['pistol', 'prong', 'flare'].includes(s.id) ? s : null)); });
  await tp(34.5, 23.5, N);
  await gameWait(0.3);
  check('the receiver module is TAKE-able on the security desk', (await g(() => window.__game.ctl.kbTarget)) === 'p_rx_H', await g(() => window.__game.ctl.kbTarget));
  await key('KeyF'); await sleep(300); await settle();
  await until(() => { const el = document.getElementById('rx-readout'); return !!el && el.style.display !== 'none'; }, 3000);
  const rx0 = await g(() => { const R = window.__game.radio, el = document.getElementById('rx-readout'); return { has: R.has, on: R.on, f: R.freq, code: R.codeF, ro: el ? getComputedStyle(el).display : 'missing' }; });
  check('module taken: receiver on, RX readout showing', rx0.has && rx0.on && rx0.ro !== 'none', JSON.stringify(rx0));
  check('the relay loop sits in 90–160 kHz', rx0.code >= 90 && rx0.code <= 160, String(rx0.code));
  await key('KeyT'); await frames(2);
  const off = await g(() => ({ on: window.__game.radio.on, ro: getComputedStyle(document.getElementById('rx-readout')).display }));
  await key('KeyT');
  check('T switches it off and on', !off.on && off.ro === 'none' && await g(() => window.__game.radio.on), JSON.stringify(off));
  // E tunes (+0.5 kHz) instead of interacting while it is on
  const e0 = await g(() => window.__game.radio.freq);
  await key('KeyE');
  const e1 = await g(() => ({ f: window.__game.radio.freq, busy: window.__game.ui.busy }));
  await key('KeyQ');
  check('while on, E tunes up and Q down (0.5 kHz), E does not interact', e1.f === e0 + 0.5 && !e1.busy && (await g(() => window.__game.radio.freq)) === e0, JSON.stringify({ e0, e1 }));
  // wheel to the loop
  await page.mouse.move(640, 400);
  for (let i = 0; i < 260; i++) {
    if (await g(() => window.__game.ui.busy)) { await settle(); await page.mouse.move(640, 400); }
    const f = await g(() => window.__game.radio.freq);
    if (Math.abs(f - rx0.code) < 0.26) break;
    await page.mouse.wheel(0, f < rx0.code ? 100 : -100);
    await frames(1);
  }
  await gameWait(0.3);
  const lk = await g(() => { const R = window.__game.radio; return { f: R.freq, lock: R.lock }; });
  await snap('receiver-lock');
  check('wheel tunes to the relay loop and it locks', lk.lock && lk.lock.id === 'numbers' && Math.abs(lk.f - rx0.code) < 0.3, JSON.stringify(lk));
  check('the loop carries the relay code 7-3-0-4', !!lk.lock && lk.lock.text.includes('7 · 3 · 0 · 4'), lk.lock && lk.lock.text);
  await settle();
  await park();
  await g(() => { window.__game.openInventory('receiver'); });
  await until(() => { const u = window.__game.ui; return !!u.modal && !u.modal.passive; }, 5000);
  await until(() => { const d = document.querySelector('.rx-decode .txt'); return d && d.textContent.includes('7 · 3 · 0 · 4'); }, 8000);
  await snap('receiver-tab');
  const dec = await g(() => { const d = document.querySelector('.rx-decode .txt'); return d ? d.textContent : null; });
  check('RECEIVER tab decodes the code', !!dec && dec.includes('7 · 3 · 0 · 4'), String(dec));
  await key('Escape');
  await until(() => !window.__game.ui.modal, 4000); await settle();
  // the Undertone: static, tears, and it stirs up a Hollow nearby
  await stage('e_H1', { x: 35, z: 27.5, yaw: 0, state: 'idle', wren: [34.5, 23.5, N] });
  await g(() => window.__game.radio.setFreq(30));
  await gameWait(0.3, 3000); await settle(); // the first time, Wren says what she hears
  const stir = await until(() => window.__game.enemies.find((q) => q.id === 'e_H1').log.some((l) => l[1] === 'investigate' || l[1] === 'notice'), 6000);
  const ut = await g(() => ({ u: window.__game.radio.undertone, tear: window.__game.renderer.uniforms.uTear.value, ro: document.getElementById('rx-readout').textContent }));
  await settle();
  await snap('undertone');
  check('below 40 kHz: the Undertone tears the picture and stirs a Hollow 4 m away', stir && ut.u > 0 && ut.tear > 0 && ut.ro.includes('UNDERTONE'), JSON.stringify({ stir, ...ut }));
  await g(() => { const G = window.__game; G.radio.setFreq(118); G.enemies.find((q) => q.id === 'e_H1').kill(); });
  await settle();

  // ---- save v2: bodies keep their place and clock; ash stays ash; v1 still loads
  await stage('e_G1', { x: 38.5, z: 31.4, state: 'chase', wren: [34.5, 31, EAST] });
  await down('e_G1');
  await g(() => { const G = window.__game, e = G.enemies.find((q) => q.id === 'e_G1'); e.clock = 5; e.reviveAt = 25; const f = G.enemies.find((q) => q.id === 'e_G2'); f.active = true; f.setState('down'); f.burn(); f.setState('ash'); f.scorch = 1; });
  const sv = await g(() => { const G = window.__game; G.saveGame(); const d = JSON.parse(localStorage.getItem('lethe7-save')); return { v: d.v, g1: d.enemies.e_G1, g2: d.enemies.e_G2, radio: d.radio }; });
  check('save v2 stores the body, its clock and the ash', sv.v === 2 && sv.g1.s === 'down' && sv.g1.clock === 5 && sv.g2.s === 'ash' && sv.radio && sv.radio.has, JSON.stringify(sv));
  await g(() => { window.__game.loadGame(); });
  await until(() => window.__game.mode === 'play' && !window.__game.fadeAnim, 10000);
  const ld = await g(() => { const G = window.__game, a = G.enemies.find((q) => q.id === 'e_G1'), b = G.enemies.find((q) => q.id === 'e_G2'); return { a: a.state, clock: a.clock, at: a.reviveAt, x: +a.pos.x.toFixed(2), b: b.state, rx: G.radio.has, code: G.radio.codeF }; });
  check('…and loads them back (down with clock 5 of 25, ash, receiver)', ld.a === 'down' && ld.clock >= 5 && ld.at === 25 && ld.b === 'ash' && ld.rx && ld.code === rx0.code, JSON.stringify(ld));
  const v1 = await g(() => {
    const d = JSON.parse(localStorage.getItem('lethe7-save'));
    d.v = 1; delete d.tried; delete d.plans; delete d.equip; delete d.radio;
    for (const k of Object.keys(d.enemies)) d.enemies[k] = typeof d.enemies[k] === 'object' ? 'dead' : d.enemies[k];
    delete d.enemies.e_G2; delete d.enemies.e_E3;
    localStorage.setItem('lethe7-save', JSON.stringify(d));
    window.__game.loadGame();
    return true;
  });
  await until(() => window.__game.mode === 'play' && !window.__game.fadeAnim, 10000);
  const l1 = await g(() => { const G = window.__game; return { g1: G.enemies.find((q) => q.id === 'e_G1').state, g2: G.enemies.find((q) => q.id === 'e_G2').state, e3: G.enemies.find((q) => q.id === 'e_E3').state, rx: G.radio.has }; });
  check('a v1 save still loads (dead stays dead; new Hollows at their posts)', v1 && l1.g1 === 'dead' && l1.g2 === 'idle' && l1.e3 === 'idle', JSON.stringify(l1));
  // the relay-room Hollow, woken by the power (wake 0: no sight or noise can
  // wake it), is saved standing: after a load it must not be asleep again
  await g(() => { const G = window.__game; G.state.powered = true; const e = G.enemies.find((q) => q.id === 'e_J1'); e.activate(); e.setState('chase'); G.saveGame(); G.loadGame(); });
  await until(() => window.__game.mode === 'play' && !window.__game.fadeAnim, 10000);
  const j1 = await g(() => { const e = window.__game.enemies.find((q) => q.id === 'e_J1'); return { s: e.state, active: e.active, saved: JSON.parse(localStorage.getItem('lethe7-save')).enemies.e_J1 }; });
  check('a Hollow the power woke is awake again after a load', j1.active && j1.s !== 'dormant', JSON.stringify(j1));
}

// ---------------------------------------------------------------- touch: tap to go / tap to use
if (scenario === 'touch') {
  await g(() => document.body.classList.add('touching'));
  // taps count only on the game view itself, not on the stick or buttons
  const onCanvas = (p) => g(([x, y]) => document.elementFromPoint(x, y) === document.getElementById('view'), [p.x, p.y]);
  await tp(7, 41.5, 0);
  await gameWait(0.9);
  const d = await screenOf(10.5, 0, 38.4);
  check('tap point is on the game view', await onCanvas(d), JSON.stringify(d));
  await page.touchscreen.tap(Math.round(d.x), Math.round(d.y));
  await until(() => window.__game.ctl.mode === 'path', 4000);
  const c = await g(() => window.__game.ctl);
  check('tap on the floor walks there', c.mode === 'path', JSON.stringify(c));
  check('tap arrives', await until(() => window.__game.ctl.mode === 'idle', 20000));
  const pos = await g(() => window.__game.player.pos);
  check('arrived at the tapped spot', Math.hypot(pos.x - 10.5, pos.z - 38.4) < 0.3, JSON.stringify(pos));
  await snap('walked');
  // tap the breaker across the room: walk over, throw it
  await tp(10.2, 38.4, 0);
  await gameWait(1.2);
  const br = await screenOf(12.5, 0.9, 41.2);
  const inView = br.x > 4 && br.x < vw - 4 && br.y > 4 && br.y < vh - 4 && await onCanvas(br);
  check('breaker is tappable on a phone screen', inView, JSON.stringify(br));
  await page.touchscreen.tap(Math.round(br.x), Math.round(br.y));
  await until(() => { const c = window.__game.ctl; return c.pending === 'f_breaker_A' || c.acting; }, 4000);
  const cb = await g(() => window.__game.ctl);
  check('tap a thing out of reach walks to it', cb.pending === 'f_breaker_A' || cb.acting, JSON.stringify(cb));
  check('…and uses it', await until(() => !!window.__game.state.flags.breaker, 25000), JSON.stringify(await g(() => window.__game.ctl)));
  await snap('used');
  await settle(15000, { x: Math.round(d.x), y: Math.round(d.y) });
  await snap('game');
  // with the receiver on, ACT still interacts (it sends F; E would tune)
  await g(() => { const G = window.__game; G.radio.has = true; G.radio.power = true; G.state.flags.radio = true; });
  await tp(4.2, 41.95, S);
  await gameWait(0.9);
  const f0 = await g(() => window.__game.radio.freq);
  const act = await g(() => { const b = document.querySelector('#touch .t-btn.act'); if (!b || !b.getClientRects().length) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, code: b.dataset.code }; });
  check('touch ACT button is showing', !!act, 'no ACT button');
  if (act) await page.touchscreen.tap(Math.round(act.x), Math.round(act.y));
  const took = await untilG(() => window.__game.state.taken.has('p_sealant_A'), 4);
  check('receiver on: touch ACT takes the item and does not tune', took && (await g(() => window.__game.radio.freq)) === f0, JSON.stringify({ took, act, f0, f1: await g(() => window.__game.radio.freq) }));
  await settle(15000, { x: Math.round(d.x), y: Math.round(d.y) });
}

await finish();
