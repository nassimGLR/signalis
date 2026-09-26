// UI acceptance harness for the Custodian OS (plan §5 Acceptance).
// Drives every screen with the mouse, asserts state changes, and writes
// shots/ui-*.png at 1280×720 plus a 412×860 touch phone.
//   node scripts/ui-shots.mjs            all scenarios
//   node scripts/ui-shots.mjs desktop    (or: phone)
// Prints PASS/FAIL lines and exits 1 on any FAIL.
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const only = process.argv[2] || 'all';
const OUT = 'shots';
await mkdir(OUT, { recursive: true });
const URL = 'file://' + path.resolve('dist/index.html');
let failures = 0;
const PASS = (n, info = '') => console.log(`PASS ${n}${info ? ' — ' + info : ''}`);
const FAIL = (n, why) => { failures++; console.log(`FAIL ${n}: ${why}`); };
const check = (n, ok, why = '', info = '') => (ok ? PASS(n, info) : FAIL(n, why || 'condition false'));

// ---------------------------------------------------------------- built output
{
  const html = await readFile('dist/index.html', 'utf8');
  check('build: no VT323/Oxanium/fonts.googleapis', !/VT323|Oxanium|fonts\.googleapis/.test(html), 'legacy font reference found');
  check('build: fonts inlined', /@font-face\{font-family:'Sofia Sans Condensed';src:url\(data:font\/woff2/.test(html), 'no inlined @font-face');
  // OFL 1.1 §2: copyright notices and the licence travel with every copy
  const embed = await readFile('dist/embed.html', 'utf8');
  const notice = ['SIL OPEN FONT LICENSE Version 1.1', 'The Sofia Sans Project Authors', 'Copyright 2017 IBM Corp', 'The Michroma Project Authors', 'James Grieshaber', 'Reserved Font Name'];
  const missing = notice.filter((t) => !html.includes(t) || !embed.includes(t));
  check('build: OFL notice in index.html and embed.html', !missing.length, 'missing: ' + missing.join(', '));
  check('build: no RFN family names in @font-face', !/font-family:'(IBM Plex Mono|Reenie Beanie)'/.test(html), 'reserved name used');
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

function hook(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => errors.push('[requestfailed] ' + r.url().slice(0, 80) + ' ' + (r.failure() || {}).errorText));
}

function helpers(page, prefix) {
  const g = (fn, arg) => page.evaluate(fn, arg);
  const wait = (ms) => page.waitForTimeout(ms);
  const until = async (fn, ms = 10000, arg) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await wait(80); }
    return false;
  };
  const shot = async (name) => { await page.screenshot({ path: `${OUT}/ui-${prefix}${name}.png` }); console.log(`  shot ui-${prefix}${name}.png`); };
  // centre of the first element matching selector (and optional text)
  const at = (sel, text) => g(([sel, text]) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => !text || e.textContent.trim().toUpperCase().includes(text.toUpperCase()));
    const e = els.find((x) => x.getClientRects().length);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [sel, text]);
  const click = async (sel, text, opts = {}) => {
    const p = await at(sel, text);
    if (!p) throw new Error(`no element ${sel} ${text || ''}`);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await wait(40);
    await page.mouse.click(p.x, p.y, opts);
    await wait(opts.after ?? 220);
    return p;
  };
  const rclick = async () => { await page.mouse.click(640, 700, { button: 'right' }); await wait(250); };
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8); await wait(30); }
    await page.mouse.up(); await wait(300);
  };
  // wait until the typing in the text box has finished
  const typedOut = () => until(() => document.querySelector('#dialog.done') || document.querySelector('#dialog.choosing'), 8000);
  const clearDialogs = async () => {
    for (let i = 0; i < 40; i++) {
      const busy = await g(() => !!window.__game.ui.dialogState);
      if (!busy) return;
      const vw = page.viewportSize().width;
      await page.mouse.click(vw / 2, 200); await wait(160);
    }
  };
  // two animation frames: the UI reads mouse edges once per game frame, so
  // two clicks inside one slow frame would merge into one
  const frames = () => g(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // a device face powers on with a scaleY transform; measure its keys only
  // once it has finished (at a few fps it can still be mid-way after 400 ms)
  const settled = (sel) => until((sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).transform === 'none' && e.getAnimations().every((a) => a.playState !== 'running'); }, 6000, sel);
  // click through a passive screen (memory, typed) until it closes
  const clickThrough = async (x, y, max = 60) => {
    for (let i = 0; i < max && await g(() => !!window.__game.ui.modal); i++) { await page.mouse.click(x, y); await frames(); await wait(120); }
    return until(() => !window.__game.ui.modal, 8000);
  };
  return { g, wait, until, shot, at, click, rclick, drag, typedOut, clearDialogs, frames, settled, clickThrough };
}

// ---------------------------------------------------------------- desktop 1280×720
async function desktop() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  hook(page, errors);
  const { g, wait, until, shot, at, click, rclick, drag, typedOut, clearDialogs, frames, settled, clickThrough } = helpers(page, '');
  await page.goto(URL);
  await until(() => !!window.__game, 8000);
  await wait(500);
  await shot('boot');

  // boot → title
  await page.mouse.click(640, 360);
  check('title opens', await until(() => !!document.querySelector('.title-screen'), 10000), 'no title screen');
  check('fonts ready after boot', await g(() => document.fonts.check('16px "Sofia Sans Condensed"') && document.fonts.check('16px "L7 Mono"') && document.fonts.check('16px "Michroma"')), 'document.fonts.check false');
  await wait(1800);
  await shot('title');

  // options (mouse) → RMB closes
  await click('.title-menu .opt', 'OPTIONS');
  check('options opens', await until(() => !!document.querySelector('.opt-screen')), 'no options screen');
  await wait(300);
  await shot('options');
  const tabsY = async () => g(() => Math.round(document.querySelector('.opt-panel .seg-tabs').getBoundingClientRect().top));
  const optFit = async () => g(() => { const r = document.querySelector('.opt-panel').getBoundingClientRect(), rows = document.querySelector('.opt-rows'); return { bottom: r.bottom, dead: rows.clientHeight - [...rows.children].reduce((a, e) => a + e.offsetHeight, 0) }; });
  const y0 = await tabsY(), f0 = await optFit();
  await click('.seg-tab', 'CONTROLS');
  const y1 = await tabsY(), f1 = await optFit();
  check('options: panel fits its section, tabs stay put', y0 === y1 && f0.dead < 40 && f1.dead < 40 && f1.bottom <= 720, `tabs ${y0}/${y1}, dead ${f0.dead}/${f1.dead}px, bottom ${f1.bottom}`);
  const before = await g(() => window.__game.ui.settings.faceCursor);
  await click('.opt-row:nth-child(3) .ch', before ? 'OFF' : 'ON');
  const after = await g(() => window.__game.ui.settings.faceCursor);
  const stored = await g(() => JSON.parse(localStorage.getItem('lethe7-settings-v2')).faceCursor);
  check('options row clickable + persisted (v2 key)', after === !before && stored === after, `faceCursor ${before}→${after}, stored ${stored}`);
  await click('.opt-row:nth-child(3) .ch', before ? 'ON' : 'OFF');
  await shot('options-controls');
  await rclick();
  check('RMB closes options', await until(() => !document.querySelector('.opt-screen'), 3000), 'options still open');

  // manual
  await click('.title-menu .opt', 'MANUAL');
  check('manual opens', await until(() => !!document.querySelector('.man-screen')), 'no manual');
  await wait(300);
  await shot('manual');
  const cue0 = await g(() => ({ pg: document.querySelector('.man-panel .pg').textContent, more: document.querySelector('.man-wrap').classList.contains('more') }));
  await g(() => { const b = document.querySelector('.man-body'); b.scrollTop = b.scrollHeight; });
  await wait(250);
  const cue1 = await g(() => ({ pg: document.querySelector('.man-panel .pg').textContent, more: document.querySelector('.man-wrap').classList.contains('more') }));
  check('manual: scroll cue (PG + fade) until the end', /^PG 1\/\d$/.test(cue0.pg) && cue0.more && !cue1.more && /^PG (\d)\/\1$/.test(cue1.pg), `${JSON.stringify(cue0)} → ${JSON.stringify(cue1)}`, `${cue0.pg} → ${cue1.pg}`);
  await shot('manual-end');
  await click('.man-screen .btn.back');
  check('manual BACK closes', await until(() => !document.querySelector('.man-screen'), 3000), 'manual still open');

  // WAKE → intro (typed) → gameplay
  await click('.title-menu .opt', 'WAKE');
  check('intro typed screen', await until(() => !!document.querySelector('.typed-screen'), 8000), 'no intro');
  await wait(2600);
  await shot('intro');
  await page.keyboard.press('Escape');
  check('gameplay starts', await until(() => window.__game.mode === 'play', 10000), 'mode never play');
  check('wake monologue in text box', await until(() => !!window.__game.ui.dialogState, 12000), 'no dialog');
  await typedOut();
  await wait(200);
  const dlg = await g(() => {
    const t = document.querySelector('#dialog .text'), w = document.querySelector('#dialog .who');
    return { size: parseFloat(getComputedStyle(t).fontSize), who: getComputedStyle(w).display, family: getComputedStyle(t).fontFamily };
  });
  check('dialog text >= 19px at 720p', dlg.size >= 19, `font-size ${dlg.size}`, `${dlg.size}px`);
  check('no speaker label for WREN', dlg.who === 'none', `who display ${dlg.who}`);
  const writes = await g(() => new Promise((res) => {
    let n = 0;
    const mo = new MutationObserver((l) => { n += l.length; });
    mo.observe(document.getElementById('dialog'), { childList: true, subtree: true, characterData: true, attributes: true });
    setTimeout(() => { mo.disconnect(); res(n); }, 600);
  }));
  check('dialog: no DOM writes while a typed line waits', writes === 0, `${writes} mutations in 600 ms`);
  await shot('dialog-examine');
  await clearDialogs();
  await wait(700);
  await shot('syslog');

  // silent screen: after toasts expire nothing with text is visible under #hud
  await wait(3600);
  const loud = await g(() => [...document.querySelectorAll('#hud *')].filter((e) => {
    if (!e.textContent.trim() || e.children.length) return false;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
    let n = e; while (n && n !== document.body) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false; n = n.parentElement; }
    return true;
  }).map((e) => e.id || e.className || e.tagName));
  check('silent screen in idle play', loud.length === 0, 'visible: ' + loud.join(', '));
  await g(() => { window.__game.ui.ammo(true, 6, 18); window.__game.ui.prompt('PANEL'); window.__game.ui.roomName('CRYO-MAINTENANCE'); });
  await wait(150);
  check('ammo/prompt/roomName are silent for mouse+keys', await g(() => !document.querySelector('#prompt.show')), 'prompt shown');
  await shot('game');

  // dialogue with a speaker
  await g(() => { window.__game.ui.say([{ who: 'M', t: 'Look. That\'s where the sound comes from.' }, { who: 'M', t: 'Don\'t ever listen to it. Alright?' }]); });
  await typedOut();
  check('speaker label for MARA', await g(() => getComputedStyle(document.querySelector('#dialog .who')).display !== 'none' && document.querySelector('#dialog .who').textContent === 'MARA'), 'no MARA label');
  await shot('dialog-mara');
  await clearDialogs();

  // choice inside the text box
  await g(() => { window.__choice = undefined; window.__game.ui.choice('A tape deck, still warm. Write a backup?', [{ label: 'WRITE', value: 'yes' }, { label: 'LEAVE IT', value: 'no' }]).then((v) => { window.__choice = v; }); });
  await until(() => !!document.querySelector('#dialog.choosing'), 6000);
  await page.mouse.move(700, 300);
  await wait(250);
  await shot('choice');
  await click('#dialog .ch', 'LEAVE IT');
  check('choice option clickable', await until(() => window.__choice === 'no', 3000), 'choice not resolved');

  // hint, sector card, banner
  await wait(300);
  await g(() => window.__game.ui.hint('ui-shots-' + Date.now(), 'Hold [RMB] to ready the sidearm. [LMB] fires.'));
  await wait(300);
  await shot('hint');
  const hintAgain = await g(() => { const id = 'ui-shots-once'; window.__game.ui.hint(id, 'x'); return window.__game.ui.hint(id, 'x'); });
  check('hint shows once per profile', hintAgain === false, 'second call returned true');
  await wait(4600);
  await g(() => window.__game.ui.sectorCard({ code: '01', name: 'HABITATION — WEST', gloss: 'ЖИЛОЙ БЛОК — ЗАПАД' }));
  await wait(1100);
  await shot('sector-card');
  await wait(2600);
  await g(() => window.__game.ui.banner('INTEGRITY FAILURE IMMINENT', { ms: 4000 }));
  await wait(350);
  await shot('banner');
  await wait(4200);

  // ---------------- inventory (mouse-only flow)
  await g(() => {
    const G = window.__game;
    G.debugTeleport(24.5, 30.8, Math.PI / 2);
    for (const k of ['A', 'B', 'C', 'J', 'G', 'D', 'E']) G.state.visited.add(k);
    G.inv.slots = [{ id: 'pistol', qty: 1, loaded: 5 }, { id: 'ammo', qty: 14 }, { id: 'sealant', qty: 2 }, { id: 'keycard', qty: 1 }, { id: 'photo', qty: 1 }, null];
    G.inv.files = ['directive', 'letter', 'bulletin', 'medical', 'lethe', 'observation'];
    G.player.hp = 58;
  });
  await wait(400);
  await page.keyboard.press('Tab');
  check('Tab opens the Custodian OS', await until(() => !!document.querySelector('.os .it'), 5000), 'no inventory');
  const openMs = await g(() => parseFloat(getComputedStyle(document.querySelector('.os')).animationDuration) * 1000);
  check('menu opens in under 150 ms', openMs > 0 && openMs < 150, `animation ${openMs} ms`, `${openMs} ms`);
  await wait(1600);
  await shot('inventory-items');
  const thumbs = await g(() => [...document.querySelectorAll('.slot:not(.empty) .th')].map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n;
  }));
  check('slots show rendered item thumbnails', thumbs.length >= 4 && thumbs.every((n) => n > 40), 'opaque px ' + thumbs.join(','));
  const selfPx = await g(() => { const c = document.querySelector('.self-cv'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  check('self-model renders (lit rig)', selfPx > 400, `opaque px ${selfPx}`);
  check('condition word is IMPAIRED at 58 hp', await g(() => document.querySelector('.cond-word').textContent === 'IMPAIRED'), 'wrong condition word');

  // click sealant slot, then USE → hp rises (the sealant sets over 8 s of
  // play, plan §7.2, so while the OS is open the heal is queued, not applied)
  const hp0 = await g(() => window.__game.player.hp);
  await click('.slot:nth-child(3)');
  await click('.act', 'USE');
  const h1 = await g(() => { const P = window.__game.player; return { hp: P.hp, pending: (P.heals || []).reduce((n, h) => n + h.left, 0) }; });
  check('mouse: select sealant + USE heals (+40 over 8 s)', h1.hp > hp0 || h1.pending >= 39, `hp ${hp0} → ${h1.hp}, pending ${h1.pending}`);
  // drag ammo onto the pistol → reload (or the failure text)
  const l0 = await g(() => window.__game.inv.slots[0].loaded);
  const a = await at('.slot:nth-child(2)'), b = await at('.slot:nth-child(1)');
  await drag(a, b);
  const l1 = await g(() => window.__game.inv.slots[0].loaded);
  const failText = await g(() => document.querySelector('.info .desc').textContent);
  check('mouse: drag ammo onto pistol combines/reloads', l1 > l0 || failText.includes('do not fit'), `loaded ${l0} → ${l1}; desc "${failText.slice(0, 40)}"`, `loaded ${l0} → ${l1}`);
  // drag photo onto keycard → failure text
  await drag(await at('.slot:nth-child(5)'), await at('.slot:nth-child(4)'));
  check('mouse: incompatible drag shows failure text', await g(() => document.querySelector('.info .desc').textContent.includes('These do not fit together.')), 'no failure text');
  await wait(200);
  await shot('inventory-combine-fail');
  // inspect the pistol
  await click('.slot:nth-child(1)');
  await click('.act', 'INSPECT');
  check('inspect opens', await until(() => !!document.querySelector('.it.inspecting')), 'no inspect');
  const iv = await at('.ins-view canvas');
  await drag(iv, { x: iv.x + 90, y: iv.y + 20 });
  await wait(700);
  await shot('inspect');
  await rclick();
  check('RMB closes inspect only', await g(() => !document.querySelector('.it.inspecting') && !!document.querySelector('.os')), 'inspect state wrong');

  // map tab
  await click('.os-tab', 'MAP');
  check('MAP tab by click', await until(() => !!document.querySelector('.mp canvas')), 'no map');
  await wait(900);
  const mc = await at('.mp-view canvas');
  await page.mouse.move(mc.x - 60, mc.y, { steps: 4 });
  await wait(400);
  await shot('map');
  // files tab
  await click('.os-tab', 'FILES');
  check('FILES tab by click', await until(() => !!document.querySelector('.fl-list .f')), 'no files');
  await click('.fl-list .f', 'STANDING DIRECTIVE');
  await wait(300);
  await shot('files-circular');
  await click('.fl-list .f', 'LETTER');
  await wait(300);
  await shot('files-note');
  await click('.fl-list .f', 'MEDICAL RECORD');
  await wait(300);
  await shot('files-log');
  await click('.fl-list .f', 'RIVER');
  await wait(300);
  await shot('files-book');
  await rclick();
  check('RMB closes the inventory', await until(() => !window.__game.ui.modal, 3000), 'still open');

  // receiver tab against a stub radio
  await g(() => {
    const G = window.__game;
    const radio = {
      on: true, freq: 112.4, band: [20, 200],
      setFreq(f) { this.freq = Math.round(f * 10) / 10; }, step(d) { this.setFreq(this.freq + d); },
      stations() { return [{ f: 114.0, strength: 0.9 }, { f: 61.5, strength: 0.5 }, { f: 33, strength: 0.7 }]; },
      get lock() { return Math.abs(this.freq - 114) < 2 ? { f: 114, text: '7 · 3 · 0 · 4 ... 7 · 3 · 0 · 4 ... REPEAT' } : null; },
    };
    window.__radio = radio;
    G.ui.inventory({ inv: G.inv, player: G.player, doors: G.world.doors, visited: G.state.visited, currentRoom: G.state.currentRoom, actions: (i) => G.itemActions(i), radio, cycle: '11 406' }, 'receiver');
  });
  await until(() => !!document.querySelector('.rx'), 4000);
  await wait(400);
  const dial = await at('.rx-dial canvas');
  await page.mouse.move(dial.x, dial.y); await wait(100);
  await page.mouse.wheel(0, -120); await wait(200); await page.mouse.wheel(0, -120);
  await wait(2200);
  check('receiver wheel tunes', await g(() => window.__radio.freq > 112.4), 'freq unchanged');
  await shot('receiver');
  await rclick();
  await until(() => !window.__game.ui.modal, 3000);

  // CRITICAL condition
  await g(() => { window.__game.player.hp = 14; window.__game.ui.lowHp(0.7); });
  await page.keyboard.press('Tab');
  await until(() => !!document.querySelector('.os .it'), 5000);
  await wait(1500);
  check('CRITICAL condition word', await g(() => document.querySelector('.cond-word').textContent === 'CRITICAL'), 'wrong word');
  const grade = await g(() => ({ ui: getComputedStyle(document.getElementById('ui')).filter, os: getComputedStyle(document.querySelector('.os')).filter, bd: getComputedStyle(document.querySelector('.os-screen')).backdropFilter }));
  check('lowHp grades content, OS backdrop still dims the world', grade.ui === 'none' && /saturate/.test(grade.os) && /brightness/.test(grade.bd), JSON.stringify(grade));
  await shot('inventory-critical');
  await page.keyboard.press('Escape');
  await until(() => !window.__game.ui.modal, 3000);
  await g(() => { window.__game.player.hp = 80; window.__game.ui.lowHp(0); });

  // document full screen
  await g(() => { window.__game.ui.document('bulletin', true); });
  await until(() => !!document.querySelector('.doc-screen'), 4000);
  await wait(500);
  await shot('doc-fullscreen');
  await page.mouse.click(640, 360);
  check('document closes with FILED toast', await until(() => /FILED/.test(document.querySelector('#toasts').textContent), 3000), 'no FILED toast');
  await wait(3500);

  // keypad (device face) by mouse
  await g(() => { window.__kp = undefined; window.__game.ui.keypad('7304').then((v) => { window.__kp = v; }); });
  await until(() => !!document.querySelector('.kp'), 4000); await settled('.kp');
  for (const d of '730') { await click('.kp .kp-key', d, { after: 160 }); await frames(); }
  await wait(300);
  check('keypad: each click enters a digit', await until(() => document.querySelector('.kp').dataset.entry === '730', 3000), 'entry ' + await g(() => document.querySelector('.kp').dataset.entry));
  check('one device face at a time', await g(() => document.querySelectorAll('.dev-screen').length === 1), 'device screens ' + await g(() => document.querySelectorAll('.dev-screen').length));
  await shot('keypad');
  await click('.kp .kp-key', '4');
  check('keypad by mouse opens with the right code', await until(() => window.__kp === true, 4000), 'keypad result ' + await g(() => window.__kp));
  await g(() => { window.__kp = undefined; window.__game.ui.keypad('7304').then((v) => { window.__kp = v; }); });
  await until(() => !!document.querySelector('.kp'), 4000); await settled('.kp');
  for (const d of '1111') { await click('.kp .kp-key', d, { after: 120 }); await frames(); }
  await wait(450);
  await shot('keypad-deny');
  await rclick();
  check('keypad RMB backs out (false)', await until(() => window.__kp === false, 3000), 'keypad result ' + await g(() => window.__kp));

  // a second device face replaces the first instead of stacking on it
  await g(() => { window.__k1 = undefined; window.__k2 = undefined; const ui = window.__game.ui; ui.keypad('7304').then((v) => { window.__k1 = v; }); ui.keypad('7304').then((v) => { window.__k2 = v; }); });
  const stackOk = await until(() => window.__k1 === false && document.querySelectorAll('.dev-screen').length === 1, 3000);
  check('a new device face replaces a stale one', stackOk, JSON.stringify(await g(() => ({ k1: window.__k1, n: document.querySelectorAll('.dev-screen').length }))));
  await rclick();
  await until(() => window.__k2 === false && !window.__game.ui.modal, 3000);

  // relay: click levers A and C
  await g(() => { window.__rl = undefined; window.__relayState = { levers: [false, false, false, false] }; window.__game.ui.relay(window.__relayState).then((v) => { window.__rl = v; }); });
  await until(() => !!document.querySelector('.rl'), 4000); await settled('.rl');
  await click('.lever .track', '', { after: 400 });
  await shot('relay');
  const levers = await g(() => [...document.querySelectorAll('.lever .track')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  await page.mouse.click(levers[2].x, levers[2].y);
  check('relay by mouse solves (A + C)', await until(() => window.__rl === true, 4000), 'relay not solved');

  // wave: drag the frequency knob down 3 steps, wheel amplitude up 2
  await g(() => { window.__wv = undefined; window.__game.ui.wave().then((v) => { window.__wv = v; }); });
  await until(() => !!document.querySelector('.sc'), 4000); await settled('.sc');
  const knobs = await g(() => [...document.querySelectorAll('.knob')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const kv = () => g(() => [...document.querySelectorAll('.sc .kv')].map((e) => +e.textContent));
  // drag the frequency knob down (14 px a step) until it reads 04; each
  // drag is checked, so a press eaten by a slow frame is simply retried
  for (let tries = 0; tries < 4 && (await kv())[0] > 4; tries++) {
    await page.mouse.move(knobs[0].x, knobs[0].y); await frames(); await page.mouse.down(); await frames();
    const steps = (await kv())[0] - 4;
    for (let i = 1; i <= steps * 3 + 1; i++) { await page.mouse.move(knobs[0].x, knobs[0].y + i * 5); await wait(40); }
    await page.mouse.up(); await frames();
  }
  // and wheel the amplitude up to 03, a notch at a time
  await page.mouse.move(knobs[1].x, knobs[1].y); await wait(100);
  for (let tries = 0; tries < 6 && (await kv())[1] < 3; tries++) { await page.mouse.wheel(0, -100); await frames(); await wait(150); }
  await wait(300);
  await shot('wave');
  await click('.sc .btn.tx');
  check('wave by mouse (drag + wheel) locks and transmits', await until(() => window.__wv === true, 3000), 'wave result ' + await g(() => window.__wv) + ' vals ' + await g(() => [...document.querySelectorAll('.kv')].map((e) => e.textContent).join('/')));

  // storage
  await g(() => { const G = window.__game; G.inv.box = [{ id: 'nanite', qty: 1 }, { id: 'ammo', qty: 12 }, { id: 'fuse', qty: 1 }]; G.inv.slots[5] = null; window.__game.ui.storage({ inv: G.inv, capacity: 24 }); });
  await until(() => !!document.querySelector('.locker'), 4000); await wait(300);
  await wait(700);
  const lk = await g(() => { const r = document.querySelector('.os.locker').getBoundingClientRect(), sl = document.querySelector('.lk-grid .slot').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, slot: sl.width, gap: [r.left, innerWidth - r.right].map(Math.round) }; });
  check('storage: 80px slots, panel fits 720p and is centred', lk.slot >= 80 && lk.top >= 0 && lk.bottom <= 720 && Math.abs(lk.gap[0] - lk.gap[1]) <= 2, JSON.stringify(lk), `slot ${lk.slot}px`);
  await shot('storage');
  const box0 = await g(() => window.__game.inv.box.length);
  await click('.lk-grid .slot:nth-child(1)');
  const box1 = await g(() => window.__game.inv.box.length);
  check('storage: click moves locker → carried', box1 === box0 - 1 && await g(() => window.__game.inv.has('nanite')), `box ${box0} → ${box1}`);
  await drag(await at('.lk-slots .slot:nth-child(4)'), await at('.lk-grid .slot:nth-child(8)'));
  check('storage: drag carried → locker', await g(() => window.__game.inv.box.some((b) => b.id === 'keycard')), 'keycard not stored');
  await wait(300);
  await shot('storage-after');
  await rclick();
  await until(() => !window.__game.ui.modal, 3000);

  // memory
  await g(() => { window.__game.ui.memory('window'); });
  await until(() => !!document.querySelector('.mem-screen'), 4000);
  await wait(2600);
  await shot('memory');
  check('memory clicks through', await clickThrough(640, 360), 'memory still open');
  await g(() => { window.__game.ui.memory('handover'); });
  check('memory alias handover', await until(() => !!document.querySelector('.mem-screen'), 3000), 'handover memory failed');
  await wait(2200);
  await shot('memory-handover');
  await clickThrough(640, 360);

  // pause
  await wait(300);
  await page.keyboard.press('Escape');
  check('pause opens', await until(() => !!document.querySelector('.pause-panel'), 4000), 'no pause');
  await page.mouse.move(640, 330);
  await wait(300);
  await shot('pause');
  await page.keyboard.press('Escape');
  await until(() => !window.__game.ui.modal, 3000);

  // death
  await g(() => { window.__dt = undefined; window.__game.ui.death(true).then((v) => { window.__dt = v; }); });
  await wait(2300);
  await page.mouse.move(640, 420);
  await wait(200);
  await shot('death');
  await click('.death-menu .opt', 'RESTORE');
  check('death menu by mouse', await until(() => window.__dt === 'load', 3000), 'death result ' + await g(() => window.__dt));

  const bad = errors.filter((e) => /ERR_CERT|font|woff/i.test(e));
  check('no ERR_CERT / font errors', bad.length === 0, bad.join(' | '));
  check('no console errors (desktop)', errors.length === 0, errors.slice(0, 6).join(' | '));
  await page.close();
}

// ---------------------------------------------------------------- phone 412×860 (touch)
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  hook(page, errors);
  const { g, wait, until, shot, click, clearDialogs, typedOut } = helpers(page, 'phone-');
  await page.goto(URL);
  await until(() => !!window.__game, 8000);
  await wait(400);
  await shot('boot');
  await page.mouse.click(206, 430);
  await until(() => !!document.querySelector('.title-screen'), 10000);
  await wait(1500);
  await shot('title');
  check('phone: touch controls hidden over the title menu', await g(() => document.body.classList.contains('touching') && getComputedStyle(document.getElementById('touch')).display === 'none'), 'touch layer covers the title');
  const fire = await g(() => document.querySelector('.t-btn.fire').dataset.code + '/' + document.querySelector('.t-btn.act').dataset.code);
  check('touch FIRE=KeyJ, ACT=KeyE', fire === 'KeyJ/KeyE', fire);
  await click('.title-menu .opt', 'WAKE');
  await until(() => !!document.querySelector('.typed-screen'), 8000);
  await wait(800);
  await page.keyboard.press('Escape');
  await until(() => window.__game.mode === 'play', 10000);
  await until(() => !!window.__game.ui.dialogState, 12000);
  await typedOut();
  await wait(200);
  await shot('game');
  check('phone: touch controls visible in play', await g(() => getComputedStyle(document.getElementById('touch')).display !== 'none'), 'no touch controls');
  const overlap = await g(() => {
    const a = document.querySelector('#dialog').getBoundingClientRect(), b = document.querySelector('.t-pad').getBoundingClientRect();
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  });
  check('phone: text box clear of the button cluster', !overlap, 'dialog overlaps .t-pad');
  await clearDialogs();
  await g(() => {
    const G = window.__game;
    G.inv.slots = [{ id: 'pistol', qty: 1, loaded: 6 }, { id: 'ammo', qty: 14 }, { id: 'sealant', qty: 2 }, { id: 'keycard', qty: 1 }, null, null];
    G.inv.files = ['directive', 'letter'];
  });
  await wait(300);
  await g(() => { window.__game.openInventory('items'); });
  await until(() => !!document.querySelector('.os .it'), 5000);
  await wait(1500);
  await shot('inventory');
  const over = async () => g(() => [...document.querySelectorAll('.os, .os *, #screens .screen')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').map((e) => e.className || e.tagName).concat(document.documentElement.scrollWidth > 412 ? ['document'] : []));
  let o = await over();
  check('phone: no horizontal overflow (items)', o.length === 0, o.join(', '));
  for (const [tab, name] of [['MAP', 'map'], ['FILES', 'files'], ['ITEMS', 'items-again']]) {
    await click('.os-tab', tab);
    await wait(900);
    await shot(name);
    o = await over();
    check(`phone: no horizontal overflow (${name})`, o.length === 0, o.join(', '));
  }
  await click('.os-close');
  check('phone: CLOSE button closes the OS', await until(() => !window.__game.ui.modal, 3000), 'still open');
  for (const [open, name, sel] of [
    ['window.__game.ui.storage({ inv: window.__game.inv })', 'storage', '.locker'],
    ['window.__game.ui.keypad("7304")', 'keypad', '.kp'],
    ['window.__game.ui.relay({ levers: [false, false, false, false] })', 'relay', '.rl'],
    ['window.__game.ui.wave()', 'wave', '.sc'],
    ['window.__game.ui.document("letter", false)', 'doc', '.doc-screen'],
    ['window.__game.ui.pause()', 'pause', '.pause-panel'],
  ]) {
    await page.evaluate(`void (${open})`);
    await until((s) => !!document.querySelector(s), 4000, sel);
    await wait(600);
    await shot(name);
    o = await page.evaluate(() => [...document.querySelectorAll('#screens *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > 413 || r.left < -1); }).map((e) => e.className || e.tagName).slice(0, 5));
    check(`phone: ${name} fits 412 px`, o.length === 0, o.join(', '));
    await page.keyboard.press('Escape');
    await until(() => !window.__game.ui.modal, 3000);
    await wait(200);
  }
  check('no console errors (phone)', errors.length === 0, errors.slice(0, 6).join(' | '));
  await ctx.close();
}

try {
  if (only === 'all' || only === 'desktop') await desktop();
  if (only === 'all' || only === 'phone') await phone();
} catch (e) {
  FAIL('harness', e.stack || e.message);
}
await browser.close();
console.log(failures ? `\n${failures} FAIL` : '\nALL PASS');
process.exit(failures ? 1 : 0);
