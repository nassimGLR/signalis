// In-world pointer and marks, drawn crisp at native resolution over the
// low-res game view: the state cursor, interaction brackets and verb labels,
// the focus box around a readied target, and the aim readout.
//
// One fixed canvas (pointer-events: none) at z 58 inside #ui, redrawn on its
// own animation frame from a state object the game pushes each frame:
//   { mode: 'game'|'menu'|'hidden', kind, label, glyph, brackets[], focus, readout }
// The pointer glyph itself always follows the live mouse position, so it
// stays responsive even when the game renders slowly.
//
// Palette comes from the §3.9 tokens on :root, with fallbacks.
const TOKENS = {
  ink: '#07080a', bone: '#e8e2d4', boneDim: '#8f8b80', grey: '#6b6b66',
  red: '#c8102e', redHi: '#ff2a3a', teal: '#6fc3c9', sodium: '#e0c85a', amber: '#e0862e',
};
const TOKEN_VARS = {
  ink: '--ink', bone: '--bone', boneDim: '--bone-dim', grey: '--grey',
  red: '--red', redHi: '--red-hi', teal: '--teal', sodium: '--sodium', amber: '--amber',
};
const FONT_LABEL = "600 11px 'Sofia Sans Condensed', 'Arial Narrow', 'DejaVu Sans Condensed', sans-serif";
const FONT_MONO = "500 13px 'IBM Plex Mono', 'DejaVu Sans Mono', monospace";
const FONT_MONO_S = "400 10px 'IBM Plex Mono', 'DejaVu Sans Mono', monospace";
// Clickable things in menus. B marks them with [data-click]; the rest is a
// fallback for screens that predate that attribute.
const CLICKABLE = '[data-click], button, .opt, .slot, .tab, .keypad .k, .relay .lever, .wave .knob, .file-list .f, .box-list .b, .act-menu .opt';

export class Cursor {
  constructor(input) {
    this.input = input;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'cursor';
    Object.assign(this.canvas.style, {
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '58',
    });
    (document.getElementById('ui') || document.body).appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.dpr = 1;
    this.w = 0; this.h = 0;
    this.state = { mode: 'hidden' };
    this.source = null;          // optional () => state, polled every frame
    this.col = { ...TOKENS };
    this.tokT = 0;
    this.noT = 0;                // 'no' flash timer (ms timestamp)
    this.reduceFlash = false;
    this.hideOS = false;
    this.menuHover = null;
    this.t0 = performance.now();

    const style = document.createElement('style');
    style.textContent = 'html.l7-nocursor, html.l7-nocursor body:not(.touching), html.l7-nocursor body:not(.touching) * { cursor: none !important; }';
    document.head.appendChild(style);

    const loop = () => { requestAnimationFrame(loop); this.draw(); };
    requestAnimationFrame(loop);
  }

  readTokens() {
    try {
      const cs = getComputedStyle(document.documentElement);
      for (const [k, v] of Object.entries(TOKEN_VARS)) {
        const val = cs.getPropertyValue(v).trim();
        this.col[k] = val || TOKENS[k];
      }
    } catch (e) { /* keep fallbacks */ }
  }

  flashNo() { if (!this.reduceFlash) this.noT = performance.now(); }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  setOSCursor(hide) {
    if (hide === this.hideOS) return;
    this.hideOS = hide;
    document.documentElement.classList.toggle('l7-nocursor', hide);
    document.documentElement.style.cursor = hide ? 'none' : '';
  }

  draw() {
    const now = performance.now();
    if (this.source) { try { this.state = this.source() || this.state; } catch (e) { this.state = { mode: 'hidden' }; } }
    if (now - this.tokT > 2000) { this.tokT = now; this.readTokens(); }
    this.resize();
    const g = this.g, s = this.state;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const touching = document.body.classList.contains('touching');
    const dev = this.input.lastDevice;
    const pointerDevice = dev !== 'pad' && dev !== 'touch' && !touching;
    this.setOSCursor(s.mode !== 'boot' && !touching);
    if (s.mode === 'hidden' || s.mode === 'boot') return;
    const mx = Math.round(this.input.mouse.x), my = Math.round(this.input.mouse.y);
    const time = (now - this.t0) / 1000;

    if (s.mode === 'menu') {
      if (!pointerDevice) return;
      this.drawMenuHover(mx, my);
      this.square(mx, my, 6, this.col.bone);
      return;
    }

    // ---- game mode: world marks first, pointer on top
    if (s.brackets) for (const b of s.brackets) this.bracket(b, time);
    if (s.focus) this.focusBox(s.focus);
    if (s.readout) this.readout(s.readout);
    if (!pointerDevice || s.pointer === false) return;
    if (now - this.noT < 250) { this.noGlyph(mx, my); return; }
    switch (s.kind) {
      case 'move': this.diamond(mx, my); break;
      case 'act': this.actGlyph(mx, my, s.label, 1, s.red, false); break;
      case 'far': this.actGlyph(mx, my, s.label, 0.5, s.red, true); break;
      case 'aim': this.aimGlyph(mx, my, s.spread); break;
      default: this.cross(mx, my); break;
    }
  }

  // ---------- primitives (1 px lines on the pixel grid, ink outline for contrast)
  line(x0, y0, x1, y1, color, w = 1) {
    const g = this.g;
    g.strokeStyle = color; g.lineWidth = w;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  // axis-aligned bar as a rect (crisper than stroked lines)
  bar(x, y, w, h, color) { this.g.fillStyle = color; this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  square(x, y, s, color) {
    this.bar(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2, this.col.ink);
    this.bar(x - s / 2, y - s / 2, s, s, color);
  }

  cross(x, y) {
    const c = this.col.bone, k = this.col.ink;
    // 9 px plus with a 2 px centre gap
    const arms = [[x - 4, y, 3, 1], [x + 2, y, 3, 1], [x, y - 4, 1, 3], [x, y + 2, 1, 3]];
    for (const [ax, ay, w, h] of arms) this.bar(ax - 1, ay - 1, w + 2, h + 2, k);
    for (const [ax, ay, w, h] of arms) this.bar(ax, ay, w, h, c);
  }

  diamond(x, y) {
    const g = this.g;
    const d = (r, col, w) => {
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath(); g.moveTo(x + 0.5, y - r + 0.5); g.lineTo(x + r + 0.5, y + 0.5); g.lineTo(x + 0.5, y + r + 0.5); g.lineTo(x - r + 0.5, y + 0.5); g.closePath(); g.stroke();
    };
    d(4, this.col.ink, 3); d(4, this.col.bone, 1);
  }

  corners(x0, y0, x1, y1, arm, th, color, outline = true) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const segs = [
      [x0, y0, arm, th], [x0, y0, th, arm],
      [x1 - arm, y0, arm, th], [x1 - th, y0, th, arm],
      [x0, y1 - th, arm, th], [x0, y1 - arm, th, arm],
      [x1 - arm, y1 - th, arm, th], [x1 - th, y1 - arm, th, arm],
    ];
    if (outline) for (const [sx, sy, w, h] of segs) this.bar(sx - 1, sy - 1, w + 2, h + 2, this.col.ink);
    for (const [sx, sy, w, h] of segs) this.bar(sx, sy, w, h, color);
  }

  label(text, x, y, color, alpha = 1, font = FONT_LABEL, track = 1.3) {
    if (!text) return 0;
    const g = this.g;
    g.save();
    g.globalAlpha *= alpha;
    g.font = font;
    if ('letterSpacing' in g) g.letterSpacing = track + 'px';
    g.textBaseline = 'top';
    g.lineJoin = 'round';
    g.strokeStyle = this.col.ink; g.lineWidth = 3;
    g.strokeText(text, Math.round(x), Math.round(y));
    g.fillStyle = color;
    g.fillText(text, Math.round(x), Math.round(y));
    const w = g.measureText(text).width;
    g.restore();
    return w;
  }

  textWidth(text, font = FONT_LABEL, track = 1.3) {
    const g = this.g;
    g.save();
    g.font = font;
    if ('letterSpacing' in g) g.letterSpacing = track + 'px';
    const w = g.measureText(text).width;
    g.restore();
    return w;
  }

  keyCap(text, x, y, color) {
    const g = this.g;
    g.save();
    g.font = FONT_LABEL;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    const w = Math.max(11, Math.ceil(g.measureText(text).width) + 6);
    this.bar(x - 1, y - 1, w + 2, 15, this.col.ink);
    g.strokeStyle = color; g.lineWidth = 1;
    g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, w - 1, 12);
    g.fillStyle = color; g.textBaseline = 'top';
    g.fillText(text, Math.round(x + (w - g.measureText(text).width) / 2), Math.round(y + 1));
    g.restore();
    return w;
  }

  footprints(x, y, color) {
    // two small offset soles: "walk there"
    this.bar(x - 1, y - 1, 5, 7, this.col.ink); this.bar(x + 4, y + 2, 5, 7, this.col.ink);
    this.bar(x, y, 3, 5, color); this.bar(x + 5, y + 3, 3, 5, color);
  }

  doorGlyph(cx, cy, color) {
    const w = 12, h = 14, x = Math.round(cx - w / 2), y = Math.round(cy - h / 2);
    const g = this.g;
    this.bar(x - 1, y - 1, w + 2, h + 2, this.col.ink);
    g.strokeStyle = color; g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    this.bar(x + w / 2 - 0.5, y + 2, 1, h - 4, color);
  }

  // World interaction bracket.
  //  b: { x, y, w, h, label, alpha, red, far, door, key, hovered }
  bracket(b, time) {
    const g = this.g;
    const color = b.red ? this.col.redHi : this.col.bone;
    const pulse = b.hovered ? 1 : 0.85 + 0.15 * Math.sin(time * Math.PI * 2 / 1.2);
    const a = (b.alpha ?? 1) * pulse;
    const w = Math.max(14, b.w), h = Math.max(14, b.h);
    const x0 = b.x - w / 2, y0 = b.y - h / 2, x1 = b.x + w / 2, y1 = b.y + h / 2;
    g.save();
    g.globalAlpha = a;
    this.corners(x0, y0, x1, y1, 6, 2, color);
    if (b.door) this.doorGlyph(b.x, b.y, color);
    const ly = Math.round(y0);
    // key cap, verb and footprints sit right of the box, or left of it when
    // they would run off the screen
    const need = (b.key ? 26 : 0) + (b.label ? this.textWidth(b.label) + 4 : 0) + (b.far ? 12 : 0);
    let lx = x1 + 8 + need > this.w - 4 ? Math.round(x0 - 8 - need) : Math.round(x1 + 8);
    if (b.key) lx += this.keyCap(b.key, lx, ly - 1, color) + 4;
    if (b.label) lx += this.label(b.label, lx, ly, color) + 4;
    if (b.far) this.footprints(lx + 2, ly + 1, color);
    g.restore();
  }

  actGlyph(x, y, label, alpha, red, far) {
    const g = this.g;
    const color = red ? this.col.redHi : this.col.bone;
    g.save();
    g.globalAlpha = alpha;
    this.corners(x - 9, y - 9, x + 9, y + 9, 5, 1, color);
    this.bar(x - 1, y - 1, 3, 3, this.col.ink); this.bar(x, y, 1, 1, color);
    const need = (label ? this.textWidth(label) + 4 : 0) + (far ? 12 : 0);
    let lx = x + 14 + need > this.w - 4 ? x - 14 - need : x + 14;
    if (label) lx += this.label(label, lx, y - 6, color) + 4;
    if (far) this.footprints(lx + 1, y - 5, color);
    g.restore();
  }

  noGlyph(x, y) {
    const c = this.col.redHi;
    const g = this.g;
    this.corners(x - 6, y - 6, x + 6, y + 6, 12, 1, c);
    g.strokeStyle = this.col.ink; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - 5, y + 5); g.lineTo(x + 5, y - 5); g.stroke();
    g.strokeStyle = c; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x - 5, y + 5); g.lineTo(x + 5, y - 5); g.stroke();
  }

  aimGlyph(x, y, spread) {
    const g = this.g;
    const c = this.col.redHi;
    if (spread) {
      const r = Math.round(spread);
      g.strokeStyle = this.col.ink; g.lineWidth = 3;
      g.beginPath(); g.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = c; g.lineWidth = 1; g.globalAlpha = 0.85;
      g.beginPath(); g.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    this.bar(x - 2, y - 2, 5, 5, this.col.ink);
    this.bar(x - 1, y - 1, 3, 3, c);
  }

  // Focus box: f: { x, y, size, f, solid, los, alpha }
  focusBox(f) {
    const g = this.g;
    const s = Math.round(f.size);
    const x0 = Math.round(f.x - s / 2), y0 = Math.round(f.y - s / 2), x1 = x0 + s, y1 = y0 + s;
    g.save();
    g.globalAlpha = f.alpha ?? 1;
    const color = f.solid ? this.col.redHi : this.col.bone;
    // corner ticks close in as focus builds
    const arm = Math.max(4, Math.round(s * (0.16 + 0.34 * f.f)));
    if (f.solid) {
      g.strokeStyle = this.col.ink; g.lineWidth = 4; g.strokeRect(x0 + 0.5, y0 + 0.5, s, s);
      g.strokeStyle = color; g.lineWidth = 2; g.strokeRect(x0 + 0.5, y0 + 0.5, s, s);
    } else {
      this.corners(x0, y0, x1, y1, arm, 1, color);
    }
    if (!f.los) {
      const k = Math.round(s * 0.28);
      const cx = Math.round(f.x), cy = Math.round(f.y);
      g.strokeStyle = this.col.ink; g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx - k, cy - k); g.lineTo(cx + k, cy + k); g.moveTo(cx + k, cy - k); g.lineTo(cx - k, cy + k); g.stroke();
      g.strokeStyle = color; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx - k, cy - k); g.lineTo(cx + k, cy + k); g.moveTo(cx + k, cy - k); g.lineTo(cx - k, cy + k); g.stroke();
    }
    g.restore();
  }

  // Aim readout: loaded rounds over the reserve, beside the box or pointer.
  readout(r) {
    const g = this.g;
    g.save();
    g.globalAlpha = r.alpha ?? 1;
    const top = Math.round(r.y - 12);
    this.label(String(r.loaded).padStart(2, '0'), r.x, top, r.loaded > 0 ? this.col.bone : this.col.redHi, 1, FONT_MONO, 0.5);
    this.label('/' + String(r.reserve).padStart(2, '0'), r.x, top + 15, this.col.grey, 1, FONT_MONO_S, 0.5);
    if (r.extra) this.label(r.extra, r.x, top + 28, this.col.boneDim, 1, FONT_MONO_S, 0.5);
    g.restore();
  }

  // Menu hover: brackets around the clickable element under the pointer.
  drawMenuHover(x, y) {
    let el = null;
    try { el = document.elementFromPoint(x, y); } catch (e) { el = null; }
    const hit = el && el.closest ? el.closest(CLICKABLE) : null;
    if (!hit || hit.id === 'boot') return;
    const r = hit.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.width > this.w * 0.9) return;
    this.corners(r.left - 3, r.top - 3, r.right + 3, r.bottom + 3, 6, 1, this.col.bone, false);
  }
}
