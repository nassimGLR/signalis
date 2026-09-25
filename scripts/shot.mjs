// Headless smoke test: boots the game, plays a few scripted steps and saves
// screenshots to shots/. Usage: node scripts/shot.mjs [scenario]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const scenario = process.argv[2] || 'basic';
const out = 'shots';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(800);
const snap = async (name) => { await page.screenshot({ path: `${out}/${scenario}-${name}.png` }); console.log('shot', name); };
const key = async (k, ms = 80) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };
const hold = async (k, ms) => { await page.keyboard.down(k); await page.waitForTimeout(ms); await page.keyboard.up(k); };

await page.mouse.click(640, 360);
await page.waitForTimeout(2500);
await snap('title');

if (scenario !== 'title') {
  await key('Enter');
  await page.waitForTimeout(1500);
  await snap('intro');
  await key('Escape');
  await page.waitForTimeout(3500);
  await snap('wake');
  // dismiss dialog lines
  for (let i = 0; i < 4; i++) { await key('Enter'); await page.waitForTimeout(400); }
  await page.waitForTimeout(500);
  await snap('cryo');
  if (scenario === 'walk' || scenario === 'full') {
    // teleport helper for quick tours
    const tp = async (x, z, yaw = 0) => page.evaluate(([x, z, yaw]) => window.__game.debugTeleport(x, z, yaw), [x, z, yaw]);
    await hold('KeyS', 700);
    await snap('walk1');
    const spots = process.env.SPOTS ? JSON.parse(process.env.SPOTS) : [
      ['concourse', 30, 31, 0], ['crew', 22, 25, 0], ['mess', 23, 37, 0], ['security', 33, 25, 0],
      ['quiet', 10, 23.5, 0], ['relay', 8, 31, 0], ['medical', 34.5, 36.5, 0], ['eastcorr', 47, 25, 0],
      ['observation', 55, 20, Math.PI], ['archive', 53.5, 30, 0], ['comms', 47, 5, Math.PI],
    ];
    for (const [name, x, z, yaw] of spots) {
      await tp(x, z, yaw);
      await page.waitForTimeout(700);
      for (let i = 0; i < 3; i++) { await key('Enter'); await page.waitForTimeout(120); }
      await page.waitForTimeout(500);
      await snap(name);
    }
  }
  if (scenario === 'inv' || scenario === 'full') {
    await key('Tab');
    await page.waitForTimeout(800);
    await snap('inventory');
    await key('KeyE'); await page.waitForTimeout(300);
    await snap('files');
    await key('KeyE'); await page.waitForTimeout(500);
    await snap('map');
    await key('Escape'); await page.waitForTimeout(300);
  }
}

if (scenario === 'play') {
  const g = (fn) => page.evaluate(fn);
  const tp = async (x, z, yaw = 0) => page.evaluate(([x, z, yaw]) => window.__game.debugTeleport(x, z, yaw), [x, z, yaw]);
  const click = async (n = 1) => { for (let i = 0; i < n; i++) { await page.mouse.click(640, 300); await page.waitForTimeout(160); } };
  const busy = () => g(() => window.__game.paused);
  // click through dialogue and read-only screens; wait out fades and scripted pauses
  const passive = () => g(() => { const u = window.__game.ui; return !!u.dialogState || !!(u.modal && u.modal.passive); });
  const drain = async () => {
    for (let i = 0; i < 300 && await busy(); i++) {
      if (await passive()) await page.mouse.click(640, 120);
      else if (await g(() => !!window.__game.ui.modal)) break; // interactive screen: caller handles it
      await page.waitForTimeout(120);
    }
  };
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await g(fn)) return true; await page.waitForTimeout(100); } return false; };
  const walkUntil = async (k, fn, ms = 8000) => { await page.keyboard.down(k); const ok = await until(fn, ms); await page.keyboard.up(k); return ok; };
  const E = async () => { await key('KeyE'); await page.waitForTimeout(350); };
  const flags = async (label) => console.log(label, JSON.stringify(await g(() => ({ f: window.__game.state.flags, powered: window.__game.state.powered, room: window.__game.state.currentRoom, hp: window.__game.player.hp, inv: window.__game.inv.slots.map((s) => s && s.id + ':' + s.qty + (s.loaded !== undefined ? '/' + s.loaded : '')), files: window.__game.inv.files }))));
  const W = -Math.PI / 2, EAST = Math.PI / 2, N = Math.PI, S = 0;

  await drain();
  await tp(4.4, 41.0, W); await E(); await drain();
  await flags('pistol');
  await tp(11.9, 41.2, EAST); await E(); await drain();
  await flags('breaker');
  await tp(12.4, 39.5, EAST); await E(); await drain();
  // walk through the door into the corridor
  console.log('walked into B:', await walkUntil('KeyD', () => window.__game.state.currentRoom === 'B'));
  await drain();
  await flags('after-walk');
  await snap('corridor');
  // quiet room: save
  await tp(10, 21.6, N); await E(); await page.waitForTimeout(300); await drain();
  await key('Enter'); await page.waitForTimeout(400); await drain();
  console.log('saved?', await g(() => !!localStorage.getItem('lethe7-save')));
  // relay door keypad without code: should stay locked
  await tp(12.4, 31.5, EAST); await E(); await drain();
  await key('Escape'); await page.waitForTimeout(300);
  // crew quarters: photo (memory), keycard, letter
  await tp(22.3, 24.2, N); await E(); await page.waitForTimeout(500);
  await snap('photo-dialog'); await drain(); await page.waitForTimeout(1500); await snap('memory-window'); await drain();
  await tp(25.8, 25.9, EAST); await E(); await drain();
  await tp(21.2, 27.4, N); await E(); await drain();
  await flags('crew');
  // concourse fight: wake the slumped hollow and shoot it
  await tp(33.5, 31, EAST); await drain(); await page.waitForTimeout(300);
  console.log('hollow woke:', await walkUntil('KeyD', () => window.__game.enemies.find((e) => e.id === 'e_G1').state !== 'dormant'));
  await page.waitForTimeout(600);
  await snap('hollow-rise');
  await page.keyboard.down('Space'); await page.waitForTimeout(400);
  for (let i = 0; i < 6; i++) { await key('KeyF'); await page.waitForTimeout(420); if (i === 1) await snap('shooting'); }
  await page.keyboard.up('Space');
  await page.waitForTimeout(500);
  console.log('G1 state', await g(() => window.__game.enemies.find((e) => e.id === 'e_G1').state));
  await flags('after-fight');
  // security: keycard door, fuse, bulletin
  await tp(33.5, 30.3, N); await E(); await drain();
  await tp(33.5, 28.3, N); await drain();
  await g(() => { const e = window.__game.enemies.find((e) => e.id === 'e_H1'); e.kill(); });
  await tp(31.0, 24.5, W); await E(); await drain();
  await tp(32.2, 23.5, N); await E(); await drain();
  await flags('security');
  // relay: code + fuse + puzzle
  await tp(12.4, 31.5, EAST); await E(); await page.waitForTimeout(300); await drain();
  await page.waitForTimeout(300);
  for (const d of '7304') { await key('Digit' + d); await page.waitForTimeout(120); }
  await until(() => !window.__game.paused, 5000); await drain();
  console.log('relay door open:', await g(() => window.__game.world.doors.dJB.open));
  await tp(8.5, 29.5, N); await E(); await drain(); await page.waitForTimeout(300);
  await snap('relay-puzzle');
  await key('Digit1'); await page.waitForTimeout(300); await key('Digit3');
  await until(() => window.__game.state.powered, 8000);
  await page.waitForTimeout(3500); await drain();
  await flags('power');
  await snap('power-on');
  // kill the relay hollow and head east
  await g(() => window.__game.enemies.forEach((e) => { if (['e_J1', 'e_K1', 'e_K2', 'e_I1'].includes(e.id)) e.kill(); }));
  await tp(44.3, 30.5, EAST); await E(); await drain();
  console.log('entered K:', await walkUntil('KeyD', () => window.__game.state.currentRoom === 'K'));
  await drain();
  await flags('east');
  // observation memory
  await tp(55, 18, N); await E(); await drain(); await page.waitForTimeout(1500); await drain(); await page.waitForTimeout(800); await drain();
  // archive: obol + journal
  await tp(53.1, 30.4, S); await E(); await drain();
  await tp(54.0, 30.4, S); await E(); await drain();
  await flags('archive');
  // comms door: pay obol
  await tp(46.5, 8.4, N); await E(); await page.waitForTimeout(300); await drain();
  await until(() => !!window.__game.ui.modal, 5000);
  await key('Enter'); await until(() => window.__game.world.doors.dKM.open, 5000); await drain();
  console.log('entered M:', await walkUntil('KeyW', () => window.__game.state.currentRoom === 'M')); await drain();
  await flags('comms');
  await snap('comms-room');
  await tp(47, 3.3, N); await E(); await drain(); await page.waitForTimeout(400);
  await snap('wave');
  for (let i = 0; i < 3; i++) { await key('ArrowLeft'); await page.waitForTimeout(100); }
  await key('ArrowDown'); await page.waitForTimeout(100);
  for (let i = 0; i < 2; i++) { await key('ArrowRight'); await page.waitForTimeout(100); }
  await page.waitForTimeout(300);
  await snap('wave-locked');
  await key('KeyE');
  await until(() => window.__game.mode === 'cutscene', 5000);
  await page.waitForTimeout(9000);
  await snap('ending');
  await flags('end');
}

console.log(errors.length ? errors.slice(0, 30).join('\n') : 'no console errors');
await browser.close();
