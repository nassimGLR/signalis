// L7 CUSTODIAN OS — the whole DOM interface layer.
//
// In play the screen stays silent: a bottom text box, a small system log, one-
// time hints, sector cards and a near-fatal banner. Everything else lives in
// Wren-3's own maintenance OS (inventory, map, archive, receiver) and on the
// device faces of the station's panels. Every screen is fully mouse-operable;
// keyboard and pad paths are kept alongside.
//
// Contract: plan §3.3 (API), §3.4 (settings), §3.5 (input usage), §3.9 (DOM).
import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { ITEMS, SLOTS } from '../game/items.js';
import { FILES, MEMORIES, WHO } from '../game/story.js';
import { ROOMS, DOORS, GRID_W, GRID_H } from '../game/map.js';
import { drawIcon, drawMemory } from './art.js';
import { buildCustodian, poseCustodian } from '../engine/characters.js';
import { itemThumb, ItemView, stage } from './items3d.js';

// ------------------------------------------------------------------ helpers
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = (n, w = 2) => String(Math.max(0, Math.floor(n))).padStart(w, '0');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const gl = (en, ru) => `<span class="gl"><span class="en">${en}</span><span class="ru">${ru}</span></span>`;
// "[F] use" → key glyph boxes
const keyify = (html) => String(html).replace(/\[([^\]<>]{1,12})\]/g, '<kbd>$1</kbd>');
function safe(fn, fallback) { try { return fn(); } catch (e) { console.error(e); return fallback; } }
function store(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (e) { return fallback; } }
function persist(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
function clickable(e) { e.setAttribute('data-click', ''); return e; }

export const GLOSS = {
  ITEMS: 'ПРЕДМЕТЫ', MAP: 'КАРТА', FILES: 'АРХИВ', RECEIVER: 'ПРИЁМНИК', CONDITION: 'СОСТОЯНИЕ',
  STORAGE: 'ХРАНЕНИЕ', SAVE: 'ЗАПИСЬ', LOCKED: 'ЗАПЕРТО', PAUSED: 'ПАУЗА', OPTIONS: 'НАСТРОЙКИ',
  MANUAL: 'РУКОВОДСТВО', 'NO RESPONSE': 'НЕТ ОТВЕТА', 'LETHE-7': 'ЛЕТА-7',
};

const COND = [
  { word: 'STABLE', gloss: 'СТАБИЛЬНО', cls: 'c0', hex: '#6fc3c9' },
  { word: 'IMPAIRED', gloss: 'НАРУШЕНО', cls: 'c1', hex: '#e0c85a' },
  { word: 'FAILING', gloss: 'СБОЙ', cls: 'c2', hex: '#e0862e' },
  { word: 'CRITICAL', gloss: 'КРИТИЧНО', cls: 'c3', hex: '#ff2a3a' },
];
function condLevel(p) {
  if (p && typeof p.conditionLevel === 'number') return clamp(Math.round(p.conditionLevel), 0, 3);
  const hp = p ? (p.hp / (p.maxHp || 100)) * 100 : 100;
  return hp >= 75 ? 0 : hp >= 50 ? 1 : hp >= 25 ? 2 : 3;
}

const KIND = { weapon: 'WEAPON', ammo: 'AMMUNITION', heal: 'MEDICAL', key: 'KEY ITEM', memory: 'MEMENTO', tool: 'TOOL' };
const FAIL_COMBINE = 'These do not fit together.';
const itemDef = (id) => ITEMS[id] || { name: String(id).toUpperCase(), kind: 'misc', stack: 1, desc: 'An unregistered object.' };

// Sector fallback until map.js carries ROOMS[k].sector (plan §7.1).
const SECTORS = {
  '01': { name: 'HABITATION — WEST', gloss: 'ЖИЛОЙ БЛОК — ЗАПАД', rooms: ['A', 'B', 'C', 'J'] },
  '02': { name: 'CENTRAL CONCOURSE', gloss: 'ЦЕНТРАЛЬНЫЙ ВЕСТИБЮЛЬ', rooms: ['G', 'D', 'H', 'E', 'F'] },
  '03': { name: 'EAST WING', gloss: 'ВОСТОЧНОЕ КРЫЛО', rooms: ['K', 'L', 'I', 'N'] },
  '04': { name: 'ARRAY', gloss: 'АНТЕННАЯ РЕШЁТКА', rooms: ['M'] },
};
function sectorOf(roomKey) {
  const r = ROOMS[roomKey];
  const s = r && r.sector;
  if (s && typeof s === 'object') return { code: s.code || '—', name: s.name || '', gloss: s.gloss || '', rooms: Object.keys(ROOMS).filter((k) => ROOMS[k].sector && (ROOMS[k].sector.code || ROOMS[k].sector) === (s.code || s)) };
  const code = s ? String(s).padStart(2, '0') : Object.keys(SECTORS).find((c) => SECTORS[c].rooms.includes(roomKey));
  const d = SECTORS[code] || { name: 'DECK 2', gloss: '', rooms: Object.keys(ROOMS) };
  const rooms = s ? Object.keys(ROOMS).filter((k) => String(ROOMS[k].sector).padStart(2, '0') === code) : d.rooms;
  return { code: code || '—', name: d.name, gloss: d.gloss, rooms };
}

// File presentation: FILES[id].type / .code win; these only fill gaps (§3.3).
const TYPE_HINT = { directive: 'circular', quiet: 'circular', bulletin: 'circular', mess: 'circular', letter: 'note', observation: 'note', medical: 'log', lethe: 'book', final: 'log' };
const TYPE_LABEL = { circular: 'CIRCULARS', note: 'NOTES', log: 'LOGS', book: 'BOOKS' };
function fileType(id) { const f = FILES[id] || {}; return f.type || TYPE_HINT[id] || 'log'; }
function fileCode(id) {
  const f = FILES[id] || {};
  if (f.code) return f.code;
  const i = Object.keys(FILES).indexOf(id);
  return 'DOC-' + pad(i + 1, 3);
}

const MOUSE_SVG = (part) => {
  const on = (p) => (part === p ? 'var(--bone)' : 'none');
  return `<svg class="mg" viewBox="0 0 10 14" width="10" height="14" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="13" rx="4.5" fill="none" stroke="currentColor"/>`
    + `<path d="M1 5.5 V4.8 A4 4 0 0 1 5 0.9 V5.5 Z" fill="${on('L')}"/><path d="M9 5.5 V4.8 A4 4 0 0 0 5 0.9 V5.5 Z" fill="${on('R')}"/>`
    + `<line x1="0.5" y1="5.5" x2="9.5" y2="5.5" stroke="currentColor"/><line x1="5" y1="0.5" x2="5" y2="5.5" stroke="currentColor"/>`
    + `<rect x="4.1" y="2" width="1.8" height="2.6" fill="${part === 'M' || part === 'W' ? 'var(--bone)' : 'var(--ink)'}" stroke="currentColor" stroke-width="0.6"/></svg>`;
};
const K = (s) => `<kbd>${s}</kbd>`;
const MB = (part, s) => `<span class="mb">${MOUSE_SVG(part)}${s ? `<span>${s}</span>` : ''}</span>`;

// ------------------------------------------------------------------ settings (§3.4)
const SETTINGS_KEY = 'lethe7-settings-v2';
const DEFAULTS = {
  res: 270, pixelPerfect: true, crt: false, grain: false, reduceFlash: false,
  movement: 'mouse', aimCursor: 'always', faceCursor: true, runFar: false, showPath: false,
  sprint: 'hold', aimMode: 'hold', swapAim: false, autoReload: false, tank: false,
  volume: 0.8,
};
const RES = [240, 270, 320, 360];
const OPTION_SECTIONS = [
  { id: 'video', label: 'VIDEO', rows: [
    { key: 'res', label: 'INTERNAL RESOLUTION', values: RES, fmt: (v) => v + 'P', help: 'Lines rendered before the image is scaled up. Lower is chunkier and faster.' },
    { key: 'pixelPerfect', label: 'PIXEL-PERFECT SCALING', help: 'Scale by whole pixels and letterbox the remainder.' },
    { key: 'crt', label: 'CRT SCANLINES AND CURVE', help: 'An old monitor over the picture. Off is the intended look.' },
    { key: 'grain', label: 'FILM GRAIN', help: 'Animated noise over the picture.' },
    { key: 'reduceFlash', label: 'REDUCE FLASHING', help: 'Softens tears, static bursts and cursor flashes.' },
  ] },
  { id: 'controls', label: 'CONTROLS', rows: [
    { key: 'movement', label: 'MOVEMENT', values: ['mouse', 'keys'], fmt: (v) => ({ mouse: 'MOUSE + KEYS', keys: 'KEYS ONLY' }[v]), help: 'Hold the left button to walk toward the pointer, or click to go.' },
    { key: 'aimCursor', label: 'AIM CURSOR', values: ['always', 'aiming', 'off'], fmt: (v) => v.toUpperCase(), help: 'When the in-world cursor is drawn.' },
    { key: 'faceCursor', label: 'FACE THE POINTER', help: 'Wren turns her head and lamp toward a resting pointer.' },
    { key: 'runFar', label: 'RUN TO FAR POINTS', help: 'Holding the pointer far away breaks into a run.' },
    { key: 'showPath', label: 'SHOW WALK PATH', help: 'Draw the planned route after a click.' },
    { key: 'sprint', label: 'RUN BUTTON', values: ['hold', 'toggle'], fmt: (v) => v.toUpperCase(), help: 'Hold Shift to run, or press once to toggle.' },
    { key: 'aimMode', label: 'READY WEAPON', values: ['hold', 'toggle'], fmt: (v) => v.toUpperCase(), help: 'Hold or toggle the ready stance.' },
    { key: 'swapAim', label: 'SWAP MOUSE BUTTONS', help: 'Ready with the left button, fire with the right.' },
    { key: 'autoReload', label: 'AUTO RELOAD', help: 'Reload by itself when the magazine runs dry.' },
    { key: 'tank', label: 'TANK CONTROLS', help: 'Up walks forward, left and right turn.' },
  ] },
  { id: 'audio', label: 'AUDIO', rows: [
    { key: 'volume', label: 'MASTER VOLUME', slider: 10, help: 'Overall loudness.' },
  ] },
];

// §3.1 binding table, mouse column first.
const MANUAL_ROWS = [
  ['Walk toward pointer', MB('L', 'hold'), `${K('W')}${K('A')}${K('S')}${K('D')}`, 'L-stick'],
  ['Go to point · use object', MB('L', 'click'), '—', '—'],
  ['Run', `${K('Shift')} + move · double-click`, `${K('Shift')}`, 'B (hold)'],
  ['Ready weapon', MB('R', 'hold'), K('Space'), 'LT'],
  ['Fire', MB('L', 'while ready'), K('J'), 'RT'],
  ['Interact · finish', MB('L', 'click it'), `${K('F')} <span class="alt">(${K('E')})</span>`, 'A'],
  ['Reload', `${K('M5')} forward`, K('R'), 'RB'],
  ['Use tool', `${K('M4')} back`, K('C'), 'LB'],
  ['Receiver on / off', MB('M', 'click'), K('T'), 'Select'],
  ['Tune receiver', MB('W', 'wheel'), `${K('Q')} ${K('E')}`, 'D-pad ◂ ▸'],
  ['Inventory', '—', `${K('Tab')} ${K('I')}`, 'X'],
  ['Map', '—', `${K('M')} ${K('Caps')}`, 'Y'],
  ['Pause', '—', `${K('Esc')} ${K('P')}`, 'Start'],
  ['Menu confirm · back', `${MB('L', 'click')} · ${MB('R', '')}`, `${K('Enter')} · ${K('Esc')}`, 'A · B'],
];

// ------------------------------------------------------------------ list menu
class Menu {
  constructor(options, { onSelect, onMove, cls = 'menu', numbered = false } = {}) {
    this.options = options;
    this.onSelect = onSelect;
    this.onMove = onMove;
    this.el = el('div', cls);
    this.i = Math.max(0, options.findIndex((o) => !o.disabled));
    this.items = options.map((o, i) => {
      const d = el('div', 'opt' + (o.disabled ? ' disabled' : ''));
      d.innerHTML = `<span class="bar"></span>${numbered ? `<span class="n">${pad(i + 1)}</span>` : ''}<span class="l">${esc(o.label)}</span>${o.tag ? `<span class="tag">${esc(o.tag)}</span>` : ''}`;
      if (!o.disabled) {
        clickable(d);
        d.addEventListener('mouseenter', () => this.set(i));
        d.addEventListener('click', () => { this.set(i, true); this.select(); });
      }
      this.el.appendChild(d);
      return d;
    });
    this.set(this.i, true);
  }
  set(i, quiet = false) {
    if (this.options[i].disabled) return;
    const changed = i !== this.i;
    this.i = i;
    this.items.forEach((d, k) => d.classList.toggle('sel', k === i));
    if (changed && !quiet) audio.uiMove();
    if (changed || quiet) this.onMove && this.onMove(this.options[i], i);
  }
  move(d) {
    const n = this.options.length;
    let i = this.i;
    for (let k = 0; k < n; k++) { i = (i + d + n) % n; if (!this.options[i].disabled) break; }
    this.set(i);
  }
  select() { audio.uiSelect(); this.onSelect && this.onSelect(this.options[this.i], this.i); }
  update(k) {
    if (k.up) this.move(-1);
    if (k.down) this.move(1);
    if (k.confirm) this.select();
  }
}

// ------------------------------------------------------------------ self-model
// A lit instance of Wren's own rig (not the wireframe), posed by condition.
class SelfModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xc9d2d4, 0x1e1a15, 1.7));
    const key = new THREE.DirectionalLight(0xfff0dc, 4.0);
    key.position.set(-1.5, 2.4, 2.2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fd6dc, 3.0);
    rim.position.set(1.8, 1.6, -2.4);
    this.scene.add(rim);
    this.rig = buildCustodian();
    this.scene.add(this.rig.root);
    if (this.rig.gun) this.rig.gun.visible = false;
    this.cam = new THREE.PerspectiveCamera(20, 96 / 128, 0.1, 40);
    this.t = 0;
    this.first = true;
  }
  frame() {
    // fit the whole figure (A's rig reports rig.height; otherwise measure it)
    const box = new THREE.Box3().setFromObject(this.rig.root);
    const h = this.rig.height || Math.max(1.2, box.max.y - Math.min(0, box.min.y)) || 1.8;
    const span = h * 1.16;
    const d = span / 2 / Math.tan((this.cam.fov * Math.PI / 180) / 2);
    this.cam.position.set(0, h * 0.56, d);
    this.cam.lookAt(0, h * 0.5, 0);
  }
  render(ctx2d, level, dt) {
    this.t += dt;
    const s = this.state || (this.state = { time: 0, speed: 0, phase: 0, aiming: false, reload: 0, recoil: 0, hurt: 0, condition: 0, limp: false, look: null });
    s.time = this.t; s.condition = level; s.limp = level >= 1;
    safe(() => poseCustodian(this.rig, s, this.first ? 1 : Math.min(dt, 0.1)));
    if (this.first) { this.rig.root.rotation.y = 0; this.rig.root.updateMatrixWorld(true); this.frame(); }
    this.first = false;
    // sway around a three-quarter view so the face and posture stay readable
    this.rig.root.rotation.y = 0.45 + Math.sin(this.t * 0.32) * 0.95;
    if (this.rig.gun) this.rig.gun.visible = false;
    return stage.render(this.scene, this.cam, 96, 128, ctx2d, { posterize: 14, dither: 0.45 });
  }
}

// ------------------------------------------------------------------ 7-segment display
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', '-': 'g', _: 'd', d: 'bcdeg', E: 'adefg', n: 'ceg', Y: 'bcdfg', O: 'abcdef', P: 'abefg', r: 'eg', ' ': '' };
function drawSeg(g, text, on, off, w, h) {
  g.fillStyle = '#0a0506'; g.fillRect(0, 0, w, h);
  const n = 4, cw = (w - 10) / n, sw = Math.max(2, Math.round(cw * 0.13));
  for (let i = 0; i < n; i++) {
    const ch = text[i] ?? ' ';
    const lit = SEG[ch] ?? '';
    const x = 5 + i * cw + cw * 0.18, y = 5, W = cw * 0.64, H = h - 10;
    const segs = { a: [x + sw, y, W - 2 * sw, sw], b: [x + W - sw, y + sw, sw, H / 2 - sw * 1.5], c: [x + W - sw, y + H / 2 + sw / 2, sw, H / 2 - sw * 1.5], d: [x + sw, y + H - sw, W - 2 * sw, sw], e: [x, y + H / 2 + sw / 2, sw, H / 2 - sw * 1.5], f: [x, y + sw, sw, H / 2 - sw * 1.5], g: [x + sw, y + H / 2 - sw / 2, W - 2 * sw, sw] };
    for (const [k, r] of Object.entries(segs)) { g.fillStyle = lit.includes(k) ? on : off; g.fillRect(...r.map(Math.round)); }
  }
}

// ------------------------------------------------------------------ Bayer dissolve for memory panels
const BAYER8 = (() => {
  const m = [[0, 32, 8, 40, 2, 34, 10, 42], [48, 16, 56, 24, 50, 18, 58, 26], [12, 44, 4, 36, 14, 46, 6, 38], [60, 28, 52, 20, 62, 30, 54, 22], [3, 35, 11, 43, 1, 33, 9, 41], [51, 19, 59, 27, 49, 17, 57, 25], [15, 47, 7, 39, 13, 45, 5, 37], [63, 31, 55, 23, 61, 29, 53, 21]];
  return m.flat().map((v) => (v + 0.5) / 64);
})();

// =================================================================== UI
export class UI {
  constructor(input) {
    this.input = input;
    this.uiRoot = $('#ui');
    this.screens = $('#screens');
    this.hud = $('#hud');
    this.stack = [];
    this.dialogState = null;
    this.sayQueue = [];
    this.settings = this.loadSettings();
    this.room = '';
    this.t = 0;
    this.clock0 = performance.now();
    this.readFiles = new Set(store('lethe7-read', []));
    this.hintsSeen = new Set(store('lethe7-hints', []));
    this._rmb = false;
    this._low = 0;
    this._noiseT = 0;
    this._promptSig = '';
    this.fontsReady = this.loadFonts();
    // RMB = back while a screen is open (the new input.js also reports it; one
    // flag per frame, so the two never double up).
    window.addEventListener('mousedown', (e) => { if (e.button === 2 && this.stack.length) this._rmb = true; });
  }

  // ---------------------------------------------------------------- settings
  loadSettings() {
    let s = store(SETTINGS_KEY, null);
    if (!s) {
      const v1 = store('lethe7-settings', null) || {};
      s = { ...v1, crt: false }; // v1 → v2: CRT is forced off once
    }
    const out = { ...DEFAULTS, ...s };
    if (!RES.includes(out.res)) out.res = RES.reduce((a, b) => (Math.abs(b - out.res) < Math.abs(a - out.res) ? b : a), 270);
    out.volume = clamp(Number(out.volume) || 0, 0, 1);
    persist(SETTINGS_KEY, out);
    return out;
  }
  saveSettings() { persist(SETTINGS_KEY, this.settings); }
  changed() {
    this.saveSettings();
    if (this.onSettings) safe(() => this.onSettings(this.settings));
  }

  loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const faces = ['400 16px "Sofia Sans Condensed"', '500 16px "Sofia Sans Condensed"', '800 16px "Sofia Sans Condensed"',
      '400 16px "L7 Mono"', '500 16px "L7 Mono"', '400 16px "Michroma"', '400 16px "Reenie Beanie"'];
    const all = Promise.all(faces.map((f) => document.fonts.load(f).catch(() => null))).then(() => document.fonts.ready);
    return Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
  }

  // ---------------------------------------------------------------- state
  get modal() { return this.stack[this.stack.length - 1] || null; }
  get busy() { return this.stack.length > 0 || !!this.dialogState; }
  get menuOpen() { const m = this.modal; return !!m && !m.passive; }

  clock() {
    const s = Math.floor((performance.now() - this.clock0) / 1000);
    return `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
  }

  // ---------------------------------------------------------------- HUD (silent screen)
  showHud(on) { this.hud.style.display = on ? '' : 'none'; document.body.classList.toggle('hud-on', !!on); }

  roomName(name) { this.room = name || ''; } // stored for the pause screen; shows nothing

  prompt(text) {
    const dev = this.input.lastDevice;
    const show = !!text && !this.busy && (dev === 'pad' || dev === 'touch');
    const key = dev === 'pad' ? 'A' : 'ACT';
    const sig = show ? key + '|' + text : '';
    if (sig === this._promptSig) return;
    this._promptSig = sig;
    const p = $('#prompt');
    p.classList.toggle('show', show);
    if (show) { $('.key', p).textContent = key; $('.txt', p).textContent = String(text).toUpperCase(); }
  }

  ammo() { /* no-op: the aim readout lives in the cursor overlay (§6.6) */ }

  toast(html) {
    const m = this.modal;
    if (m && m.onToast) { m.onToast(html); return; }
    const box = $('#toasts');
    while (box.children.length >= 3) box.firstChild.remove();
    const t = el('div', 'toast');
    t.innerHTML = `<span class="ts">${this.clock()}</span><span class="msg">${html}</span>`;
    box.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2800);
    setTimeout(() => t.remove(), 3250);
  }

  hint(id, html) {
    if (this.hintsSeen.has(id)) return false;
    this.hintsSeen.add(id);
    persist('lethe7-hints', [...this.hintsSeen]);
    const h = $('#hint');
    h.innerHTML = `<span class="hk">NOTE</span><span class="ht">${keyify(html)}</span>`;
    h.classList.remove('show', 'out');
    void h.offsetWidth;
    h.classList.add('show');
    clearTimeout(this._hintT1); clearTimeout(this._hintT2);
    this._hintT1 = setTimeout(() => h.classList.add('out'), 4000);
    this._hintT2 = setTimeout(() => h.classList.remove('show', 'out'), 4450);
    return true;
  }

  sectorCard({ code = '', name = '', gloss = '' } = {}) {
    const s = $('#sector');
    s.innerHTML = `<div class="sc-code">SECTOR <b>${esc(code)}</b></div><div class="sc-name">${esc(name)}</div><div class="sc-rule"></div><div class="sc-gloss">${esc(gloss)}</div>`;
    s.classList.remove('show', 'out');
    void s.offsetWidth;
    s.classList.add('show');
    clearTimeout(this._secT1); clearTimeout(this._secT2);
    this._secT1 = setTimeout(() => s.classList.add('out'), 2800);
    this._secT2 = setTimeout(() => s.classList.remove('show', 'out'), 3250);
  }

  banner(text, { ms = 1600 } = {}) {
    const b = $('#banner');
    b.innerHTML = `<span class="bk"></span>${esc(text)}<span class="bk"></span>`;
    b.classList.remove('show', 'out');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this._banT1); clearTimeout(this._banT2);
    this._banT1 = setTimeout(() => b.classList.add('out'), ms);
    this._banT2 = setTimeout(() => b.classList.remove('show', 'out'), ms + 450);
  }

  lowHp(level) {
    const q = Math.round(clamp(Number(level) || 0, 0, 1) * 20) / 20;
    if (q === this._low) return;
    this._low = q;
    this.uiRoot.style.filter = q > 0.001 ? `saturate(${(1 - 0.75 * q).toFixed(2)})` : '';
    $('#lowhp').classList.toggle('on', q > 0.5);
  }

  updateAmbient(dt) {
    if (this._low > 0.5 && this.hud.style.display !== 'none') {
      this._noiseT -= dt;
      if (this._noiseT <= 0) {
        this._noiseT = 0.07;
        const c = $('#lowhp');
        const g = c.getContext('2d');
        const img = g.createImageData(c.width, c.height);
        for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() < 0.5 ? 0 : 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
        g.putImageData(img, 0, 0);
      }
    }
  }

  // ---------------------------------------------------------------- dialogue (bottom text box)
  say(lines, who = '') {
    if (!Array.isArray(lines)) lines = [lines];
    const norm = lines.map((l) => {
      const raw = typeof l === 'string' ? { t: l, who } : { ...l, who: l.who ?? who };
      const name = raw.who ? (WHO[raw.who] ?? raw.who) : '';
      return { t: String(raw.t ?? ''), who: name === 'WREN' || name === WHO.W ? '' : name };
    });
    return new Promise((resolve) => {
      const job = { lines: norm, resolve };
      if (this.dialogState) { this.sayQueue.push(job); return; }
      this.startDialog(job);
    });
  }

  startDialog(job) {
    const box = $('#dialog');
    this.dialogState = { lines: job.lines, i: 0, shown: 0, resolve: job.resolve, box, ticked: 0 };
    box.classList.remove('choosing');
    $('.choices', box).innerHTML = '';
    box.classList.add('show');
    this._promptSig = null; $('#prompt').classList.remove('show');
    this.renderDialog();
  }

  renderDialog() {
    const s = this.dialogState;
    const line = s.lines[s.i];
    const n = Math.floor(s.shown);
    $('.who', s.box).textContent = line.who || '';
    s.box.classList.toggle('has-who', !!line.who);
    // untyped remainder is laid out invisibly so the wrap never jumps
    $('.text', s.box).innerHTML = `${esc(line.t.slice(0, n))}<span class="ghost">${esc(line.t.slice(n))}</span>`;
    s.box.classList.toggle('done', n >= line.t.length);
    $('.idx', s.box).textContent = s.lines.length > 1 ? `${pad(s.i + 1)} / ${pad(s.lines.length)}` : '';
  }

  updateDialog(dt, k) {
    const s = this.dialogState;
    const line = s.lines[s.i];
    const before = Math.floor(s.shown);
    if (s.shown < line.t.length) {
      s.shown = Math.min(line.t.length, s.shown + dt * 55);
      const now = Math.floor(s.shown);
      if (now !== before && line.t[now - 1] !== ' ' && (s.ticked++ % 2 === 0)) audio.typeTick();
    }
    if (k.confirm || k.click || this.input.hit('Escape')) {
      if (s.shown < line.t.length) s.shown = line.t.length;
      else {
        s.i++; s.shown = 0;
        audio.uiMove();
        if (s.i >= s.lines.length) {
          this.dialogState = null;
          const next = this.sayQueue.shift();
          if (next) this.startDialog(next);
          else s.box.classList.remove('show', 'done', 'has-who');
          s.resolve();
          return;
        }
      }
    }
    this.renderDialog();
  }

  // Options render inside the text box as a row of clickable items.
  choice(question, options) {
    const box = $('#dialog');
    const root = el('div', 'screen catcher');
    const modal = { el: root, passive: true };
    const text = String(question ?? '');
    let shown = 0, sel = 0, ready = false, ticked = 0;
    const row = $('.choices', box);
    const optEls = [];
    const pick = (v) => { audio.uiSelect(); modal.resolve(v); };
    const draw = () => {
      const n = Math.floor(shown);
      $('.who', box).textContent = '';
      box.classList.remove('has-who');
      $('.text', box).innerHTML = `${esc(text.slice(0, n))}<span class="ghost">${esc(text.slice(n))}</span>`;
      $('.idx', box).textContent = '';
      optEls.forEach((e, i) => e.classList.toggle('sel', i === sel));
    };
    const reveal = () => {
      ready = true;
      modal.passive = false;
      this.syncBody();
      box.classList.add('choosing');
      row.innerHTML = '';
      options.forEach((o, i) => {
        const b = clickable(el('div', 'ch', `<span class="bar"></span>${esc(o.label)}`));
        b.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; audio.uiMove(); draw(); } });
        b.addEventListener('click', () => pick(o.value));
        row.appendChild(b);
        optEls.push(b);
      });
      draw();
    };
    modal.update = (input, dt, k) => {
      if (!ready) {
        const before = Math.floor(shown);
        shown = Math.min(text.length, shown + dt * 55);
        if (Math.floor(shown) !== before && ticked++ % 2 === 0) audio.typeTick();
        if (k.confirm || k.click) shown = text.length;
        if (shown >= text.length) reveal(); else draw();
        return;
      }
      if (k.back) { audio.uiBack(); modal.resolve(null); return; }
      if (k.left || k.up) { sel = (sel + optEls.length - 1) % optEls.length; audio.uiMove(); draw(); }
      if (k.right || k.down) { sel = (sel + 1) % optEls.length; audio.uiMove(); draw(); }
      if (k.confirm) pick(options[sel].value);
    };
    modal.onClose = () => { box.classList.remove('show', 'choosing', 'done'); row.innerHTML = ''; };
    box.classList.remove('done', 'choosing');
    row.innerHTML = '';
    box.classList.add('show');
    draw();
    return this.open(modal);
  }

  // ---------------------------------------------------------------- modal stack
  open(modal) {
    return new Promise((resolve) => {
      modal.resolve = (v) => {
        if (modal.closed) return;
        modal.closed = true;
        const i = this.stack.indexOf(modal);
        if (i >= 0) this.stack.splice(i, 1);
        if (modal.onClose) safe(() => modal.onClose());
        modal.el.remove();
        this.syncBody();
        resolve(v);
      };
      this.stack.push(modal);
      this.screens.appendChild(modal.el);
      this._promptSig = null;
      $('#prompt').classList.remove('show');
      this.syncBody();
    });
  }

  syncBody() {
    document.body.classList.toggle('menu-open', this.menuOpen);
    document.body.classList.toggle('modal-open', this.stack.length > 0);
    const top = this.modal;
    for (const m of this.stack) m.el.classList.toggle('covered', m !== top);
  }

  keys(input) {
    return {
      back: input.back || this._rmb,
      confirm: input.confirm,
      ok: input.hit('Enter', 'Space', 'NumpadEnter') || input.padEdge.has('a'),
      up: input.up, down: input.downNav, left: input.left, right: input.right,
      click: input.mouse.anyClick,
    };
  }

  update(dt) {
    this.t += dt;
    const k = this.keys(this.input);
    if (this.dialogState) this.updateDialog(dt, k);
    else if (this.modal && this.modal.update) this.modal.update(this.input, dt, k);
    this._rmb = false;
    this.updateAmbient(dt);
  }

  // Header used by the OS-style panels.
  panelHead(title, gloss, code) {
    return `<div class="p-head"><div class="p-title">${esc(title)}${gloss ? `<span class="ru">${esc(gloss)}</span>` : ''}</div><div class="p-code">${esc(code || '')}</div></div>`;
  }

  // ---------------------------------------------------------------- boot / title
  boot() {
    return new Promise((resolve) => {
      const b = $('#boot');
      let went = false;
      const go = async () => {
        if (went) return;
        went = true;
        window.removeEventListener('keydown', go);
        b.removeEventListener('click', go);
        b.classList.add('go');
        await this.fontsReady;
        b.classList.add('gone');
        resolve();
      };
      window.addEventListener('keydown', go);
      b.addEventListener('click', go);
    });
  }

  title(hasSave) {
    const root = el('div', 'screen title-screen');
    root.innerHTML = `
      <div class="t-logo-wrap">
        <div class="t-logo" data-text="LETHE-7">LETHE-7</div>
        <div class="t-rule"></div>
        <div class="t-gloss">ЛЕТА-7 <i></i> CUSTODIAN STATION <i></i> HALCYON IV</div>
      </div>
      <div class="t-meta"><span>DECK 2 · HABITATION RING</span><span>L7-OS 3.1 · BUILD 0.2</span></div>
      <div class="t-foot"><div class="t-help"></div></div>
      <div class="t-credit">An original work. Every model, texture, sound and word is made in code.</div>`;
    const modal = { el: root };
    const help = $('.t-help', root);
    const menu = new Menu([
      { label: 'WAKE', value: 'new', help: 'Begin a new cycle.' },
      { label: 'RESTORE', value: 'continue', disabled: !hasSave, tag: hasSave ? '' : 'NO BACKUP', help: 'Resume from the last backup.' },
      { label: 'OPTIONS', value: 'options', help: 'Picture, controls and sound.' },
      { label: 'MANUAL', value: 'manual', help: 'Controls and service notes.' },
    ], {
      cls: 'menu title-menu',
      numbered: true,
      onMove: (o) => { help.textContent = o.help || ''; },
      onSelect: async (o) => {
        if (o.value === 'options') { await this.optionsScreen(); return; }
        if (o.value === 'manual') { await this.manualScreen(); return; }
        modal.resolve(o.value);
      },
    });
    root.insertBefore(menu.el, $('.t-foot', root));
    // the logo loses signal every 9–14 s for a few frames
    const logo = $('.t-logo', root);
    let nextTear = 5 + Math.random() * 4, tearFrames = 0;
    modal.update = (input, dt, k) => {
      nextTear -= dt;
      if (nextTear <= 0 && !this.settings.reduceFlash) { tearFrames = 3 + (Math.random() < 0.5 ? 1 : 0); nextTear = 9 + Math.random() * 5; audio.click(0, 900 + Math.random() * 600, 0.08); }
      if (tearFrames > 0) {
        tearFrames--;
        const a = 15 + Math.random() * 55, b = a + 6 + Math.random() * 18;
        logo.style.setProperty('--ta', a + '%');
        logo.style.setProperty('--tb', (100 - b) + '%');
        logo.style.setProperty('--dx', ((Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 16)).toFixed(0) + 'px');
        logo.classList.add('tear');
      } else logo.classList.remove('tear');
      menu.update(k);
    };
    return this.open(modal);
  }

  optionsScreen() {
    const root = el('div', 'screen opt-screen shade');
    const p = el('div', 'panel opt-panel');
    p.innerHTML = this.panelHead('OPTIONS', GLOSS.OPTIONS, 'L7-OS / CFG-02')
      + '<div class="seg-tabs"></div><div class="opt-rows"></div><div class="opt-help"></div>'
      + '<div class="p-foot"><div class="btn back" data-click>BACK</div><div class="keys">' + `${K('↑')}${K('↓')} select · ${K('←')}${K('→')} change · ${K('Q')}${K('E')} section · ${K('Esc')} back` + '</div></div>';
    root.appendChild(p);
    const modal = { el: root };
    const S = this.settings;
    let sec = 0, row = 0;
    const tabsEl = $('.seg-tabs', p), rowsEl = $('.opt-rows', p), helpEl = $('.opt-help', p);
    const rows = () => OPTION_SECTIONS[sec].rows;
    const valuesOf = (r) => r.values || [false, true];
    const fmt = (r, v) => (r.fmt ? r.fmt(v) : v === true ? 'ON' : v === false ? 'OFF' : String(v).toUpperCase());
    const setVal = (r, v) => { S[r.key] = v; audio.uiMove(); this.changed(); render(); };
    const step = (d) => {
      const r = rows()[row];
      if (r.slider) { setVal(r, clamp(Math.round((S[r.key] * r.slider + d)) / r.slider, 0, 1)); return; }
      const vs = valuesOf(r);
      const i = vs.indexOf(S[r.key]);
      setVal(r, vs[(i + d + vs.length) % vs.length]);
    };
    const render = () => {
      tabsEl.innerHTML = '';
      OPTION_SECTIONS.forEach((s, i) => {
        const t = clickable(el('div', 'seg-tab' + (i === sec ? ' sel' : ''), s.label));
        t.addEventListener('click', () => { sec = i; row = 0; audio.uiMove(); render(); });
        tabsEl.appendChild(t);
      });
      rowsEl.innerHTML = '';
      rows().forEach((r, i) => {
        const d = el('div', 'opt-row' + (i === row ? ' sel' : ''));
        d.innerHTML = `<span class="bar"></span><span class="lbl">${esc(r.label)}</span><span class="vals"></span>`;
        const vals = $('.vals', d);
        if (r.slider) {
          const n = Math.round(S[r.key] * r.slider);
          const bar = el('span', 'slider');
          for (let k = 1; k <= r.slider; k++) {
            const c = clickable(el('span', 'cell' + (k <= n ? ' on' : '')));
            c.addEventListener('click', (e) => { e.stopPropagation(); row = i; setVal(r, k / r.slider === S[r.key] && k === 1 ? 0 : k / r.slider); });
            bar.appendChild(c);
          }
          vals.appendChild(bar);
          vals.appendChild(el('span', 'num', pad(Math.round(S[r.key] * 100), 3)));
        } else {
          for (const v of valuesOf(r)) {
            const c = clickable(el('span', 'ch' + (S[r.key] === v ? ' on' : ''), esc(fmt(r, v))));
            c.addEventListener('click', (e) => { e.stopPropagation(); row = i; if (S[r.key] !== v) setVal(r, v); else render(); });
            vals.appendChild(c);
          }
        }
        d.addEventListener('mouseenter', () => { if (row !== i) { row = i; paintSel(); } });
        rowsEl.appendChild(d);
      });
      paintSel();
    };
    const paintSel = () => {
      [...rowsEl.children].forEach((d, i) => d.classList.toggle('sel', i === row));
      helpEl.textContent = rows()[row] ? rows()[row].help : '';
    };
    $('.back', p).addEventListener('click', () => { audio.uiBack(); modal.resolve(); });
    modal.update = (input, dt, k) => {
      if (input.hit('KeyQ') || input.padEdge.has('lb')) { sec = (sec + 2) % 3; row = 0; audio.uiMove(); render(); return; }
      if (input.hit('KeyE') || input.padEdge.has('rb')) { sec = (sec + 1) % 3; row = 0; audio.uiMove(); render(); return; }
      if (k.back) { audio.uiBack(); modal.resolve(); return; }
      if (k.up) { row = (row + rows().length - 1) % rows().length; audio.uiMove(); paintSel(); }
      if (k.down) { row = (row + 1) % rows().length; audio.uiMove(); paintSel(); }
      if (k.left) step(-1);
      if (k.right || k.ok) step(1);
    };
    render();
    audio.uiSelect();
    return this.open(modal);
  }

  manualScreen() {
    const root = el('div', 'screen man-screen shade');
    const p = el('div', 'panel man-panel');
    const rows = MANUAL_ROWS.map(([a, m, kb, pd]) => `<div class="mr"><div class="m-a">${esc(a)}</div><div class="m-m" data-h="MOUSE">${m}</div><div class="m-k" data-h="KEYBOARD">${kb}</div><div class="m-p" data-h="PAD">${esc(pd)}</div></div>`).join('');
    p.innerHTML = this.panelHead('MANUAL', GLOSS.MANUAL, 'L7-OS / MAN-01 · REV 3')
      + `<div class="man-body">
        <div class="man-sub">CUSTODIAN OPERATING PROCEDURES</div>
        <div class="man-table"><div class="mr mh"><div>ACTION</div><div>MOUSE</div><div>KEYBOARD</div><div>PAD</div></div>${rows}</div>
        <div class="man-notes">
          <div class="mn-h">SERVICE NOTES</div>
          <ol>
            <li>Anything within reach is framed in white. Point at it and click, or press ${K('F')}.</li>
            <li>The harness has six clip points. Everything you carry takes one.</li>
            <li>The screen stays quiet. Condition, files and the deck plan are in your own system: ${K('Tab')}.</li>
            <li>Backups are written by hand, at a backup deck. Nothing is written for you.</li>
          </ol>
        </div>
        <div class="man-type">Type: Sofia Sans Condensed, L7 Mono (from IBM Plex Mono), Michroma, Reenie Beanie. SIL Open Font License 1.1.</div>
      </div>`
      + `<div class="p-foot"><div class="btn back" data-click>BACK</div><div class="keys">${K('Esc')} or ${MB('R', '')} back</div></div>`;
    root.appendChild(p);
    const modal = { el: root };
    $('.back', p).addEventListener('click', () => { audio.uiBack(); modal.resolve(); });
    const body = $('.man-body', p);
    modal.update = (input, dt, k) => {
      if (k.back || k.ok) { audio.uiBack(); modal.resolve(); return; }
      if (k.up) body.scrollTop -= 48;
      if (k.down) body.scrollTop += 48;
    };
    audio.uiSelect();
    return this.open(modal);
  }

  // Legacy name kept for anything that still calls it.
  controlsScreen() { return this.manualScreen(); }

  pause() {
    const root = el('div', 'screen pause-screen shade');
    const p = el('div', 'panel pause-panel');
    p.innerHTML = this.panelHead('PAUSED', GLOSS.PAUSED, 'L7-OS');
    const modal = { el: root };
    const menu = new Menu([
      { label: 'RESUME', value: 'resume' },
      { label: 'MANUAL', value: 'manual' },
      { label: 'OPTIONS', value: 'options' },
      { label: 'QUIT TO TITLE', value: 'title' },
    ], {
      onSelect: async (o) => {
        if (o.value === 'manual') { await this.manualScreen(); return; }
        if (o.value === 'options') { await this.optionsScreen(); return; }
        modal.resolve(o.value);
      },
    });
    p.appendChild(menu.el);
    p.appendChild(el('div', 'pause-loc', `<span>LOC</span>${esc(this.room || '—')}<span class="clk">${this.clock()}</span>`));
    root.appendChild(p);
    modal.update = (input, dt, k) => {
      if (input.hit('Escape', 'KeyP') || input.padEdge.has('start') || (k.back && !input.hit('Tab'))) { audio.uiBack(); modal.resolve('resume'); return; }
      menu.update(k);
    };
    audio.uiSelect();
    return this.open(modal);
  }

  death(hasSave) {
    const root = el('div', 'screen death-screen');
    root.innerHTML = '<div class="d-wrap"><div class="d-line"></div><div class="d-msg">WREN-3 <i></i> NO RESPONSE</div><div class="d-gloss">НЕТ ОТВЕТА</div></div>';
    const modal = { el: root };
    let t = 0, menu = null;
    modal.update = (input, dt, k) => {
      t += dt;
      if (t > 0.8) root.classList.add('msg');
      if (t > 1.4 && !menu) {
        menu = new Menu([
          { label: 'RESTORE LAST BACKUP', value: 'load', disabled: !hasSave },
          { label: 'RETURN TO TITLE', value: 'title' },
        ], { cls: 'menu death-menu', onSelect: (o) => modal.resolve(o.value) });
        $('.d-wrap', root).appendChild(menu.el);
        root.classList.add('opts');
      }
      if (menu) menu.update(k);
    };
    return this.open(modal);
  }

  // ---------------------------------------------------------------- typed text screens
  typed(lines, { black = true, skippable = true, art = null } = {}) {
    const root = el('div', 'screen typed-screen ' + (black ? 'black' : 'shade'));
    const wrap = el('div', 'typed');
    if (art) {
      const c = drawMemory(art);
      c.className = 'typed-art';
      wrap.appendChild(c);
    }
    root.appendChild(el('div', 'typed-code', 'L7-OS · WAKE LOG'));
    root.appendChild(wrap);
    const skip = el('div', 'skip', skippable ? `${MB('L', '')} continue <i></i> ${K('Esc')} skip` : `${MB('L', '')} continue`);
    root.appendChild(skip);
    const modal = { el: root, passive: true };
    let i = 0, shown = 0, wait = 0.6, cur = null, done = false;
    modal.update = (input, dt, k) => {
      const hurry = k.confirm || k.click;
      if (input.back && skippable) { modal.resolve(); return; }
      if (done) { if (hurry) modal.resolve(); return; }
      if (wait > 0) { wait -= dt * (hurry ? 20 : 1); return; }
      const L = lines[i];
      if (!cur) { cur = el('div', 'ln ' + (L.cls || '')); wrap.appendChild(cur); shown = 0; }
      const before = Math.floor(shown);
      shown += dt * (L.cls && L.cls.includes('voice') ? 30 : 55) * (hurry ? 30 : 1);
      if (Math.floor(shown) > before && L.t[Math.floor(shown) - 1] && L.t[Math.floor(shown) - 1] !== ' ') audio.typeTick();
      cur.textContent = L.t.slice(0, Math.floor(shown));
      if (shown >= L.t.length) {
        cur = null; i++;
        wait = (L.pause || 250) / 1000;
        if (i >= lines.length) { done = true; skip.innerHTML = `${MB('L', '')} continue`; root.classList.add('done'); }
      }
    };
    return this.open(modal);
  }

  // ---------------------------------------------------------------- documents
  readerHTML(id) {
    const f = FILES[id];
    const type = fileType(id);
    const code = fileCode(id);
    const body = esc(f.body);
    if (type === 'circular') {
      return `<div class="doc doc-circular"><div class="dc-head"><div><span>FORM</span>${esc(code)}</div><div><span>POSTED</span>${esc((f.where || '').toUpperCase())}</div><div><span>DECK</span>2 · HABITATION RING</div></div>
        <div class="dc-stamp"><b>FILED</b><i>В ДЕЛО</i></div><div class="dc-title">${esc(f.title)}</div><div class="dc-body">${body}</div></div>`;
    }
    if (type === 'note') {
      return `<div class="doc doc-note"><div class="dn-paper"><div class="dn-body">${body}</div></div></div>`;
    }
    if (type === 'book') {
      return `<div class="doc doc-book"><div class="db-title">${esc(f.title)}</div><div class="db-body">${body}</div><div class="db-folio">— ${esc(code)} —</div></div>`;
    }
    const lines = String(f.body).split('\n').map((l, i) => `<div class="ll"><span class="n">${pad(i + 1, 3)}</span><span class="t">${esc(l) || '&nbsp;'}</span></div>`).join('');
    return `<div class="doc doc-log"><div class="dl-head">${esc(f.title)}<span>${esc(code)} · ${esc((f.where || '').toUpperCase())}</span></div><div class="dl-body">${lines}</div></div>`;
  }

  document(id, isNew = true) {
    const f = FILES[id];
    const root = el('div', 'screen doc-screen shade');
    const code = fileCode(id);
    const frame = el('div', 'doc-frame');
    frame.innerHTML = `<div class="df-bar"><span class="df-code">${esc(code)}</span><span class="df-title">${esc(f.title)}</span><span class="df-where">${esc((f.where || '').toUpperCase())}</span></div>`
      + `<div class="df-scroll">${this.readerHTML(id)}</div>`
      + `<div class="df-foot"><span class="pg"></span><span class="keys">wheel scroll <i></i> ${MB('L', '')} close</span></div>`;
    root.appendChild(frame);
    const scroll = $('.df-scroll', frame), pg = $('.pg', frame);
    const page = () => {
      const n = Math.max(1, Math.ceil(scroll.scrollHeight / Math.max(1, scroll.clientHeight) - 0.02));
      const i = Math.min(n, Math.floor(scroll.scrollTop / Math.max(1, scroll.clientHeight) + 0.02) + 1);
      pg.textContent = `PG ${i}/${n}`;
    };
    scroll.addEventListener('scroll', page);
    const modal = { el: root, passive: true };
    modal.update = (input, dt, k) => {
      if (k.up) scroll.scrollTop -= 60;
      if (k.down) scroll.scrollTop += 60;
      page();
      if (k.confirm || k.back || k.click) { audio.uiBack(); modal.resolve(); }
    };
    modal.onClose = () => {
      this.readFiles.add(id);
      persist('lethe7-read', [...this.readFiles]);
      if (isNew) setTimeout(() => this.toast(`FILED — <b>${esc(code)}</b>`), 0);
    };
    audio.uiSelect();
    requestAnimationFrame(page);
    return this.open(modal);
  }

  // ---------------------------------------------------------------- memory
  memory(key) {
    const m = MEMORIES[key] || MEMORIES[key === 'handover' ? 'promise' : key === 'promise' ? 'handover' : key] || MEMORIES.window;
    const root = el('div', 'screen black mem-screen');
    root.innerHTML = `<div class="mem-top"><span class="mt">${esc(m.title)}</span><span class="mc">L7-OS · RECALL</span></div><div class="mem-frame"><canvas width="320" height="134"></canvas></div><div class="mem-sub"><div class="w"></div><div class="l"></div></div>`;
    const cv = $('canvas', root), g = cv.getContext('2d');
    const src = drawMemory(m.art);
    const sc = document.createElement('canvas'); sc.width = 320; sc.height = 134;
    const sg = sc.getContext('2d');
    sg.drawImage(src, 0, Math.round((src.height - 134) / 2), 320, 134, 0, 0, 320, 134);
    const srcData = sg.getImageData(0, 0, 320, 134);
    const out = g.createImageData(320, 134);
    const dissolve = (thr) => {
      const s = srcData.data, o = out.data;
      for (let y = 0; y < 134; y++) for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 4;
        const on = BAYER8[(y & 7) * 8 + (x & 7)] < thr;
        o[i] = on ? s[i] : 0; o[i + 1] = on ? s[i + 1] : 0; o[i + 2] = on ? s[i + 2] : 0; o[i + 3] = 255;
      }
      g.putImageData(out, 0, 0);
    };
    dissolve(0);
    const wEl = $('.mem-sub .w', root), lEl = $('.mem-sub .l', root);
    const modal = { el: root, passive: true };
    let phase = 'in', t = 0, i = -1, shown = 0;
    modal.update = (input, dt, k) => {
      t += dt;
      if (phase === 'in') { dissolve(Math.min(1, t / 0.4)); if (t >= 1.4) { phase = 'lines'; i = 0; shown = 0; } return; }
      if (phase === 'out') { dissolve(Math.max(0, 1 - t / 0.4)); if (t >= 0.55) modal.resolve(); return; }
      const L = m.lines[i];
      const before = Math.floor(shown);
      shown = Math.min(L.t.length, shown + dt * 30);
      if (Math.floor(shown) > before && L.t[Math.floor(shown) - 1] !== ' ') audio.typeTick();
      wEl.textContent = L.who ? (WHO[L.who] || L.who) : '';
      lEl.innerHTML = `${esc(L.t.slice(0, Math.floor(shown)))}<span class="ghost">${esc(L.t.slice(Math.floor(shown)))}</span>`;
      if (k.confirm || k.click) {
        if (shown < L.t.length) shown = L.t.length;
        else { audio.uiMove(); i++; shown = 0; if (i >= m.lines.length) { phase = 'out'; t = 0; wEl.textContent = ''; lEl.textContent = ''; } }
      }
    };
    return this.open(modal);
  }

  // ================================================================ CUSTODIAN OS (inventory)
  inventory(ctx, startTab = 'items') {
    const ui = this;
    const root = el('div', 'screen os-screen');
    const os = el('div', 'os');
    root.appendChild(os);
    const TABS = [
      { id: 'items', en: 'ITEMS', ru: GLOSS.ITEMS },
      { id: 'map', en: 'MAP', ru: GLOSS.MAP },
      { id: 'files', en: 'FILES', ru: GLOSS.FILES },
      { id: 'receiver', en: 'RECEIVER', ru: ctx.radio ? GLOSS.RECEIVER : 'NO MODULE', disabled: !ctx.radio },
    ];
    const cycle = ctx.cycle || '11 406';
    os.innerHTML = `<header class="os-head">
        <div class="os-brand"><span class="os-mark">L7</span><span class="os-name">CUSTODIAN OS <b>3.1</b></span></div>
        <nav class="os-tabs"></nav>
        <div class="os-meta"><span>UNIT WREN-3</span><span class="mono">CYCLE ${esc(cycle)}</span></div>
        <div class="os-close" data-click title="Close">CLOSE<i></i></div>
      </header>
      <div class="os-body"></div>
      <footer class="os-foot"><div class="os-help"></div><div class="os-log"></div><div class="os-code">L7-OS / INV-06</div></footer>`;
    const nav = $('.os-tabs', os), body = $('.os-body', os), helpEl = $('.os-help', os), logEl = $('.os-log', os);
    const tabEls = TABS.map((t) => {
      const d = el('div', 'os-tab' + (t.disabled ? ' disabled' : ''), `<span class="en">${t.en}</span><span class="ru">${t.ru}</span>`);
      if (!t.disabled) { clickable(d); d.addEventListener('click', () => { if (tab !== t.id) { audio.click(0, 2600, 0.15); setTab(t.id); } }); }
      nav.appendChild(d);
      return d;
    });
    nav.addEventListener('wheel', (e) => { e.preventDefault(); cycleTab(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    $('.os-close', os).addEventListener('click', () => { audio.uiBack(); modal.resolve(); });

    const modal = { el: root, os: true };
    let logTimer = null;
    const log = (html) => {
      logEl.innerHTML = `<span class="ts">${ui.clock()}</span>${html}`;
      logEl.classList.remove('flash'); void logEl.offsetWidth; logEl.classList.add('flash');
      clearTimeout(logTimer);
      logTimer = setTimeout(() => { logEl.innerHTML = ''; }, 4000);
    };
    modal.onToast = log;

    let tab = null, view = null;
    const views = {
      items: () => this.osItems(ctx, modal, log),
      map: () => this.osMap(ctx),
      files: () => this.osFiles(ctx),
      receiver: () => this.osReceiver(ctx),
    };
    const setTab = (t) => {
      if (!views[t] || (TABS.find((x) => x.id === t) || {}).disabled) t = 'items';
      if (view && view.destroy) safe(() => view.destroy());
      tab = t;
      tabEls.forEach((e, i) => e.classList.toggle('sel', TABS[i].id === t));
      body.innerHTML = '';
      view = views[t]();
      view.el.classList.add('tab-in');
      body.appendChild(view.el);
      helpEl.innerHTML = view.help || '';
      if (view.mounted) requestAnimationFrame(() => safe(() => view.mounted()));
    };
    const cycleTab = (d) => {
      const live = TABS.filter((t) => !t.disabled).map((t) => t.id);
      const i = live.indexOf(tab);
      audio.click(0, 2600, 0.15);
      setTab(live[(i + d + live.length) % live.length]);
    };
    modal.update = (input, dt, k) => {
      if (view && view.update) safe(() => view.update(dt, k, input));
      if (view && view.consumed) { view.consumed = false; return; }
      if (input.hit('KeyQ') || input.padEdge.has('lb')) { cycleTab(-1); return; }
      if (input.hit('KeyE') || input.padEdge.has('rb')) { cycleTab(1); return; }
      if (k.back || (input.hit('KeyM') && tab === 'map') || (input.hit('KeyI') && tab === 'items')) { audio.uiBack(); modal.resolve(); }
    };
    modal.onClose = () => { if (view && view.destroy) safe(() => view.destroy()); clearTimeout(logTimer); };
    setTab(startTab);
    audio.click(0, 2400, 0.2);
    audio.uiSelect();
    return this.open(modal);
  }

  // ---------------------------------------------------------------- ITEMS tab
  osItems(ctx, modal, log) {
    const ui = this;
    const inv = ctx.inv;
    const v = { el: el('div', 'it'), help: `click select <i></i> double-click use <i></i> drag onto item combine <i></i> ${MB('R', '')} / ${K('Esc')} back <i></i> ${K('Q')}${K('E')} tab` };
    v.el.innerHTML = `
      <section class="it-unit">
        <div class="lbl">UNIT <b>WREN-3</b><span class="sub">CUSTODIAN · SER. 0003</span></div>
        <div class="self"><canvas class="self-cv" width="96" height="128"></canvas><div class="ruler"></div><div class="sweep"></div><span class="self-cap">1.72 M</span></div>
        <div class="cond">
          <div class="lbl">CONDITION <span class="ru">${GLOSS.CONDITION}</span></div>
          <div class="cond-row"><div class="cond-word"></div><div class="cond-pct mono"></div></div>
          <div class="cond-gloss"></div>
          <div class="cond-bar"></div>
          <canvas class="trace" width="226" height="34"></canvas>
        </div>
        <div class="equip"></div>
      </section>
      <section class="it-main">
        <div class="it-top">
          <div class="tt"><canvas class="tt-cv" width="176" height="160"></canvas><span class="tt-cap">VIEW 01 · ROTATE</span><span class="tt-id mono"></span><div class="tt-empty">NO ITEM</div></div>
          <div class="info"><div class="kind"></div><div class="name"></div><div class="desc"></div><div class="stats"></div><div class="rec"></div></div>
        </div>
        <div class="slots"></div>
        <div class="acts"></div>
      </section>
      <div class="inspect"></div>`;
    const selfCv = $('.self-cv', v.el), selfG = selfCv.getContext('2d');
    const traceCv = $('.trace', v.el), traceG = traceCv.getContext('2d');
    const slotsEl = $('.slots', v.el), actsEl = $('.acts', v.el);
    const tt = new ItemView($('.tt-cv', v.el), { spin: 0.6, levels: 12 });
    // the wheel over the slot row steps the selection
    slotsEl.addEventListener('wheel', (e) => { e.preventDefault(); if (inspect || drag) return; sel = (sel + (e.deltaY > 0 ? 1 : SLOTS - 1)) % SLOTS; focus = 'slots'; failT = 0; audio.uiMove(); refresh(); }, { passive: false });
    const inspectEl = $('.inspect', v.el);
    if (!this.selfModel) this.selfModel = safe(() => new SelfModel(), null);

    let sel = inv.slots.findIndex((s) => !!s);
    if (sel < 0) sel = 0;
    let focus = 'slots', actIdx = 0, combineFrom = null, discardAsk = null, failT = 0, busy = false;
    let inspect = null;
    const slotEls = [];
    const slotPx = () => Math.max(20, Math.floor((slotEls[0] ? slotEls[0].clientWidth : 96) / 2));

    const equippedWeapon = () => {
      if (ctx.equipped && ctx.equipped.weapon != null) return ctx.equipped.weapon;
      return inv.slots.findIndex((s) => s && itemDef(s.id).kind === 'weapon');
    };
    const isEquipped = (i) => ctx.equipped ? (ctx.equipped.weapon === i || ctx.equipped.tool === i) : (i === equippedWeapon());

    // --- condition block
    const renderCond = () => {
      const lvl = condLevel(ctx.player);
      const c = COND[lvl];
      const hp = clamp(ctx.player.hp / (ctx.player.maxHp || 100), 0, 1);
      const cw = $('.cond-word', v.el);
      cw.textContent = c.word;
      cw.className = 'cond-word ' + c.cls;
      $('.cond-gloss', v.el).textContent = c.gloss;
      $('.cond-pct', v.el).textContent = 'INTEGRITY ' + pad(Math.round(hp * 100), 3);
      const segs = Math.ceil(hp * 8 - 0.001);
      $('.cond-bar', v.el).innerHTML = Array.from({ length: 8 }, (_, i) => `<i class="${i < segs ? 'on ' + c.cls : ''}"></i>`).join('');
      v.el.dataset.cond = lvl;
      const w = equippedWeapon();
      const wname = w >= 0 && inv.slots[w] ? itemDef(inv.slots[w].id).name : '—';
      const tl = ctx.equipped && ctx.equipped.tool != null && inv.slots[ctx.equipped.tool] ? itemDef(inv.slots[ctx.equipped.tool].id).name : '—';
      $('.equip', v.el).innerHTML = `<div><span class="lbl">WEAPON</span><span class="val">${esc(wname)}</span></div><div><span class="lbl">TOOL</span><span class="val">${esc(tl)}</span></div>`;
      return lvl;
    };

    // --- slots
    const renderSlots = () => {
      if (!slotEls.length) {
        for (let i = 0; i < SLOTS; i++) {
          const d = clickable(el('div', 'slot'));
          d.innerHTML = '<canvas class="th"></canvas><span class="no mono">' + (i + 1) + '</span><span class="qty mono"></span><span class="eq">EQ</span>';
          d.addEventListener('click', () => onSlotClick(i));
          d.addEventListener('dblclick', () => { const a = actionsFor(i).find((x) => x.primary); if (a) runAction(a); });
          d.addEventListener('mousedown', (e) => startDrag(e, i));
          slotsEl.appendChild(d);
          slotEls.push(d);
        }
      }
      const px = slotPx();
      slotEls.forEach((d, i) => {
        const s = inv.slots[i];
        d.classList.toggle('sel', i === sel);
        d.classList.toggle('empty', !s);
        d.classList.toggle('src', combineFrom === i);
        d.classList.toggle('equipped', !!s && isEquipped(i));
        const cv = $('.th', d);
        const key = s ? s.id + '@' + px : '';
        if (cv.dataset.key !== key) {
          cv.dataset.key = key;
          cv.width = px; cv.height = px;
          const g = cv.getContext('2d');
          g.clearRect(0, 0, px, px);
          if (s) {
            const th = itemThumb(s.id, px) || safe(() => drawIcon(s.id), null);
            if (th) { g.imageSmoothingEnabled = false; g.drawImage(th, 0, 0, px, px); }
          }
        }
        const q = $('.qty', d);
        if (!s) q.textContent = '';
        else if (itemDef(s.id).kind === 'weapon' && s.loaded !== undefined) q.textContent = pad(s.loaded);
        else q.textContent = itemDef(s.id).stack > 1 ? '×' + s.qty : '';
      });
    };

    // --- item info
    const renderInfo = () => {
      const s = inv.slots[sel];
      const info = $('.info', v.el);
      const tte = $('.tt', v.el);
      tte.classList.toggle('none', !s);
      if (!s) {
        tt.setItem(null);
        $('.tt-id', v.el).textContent = '';
        $('.kind', info).innerHTML = `CLIP POINT ${sel + 1} <i></i> EMPTY`;
        $('.name', info).textContent = '—';
        $('.desc', info).innerHTML = `<span class="dim">${inv.freeSlots()} of ${SLOTS} clip points free.</span>`;
        $('.stats', info).innerHTML = '';
        $('.rec', info).innerHTML = '';
      } else {
        const def = itemDef(s.id);
        tt.setItem(s.id);
        $('.tt-id', v.el).textContent = 'IT-' + String(s.id).toUpperCase().slice(0, 6);
        $('.kind', info).innerHTML = `${KIND[def.kind] || 'ITEM'} <i></i> CLIP POINT ${sel + 1}${isEquipped(sel) ? ' <i></i> <b>EQUIPPED</b>' : ''}`;
        $('.name', info).textContent = def.name;
        const d = $('.desc', info);
        if (failT > 0) d.innerHTML = `<span class="fail">${esc(FAIL_COMBINE)}</span>`;
        else if (combineFrom !== null) d.innerHTML = `<span class="note">Combine <b>${esc(itemDef(inv.slots[combineFrom]?.id).name)}</b> with… choose an item. ${MB('R', '')} cancels.</span>`;
        else d.textContent = def.desc;
        let st = '';
        if (def.kind === 'weapon' && s.loaded !== undefined) {
          const mag = def.mag || 8;
          st = `<span class="pips">${Array.from({ length: mag }, (_, i) => `<i class="${i < s.loaded ? 'on' : ''}"></i>`).join('')}</span><span>LOADED <b>${pad(s.loaded)}</b> / ${pad(mag)}</span><span>RESERVE <b>${pad(inv.count('ammo'))}</b></span>`;
        } else if (def.stack > 1) {
          st = `<span>QTY <b>${pad(s.qty)}</b> / ${pad(def.stack)}</span>`;
          if (def.heal) st += `<span>RESTORES <b>${def.heal}</b></span>`;
        } else if (def.heal) st = `<span>RESTORES <b>${def.heal}</b></span>`;
        $('.stats', info).innerHTML = st;
        const status = isEquipped(sel) ? 'EQUIPPED' : def.kind === 'key' ? 'RETAIN' : 'CARRIED';
        $('.rec', info).innerHTML = [['REF', 'IT-' + String(s.id).toUpperCase()], ['CLASS', KIND[def.kind] || 'ITEM'], ['HELD', `${pad(s.qty || 1)} / ${pad(def.stack || 1)}`], ['STATUS', status]]
          .map(([k, v]) => `<div><span>${k}</span><b>${esc(v)}</b></div>`).join('') + `<div class="hint">INSPECT to turn it over and look closer.</div>`;
      }
    };

    // --- actions
    const actionsFor = (i) => {
      const s = inv.slots[i];
      if (!s) return [];
      const def = itemDef(s.id);
      const list = [];
      const base = safe(() => ctx.actions(i), []) || [];
      for (const a of base) list.push({ label: String(a.label).toUpperCase(), run: a.fn, primary: true });
      if (ctx.equipped && (def.kind === 'weapon' || def.kind === 'tool')) list.push({ label: isEquipped(i) ? 'UNEQUIP' : 'EQUIP', run: () => equip(i) });
      if (ctx.combine) list.push({ label: 'COMBINE', run: () => { combineFrom = i; refresh(); } });
      list.push({ label: 'INSPECT', run: () => openInspect(i) });
      if (ctx.discard && def.kind !== 'key') list.push({ label: 'DISCARD', run: () => { discardAsk = i; actIdx = 0; focus = 'acts'; refresh(); } });
      return list;
    };
    const renderActs = () => {
      actsEl.innerHTML = '';
      if (discardAsk !== null) {
        const s = inv.slots[discardAsk];
        actsEl.appendChild(el('span', 'ask', `Discard <b>${esc(itemDef(s?.id).name)}</b>?`));
        const list = [{ label: 'DISCARD', run: () => { const ok = safe(() => ctx.discard(discardAsk), false); log(ok ? `DISCARDED — <b>${esc(itemDef(s?.id).name)}</b>` : 'CANNOT DISCARD'); discardAsk = null; } }, { label: 'KEEP', run: () => { discardAsk = null; } }];
        list.forEach((a, k) => actsEl.appendChild(actBtn(a, k, k === 0 ? 'danger' : '')));
        return;
      }
      const list = actionsFor(sel);
      if (!list.length) { actsEl.appendChild(el('span', 'none', 'NO ACTIONS')); return; }
      actIdx = Math.min(actIdx, list.length - 1);
      list.forEach((a, k) => actsEl.appendChild(actBtn(a, k)));
    };
    const actBtn = (a, k, extra = '') => {
      const b = clickable(el('div', 'act ' + extra + (focus === 'acts' && k === actIdx ? ' sel' : ''), `<span class="bar"></span>${esc(a.label)}`));
      b.addEventListener('click', () => { actIdx = k; runAction(a); });
      b.addEventListener('mouseenter', () => { if (focus === 'acts') { actIdx = k; paintActs(); } });
      return b;
    };
    const paintActs = () => [...actsEl.querySelectorAll('.act')].forEach((b, k) => b.classList.toggle('sel', focus === 'acts' && k === actIdx));
    const runAction = async (a) => {
      if (busy) return;
      busy = true;
      audio.uiSelect();
      let res;
      try { res = await a.run(); } catch (e) { console.error(e); }
      busy = false;
      if (res === 'close') { modal.resolve(); return; }
      refresh();
    };
    const equip = (i) => {
      const s = inv.slots[i];
      const kind = itemDef(s.id).kind === 'tool' ? 'tool' : 'weapon';
      if (typeof ctx.equip === 'function') ctx.equip(i);
      else ctx.equipped[kind] = ctx.equipped[kind] === i ? null : i;
      log(`${ctx.equipped[kind] === i ? 'EQUIPPED' : 'STOWED'} — <b>${esc(itemDef(s.id).name)}</b>`);
    };
    const refresh = () => { renderSlots(); renderInfo(); renderActs(); renderCond(); };

    const onSlotClick = (i) => {
      if (dragJustEnded) return;
      if (combineFrom !== null) {
        const from = combineFrom;
        combineFrom = null;
        if (i !== from) { doCombine(from, i); return; }
        refresh(); return;
      }
      if (sel !== i) audio.uiMove();
      sel = i; focus = 'slots'; discardAsk = null; failT = 0;
      refresh();
    };

    // --- combining (drag an item onto another)
    const reloadActionOn = (w) => (safe(() => ctx.actions(w), []) || []).find((x) => /RELOAD|LOAD/i.test(String(x.label)));
    const doCombine = async (i, j) => {
      const a = inv.slots[i], b = inv.slots[j];
      if (!a || !b || i === j) { refresh(); return; }
      if (ctx.combine) {
        const r = safe(() => ctx.combine(i, j), { ok: false }) || { ok: false };
        if (r.ok) { log(r.msg ? esc(r.msg) : 'COMBINED'); flashSlot(j); audio.uiSelect(); } else { fail(); if (r.msg) log(esc(r.msg)); }
        sel = inv.slots[j] ? j : i;
        refresh();
        return;
      }
      // Without a combine hook: ammo dropped on a weapon reloads it.
      const ka = itemDef(a.id).kind, kb = itemDef(b.id).kind;
      const target = ka === 'ammo' ? j : kb === 'ammo' ? i : -1;
      const act = target >= 0 ? reloadActionOn(target) : null;
      if (act) {
        sel = target;
        const before = inv.slots[target] && inv.slots[target].loaded;
        await runAction({ run: act.fn });
        if (inv.slots[target] && inv.slots[target].loaded !== before) { flashSlot(target); log(`LOADED — <b>${esc(itemDef(inv.slots[target].id).name)}</b>`); }
        return;
      }
      fail();
    };
    const fail = () => { failT = 2.6; audio.uiBack(); refresh(); };
    const flashSlot = (i) => { const d = slotEls[i]; if (!d) return; d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); };

    let drag = null, dragJustEnded = false;
    const startDrag = (e, i) => {
      if (e.button !== 0 || !inv.slots[i] || inspect) return;
      drag = { i, x: e.clientX, y: e.clientY, on: false, ghost: null, over: -1 };
    };
    const onMove = (e) => {
      if (!drag) return;
      if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
        drag.on = true;
        const g = el('canvas', 'drag-ghost');
        const src = $('.th', slotEls[drag.i]);
        g.width = src.width; g.height = src.height;
        g.getContext('2d').drawImage(src, 0, 0);
        document.body.appendChild(g);
        drag.ghost = g;
        slotEls[drag.i].classList.add('dragging');
      }
      if (drag.on) {
        drag.ghost.style.transform = `translate(${e.clientX - drag.ghost.offsetWidth / 2}px, ${e.clientY - drag.ghost.offsetHeight / 2}px)`;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        const s = t && t.closest ? t.closest('.slot') : null;
        const j = s ? slotEls.indexOf(s) : -1;
        if (j !== drag.over) { slotEls.forEach((d, k) => d.classList.toggle('target', k === j && k !== drag.i)); drag.over = j; }
      }
    };
    const onUp = (e) => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.on) return;
      d.ghost.remove();
      slotEls.forEach((s) => s.classList.remove('dragging', 'target'));
      dragJustEnded = true;
      setTimeout(() => { dragJustEnded = false; }, 0);
      if (d.over >= 0 && d.over !== d.i) doCombine(d.i, d.over);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // --- inspect (full-panel turntable)
    const openInspect = (i) => {
      const s = inv.slots[i];
      if (!s) return;
      const def = itemDef(s.id);
      inspectEl.innerHTML = `<div class="ins-head"><span class="lbl">INSPECT</span><span class="nm">${esc(def.name)}</span><span class="mono code">IT-${esc(String(s.id).toUpperCase())}</span></div>
        <div class="ins-view"><canvas width="320" height="200"></canvas><div class="ins-grid"></div></div>
        <div class="ins-cap">${esc(def.inspect || def.desc)}</div>
        <div class="ins-acts"><div class="act turn" data-click><span class="bar"></span>TURN OVER</div><div class="act back" data-click><span class="bar"></span>BACK</div><span class="keys">drag rotate <i></i> wheel zoom <i></i> ${MB('R', '')} back</span></div>`;
      const cv = $('canvas', inspectEl);
      const view = new ItemView(cv, { spin: 0.25, fov: 22, fill: 0.72, levels: 14 });
      view.setItem(s.id);
      inspect = { view };
      v.el.classList.add('inspecting');
      let dragging = null;
      cv.addEventListener('mousedown', (e) => { if (e.button === 0) { dragging = { x: e.clientX, y: e.clientY }; view.dragging = true; } });
      inspect.move = (e) => { if (!dragging) return; view.drag(e.clientX - dragging.x, e.clientY - dragging.y); dragging.x = e.clientX; dragging.y = e.clientY; };
      inspect.up = () => { dragging = null; view.dragging = false; };
      window.addEventListener('mousemove', inspect.move);
      window.addEventListener('mouseup', inspect.up);
      cv.addEventListener('wheel', (e) => { e.preventDefault(); view.wheel(e.deltaY); }, { passive: false });
      $('.turn', inspectEl).addEventListener('click', () => { audio.click(0, 1800, 0.2); view.turnOver(); });
      $('.back', inspectEl).addEventListener('click', () => closeInspect());
      audio.uiSelect();
    };
    const closeInspect = () => {
      if (!inspect) return;
      window.removeEventListener('mousemove', inspect.move);
      window.removeEventListener('mouseup', inspect.up);
      inspect.view.dispose();
      inspect = null;
      inspectEl.innerHTML = '';
      v.el.classList.remove('inspecting');
      audio.uiBack();
    };

    // --- per-frame
    let traceX = 0, traceY = 17, beat = 0, drop = 0, level = renderCond();
    traceG.fillStyle = '#07080a'; traceG.fillRect(0, 0, traceCv.width, traceCv.height);
    const drawTrace = (dt) => {
      const P = [{ sp: 44, per: 1.15, n: 0.25 }, { sp: 58, per: 0.85, n: 0.9 }, { sp: 74, per: 0.62, n: 2.0 }, { sp: 90, per: 0.48, n: 3.2 }][level];
      const col = COND[level].hex;
      const W = traceCv.width, H = traceCv.height, mid = H / 2 + 2;
      let px = P.sp * dt;
      traceG.lineWidth = 1;
      while (px > 0) {
        const stepX = Math.min(1, px); px -= stepX;
        beat += stepX / P.sp;
        if (beat > P.per) { beat -= P.per; if (level === 3 && Math.random() < 0.35) drop = 0.25 + Math.random() * 0.5; }
        if (drop > 0) drop -= stepX / P.sp;
        const ph = beat / P.per;
        let y = mid + (Math.random() - 0.5) * P.n;
        if (drop <= 0) {
          if (ph > 0.1 && ph < 0.14) y = mid - (ph - 0.1) / 0.04 * 12;
          else if (ph >= 0.14 && ph < 0.19) y = mid - 12 + (ph - 0.14) / 0.05 * 20;
          else if (ph >= 0.19 && ph < 0.23) y = mid + 8 - (ph - 0.19) / 0.04 * 8;
          else if (ph > 0.36 && ph < 0.48) y = mid - Math.sin((ph - 0.36) / 0.12 * Math.PI) * 4;
        } else y = mid;
        const x0 = Math.floor(traceX);
        traceX += stepX;
        if (traceX >= W) { traceX -= W; }
        const x1 = Math.floor(traceX);
        traceG.fillStyle = '#07080a';
        traceG.fillRect(x1 + 1, 0, 10, H);
        if (x1 < x0) traceG.fillRect(0, 0, 10, H);
        if ((x1 + 10) % 29 === 0) { traceG.fillStyle = 'rgba(232,226,212,0.09)'; traceG.fillRect(x1 + 10, 0, 1, H); }
        traceG.strokeStyle = col;
        traceG.beginPath(); traceG.moveTo(x0 + 0.5, traceY); traceG.lineTo(x1 + 0.5, y); traceG.stroke();
        traceY = y;
      }
    };

    v.update = (dt, k, input) => {
      if (failT > 0) { failT -= dt; if (failT <= 0) renderInfo(); }
      if (inspect) {
        inspect.view.update(dt);
        if (k.back) { closeInspect(); v.consumed = true; }
        return;
      }
      if (this.selfModel) this.selfModel.render(selfG, level, dt);
      tt.update(dt);
      drawTrace(dt);
      // keyboard / pad
      if (k.back && (combineFrom !== null || discardAsk !== null || focus === 'acts') && !input.hit('Tab', 'KeyQ')) {
        combineFrom = null; discardAsk = null; focus = 'slots'; audio.uiBack(); refresh(); v.consumed = true; return;
      }
      if (focus === 'slots') {
        if (k.left) { sel = (sel + SLOTS - 1) % SLOTS; audio.uiMove(); failT = 0; refresh(); }
        if (k.right) { sel = (sel + 1) % SLOTS; audio.uiMove(); failT = 0; refresh(); }
        if ((k.down || k.ok) && inv.slots[sel]) {
          if (combineFrom !== null) { const f = combineFrom; combineFrom = null; if (f !== sel) doCombine(f, sel); else refresh(); return; }
          focus = 'acts'; actIdx = 0; audio.uiMove(); renderActs();
        }
      } else {
        const n = actsEl.querySelectorAll('.act').length;
        if (k.left && n) { actIdx = (actIdx + n - 1) % n; audio.uiMove(); paintActs(); }
        if (k.right && n) { actIdx = (actIdx + 1) % n; audio.uiMove(); paintActs(); }
        if (k.up) { focus = 'slots'; audio.uiMove(); paintActs(); }
        if (k.ok && n) actsEl.querySelectorAll('.act')[actIdx].click();
      }
    };
    v.destroy = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (drag && drag.ghost) drag.ghost.remove();
      if (inspect) closeInspect();
      tt.dispose();
    };
    v.mounted = () => { renderSlots(); };
    refresh();
    return v;
  }

  // ---------------------------------------------------------------- MAP tab (blueprint)
  osMap(ctx) {
    const v = { el: el('div', 'mp'), help: `drag pan <i></i> wheel zoom <i></i> hover a room <i></i> ${K('M')} / ${MB('R', '')} close` };
    v.el.innerHTML = `<div class="mp-view"><canvas></canvas><div class="mp-scale mono"></div></div>
      <aside class="mp-legend">
        <div class="sec-code"></div><div class="sec-name"></div><div class="sec-gloss"></div>
        <div class="rooms"></div>
        <div class="hover"><span class="lbl">POINTER</span><span class="nm">—</span></div>
        <div class="stat mono"></div>
        <div class="mkey">
          <div><i class="k-you"></i>WREN-3</div>
          <div><i class="k-cur"></i>CURRENT ROOM</div>
          <div><i class="k-plan"></i>FROM PLAN ONLY</div>
          <div><i class="k-open"></i>DOOR OPEN</div>
          <div><i class="k-item"></i>NEEDS AN ITEM</div>
          <div><i class="k-seal"></i>SEALED</div>
        </div>
      </aside>`;
    const cv = $('canvas', v.el), wrap = $('.mp-view', v.el);
    const g = cv.getContext('2d');
    const map = ctx.map || {};
    const plans = map.plans instanceof Set ? map.plans : new Set(map.plans || []);
    const visited = ctx.visited || new Set();
    const cur = ctx.currentRoom;
    const sec = sectorOf(cur);
    $('.sec-code', v.el).textContent = 'SECTOR ' + sec.code;
    $('.sec-name', v.el).textContent = sec.name;
    $('.sec-gloss', v.el).textContent = sec.gloss;
    const known = (k) => visited.has(k) || plans.has(sectorOf(k).code) || plans.has(k);
    $('.rooms', v.el).innerHTML = sec.rooms.filter((k) => ROOMS[k]).map((k) => `<div class="${k === cur ? 'cur' : ''} ${visited.has(k) ? 'vis' : ''}"><i></i>${visited.has(k) || plans.has(sec.code) ? esc(ROOMS[k].name) : '— — —'}</div>`).join('');
    const hoverNm = $('.hover .nm', v.el);
    const nKnown = Object.keys(ROOMS).filter((k) => visited.has(k)).length;
    const nDoors = DOORS.filter((d) => visited.has(d.a) || visited.has(d.b)).length;
    $('.stat', v.el).innerHTML = `ROOMS ENTERED <b>${pad(nKnown)}</b> / ${pad(Object.keys(ROOMS).length)}<br>DOORS KNOWN <b>${pad(nDoors)}</b> / ${pad(DOORS.length)}<br>PLAN ${plans.size ? 'ON FILE' : 'NOT ON FILE'}`;
    const ZOOMS = [1, 1.6, 2.4];
    let zi = 0, panX = 0, panY = 0, hover = null, t = 0, dragging = null, W = 0, H = 0, dpr = 1;
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = wrap.clientWidth; H = wrap.clientHeight;
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
    };
    // frame the known part of the deck (plus a margin), not the whole grid
    const fit = (() => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (const [k, r] of Object.entries(ROOMS)) if (known(k)) { x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1 + 1); z1 = Math.max(z1, r.z1 + 1); }
      if (!isFinite(x0)) { x0 = 0; z0 = 0; x1 = GRID_W; z1 = GRID_H; }
      const m = 4;
      return { x0: x0 - m, z0: z0 - m, w: Math.max(18, x1 - x0 + 2 * m), h: Math.max(14, z1 - z0 + 2 * m) };
    })();
    const baseScale = () => Math.min(W / fit.w, H / fit.h);
    const view = () => {
      const s = baseScale() * ZOOMS[zi];
      const cx = W / 2 - (fit.x0 + fit.w / 2) * s + panX, cy = H / 2 - (fit.z0 + fit.h / 2) * s + panY;
      return { s, cx, cy };
    };
    const doorState = (d) => {
      if (map.tried instanceof Map) return map.tried.get(d.id) || null;
      if (!(visited.has(d.a) || visited.has(d.b))) return null;
      const door = ctx.doors && ctx.doors[d.id];
      if (!door) return null;
      if (door.open || !door.locked) return 'open';
      const lock = door.lock || d.lock;
      return lock === 'power' || lock === 'breaker' ? 'sealed' : 'item';
    };
    const draw = () => {
      const { s, cx, cy } = view();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#07080a'; g.fillRect(0, 0, W, H);
      // 8 px grid at 6 %
      g.fillStyle = 'rgba(232,226,212,0.06)';
      for (let x = ((cx % 8) + 8) % 8; x < W; x += 8) g.fillRect(Math.floor(x), 0, 1, H);
      for (let y = ((cy % 8) + 8) % 8; y < H; y += 8) g.fillRect(0, Math.floor(y), W, 1);
      g.fillStyle = 'rgba(232,226,212,0.1)';
      for (let x = ((cx % 64) + 64) % 64; x < W; x += 64) g.fillRect(Math.floor(x), 0, 1, H);
      for (let y = ((cy % 64) + 64) % 64; y < H; y += 64) g.fillRect(0, Math.floor(y), W, 1);
      const R = (r) => [Math.round(cx + r.x0 * s) + 0.5, Math.round(cy + r.z0 * s) + 0.5, Math.round((r.x1 - r.x0 + 1) * s), Math.round((r.z1 - r.z0 + 1) * s)];
      for (const [k, r] of Object.entries(ROOMS)) {
        if (!known(k)) continue;
        const [x, y, w, h] = R(r);
        const isCur = k === cur, vis = visited.has(k);
        if (isCur) {
          g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
          g.strokeStyle = 'rgba(255,42,58,0.25)'; g.lineWidth = 1;
          for (let q = -h; q < w; q += 6) { g.beginPath(); g.moveTo(x + q, y + h); g.lineTo(x + q + h, y); g.stroke(); }
          g.restore();
        } else if (vis) { g.fillStyle = 'rgba(232,226,212,0.035)'; g.fillRect(x, y, w, h); }
        if (hover === k) { g.fillStyle = 'rgba(232,226,212,0.08)'; g.fillRect(x, y, w, h); }
        g.strokeStyle = isCur ? 'rgba(255,42,58,0.9)' : vis ? 'rgba(232,226,212,0.8)' : 'rgba(232,226,212,0.45)';
        g.setLineDash(vis || isCur ? [] : [4, 3]);
        g.lineWidth = 1;
        g.strokeRect(x, y, w, h);
        g.setLineDash([]);
        if (r.safe && vis) { g.strokeStyle = 'rgba(232,226,212,0.8)'; g.strokeRect(x + w - 9, y + 4, 5, 5); }
        if ((vis || isCur) && w > 38 && h > 14) {
          g.font = `500 ${s > 14 ? 10 : 9}px "L7 Mono", monospace`;
          g.fillStyle = isCur ? '#e8e2d4' : 'rgba(143,139,128,0.95)';
          const words = r.name.split(' ');
          let label = r.name;
          if (g.measureText(label).width > w - 8) label = words[0];
          if (g.measureText(label).width <= w - 8) g.fillText(label, x + 4, y + 12);
        }
      }
      // door ticks
      for (const d of DOORS) {
        const st = doorState(d);
        if (!st) continue;
        const x = cx + (d.x + 0.5) * s, y = cy + (d.z + 0.5) * s, r = Math.max(3, s * 0.32);
        const col = st === 'open' ? '#6fc3c9' : st === 'item' || st === 'locked' ? '#e0c85a' : '#ff2a3a';
        g.fillStyle = '#07080a'; g.fillRect(x - r - 1, y - r - 1, r * 2 + 2, r * 2 + 2);
        g.strokeStyle = col; g.lineWidth = 1;
        g.strokeRect(Math.round(x - r) + 0.5, Math.round(y - r) + 0.5, Math.round(r * 2), Math.round(r * 2));
        if (st === 'open') { g.fillStyle = col; g.fillRect(Math.round(x - r / 2), Math.round(y - r / 2), Math.round(r), Math.round(r)); }
        else if (st === 'item' || st === 'locked') { g.fillStyle = col; g.fillRect(Math.round(x - 1), Math.round(y - r + 2), 2, Math.round(r * 2 - 4)); g.fillRect(Math.round(x - 1), Math.round(y + r - 4), 4, 2); g.beginPath(); g.arc(x, y - r / 2, 1.8, 0, 7); g.fill(); }
        else { g.beginPath(); g.moveTo(x - r + 2, y - r + 2); g.lineTo(x + r - 2, y + r - 2); g.moveTo(x + r - 2, y - r + 2); g.lineTo(x - r + 2, y + r - 2); g.stroke(); }
      }
      // markers
      for (const m of map.markers || []) {
        const x = cx + m.x * s, y = cy + m.z * s;
        g.strokeStyle = g.fillStyle = 'rgba(232,226,212,0.85)';
        if (m.kind === 'save') g.strokeRect(Math.round(x - 3) + 0.5, Math.round(y - 3) + 0.5, 6, 6);
        else if (m.kind === 'fixture') { g.beginPath(); g.moveTo(x, y - 3); g.lineTo(x + 3, y); g.lineTo(x, y + 3); g.lineTo(x - 3, y); g.closePath(); g.stroke(); }
        else g.fillRect(Math.round(x - 1), Math.round(y - 1), 2, 2);
      }
      // Wren: bone triangle, blinking at 2 Hz
      if (Math.floor(t * 4) % 2 === 0 && ctx.player && ctx.player.pos) {
        const px = cx + ctx.player.pos.x * s, pz = cy + ctx.player.pos.z * s;
        g.save(); g.translate(px, pz); g.rotate(-ctx.player.yaw + Math.PI);
        g.fillStyle = '#e8e2d4'; g.strokeStyle = '#07080a'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.stroke(); g.fill();
        g.restore();
      }
      $('.mp-scale', v.el).textContent = `ZOOM ${ZOOMS[zi].toFixed(1)}× · 1 SQ = 1 M`;
    };
    const roomAt = (mx, my) => {
      const { s, cx, cy } = view();
      const x = (mx - cx) / s, z = (my - cy) / s;
      for (const [k, r] of Object.entries(ROOMS)) if (known(k) && x >= r.x0 && x < r.x1 + 1 && z >= r.z0 && z < r.z1 + 1) return k;
      return null;
    };
    cv.addEventListener('mousemove', (e) => {
      const b = cv.getBoundingClientRect();
      const k = roomAt(e.clientX - b.left, e.clientY - b.top);
      if (k !== hover) { hover = k; hoverNm.textContent = k ? ROOMS[k].name : '—'; }
    });
    cv.addEventListener('mouseleave', () => { hover = null; hoverNm.textContent = '—'; });
    cv.addEventListener('mousedown', (e) => { if (e.button === 0) dragging = { x: e.clientX, y: e.clientY }; });
    const mm = (e) => { if (!dragging) return; panX += e.clientX - dragging.x; panY += e.clientY - dragging.y; dragging.x = e.clientX; dragging.y = e.clientY; };
    const mu = () => { dragging = null; };
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const nz = clamp(zi + (e.deltaY < 0 ? 1 : -1), 0, ZOOMS.length - 1);
      if (nz === zi) return;
      const b = cv.getBoundingClientRect();
      const mx = e.clientX - b.left, my = e.clientY - b.top;
      const before = view();
      const wx = (mx - before.cx) / before.s, wz = (my - before.cy) / before.s;
      zi = nz;
      const after = view();
      panX += mx - (after.cx + wx * after.s); panY += my - (after.cy + wz * after.s);
      audio.click(0, 2200, 0.12);
    }, { passive: false });
    v.mounted = () => {
      size();
      // start with the current room in view
      if (ROOMS[cur]) {
        const r = ROOMS[cur], { s, cx, cy } = view();
        const rx = cx + ((r.x0 + r.x1 + 1) / 2) * s, ry = cy + ((r.z0 + r.z1 + 1) / 2) * s;
        if (rx < 40 || rx > W - 40) panX += W / 2 - rx;
        if (ry < 40 || ry > H - 40) panY += H / 2 - ry;
      }
      draw();
    };
    v.update = (dt, k) => {
      t += dt;
      if (!W) return;
      if (k.left) panX += 40; if (k.right) panX -= 40;
      if (k.up) panY += 40; if (k.down) panY -= 40;
      if (wrap.clientWidth !== W || wrap.clientHeight !== H) size();
      draw();
    };
    v.destroy = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    return v;
  }

  // ---------------------------------------------------------------- FILES tab
  osFiles(ctx) {
    const ui = this;
    const files = (ctx.inv.files || []).filter((id) => FILES[id]);
    const v = { el: el('div', 'fl'), help: `click a file <i></i> wheel scroll <i></i> ${K('↑')}${K('↓')} select <i></i> ${K('Q')}${K('E')} tab` };
    v.el.innerHTML = `<div class="fl-index"><div class="fl-cats"></div><div class="fl-list"></div><div class="fl-count mono"></div></div><div class="fl-reader"><div class="fl-scroll"></div><div class="fl-foot"><span class="pg mono"></span><span class="where"></span></div></div>`;
    const cats = ['all', ...['circular', 'note', 'log', 'book'].filter((t) => files.some((id) => fileType(id) === t))];
    let cat = 'all', sel = files.length ? files[files.length - 1] : null;
    const listEl = $('.fl-list', v.el), scroll = $('.fl-scroll', v.el), pg = $('.pg', v.el);
    const shown = () => files.filter((id) => cat === 'all' || fileType(id) === cat);
    const renderCats = () => {
      const c = $('.fl-cats', v.el);
      c.innerHTML = '';
      for (const t of cats) {
        const d = clickable(el('div', 'cat' + (t === cat ? ' sel' : ''), t === 'all' ? 'ALL' : TYPE_LABEL[t]));
        d.addEventListener('click', () => { cat = t; audio.uiMove(); const s = shown(); if (!s.includes(sel)) sel = s[0] || null; renderCats(); renderList(); renderDoc(); });
        c.appendChild(d);
      }
    };
    const renderList = () => {
      listEl.innerHTML = '';
      const s = shown();
      if (!s.length) listEl.appendChild(el('div', 'empty', 'No files recovered.'));
      for (const id of s) {
        const d = clickable(el('div', 'f' + (id === sel ? ' sel' : '') + (ui.readFiles.has(id) ? '' : ' unread')));
        d.innerHTML = `<span class="dot"></span><span class="c">${esc(fileCode(id))}</span><span class="t">${esc(FILES[id].title)}</span>`;
        d.addEventListener('click', () => { if (sel !== id) { sel = id; audio.uiMove(); renderList(); renderDoc(); } });
        listEl.appendChild(d);
      }
      $('.fl-count', v.el).textContent = `${pad(files.length)} FILED · ${pad(Object.keys(FILES).length)} INDEXED`;
    };
    const renderDoc = () => {
      if (!sel) { scroll.innerHTML = '<div class="fl-none">NO DOCUMENT SELECTED</div>'; pg.textContent = ''; $('.where', v.el).textContent = ''; return; }
      scroll.innerHTML = ui.readerHTML(sel);
      scroll.scrollTop = 0;
      $('.where', v.el).textContent = (FILES[sel].where || '').toUpperCase();
      ui.readFiles.add(sel);
      persist('lethe7-read', [...ui.readFiles]);
      requestAnimationFrame(page);
    };
    const page = () => {
      const n = Math.max(1, Math.ceil(scroll.scrollHeight / Math.max(1, scroll.clientHeight) - 0.02));
      const i = Math.min(n, Math.floor(scroll.scrollTop / Math.max(1, scroll.clientHeight) + 0.02) + 1);
      pg.textContent = sel ? `PG ${i}/${n}` : '';
    };
    scroll.addEventListener('scroll', page);
    renderCats(); renderList(); renderDoc();
    v.update = (dt, k) => {
      const s = shown();
      if (s.length && (k.up || k.down)) {
        const i = s.indexOf(sel);
        sel = s[(i + (k.up ? -1 : 1) + s.length) % s.length];
        audio.uiMove(); renderList(); renderDoc();
      }
      if (k.right) scroll.scrollTop += 80;
      if (k.left) scroll.scrollTop -= 80;
    };
    return v;
  }

  // ---------------------------------------------------------------- RECEIVER tab
  osReceiver(ctx) {
    const R = ctx.radio;
    const v = { el: el('div', 'rx'), help: `drag the dial or wheel to tune <i></i> ${K('Shift')} + wheel fine <i></i> ${K('←')}${K('→')} step` };
    const [lo, hi] = R.band || [20, 200];
    v.el.innerHTML = `
      <div class="rx-top">
        <div class="rx-freq"><span class="lbl">TUNED</span><span class="num mono"></span><span class="unit">kHz</span></div>
        <div class="rx-lamps"><div class="lamp carrier"><i></i>CARRIER</div><div class="lamp payload"><i></i>PAYLOAD</div><div class="lamp power"><i></i>POWER</div></div>
        <div class="rx-meter"><span class="lbl">SIGNAL</span><span class="bars"></span></div>
      </div>
      <div class="rx-dial"><canvas data-click></canvas></div>
      <div class="rx-fall"><canvas width="360" height="72"></canvas><span class="cap">WATERFALL · ${lo}–${hi} kHz</span></div>
      <div class="rx-decode"><div class="lbl">DECODE</div><div class="txt mono"></div></div>`;
    const dialWrap = $('.rx-dial', v.el), dial = $('.rx-dial canvas', v.el), dg = dial.getContext('2d');
    const fall = $('.rx-fall canvas', v.el), fg = fall.getContext('2d');
    const numEl = $('.rx-freq .num', v.el), barsEl = $('.rx-meter .bars', v.el), decEl = $('.rx-decode .txt', v.el);
    fg.fillStyle = '#07080a'; fg.fillRect(0, 0, fall.width, fall.height);
    let DW = 0, DH = 0, dpr = 1, typed = 0, lastLock = null;
    const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); DW = dialWrap.clientWidth; DH = dialWrap.clientHeight; dial.width = Math.round(DW * dpr); dial.height = Math.round(DH * dpr); dial.style.width = DW + 'px'; dial.style.height = DH + 'px'; };
    const fx = (f) => 20 + (f - lo) / (hi - lo) * (DW - 40);
    const setF = (f) => { f = clamp(f, lo, hi); if (R.setFreq) R.setFreq(f); else R.freq = f; };
    const strengthAt = (f) => {
      const st = safe(() => (R.stations ? R.stations() : []), []) || [];
      let best = 0;
      for (const s of st) { const d = Math.abs(s.f - f); best = Math.max(best, (s.strength ?? 1) * Math.max(0, 1 - d / 4)); }
      return best;
    };
    let dragging = false;
    const tuneAt = (clientX) => { const b = dial.getBoundingClientRect(); setF(lo + clamp((clientX - b.left - 20) / (DW - 40), 0, 1) * (hi - lo)); };
    dial.addEventListener('mousedown', (e) => { if (e.button === 0) { dragging = true; tuneAt(e.clientX); } });
    const mm = (e) => { if (dragging) tuneAt(e.clientX); };
    const mu = () => { dragging = false; };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    v.el.addEventListener('wheel', (e) => { e.preventDefault(); const d = (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1); if (R.step) R.step(d); else setF((R.freq || lo) + d); }, { passive: false });
    const drawDial = () => {
      const g = dg;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0b0d0f'; g.fillRect(0, 0, DW, DH);
      // restricted Undertone band below 40 kHz
      const ux = fx(Math.min(40, hi));
      g.save(); g.beginPath(); g.rect(fx(lo), 8, ux - fx(lo), DH - 22); g.clip();
      g.strokeStyle = 'rgba(255,42,58,0.22)';
      for (let q = -DH; q < ux; q += 5) { g.beginPath(); g.moveTo(q, DH); g.lineTo(q + DH, 0); g.stroke(); }
      g.restore();
      g.fillStyle = 'rgba(255,42,58,0.8)'; g.font = '500 9px "L7 Mono", monospace';
      g.fillText('UNDERTONE', fx(lo) + 3, 19);
      g.fillStyle = 'rgba(232,226,212,0.5)'; g.fillRect(fx(lo), DH - 22, fx(hi) - fx(lo), 1);
      for (let f = Math.ceil(lo / 5) * 5; f <= hi; f += 5) {
        const x = Math.round(fx(f)) + 0.5, major = f % 20 === 0;
        g.fillStyle = major ? 'rgba(232,226,212,0.85)' : 'rgba(232,226,212,0.35)';
        g.fillRect(Math.floor(x), DH - 22 - (major ? 10 : 5), 1, major ? 10 : 5);
        if (major) { g.fillStyle = 'rgba(143,139,128,1)'; g.textAlign = 'center'; g.fillText(String(f), x, DH - 7); g.textAlign = 'left'; }
      }
      const x = Math.round(fx(R.freq ?? lo));
      g.fillStyle = '#ff2a3a'; g.fillRect(x, 6, 2, DH - 22);
      g.beginPath(); g.moveTo(x - 4, 4); g.lineTo(x + 6, 4); g.lineTo(x + 1, 10); g.closePath(); g.fill();
    };
    const rowImg = fg.createImageData(fall.width, 1);
    const drawFall = () => {
      fg.drawImage(fall, 0, 0, fall.width, fall.height - 1, 0, 1, fall.width, fall.height - 1);
      const d = rowImg.data;
      for (let x = 0; x < fall.width; x++) {
        const f = lo + (x / (fall.width - 1)) * (hi - lo);
        const near = 0.22 + 0.78 * Math.exp(-Math.abs(f - (R.freq ?? lo)) / 16);
        let e = strengthAt(f) * 0.9 * near + Math.random() * 0.22 + (f < 40 ? 0.12 : 0);
        e += (BAYER8[(x & 7)] - 0.5) * 0.2;
        const q = e < 0.25 ? 0 : e < 0.45 ? 1 : e < 0.7 ? 2 : 3;
        const col = [[7, 8, 10], [46, 93, 97], [111, 195, 201], [232, 226, 212]][q];
        const i = x * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
      fg.putImageData(rowImg, 0, 0);
      const nx = Math.round(((R.freq ?? lo) - lo) / (hi - lo) * (fall.width - 1));
      fg.fillStyle = 'rgba(255,42,58,0.7)'; fg.fillRect(nx, 0, 1, 1);
    };
    v.mounted = () => { size(); for (let i = 0; i < fall.height; i++) drawFall(); };
    v.update = (dt, k) => {
      if (!DW) size();
      if (k.left) { if (R.step) R.step(-1); else setF((R.freq || lo) - 1); }
      if (k.right) { if (R.step) R.step(1); else setF((R.freq || lo) + 1); }
      const f = R.freq ?? lo;
      numEl.textContent = f.toFixed(1).padStart(5, '0');
      const sgl = R.on === false ? 0 : strengthAt(f);
      const lock = R.on === false ? null : R.lock;
      $('.lamp.power', v.el).classList.toggle('on', R.on !== false);
      $('.lamp.carrier', v.el).classList.toggle('on', sgl > 0.3);
      $('.lamp.payload', v.el).classList.toggle('on', !!lock);
      const nb = Math.round(sgl * 5);
      barsEl.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < nb ? 'on' : ''}"></i>`).join('');
      if (lock !== lastLock) { lastLock = lock; typed = 0; }
      if (lock && lock.text) { typed = Math.min(lock.text.length, typed + dt * 24); decEl.textContent = lock.text.slice(0, Math.floor(typed)); }
      else decEl.textContent = R.on === false ? 'RECEIVER OFF' : '···';
      drawDial();
      drawFall();
    };
    v.destroy = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
    return v;
  }

  // ================================================================ STORAGE (pneumatic locker)
  storage(ctx) {
    const inv = ctx.inv;
    const capacity = ctx.capacity || 24;
    const root = el('div', 'screen os-screen');
    const p = el('div', 'os locker');
    p.innerHTML = `<header class="os-head"><div class="os-brand"><span class="os-mark">L7</span><span class="os-name">PNEUMATIC LOCKER <span class="ru">${GLOSS.STORAGE}</span></span></div><div class="os-meta"><span>TUBE NETWORK · DECK 2</span></div><div class="os-close" data-click title="Close">CLOSE<i></i></div></header>
      <div class="lk-body">
        <div class="lk-col carried"><div class="lbl">CARRIED <span class="sub">6 CLIP POINTS</span></div><div class="lk-slots"></div></div>
        <div class="lk-mid"><span class="arrow">◂</span><span class="tube"></span><span class="arrow">▸</span></div>
        <div class="lk-col locker"><div class="lbl">LOCKER <span class="sub">SHARED ACROSS THE STATION</span></div><div class="lk-grid"></div></div>
      </div>
      <div class="lk-info"><div class="nm"></div><div class="ds"></div></div>
      <footer class="os-foot"><div class="os-help">click move <i></i> drag between panes <i></i> ${MB('R', '')} / ${K('Esc')} close</div><div class="os-log"></div><div class="os-code">L7-OS / STR-24</div></footer>`;
    root.appendChild(p);
    const modal = { el: root, os: true };
    $('.os-close', p).addEventListener('click', () => { audio.uiBack(); modal.resolve(); });
    const slotsEl = $('.lk-slots', p), gridEl = $('.lk-grid', p), logEl = $('.os-log', p);
    let col = 0, iSel = 0, bSel = 0, hover = null;
    const log = (html) => { logEl.innerHTML = `<span class="ts">${this.clock()}</span>${html}`; };
    modal.onToast = log;
    const cell = (item, i, which) => {
      const d = clickable(el('div', 'slot' + (item ? '' : ' empty')));
      d.innerHTML = '<canvas class="th"></canvas><span class="qty mono"></span>';
      const selNow = which === 'c' ? col === 0 && i === iSel : col === 1 && i === bSel;
      d.classList.toggle('sel', selNow);
      d.dataset.w = which; d.dataset.i = i;
      if (item) {
        const def = itemDef(item.id);
        requestAnimationFrame(() => {
          const px = Math.max(20, Math.floor(d.clientWidth / 2));
          const cv = $('.th', d); cv.width = px; cv.height = px;
          const th = itemThumb(item.id, px) || safe(() => drawIcon(item.id), null);
          if (th) { const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(th, 0, 0, px, px); }
        });
        $('.qty', d).textContent = def.kind === 'weapon' && item.loaded !== undefined ? pad(item.loaded) : def.stack > 1 ? '×' + item.qty : '';
      }
      d.addEventListener('mouseenter', () => { hover = item; info(item); });
      d.addEventListener('mouseleave', () => { hover = null; info(which === 'c' ? inv.slots[iSel] : inv.box[bSel]); });
      d.addEventListener('click', () => { if (dragEnded) return; if (which === 'c') { col = 0; iSel = i; } else { col = 1; bSel = i; } move(); });
      d.addEventListener('mousedown', (e) => { if (e.button === 0 && item) drag = { which, i, x: e.clientX, y: e.clientY, on: false }; });
      return d;
    };
    const info = (item) => {
      $('.lk-info .nm', p).textContent = item ? itemDef(item.id).name : '';
      $('.lk-info .ds', p).textContent = item ? itemDef(item.id).desc : '';
    };
    let flash = null;
    const render = () => {
      slotsEl.innerHTML = '';
      inv.slots.forEach((s, i) => slotsEl.appendChild(cell(s, i, 'c')));
      gridEl.innerHTML = '';
      const n = Math.max(capacity, Math.ceil(inv.box.length / 4) * 4);
      for (let j = 0; j < n; j++) gridEl.appendChild(cell(inv.box[j] || null, j, 'b'));
      if (flash) {
        const d = flash.w === 'c' ? slotsEl.children[flash.i] : gridEl.children[flash.i];
        if (d) d.classList.add('flash');
        flash = null;
      }
      info(hover || (col === 0 ? inv.slots[iSel] : inv.box[bSel]));
    };
    const move = () => {
      if (col === 0) {
        const s = inv.slots[iSel];
        if (!s) { audio.uiBack(); render(); return; }
        const mergeable = inv.box.some((b) => b.id === s.id && itemDef(s.id).stack > 1);
        if (inv.box.length >= capacity && !mergeable) { audio.locked(); log('LOCKER FULL'); render(); return; }
        const name = itemDef(s.id).name;
        inv.store(iSel);
        const j = inv.box.findIndex((b) => b.id === s.id);
        flash = { w: 'b', i: j >= 0 ? j : inv.box.length - 1 };
        audio.thud(0.25, 90); audio.click(0.03, 2000, 0.2);
        log(`STORED — <b>${esc(name)}</b>`);
      } else {
        const b = inv.box[bSel];
        if (!b) { audio.uiBack(); render(); return; }
        const name = itemDef(b.id).name, id = b.id;
        if (inv.retrieve(bSel)) {
          audio.thud(0.25, 90); audio.click(0.03, 2000, 0.2);
          const i = inv.slots.findIndex((s) => s && s.id === id);
          flash = { w: 'c', i };
          log(`RETRIEVED — <b>${esc(name)}</b>`);
        } else { audio.locked(); log('NO FREE CLIP POINT'); }
        bSel = Math.min(bSel, Math.max(0, inv.box.length - 1));
      }
      render();
    };
    let drag = null, dragEnded = false, ghost = null;
    const mm = (e) => {
      if (!drag) return;
      if (!drag.on && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
        drag.on = true;
        const src = (drag.which === 'c' ? slotsEl : gridEl).children[drag.i];
        const th = $('.th', src);
        ghost = el('canvas', 'drag-ghost'); ghost.width = th.width; ghost.height = th.height;
        ghost.getContext('2d').drawImage(th, 0, 0);
        document.body.appendChild(ghost);
        src.classList.add('dragging');
      }
      if (drag.on) {
        ghost.style.transform = `translate(${e.clientX - ghost.offsetWidth / 2}px, ${e.clientY - ghost.offsetHeight / 2}px)`;
        const t = document.elementFromPoint(e.clientX, e.clientY);
        p.querySelectorAll('.lk-col').forEach((c) => c.classList.toggle('drop', !!t && c.contains(t) && !c.classList.contains(drag.which === 'c' ? 'carried' : 'locker')));
      }
    };
    const mu = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      if (!d.on) return;
      if (ghost) { ghost.remove(); ghost = null; }
      dragEnded = true; setTimeout(() => { dragEnded = false; }, 0);
      p.querySelectorAll('.lk-col').forEach((c) => c.classList.remove('drop'));
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const toLocker = t && $('.locker', p).contains(t), toCarried = t && $('.carried', p).contains(t);
      if (d.which === 'c' && toLocker) { col = 0; iSel = d.i; move(); }
      else if (d.which === 'b' && toCarried) { col = 1; bSel = d.i; move(); }
      else render();
    };
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    modal.onClose = () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); if (ghost) ghost.remove(); };
    modal.update = (input, dt, k) => {
      if (k.back) { audio.uiBack(); modal.resolve(); return; }
      let moved = false;
      if (col === 0) {
        if (k.up) { iSel = (iSel + SLOTS - 1) % SLOTS; moved = true; }
        if (k.down) { iSel = (iSel + 1) % SLOTS; moved = true; }
        if (k.right) { col = 1; moved = true; }
      } else {
        const n = gridEl.children.length;
        if (k.left) { if (bSel % 4 === 0) col = 0; else bSel--; moved = true; }
        if (k.right) { bSel = Math.min(n - 1, bSel + 1); moved = true; }
        if (k.up) { bSel = Math.max(0, bSel - 4); moved = true; }
        if (k.down) { bSel = Math.min(n - 1, bSel + 4); moved = true; }
      }
      if (moved) { audio.uiMove(); render(); }
      if (k.confirm) move();
    };
    render();
    audio.click(0, 2400, 0.2);
    audio.uiSelect();
    return this.open(modal);
  }

  // ================================================================ DEVICE FACES
  deviceScreen(cls, inner, help) {
    const root = el('div', 'screen dev-screen shade');
    const d = el('div', 'device ' + cls);
    d.innerHTML = `<i class="screw tl"></i><i class="screw tr"></i><i class="screw bl"></i><i class="screw br"></i>${inner}`;
    root.appendChild(d);
    const foot = el('div', 'dev-foot');
    const back = clickable(el('div', 'btn dev-back', 'STEP BACK'));
    foot.appendChild(back);
    foot.appendChild(el('div', 'dev-help', help));
    root.appendChild(foot);
    root.back = back;
    return [root, d];
  }

  keypad(code) {
    const [root, d] = this.deviceScreen('kp', `
      <div class="dv-label"><span>ACCESS CONTROL</span><span class="ru">ДОСТУП</span></div>
      <div class="kp-disp"><canvas width="200" height="56"></canvas><span class="kp-led"></span></div>
      <div class="kp-grid"></div>
      <div class="dv-plate mono">UNIT K-4 · 4 DIGIT</div>`,
    `click keys <i></i> ${K('0')}–${K('9')} enter <i></i> ${K('Backspace')} clear <i></i> ${MB('R', '')} / ${K('Esc')} step back`);
    const cv = $('canvas', d), g = cv.getContext('2d');
    const led = $('.kp-led', d);
    const grid = $('.kp-grid', d);
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'OK'];
    let sel = 4, entry = '', locked = false, mode = 'entry';
    const keyEls = keys.map((kk, i) => {
      const b = clickable(el('div', 'kp-key' + (kk === 'OK' ? ' ok' : kk === 'CLR' ? ' clr' : ''), `<span>${kk}</span>`));
      b.addEventListener('mousedown', (e) => { if (e.button === 0) { sel = i; press(kk); } });
      grid.appendChild(b);
      return b;
    });
    const modal = { el: root };
    root.back.addEventListener('click', () => { audio.uiBack(); modal.resolve(false); });
    const paint = () => {
      keyEls.forEach((e, i) => e.classList.toggle('sel', i === sel));
      if (mode === 'deny') drawSeg(g, 'dEnY', '#ff2a3a', '#1e0709', cv.width, cv.height);
      else if (mode === 'open') drawSeg(g, 'OPEn', '#6fc3c9', '#0c1d1f', cv.width, cv.height);
      else drawSeg(g, (entry + '____').slice(0, 4), '#ff2a3a', '#1e0709', cv.width, cv.height);
      led.className = 'kp-led ' + mode;
    };
    const tapKey = (i) => { const e = keyEls[i]; e.classList.remove('down'); void e.offsetWidth; e.classList.add('down'); };
    const press = (kk) => {
      if (locked) return;
      tapKey(keys.indexOf(kk));
      if (kk === 'CLR') { entry = ''; audio.click(0, 1400, 0.25); }
      else if (kk === 'OK') submit();
      else if (entry.length < 4) {
        entry += kk;
        audio.click(0, 2200 + Number(kk) * 90, 0.3);
        if (entry.length === 4) setTimeout(submit, 260);
      }
      paint();
    };
    const submit = () => {
      if (locked) return;
      locked = true;
      if (entry === code) { mode = 'open'; audio.uiSelect(); setTimeout(() => modal.resolve(true), 700); }
      else { mode = 'deny'; audio.locked(); setTimeout(() => { entry = ''; locked = false; mode = 'entry'; paint(); }, 750); }
      paint();
    };
    modal.update = (input, dt, k) => {
      if (k.back && !input.hit('Backspace')) { audio.uiBack(); modal.resolve(false); return; }
      for (let n = 0; n <= 9; n++) if (input.hit('Digit' + n, 'Numpad' + n)) press(String(n));
      if (input.hit('Backspace')) press('CLR');
      let m = false;
      if (k.left) { sel = (sel + 11) % 12; m = true; }
      if (k.right) { sel = (sel + 1) % 12; m = true; }
      if (k.up) { sel = (sel + 9) % 12; m = true; }
      if (k.down) { sel = (sel + 3) % 12; m = true; }
      if (m) { audio.uiMove(); paint(); }
      if (input.hit('Enter', 'KeyE', 'Space', 'NumpadEnter') || input.padEdge.has('a')) press(keys[sel]);
    };
    paint();
    audio.click(0, 1600, 0.25);
    return this.open(modal);
  }

  relay(state) {
    // 5 lamps, 4 levers. Each lever flips a fixed set of lamps.
    const FLIPS = [[0, 1], [1, 2, 3], [3, 4], [0, 4]];
    const [root, d] = this.deviceScreen('rl', `
      <div class="dv-label"><span>MAIN BUS · REDISTRIBUTION</span><span class="ru">ШИНА</span></div>
      <div class="rl-lamps"></div>
      <svg class="rl-wires" viewBox="0 0 400 70" preserveAspectRatio="none"></svg>
      <div class="rl-levers"></div>
      <div class="rl-status mono"></div>
      <div class="dv-plate mono">ALL FIVE LINES MUST CARRY LOAD</div>`,
    `click or drag a lever <i></i> ${K('1')}–${K('4')} throw <i></i> ${K('←')}${K('→')} select <i></i> ${MB('R', '')} / ${K('Esc')} step back`);
    const lampsEl = $('.rl-lamps', d), leversEl = $('.rl-levers', d), wires = $('.rl-wires', d), status = $('.rl-status', d);
    const lampEls = [0, 1, 2, 3, 4].map((i) => { const l = el('div', 'lamp', `<i></i><span>${i + 1}</span>`); lampsEl.appendChild(l); return l; });
    // bus wiring: lever columns at 12.5/37.5/62.5/87.5 %, lamps at 10/30/50/70/90 %
    const LX = [50, 150, 250, 350], PX = [40, 120, 200, 280, 360];
    wires.innerHTML = FLIPS.map((f, i) => f.map((p) => `<path d="M${LX[i]} 70 V${38 - i * 7} H${PX[p]} V0" />`).join('')).join('');
    let sel = 0, solved = false;
    const modal = { el: root };
    root.back.addEventListener('click', () => { audio.uiBack(); modal.resolve(false); });
    const lamps = () => {
      const on = [false, false, true, false, false];
      state.levers.forEach((up, i) => { if (up) FLIPS[i].forEach((kk) => { on[kk] = !on[kk]; }); });
      return on;
    };
    const leverEls = [0, 1, 2, 3].map((i) => {
      const l = clickable(el('div', 'lever', `<div class="track"><div class="handle"><i></i></div></div><div class="n">${'ABCD'[i]}</div><div class="pos mono"></div>`));
      let dy = null;
      l.addEventListener('mousedown', (e) => { if (e.button === 0) { sel = i; dy = { y: e.clientY, moved: false }; render(); } });
      l.addEventListener('mousemove', (e) => {
        if (!dy || !(e.buttons & 1)) return;
        const want = e.clientY < dy.y - 14 ? true : e.clientY > dy.y + 14 ? false : null;
        if (want !== null && want !== !!state.levers[i]) { dy.moved = true; flip(i); dy.y = e.clientY; }
      });
      l.addEventListener('mouseup', () => { if (dy && !dy.moved) flip(i); dy = null; });
      l.addEventListener('mouseleave', () => { dy = null; });
      leversEl.appendChild(l);
      return l;
    });
    const render = () => {
      const on = lamps();
      lampEls.forEach((l, i) => l.classList.toggle('on', on[i]));
      leverEls.forEach((l, i) => { l.classList.toggle('up', !!state.levers[i]); l.classList.toggle('sel', i === sel); $('.pos', l).textContent = state.levers[i] ? 'UP' : 'DN'; });
      [...wires.children].forEach((w, k) => {
        let n = 0, li = 0; for (; li < FLIPS.length; li++) { if (k < n + FLIPS[li].length) break; n += FLIPS[li].length; }
        w.classList.toggle('live', !!state.levers[li]);
        w.classList.toggle('sel', li === sel);
      });
      const c = on.filter(Boolean).length;
      status.innerHTML = `LOAD <b>${c}</b> / 5 ${c === 5 ? '<span class="ok">· BALANCED</span>' : ''}`;
      return on.every(Boolean);
    };
    const flip = (i) => {
      if (solved) return;
      state.levers[i] = !state.levers[i];
      audio.thud(0.3, 110); audio.click(0.02, 1800, 0.3);
      if (render()) { solved = true; d.classList.add('solved'); audio.uiSelect(); setTimeout(() => modal.resolve(true), 900); }
    };
    modal.update = (input, dt, k) => {
      if (k.back) { audio.uiBack(); modal.resolve(false); return; }
      if (k.left) { sel = (sel + 3) % 4; audio.uiMove(); render(); }
      if (k.right) { sel = (sel + 1) % 4; audio.uiMove(); render(); }
      for (let n = 1; n <= 4; n++) if (input.hit('Digit' + n)) { sel = n - 1; flip(n - 1); }
      if (k.confirm) flip(sel);
    };
    render();
    audio.click(0, 1600, 0.25);
    return this.open(modal);
  }

  wave() {
    const TARGET = { f: 4, a: 3 };
    const [root, d] = this.deviceScreen('sc', `
      <div class="dv-label"><span>ARRAY · CARRIER ALIGNMENT</span><span class="ru">НЕСУЩАЯ</span></div>
      <div class="sc-screen"><canvas width="440" height="170"></canvas><span class="sc-cap mono">CH1 REF</span><span class="sc-cap2 mono">CH2 OUT</span></div>
      <div class="sc-ctl">
        <div class="knob-u" data-k="f"><div class="knob" data-click><div class="kn"><i></i></div></div><div class="kl">FREQUENCY</div><div class="kv mono"></div></div>
        <div class="knob-u" data-k="a"><div class="knob" data-click><div class="kn"><i></i></div></div><div class="kl">AMPLITUDE</div><div class="kv mono"></div></div>
        <div class="sc-lock"><div class="lamp"><i></i></div><div class="st mono"></div></div>
        <div class="btn tx" data-click>TRANSMIT</div>
      </div>
      <div class="dv-plate mono">MATCH THE REFERENCE TRACE</div>`,
    `drag a knob up or down, or use the wheel <i></i> ${K('↑')}${K('↓')} knob <i></i> ${K('←')}${K('→')} turn <i></i> ${K('Enter')} transmit`);
    const c = $('canvas', d), g = c.getContext('2d');
    const vals = { f: 7, a: 1 };
    const RANGE = { f: [1, 9], a: [1, 5] };
    let sel = 0, locked = false;
    const units = [...d.querySelectorAll('.knob-u')];
    const status = $('.sc-lock .st', d), lampEl = $('.sc-lock .lamp', d);
    const modal = { el: root };
    root.back.addEventListener('click', () => { audio.uiBack(); modal.resolve(false); });
    const keysOf = ['f', 'a'];
    const render = () => {
      units.forEach((u, i) => {
        const kk = keysOf[i], [a, b] = RANGE[kk];
        const ang = -135 + (vals[kk] - a) / (b - a) * 270;
        $('.kn', u).style.transform = `rotate(${ang}deg)`;
        $('.kv', u).textContent = pad(vals[kk]);
        u.classList.toggle('sel', i === sel);
        const ticks = $('.knob', u);
        if (!ticks.dataset.t) { ticks.dataset.t = 1; for (let s = a; s <= b; s++) { const t = el('i', 'tk'); t.style.transform = `rotate(${-135 + (s - a) / (b - a) * 270}deg)`; ticks.appendChild(t); } }
      });
      locked = vals.f === TARGET.f && vals.a === TARGET.a;
      status.textContent = locked ? 'CARRIER LOCKED' : 'SEARCHING';
      lampEl.classList.toggle('on', locked);
      $('.tx', d).classList.toggle('ready', locked);
    };
    const adj = (i, delta) => {
      const kk = keysOf[i], [a, b] = RANGE[kk];
      const nv = clamp(vals[kk] + delta, a, b);
      if (nv === vals[kk]) return;
      vals[kk] = nv;
      audio.click(0, 1500 + vals.f * 80 + vals.a * 30, 0.2);
      render();
    };
    units.forEach((u, i) => {
      const knob = $('.knob', u);
      let drag = null;
      knob.addEventListener('mousedown', (e) => { if (e.button === 0) { sel = i; drag = { y: e.clientY }; render(); } });
      u.addEventListener('wheel', (e) => { e.preventDefault(); sel = i; adj(i, e.deltaY < 0 ? 1 : -1); }, { passive: false });
      u._mm = (e) => { if (!drag) return; const dy = drag.y - e.clientY; if (Math.abs(dy) >= 14) { adj(i, Math.sign(dy)); drag.y = e.clientY; } };
      u._mu = () => { drag = null; };
      window.addEventListener('mousemove', u._mm); window.addEventListener('mouseup', u._mu);
    });
    const transmit = () => { if (locked) { audio.uiSelect(); modal.resolve(true); } else { audio.locked(); d.classList.remove('nope'); void d.offsetWidth; d.classList.add('nope'); } };
    $('.tx', d).addEventListener('click', transmit);
    modal.onClose = () => units.forEach((u) => { window.removeEventListener('mousemove', u._mm); window.removeEventListener('mouseup', u._mu); });
    let t = 0;
    const W = c.width, H = c.height, MY = H / 2;
    modal.update = (input, dt, k) => {
      t += dt;
      g.fillStyle = 'rgba(5,10,11,0.55)'; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(111,195,201,0.12)';
      for (let x = 0; x <= W; x += W / 10) g.fillRect(Math.round(x), 0, 1, H);
      for (let y = 0; y <= H; y += H / 6) g.fillRect(0, Math.round(y), W, 1);
      g.fillStyle = 'rgba(111,195,201,0.3)';
      g.fillRect(0, Math.round(MY), W, 1); g.fillRect(Math.round(W / 2), 0, 1, H);
      for (let x = 0; x < W; x += W / 50) g.fillRect(Math.round(x), Math.round(MY) - 2, 1, 5);
      const wave = (f, a, col, w, noise) => {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath();
        for (let x = 0; x <= W; x += 2) {
          const y = MY - Math.sin(x / W * Math.PI * 2 * f + t * 3) * a * (H / 12.5) + (noise ? (Math.random() - 0.5) * noise : 0);
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      wave(TARGET.f, TARGET.a, 'rgba(255,42,58,0.85)', 2, 5);
      wave(vals.f, vals.a, locked ? '#e8e2d4' : '#6fc3c9', 1.2, locked ? 0 : 1.5);
      if (k.back) { audio.uiBack(); modal.resolve(false); return; }
      if (k.up || k.down) { sel = 1 - sel; audio.uiMove(); render(); }
      if (k.left) adj(sel, -1);
      if (k.right) adj(sel, 1);
      if (k.confirm) transmit();
    };
    render();
    audio.click(0, 1600, 0.25);
    return this.open(modal);
  }
}
