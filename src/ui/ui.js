// DOM-based interface layer: HUD, dialogue, and every modal screen.
import * as THREE from 'three';
import { audio } from '../engine/audio.js';
import { ITEMS, SLOTS } from '../game/items.js';
import { FILES, MEMORIES, WHO } from '../game/story.js';
import { ROOMS, DOORS, GRID_W, GRID_H } from '../game/map.js';
import { drawIcon, drawMemory } from './art.js';
import { wireframeClone } from '../engine/characters.js';

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const iconCache = {};
const icon = (id) => {
  if (!iconCache[id]) iconCache[id] = drawIcon(id);
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  c.getContext('2d').drawImage(iconCache[id], 0, 0);
  return c;
};

// Keyboard/mouse list selector used by all menus.
class Menu {
  constructor(options, { onSelect, onMove, cls = 'menu' } = {}) {
    this.options = options;
    this.onSelect = onSelect;
    this.onMove = onMove;
    this.el = el('div', cls);
    this.i = options.findIndex((o) => !o.disabled);
    this.render();
  }
  render() {
    this.el.innerHTML = '';
    this.options.forEach((o, i) => {
      const d = el('div', 'opt' + (i === this.i ? ' sel' : '') + (o.disabled ? ' disabled' : ''), esc(o.label));
      d.onmouseenter = () => { if (!o.disabled && this.i !== i) { this.i = i; audio.uiMove(); this.render(); this.onMove && this.onMove(i); } };
      d.onclick = () => { if (!o.disabled) { this.i = i; this.select(); } };
      this.el.appendChild(d);
    });
  }
  move(d) {
    const n = this.options.length;
    let i = this.i;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      if (!this.options[i].disabled) break;
    }
    if (i !== this.i) { this.i = i; audio.uiMove(); this.render(); this.onMove && this.onMove(i); }
  }
  select() { audio.uiSelect(); this.onSelect && this.onSelect(this.options[this.i], this.i); }
  update(input) {
    if (input.up) this.move(-1);
    if (input.downNav) this.move(1);
    if (input.confirm) this.select();
  }
}

export class UI {
  constructor(input) {
    this.input = input;
    this.screens = $('#screens');
    this.hud = $('#hud');
    this.modal = null;
    this.dialogState = null;
    this.roomTimer = 0;
    this.settings = this.loadSettings();
  }

  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('lethe7-settings'));
      if (s) return { crt: true, res: 270, ...s };
    } catch (e) { /* no storage */ }
    return { crt: true, res: 270 };
  }
  saveSettings() {
    try { localStorage.setItem('lethe7-settings', JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  get busy() { return !!this.modal || !!this.dialogState; }

  // ---------------- HUD ----------------
  showHud(on) { this.hud.style.display = on ? '' : 'none'; }

  roomName(name) {
    const r = $('#roomName');
    $('.txt', r).textContent = name;
    r.classList.add('show', 'glitch');
    clearTimeout(this.roomTimeout);
    setTimeout(() => r.classList.remove('glitch'), 900);
    this.roomTimeout = setTimeout(() => r.classList.remove('show'), 3200);
  }

  prompt(text) {
    const p = $('#prompt');
    if (!text || this.busy) { p.classList.remove('show'); return; }
    $('.key', p).textContent = this.input.lastDevice === 'pad' ? 'A' : 'E';
    $('.txt', p).textContent = text;
    p.classList.add('show');
  }

  ammo(show, loaded = 0, reserve = 0) {
    const a = $('#ammo');
    a.classList.toggle('show', show && !this.busy);
    const l = $('.loaded', a);
    l.textContent = String(loaded).padStart(2, '0');
    l.classList.toggle('empty', loaded === 0);
    $('.reserve', a).textContent = `/ ${String(reserve).padStart(2, '0')}`;
  }

  toast(html) {
    const t = el('div', 'toast', html);
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 3400);
  }

  lowHp(level) { $('#lowhp').style.opacity = level; }

  // ---------------- dialogue ----------------
  say(lines, who = '') {
    if (!Array.isArray(lines)) lines = [lines];
    lines = lines.map((l) => (typeof l === 'string' ? { t: l, who } : { ...l, who: WHO[l.who] ?? l.who ?? who }));
    return new Promise((resolve) => {
      const box = $('#dialog');
      this.dialogState = { lines, i: 0, shown: 0, resolve, box, acc: 0 };
      box.classList.add('show');
      this.renderDialog();
      $('#prompt').classList.remove('show');
    });
  }

  renderDialog() {
    const s = this.dialogState;
    const line = s.lines[s.i];
    $('.who', s.box).textContent = line.who || '';
    $('.text', s.box).textContent = line.t.slice(0, Math.floor(s.shown));
    s.box.classList.toggle('done', s.shown >= line.t.length);
  }

  updateDialog(dt) {
    const s = this.dialogState;
    const line = s.lines[s.i];
    const before = Math.floor(s.shown);
    if (s.shown < line.t.length) {
      s.shown = Math.min(line.t.length, s.shown + dt * 48);
      if (Math.floor(s.shown) !== before && line.t[Math.floor(s.shown) - 1] !== ' ') audio.typeTick();
    }
    const adv = this.input.confirm || this.input.mouse.anyClick || this.input.hit('Escape');
    if (adv) {
      if (s.shown < line.t.length) s.shown = line.t.length;
      else {
        s.i++; s.shown = 0;
        audio.uiMove();
        if (s.i >= s.lines.length) {
          s.box.classList.remove('show');
          this.dialogState = null;
          s.resolve();
          return;
        }
      }
    }
    this.renderDialog();
  }

  // ---------------- modal plumbing ----------------
  open(modal) {
    return new Promise((resolve) => {
      modal.resolve = (v) => {
        if (this.modal !== modal) return;
        modal.el.remove();
        if (modal.onClose) modal.onClose();
        this.modal = null;
        resolve(v);
      };
      this.modal = modal;
      this.screens.appendChild(modal.el);
      $('#prompt').classList.remove('show');
      $('#ammo').classList.remove('show');
    });
  }

  update(dt) {
    if (this.dialogState) this.updateDialog(dt);
    else if (this.modal && this.modal.update) this.modal.update(this.input, dt);
  }

  // ---------------- boot / title ----------------
  boot() {
    return new Promise((resolve) => {
      const b = $('#boot');
      const go = () => {
        window.removeEventListener('keydown', go);
        b.removeEventListener('click', go);
        b.classList.add('gone');
        resolve();
      };
      window.addEventListener('keydown', go);
      b.addEventListener('click', go);
    });
  }

  title(hasSave) {
    const root = el('div', 'screen');
    const wrap = el('div', 'title-wrap');
    wrap.appendChild(el('div', 'title-logo', 'LETHE-7'));
    wrap.appendChild(el('div', 'title-sub', 'NO ONE WATCHES THE PLANET ALONE'));
    const modal = { el: root };
    const menu = new Menu([
      { label: 'NEW SIGNAL', value: 'new' },
      { label: 'CONTINUE', value: 'continue', disabled: !hasSave },
      { label: 'CONTROLS', value: 'controls' },
      { label: 'OPTIONS', value: 'options' },
    ], {
      onSelect: async (o) => {
        if (o.value === 'controls') { modal.sub = true; await this.controlsScreen(root); modal.sub = false; return; }
        if (o.value === 'options') { modal.sub = true; await this.optionsScreen(root); modal.sub = false; return; }
        modal.resolve(o.value);
      },
    });
    wrap.appendChild(menu.el);
    root.appendChild(wrap);
    root.appendChild(el('div', 'title-foot', 'An original survival-horror vertical slice. Made from scratch in code — every model, texture, sound and word.'));
    root.appendChild(el('div', 'title-ver', 'DECK 2 // HABITATION RING<br>BUILD 0.1'));
    modal.update = (input) => { if (!modal.sub) menu.update(input); };
    return this.open(modal);
  }

  controlsScreen(parent) {
    return new Promise((resolve) => {
      const p = el('div', 'panel sub-panel');
      p.style.position = 'absolute';
      p.innerHTML = `<div class="hdr red">CONTROLS</div>
      <div class="controls">
        <span class="k">WASD / ARROWS</span><span>Move</span>
        <span class="k">SHIFT</span><span>Run</span>
        <span class="k">RIGHT MOUSE / SPACE</span><span>Aim (mouse or WASD to turn)</span>
        <span class="k">LEFT MOUSE / F</span><span>Fire while aiming</span>
        <span class="k">R</span><span>Reload</span>
        <span class="k">E / ENTER</span><span>Examine · Interact · Confirm</span>
        <span class="k">TAB / I</span><span>Inventory</span>
        <span class="k">M</span><span>Map</span>
        <span class="k">ESC</span><span>Pause · Back</span>
        <span class="k">GAMEPAD</span><span>L-stick move · LT aim · RT fire · A interact · Select inventory</span>
      </div>
      <div class="hdr" style="margin-top:22px">[ESC] BACK</div>`;
      const holder = el('div', 'screen dim');
      holder.appendChild(p);
      parent.appendChild(holder);
      const prev = this.modal.update;
      this.modal.update = (input) => {
        if (input.back || input.confirm || input.mouse.anyClick) {
          audio.uiBack(); holder.remove(); this.modal.update = prev; resolve();
        }
      };
    });
  }

  optionsScreen(parent) {
    return new Promise((resolve) => {
      const holder = el('div', 'screen dim');
      const p = el('div', 'panel sub-panel');
      p.appendChild(el('div', 'hdr red', 'OPTIONS'));
      const resList = [240, 270, 360, 480];
      const build = () => [
        { label: `CRT FILTER ........ ${this.settings.crt ? 'ON' : 'OFF'}`, value: 'crt' },
        { label: `RESOLUTION ........ ${this.settings.res}p`, value: 'res' },
        { label: 'BACK', value: 'back' },
      ];
      const menu = new Menu(build(), {
        onSelect: (o) => {
          if (o.value === 'crt') this.settings.crt = !this.settings.crt;
          if (o.value === 'res') this.settings.res = resList[(resList.indexOf(this.settings.res) + 1) % resList.length];
          if (o.value === 'back') { holder.remove(); this.modal.update = prev; resolve(); return; }
          this.saveSettings();
          if (this.onSettings) this.onSettings(this.settings);
          const i = menu.i; menu.options = build(); menu.i = i; menu.render();
        },
      });
      p.appendChild(menu.el);
      holder.appendChild(p);
      parent.appendChild(holder);
      const prev = this.modal.update;
      this.modal.update = (input) => {
        if (input.back) { audio.uiBack(); holder.remove(); this.modal.update = prev; resolve(); return; }
        menu.update(input);
      };
    });
  }

  // ---------------- typed text screens ----------------
  typed(lines, { black = true, skippable = true, art = null } = {}) {
    const root = el('div', 'screen ' + (black ? 'black' : 'dim'));
    const wrap = el('div', 'typed');
    if (art) {
      const c = drawMemory(art);
      c.style.cssText = 'width:min(640px,80vw);image-rendering:pixelated;display:block;margin:0 auto 30px;animation:memIn 3s ease-out';
      wrap.appendChild(c);
    }
    root.appendChild(wrap);
    if (skippable) root.appendChild(el('div', 'skip', '[E] CONTINUE · [ESC] SKIP'));
    const modal = { el: root, passive: true };
    let i = 0, shown = 0, wait = 0.6, cur = null, done = false;
    modal.update = (input, dt) => {
      if (input.back && skippable) { modal.resolve(); return; }
      if (done) { if (input.confirm || input.mouse.anyClick) modal.resolve(); return; }
      if (wait > 0) {
        wait -= dt * ((input.confirm || input.mouse.anyClick) ? 20 : 1);
        return;
      }
      const L = lines[i];
      if (!cur) { cur = el('div', 'ln ' + (L.cls || '')); wrap.appendChild(cur); shown = 0; }
      const before = Math.floor(shown);
      shown += dt * (L.cls && L.cls.includes('voice') ? 30 : 55) * ((input.confirm || input.mouse.anyClick) ? 30 : 1);
      if (Math.floor(shown) > before && L.t[Math.floor(shown) - 1] && L.t[Math.floor(shown) - 1] !== ' ') audio.typeTick();
      cur.textContent = L.t.slice(0, Math.floor(shown));
      if (shown >= L.t.length) {
        cur = null; i++;
        wait = (L.pause || 250) / 1000;
        if (i >= lines.length) { done = true; root.querySelector('.skip') && (root.querySelector('.skip').textContent = '[E] CONTINUE'); }
      }
    };
    return this.open(modal);
  }

  // ---------------- document ----------------
  document(id, isNew = true) {
    const f = FILES[id];
    const root = el('div', 'screen dim');
    const p = el('div', 'panel doc fade-in');
    p.innerHTML = `<div class="title">${esc(f.title)}</div><div class="where">${isNew ? 'FILE ADDED — ' : ''}${esc(f.where.toUpperCase())}</div><div class="body">${esc(f.body)}</div><div class="foot">[E] CLOSE</div>`;
    root.appendChild(p);
    const modal = { el: root, passive: true };
    modal.update = (input) => {
      if (input.up) p.scrollTop -= 40;
      if (input.downNav) p.scrollTop += 40;
      if (input.confirm || input.back || input.mouse.anyClick) { audio.uiBack(); modal.resolve(); }
    };
    audio.uiSelect();
    return this.open(modal);
  }

  // ---------------- memory ----------------
  memory(key) {
    const m = MEMORIES[key];
    const root = el('div', 'screen black memory');
    root.appendChild(el('div', 'mtitle', esc(m.title)));
    root.appendChild(drawMemory(m.art));
    const line = el('div', 'mline');
    root.appendChild(line);
    const modal = { el: root, passive: true };
    let i = -1, shown = 0, wait = 2.0;
    const next = () => { i++; shown = 0; };
    modal.update = (input, dt) => {
      if (wait > 0) { wait -= dt; if (wait <= 0) next(); return; }
      if (i >= m.lines.length) { modal.resolve(); return; }
      const L = m.lines[i];
      const before = Math.floor(shown);
      shown = Math.min(L.t.length, shown + dt * 30);
      if (Math.floor(shown) > before) audio.typeTick();
      line.innerHTML = (L.who ? `<span class="w">${WHO[L.who]}</span>` : '<span class="w">&nbsp;</span>') + esc(L.t.slice(0, Math.floor(shown)));
      if (input.confirm || input.mouse.anyClick) {
        if (shown < L.t.length) shown = L.t.length;
        else { audio.uiMove(); next(); if (i >= m.lines.length) { wait = 0.8; } }
      }
    };
    return this.open(modal);
  }

  // ---------------- inventory ----------------
  inventory(ctx, startTab = 'items') {
    const root = el('div', 'screen dim');
    const p = el('div', 'panel inv fade-in');
    root.appendChild(p);
    const tabs = el('div', 'tabs');
    const tabNames = ['items', 'files', 'map'];
    const tabEls = tabNames.map((t) => {
      const e = el('div', 'tab', t.toUpperCase());
      e.onclick = () => { setTab(t); audio.uiMove(); };
      tabs.appendChild(e);
      return e;
    });
    tabs.appendChild(el('div', 'hint', '[Q]/[E] TAB · [ESC] CLOSE'));
    p.appendChild(tabs);
    const body = el('div', 'inv-body');
    p.appendChild(body);

    // status column (shared)
    const status = el('div', 'status');
    status.appendChild(el('div', 'hdr', 'UNIT STATUS // WREN-3'));
    const modelCanvas = el('canvas', 'model');
    modelCanvas.width = 150; modelCanvas.height = 150;
    status.appendChild(modelCanvas);
    const cond = el('div', 'cond ' + ctx.player.condition, ctx.player.condition);
    status.appendChild(cond);
    const ecg = el('canvas', 'ecg');
    ecg.width = 300; ecg.height = 60;
    status.appendChild(ecg);
    status.appendChild(el('div', 'unit', `INTEGRITY ${Math.round(ctx.player.hp)}%<br>CYCLE 11,406`));
    body.appendChild(status);
    const pane = el('div');
    pane.style.minHeight = '0';
    body.appendChild(pane);

    const modal = { el: root };
    let tab = startTab;
    let sel = 0, actionMenu = null, fileSel = 0;

    const renderItems = () => {
      pane.className = 'items-pane';
      pane.innerHTML = '';
      const slots = el('div', 'slots');
      const inv = ctx.inv;
      for (let i = 0; i < SLOTS; i++) {
        const s = inv.slots[i];
        const d = el('div', 'slot' + (i === sel ? ' sel' : '') + (s ? '' : ' empty'));
        if (s) {
          d.appendChild(icon(s.id));
          if (s.id === 'pistol') d.appendChild(el('div', 'qty', `${s.loaded}`));
          else if (ITEMS[s.id].stack > 1) d.appendChild(el('div', 'qty', `×${s.qty}`));
          if (s.id === 'pistol') d.appendChild(el('div', 'eq', 'EQ'));
        }
        d.onclick = () => { sel = i; actionMenu = null; audio.uiMove(); renderItems(); openActions(); };
        d.onmouseenter = () => { if (!actionMenu && sel !== i) { sel = i; renderItems(); } };
        slots.appendChild(d);
      }
      pane.appendChild(slots);
      const det = el('div', 'detail');
      const s = inv.slots[sel];
      if (s) {
        const def = ITEMS[s.id];
        det.appendChild(el('div', 'hdr red', def.kind.toUpperCase()));
        det.appendChild(el('div', 'name', esc(def.name)));
        let extra = '';
        if (s.id === 'pistol') extra = `\nLOADED ${s.loaded}/8 · RESERVE ${inv.count('ammo')}`;
        det.appendChild(el('div', 'desc', esc(def.desc + extra).replace(/\n/g, '<br>')));
      } else {
        det.appendChild(el('div', 'hdr', 'EMPTY SLOT'));
        det.appendChild(el('div', 'desc', `<span style="color:var(--bone-dim)">${inv.freeSlots()} of ${SLOTS} slots free.</span>`));
      }
      const acts = el('div', 'actions');
      if (actionMenu) acts.appendChild(actionMenu.el);
      else if (s) acts.appendChild(el('div', 'hdr', '[E] SELECT'));
      det.appendChild(acts);
      pane.appendChild(det);
    };

    const openActions = () => {
      const s = ctx.inv.slots[sel];
      if (!s) return;
      const list = ctx.actions(sel);
      list.push({ label: 'CANCEL', fn: () => {} });
      actionMenu = new Menu(list.map((a) => ({ label: a.label, a })), {
        onSelect: async (o) => {
          actionMenu = null;
          const res = await o.a.fn();
          if (res === 'close') { modal.resolve(); return; }
          cond.className = 'cond ' + ctx.player.condition;
          cond.textContent = ctx.player.condition;
          status.querySelector('.unit').innerHTML = `INTEGRITY ${Math.round(ctx.player.hp)}%<br>CYCLE 11,406`;
          renderItems();
        },
      });
      renderItems();
    };

    const renderFiles = () => {
      pane.className = 'files-pane';
      pane.innerHTML = '';
      const files = ctx.inv.files;
      if (!files.length) { pane.appendChild(el('div', 'empty-msg', 'No files recovered.')); return; }
      fileSel = Math.min(fileSel, files.length - 1);
      const list = el('div', 'file-list');
      files.forEach((id, i) => {
        const f = el('div', 'f' + (i === fileSel ? ' sel' : ''), esc(FILES[id].title));
        f.onclick = () => { fileSel = i; audio.uiMove(); renderFiles(); };
        list.appendChild(f);
      });
      pane.appendChild(list);
      const f = FILES[files[fileSel]];
      const b = el('div', 'file-body');
      b.innerHTML = `<div class="ft">${esc(f.title)}</div><div class="fw">${esc(f.where.toUpperCase())}</div>${esc(f.body)}`;
      pane.appendChild(b);
      modal.fileBody = b;
    };

    const renderMap = () => {
      pane.className = 'map-pane';
      pane.innerHTML = '';
      const c = el('canvas');
      c.width = GRID_W * 10; c.height = GRID_H * 10;
      pane.appendChild(c);
      const leg = el('div', 'map-legend');
      leg.innerHTML = `<div class="cur">${esc(ROOMS[ctx.currentRoom].name)}</div>
        <div><i style="background:#d8242e"></i>LOCATION</div>
        <div><i style="background:#3a3c3e;border:1px solid #e6e0d0"></i>VISITED</div>
        <div><i style="border:1px dashed #5a5e60"></i>NOT VISITED</div>
        <div><i style="background:#ff4a4a"></i>LOCKED DOOR</div>
        <div><i style="background:#e0a040"></i>CLOSED DOOR</div>
        <div><i style="background:#9fe6ea"></i>QUIET ROOM</div>
        <div style="margin-top:14px">DECK 2 — HABITATION RING</div>`;
      pane.appendChild(leg);
      modal.mapCanvas = c;
      drawMap(c, 0);
    };

    const drawMap = (c, t) => {
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#060707'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = 'rgba(90,94,96,0.12)';
      for (let x = 0; x < GRID_W; x += 4) { g.beginPath(); g.moveTo(x * 10 + 0.5, 0); g.lineTo(x * 10 + 0.5, c.height); g.stroke(); }
      for (let z = 0; z < GRID_H; z += 4) { g.beginPath(); g.moveTo(0, z * 10 + 0.5); g.lineTo(c.width, z * 10 + 0.5); g.stroke(); }
      for (const [k, r] of Object.entries(ROOMS)) {
        const x = r.x0 * 10, y = r.z0 * 10, w = (r.x1 - r.x0 + 1) * 10, h = (r.z1 - r.z0 + 1) * 10;
        const visited = ctx.visited.has(k);
        const cur = k === ctx.currentRoom;
        if (visited) {
          g.fillStyle = cur ? (Math.sin(t * 6) > 0 ? 'rgba(216,36,46,0.55)' : 'rgba(216,36,46,0.3)') : r.safe ? 'rgba(159,230,234,0.18)' : 'rgba(230,224,208,0.13)';
          g.fillRect(x, y, w, h);
          g.strokeStyle = cur ? '#ff4a4a' : '#e6e0d0'; g.lineWidth = 2;
          g.setLineDash([]);
          g.strokeRect(x + 1, y + 1, w - 2, h - 2);
        } else {
          g.strokeStyle = '#3a3e40'; g.lineWidth = 1;
          g.setLineDash([3, 3]);
          g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          g.setLineDash([]);
        }
        if (visited && w > 40) {
          g.fillStyle = cur ? '#ffffff' : '#9a968a';
          g.font = '12px VT323, monospace';
          const label = r.name.length * 6 > w - 6 ? r.name.split(' ')[0] : r.name;
          if (w > 30 && h > 16) g.fillText(label, x + 4, y + 13);
        }
        if (r.safe && visited) { g.fillStyle = '#9fe6ea'; g.fillRect(x + w - 10, y + 4, 6, 6); }
      }
      for (const d of DOORS) {
        const door = ctx.doors[d.id];
        const known = ctx.visited.has(d.a) || ctx.visited.has(d.b);
        if (!known) continue;
        g.fillStyle = door.open ? '#6a6e70' : door.locked ? '#ff4a4a' : '#e0a040';
        g.fillRect(d.x * 10 + 2, d.z * 10 + 2, 6, 6);
      }
      // player arrow
      const px = ctx.player.pos.x * 10, pz = ctx.player.pos.z * 10;
      g.save(); g.translate(px, pz); g.rotate(-ctx.player.yaw + Math.PI);
      g.fillStyle = Math.sin(t * 8) > -0.3 ? '#ffffff' : '#ff4a4a';
      g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill();
      g.restore();
    };

    const setTab = (t) => {
      tab = t; actionMenu = null;
      tabEls.forEach((e, i) => e.classList.toggle('sel', tabNames[i] === t));
      status.style.display = t === 'map' ? 'none' : '';
      body.style.gridTemplateColumns = t === 'map' ? '1fr' : '';
      if (t === 'items') renderItems();
      if (t === 'files') renderFiles();
      if (t === 'map') renderMap();
    };
    setTab(tab);

    // wireframe model monitor
    const wf = this.getWireRenderer(modelCanvas);
    const wire = wireframeClone(ctx.player.rig, ctx.player.hp > 66 ? 0xe6e0d0 : ctx.player.hp > 33 ? 0xe0a040 : 0xff3030);
    const wireRoot = new THREE.Group();
    const inner = new THREE.Group();
    wire.position.set(-ctx.player.pos.x, 0, -ctx.player.pos.z);
    inner.add(wire);
    inner.rotation.y = -ctx.player.yaw;
    wireRoot.add(inner);
    wf.scene.add(wireRoot);
    let time = 0;
    let ecgX = 0;
    const eg = ecg.getContext('2d');
    eg.fillStyle = '#050606'; eg.fillRect(0, 0, 300, 60);
    const ecgColor = ctx.player.hp > 66 ? '#e6e0d0' : ctx.player.hp > 33 ? '#e0a040' : '#ff4a4a';
    const bpm = ctx.player.hp > 66 ? 1.1 : ctx.player.hp > 33 ? 1.6 : 2.3;
    let lastY = 30;

    modal.onClose = () => { wf.scene.remove(wireRoot); };
    modal.update = (input, dt) => {
      time += dt;
      // model
      wireRoot.rotation.y = time * 0.6;
      wf.renderer.render(wf.scene, wf.camera);
      // ecg
      for (let k = 0; k < 3; k++) {
        const ph = (time * bpm + k / 180) % 1;
        let y = 30 + Math.sin(ecgX * 0.3) * 0.5;
        if (ph > 0.1 && ph < 0.13) y = 30 - (ph - 0.1) * 500;
        else if (ph >= 0.13 && ph < 0.17) y = 15 + (ph - 0.13) * 900;
        else if (ph >= 0.17 && ph < 0.2) y = 51 - (ph - 0.17) * 700;
        else if (ph > 0.35 && ph < 0.45) y = 30 - Math.sin((ph - 0.35) / 0.1 * Math.PI) * 5;
        eg.fillStyle = '#050606'; eg.fillRect(ecgX, 0, 8, 60);
        eg.strokeStyle = ecgColor; eg.lineWidth = 2;
        eg.beginPath(); eg.moveTo(ecgX - 1, lastY); eg.lineTo(ecgX, y); eg.stroke();
        lastY = y;
        ecgX = (ecgX + 1) % 300;
      }
      if (tab === 'map' && modal.mapCanvas) drawMap(modal.mapCanvas, time);

      // input
      if (input.hit('KeyQ')) { setTab(tabNames[(tabNames.indexOf(tab) + 2) % 3]); audio.uiMove(); return; }
      if (input.hit('KeyE') && !actionMenu && tab !== 'items') { setTab(tabNames[(tabNames.indexOf(tab) + 1) % 3]); audio.uiMove(); return; }
      if (input.padEdge.has('lb')) { setTab(tabNames[(tabNames.indexOf(tab) + 2) % 3]); audio.uiMove(); return; }
      if (input.padEdge.has('rb')) { setTab(tabNames[(tabNames.indexOf(tab) + 1) % 3]); audio.uiMove(); return; }
      if (input.back || input.hit('KeyM') && tab === 'map') {
        if (actionMenu) { actionMenu = null; renderItems(); audio.uiBack(); return; }
        audio.uiBack(); modal.resolve(); return;
      }
      if (tab === 'items') {
        if (actionMenu) { actionMenu.update(input); return; }
        let moved = false;
        if (input.left && sel % 2 === 1) { sel--; moved = true; }
        if (input.right && sel % 2 === 0) { sel++; moved = true; }
        if (input.up && sel >= 2) { sel -= 2; moved = true; }
        if (input.downNav && sel < SLOTS - 2) { sel += 2; moved = true; }
        if (moved) { audio.uiMove(); renderItems(); }
        if (input.hit('Enter', 'Space', 'KeyE') || input.padEdge.has('a')) { if (ctx.inv.slots[sel]) { audio.uiSelect(); openActions(); } }
      } else if (tab === 'files') {
        const n = ctx.inv.files.length;
        if (n) {
          if (input.up) { fileSel = (fileSel - 1 + n) % n; audio.uiMove(); renderFiles(); }
          if (input.downNav) { fileSel = (fileSel + 1) % n; audio.uiMove(); renderFiles(); }
          if (input.right && modal.fileBody) modal.fileBody.scrollTop += 60;
          if (input.left && modal.fileBody) modal.fileBody.scrollTop -= 60;
        }
      }
    };
    audio.uiSelect();
    return this.open(modal);
  }

  getWireRenderer(canvas) {
    if (!this.wf) {
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
      renderer.setPixelRatio(1);
      renderer.setSize(150, 150, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      camera.position.set(0, 1.4, 4.4);
      camera.lookAt(0, 0.85, 0);
      this.wf = { renderer, scene, camera };
    }
    // draw into the provided canvas by copying each frame
    const wf = this.wf;
    const g = canvas.getContext('2d');
    return {
      scene: wf.scene, camera: wf.camera,
      renderer: {
        render: (s, c) => {
          wf.renderer.render(s, c);
          g.clearRect(0, 0, 150, 150);
          g.drawImage(wf.renderer.domElement, 0, 0);
          // scan flicker
          g.fillStyle = 'rgba(0,0,0,0.35)';
          for (let y = 0; y < 150; y += 2) g.fillRect(0, y, 150, 1);
        },
      },
    };
  }

  // ---------------- storage trunk ----------------
  storage(ctx) {
    const root = el('div', 'screen dim');
    const p = el('div', 'panel box fade-in');
    root.appendChild(p);
    const modal = { el: root };
    let col = 0, iSel = 0, bSel = 0;
    const render = () => {
      p.innerHTML = '';
      const left = el('div', col === 0 ? 'col-focus' : '');
      left.appendChild(el('div', 'hdr red', 'CARRIED'));
      const ll = el('div', 'box-list');
      ctx.inv.slots.forEach((s, i) => {
        const r = el('div', 'b' + (col === 0 && i === iSel ? ' sel' : ''));
        if (s) { r.appendChild(icon(s.id)); r.appendChild(el('span', '', esc(ITEMS[s.id].name) + (ITEMS[s.id].stack > 1 ? ` ×${s.qty}` : s.id === 'pistol' ? ` [${s.loaded}]` : ''))); }
        else r.appendChild(el('span', '', '<span style="color:#5a5e60">— empty —</span>'));
        r.onclick = () => { col = 0; iSel = i; move(); };
        ll.appendChild(r);
      });
      left.appendChild(ll);
      const right = el('div', col === 1 ? 'col-focus' : '');
      right.appendChild(el('div', 'hdr red', 'TRUNK'));
      const rl = el('div', 'box-list');
      if (!ctx.inv.box.length) rl.appendChild(el('div', 'b', '<span style="color:#5a5e60">— empty —</span>'));
      ctx.inv.box.forEach((b, i) => {
        const r = el('div', 'b' + (col === 1 && i === bSel ? ' sel' : ''));
        r.appendChild(icon(b.id));
        r.appendChild(el('span', '', esc(ITEMS[b.id].name) + (ITEMS[b.id].stack > 1 ? ` ×${b.qty}` : '')));
        r.onclick = () => { col = 1; bSel = i; move(); };
        rl.appendChild(r);
      });
      right.appendChild(rl);
      const cols = el('div', 'cols');
      cols.appendChild(left); cols.appendChild(right);
      p.appendChild(cols);
      const hint = el('div', 'hdr');
      hint.style.gridColumn = '1 / -1';
      hint.textContent = '[←/→] SWITCH · [E] MOVE ITEM · [ESC] CLOSE';
      p.appendChild(hint);
    };
    const move = () => {
      if (col === 0) {
        const s = ctx.inv.slots[iSel];
        if (s) { ctx.inv.store(iSel); audio.uiSelect(); } else audio.uiBack();
      } else if (ctx.inv.box[bSel]) {
        if (ctx.inv.retrieve(bSel)) audio.uiSelect(); else { audio.uiBack(); this.toast('No free slot.'); }
        bSel = Math.min(bSel, Math.max(0, ctx.inv.box.length - 1));
      }
      render();
    };
    modal.update = (input) => {
      if (input.back) { audio.uiBack(); modal.resolve(); return; }
      if (input.left && col === 1) { col = 0; audio.uiMove(); render(); }
      if (input.right && col === 0) { col = 1; audio.uiMove(); render(); }
      const n = col === 0 ? SLOTS : Math.max(1, ctx.inv.box.length);
      if (input.up) { if (col === 0) iSel = (iSel - 1 + n) % n; else bSel = (bSel - 1 + n) % n; audio.uiMove(); render(); }
      if (input.downNav) { if (col === 0) iSel = (iSel + 1) % n; else bSel = (bSel + 1) % n; audio.uiMove(); render(); }
      if (input.confirm) move();
    };
    render();
    audio.uiSelect();
    return this.open(modal);
  }

  // ---------------- keypad ----------------
  keypad(code) {
    const root = el('div', 'screen dim');
    const p = el('div', 'panel keypad fade-in');
    p.appendChild(el('div', 'hdr red', 'POWER RELAY — ACCESS'));
    const disp = el('div', 'disp', '____');
    p.appendChild(disp);
    const grid = el('div', 'grid');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'OK'];
    let sel = 0, entry = '', locked = false;
    const keyEls = keys.map((k, i) => {
      const d = el('div', 'k', k);
      d.onclick = () => { sel = i; press(k); };
      grid.appendChild(d);
      return d;
    });
    p.appendChild(grid);
    p.appendChild(el('div', 'hdr', '[0-9] ENTER · [ESC] BACK'));
    root.appendChild(p);
    const modal = { el: root };
    const render = () => {
      keyEls.forEach((e, i) => e.classList.toggle('sel', i === sel));
      if (!locked) disp.textContent = (entry + '____').slice(0, 4);
    };
    const press = (k) => {
      if (locked) return;
      if (k === 'CLR') { entry = ''; audio.uiBack(); }
      else if (k === 'OK') submit();
      else if (entry.length < 4) { entry += k; audio.blip(800 + Number(k) * 60, 0.06, 'square', 0.05); if (entry.length === 4) setTimeout(submit, 250); }
      render();
    };
    const submit = () => {
      if (locked) return;
      locked = true;
      if (entry === code) {
        disp.textContent = 'OPEN'; disp.classList.add('ok');
        audio.uiSelect();
        setTimeout(() => modal.resolve(true), 700);
      } else {
        disp.textContent = 'DENY';
        audio.locked();
        setTimeout(() => { entry = ''; locked = false; render(); }, 700);
      }
    };
    modal.update = (input) => {
      if (input.back) { audio.uiBack(); modal.resolve(false); return; }
      for (let d = 0; d <= 9; d++) if (input.hit('Digit' + d, 'Numpad' + d)) press(String(d));
      if (input.hit('Backspace')) press('CLR');
      if (input.left) { sel = (sel + 11) % 12; audio.uiMove(); }
      if (input.right) { sel = (sel + 1) % 12; audio.uiMove(); }
      if (input.up) { sel = (sel + 9) % 12; audio.uiMove(); }
      if (input.downNav) { sel = (sel + 3) % 12; audio.uiMove(); }
      if (input.hit('Enter', 'KeyE', 'Space') || input.padEdge.has('a')) press(keys[sel]);
      render();
    };
    render();
    return this.open(modal);
  }

  // ---------------- relay (lights puzzle) ----------------
  relay(state) {
    // 5 lamps, 4 levers. Each lever flips a fixed set of lamps.
    const FLIPS = [[0, 1], [1, 2, 3], [3, 4], [0, 4]];
    const root = el('div', 'screen dim');
    const p = el('div', 'panel relay fade-in');
    p.appendChild(el('div', 'hdr red', 'MAIN BUS — REDISTRIBUTION'));
    const lampsEl = el('div', 'lamps');
    const lampEls = [0, 1, 2, 3, 4].map(() => { const l = el('div', 'lamp'); lampsEl.appendChild(l); return l; });
    p.appendChild(lampsEl);
    const leversEl = el('div', 'levers');
    let sel = 0, solved = false;
    const leverEls = [0, 1, 2, 3].map((i) => {
      const l = el('div', 'lever');
      l.appendChild(el('div', 'h'));
      l.appendChild(el('div', 'n', 'ABCD'[i]));
      l.onclick = () => { sel = i; flip(i); };
      leversEl.appendChild(l);
      return l;
    });
    p.appendChild(leversEl);
    p.appendChild(el('div', 'schem', '<br>A → 1·2 &nbsp;&nbsp; B → 2·3·4 &nbsp;&nbsp; C → 4·5 &nbsp;&nbsp; D → 1·5<br>ALL FIVE LINES MUST CARRY LOAD'));
    p.appendChild(el('div', 'hdr', '[←/→] SELECT · [E] THROW · [ESC] BACK'));
    root.appendChild(p);
    const lamps = () => {
      const on = [false, false, true, false, false];
      state.levers.forEach((up, i) => { if (up) FLIPS[i].forEach((k) => { on[k] = !on[k]; }); });
      return on;
    };
    const render = () => {
      const on = lamps();
      lampEls.forEach((l, i) => l.classList.toggle('on', on[i]));
      leverEls.forEach((l, i) => { l.classList.toggle('up', state.levers[i]); l.classList.toggle('sel', i === sel); });
      return on.every(Boolean);
    };
    const modal = { el: root };
    const flip = (i) => {
      if (solved) return;
      state.levers[i] = !state.levers[i];
      audio.thud(0.3, 110); audio.click(0.02, 1800, 0.3);
      if (render()) {
        solved = true;
        audio.uiSelect();
        setTimeout(() => modal.resolve(true), 900);
      }
    };
    modal.update = (input) => {
      if (input.back) { audio.uiBack(); modal.resolve(false); return; }
      if (input.left) { sel = (sel + 3) % 4; audio.uiMove(); render(); }
      if (input.right) { sel = (sel + 1) % 4; audio.uiMove(); render(); }
      for (let d = 1; d <= 4; d++) if (input.hit('Digit' + d)) { sel = d - 1; flip(d - 1); }
      if (input.confirm) flip(sel);
    };
    render();
    return this.open(modal);
  }

  // ---------------- oscilloscope ----------------
  wave() {
    const TARGET = { f: 4, a: 3 };
    const root = el('div', 'screen dim');
    const p = el('div', 'panel wave fade-in');
    p.appendChild(el('div', 'hdr red', 'ARRAY — CARRIER ALIGNMENT'));
    const c = el('canvas');
    c.width = 360; c.height = 120;
    p.appendChild(c);
    const knobs = el('div', 'knobs');
    const vals = { f: 7, a: 1 };
    let sel = 0, locked = false;
    const kEls = ['f', 'a'].map((k, i) => {
      const d = el('div', 'knob');
      d.onclick = () => { sel = i; render(); };
      d.onwheel = (e) => { sel = i; adj(e.deltaY < 0 ? 1 : -1); };
      knobs.appendChild(d);
      return d;
    });
    p.appendChild(knobs);
    const status = el('div', 'status', 'SEARCHING');
    p.appendChild(status);
    p.appendChild(el('div', 'hdr', '[↑/↓] KNOB · [←/→] ADJUST · [E] TRANSMIT · [ESC] BACK'));
    root.appendChild(p);
    const modal = { el: root };
    const render = () => {
      kEls[0].innerHTML = `FREQUENCY<span class="v">${vals.f}</span>`;
      kEls[1].innerHTML = `AMPLITUDE<span class="v">${vals.a}</span>`;
      kEls.forEach((e, i) => e.classList.toggle('sel', i === sel));
      locked = vals.f === TARGET.f && vals.a === TARGET.a;
      status.textContent = locked ? 'CARRIER LOCKED — READY TO TRANSMIT' : 'SEARCHING';
      status.classList.toggle('lock', locked);
    };
    const adj = (d) => {
      if (sel === 0) vals.f = Math.max(1, Math.min(9, vals.f + d));
      else vals.a = Math.max(1, Math.min(5, vals.a + d));
      audio.blip(300 + vals.f * 80 + vals.a * 30, 0.05, 'sine', 0.06);
      render();
    };
    let t = 0;
    const g = c.getContext('2d');
    modal.update = (input, dt) => {
      t += dt;
      g.fillStyle = 'rgba(7,3,3,0.55)'; g.fillRect(0, 0, 360, 120);
      g.strokeStyle = 'rgba(94,16,22,0.6)'; g.lineWidth = 1;
      for (let x = 0; x < 360; x += 30) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 120); g.stroke(); }
      g.beginPath(); g.moveTo(0, 60.5); g.lineTo(360, 60.5); g.stroke();
      const wave = (f, a, col, w, noise) => {
        g.strokeStyle = col; g.lineWidth = w; g.beginPath();
        for (let x = 0; x <= 360; x += 2) {
          const y = 60 - Math.sin(x / 360 * Math.PI * 2 * f + t * 3) * a * 10 + (noise ? (Math.random() - 0.5) * noise : 0);
          x ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
      };
      wave(TARGET.f, TARGET.a, 'rgba(216,36,46,0.9)', 2, 6);
      wave(vals.f, vals.a, locked ? '#80ffa0' : '#e6e0d0', 1, locked ? 0 : 2);
      if (input.back) { audio.uiBack(); modal.resolve(false); return; }
      if (input.up || input.downNav) { sel = 1 - sel; audio.uiMove(); render(); }
      if (input.left) adj(-1);
      if (input.right) adj(1);
      if (input.confirm) {
        if (locked) { audio.uiSelect(); modal.resolve(true); } else { audio.locked(); }
      }
    };
    render();
    return this.open(modal);
  }

  // ---------------- death / pause ----------------
  death(hasSave) {
    const root = el('div', 'screen death fade-in');
    root.appendChild(el('div', 'big', 'SIGNAL LOST'));
    root.appendChild(el('div', 'sub', 'UNIT WREN-3 HAS CEASED FUNCTION'));
    const modal = { el: root };
    const menu = new Menu([
      { label: 'RESUME FROM LAST RECORD', value: 'load', disabled: !hasSave },
      { label: 'RETURN TO TITLE', value: 'title' },
    ], { onSelect: (o) => modal.resolve(o.value) });
    root.appendChild(menu.el);
    modal.update = (input) => menu.update(input);
    return this.open(modal);
  }

  pause() {
    const root = el('div', 'screen dim');
    const p = el('div', 'panel pause-panel fade-in');
    p.appendChild(el('div', 'hdr red', 'PAUSED'));
    const modal = { el: root };
    const menu = new Menu([
      { label: 'RESUME', value: 'resume' },
      { label: 'CONTROLS', value: 'controls' },
      { label: 'OPTIONS', value: 'options' },
      { label: 'QUIT TO TITLE', value: 'title' },
    ], {
      onSelect: async (o) => {
        if (o.value === 'controls') { modal.sub = true; await this.controlsScreen(root); modal.sub = false; return; }
        if (o.value === 'options') { modal.sub = true; await this.optionsScreen(root); modal.sub = false; return; }
        modal.resolve(o.value);
      },
    });
    p.appendChild(menu.el);
    root.appendChild(p);
    modal.update = (input) => {
      if (modal.sub) return;
      if (input.hit('Escape', 'KeyP') || input.padEdge.has('start')) { audio.uiBack(); modal.resolve('resume'); return; }
      menu.update(input);
    };
    audio.uiSelect();
    return this.open(modal);
  }

  choice(question, options) {
    return new Promise((resolve) => {
      this.say([question]).then(() => {
        const root = el('div', 'screen');
        const p = el('div', 'panel pause-panel fade-in');
        p.style.position = 'absolute'; p.style.bottom = '8vh';
        const modal = { el: root };
        const menu = new Menu(options.map((o) => ({ label: o.label, value: o.value })), { onSelect: (o) => modal.resolve(o.value) });
        p.appendChild(menu.el);
        root.appendChild(p);
        modal.update = (input) => {
          if (input.back) { audio.uiBack(); modal.resolve(null); return; }
          menu.update(input);
        };
        this.open(modal).then(resolve);
      });
    });
  }
}
