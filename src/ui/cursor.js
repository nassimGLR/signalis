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
// Everything is sized for a 720 px tall window and scaled by an integer
// factor k = round(innerHeight / 720), so the marks keep their size relative
// to the game view and stay on the pixel grid (crisp) at any window size.
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
const SANS = "'Sofia Sans Condensed', 'Arial Narrow', 'DejaVu Sans Condensed', sans-serif";
const MONO = "'IBM Plex Mono', 'DejaVu Sans Mono', monospace";
const fontLabel = (k) => `600 ${11 * k}px ${SANS}`;
const fontMono = (k) => `500 ${13 * k}px ${MONO}`;
const fontMonoS = (k) => `400 ${10 * k}px ${MONO}`;
// Clickable things in menus. B marks them with [data-click]; the rest is a
// fallback for screens that predate that attribute.
const CLICKABLE = '[data-click], button, .opt, .slot, .tab, .keypad .k, .relay .lever, .wave .knob, .file-list .f, .box-list .b, .act-menu .opt';

// ---- pointer glyphs as pixel art, in 720p pixels around the hotspot. The
// hotspot is the pixel corner at (0, 0), so a 2 px stroke sits on pixels -1
// and 0 and the glyph is symmetric about the pointer.
// idle: a 14 px "+" with a 2 px stroke and a 4 px centre gap
const CROSS = [[-7, -1, 5, 2], [2, -1, 5, 2], [-1, -7, 2, 5], [-1, 2, 2, 5]];
// move (hold-walking): a 14 px diamond ring, 2 px thick, with a 2 px centre dot
const DIAMOND = [];
for (let j = -7; j <= 6; j++) {
  for (let i = -7; i <= 6; i++) {
    const s = Math.abs(i + 0.5) + Math.abs(j + 0.5);
    if (s === 6 || s === 7 || s === 1) DIAMOND.push([i, j]);
  }
}
// far: a 9 px double chevron after the verb ("go there first")
const GO = [];
for (const ox of [0, 5]) {
  for (let j = 0; j <= 8; j++) { const i = j <= 4 ? j : 8 - j; GO.push([ox + i, j], [ox + i + 1, j]); }
}
const GO_W = 11;

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
    this.k = 1;                  // integer mark scale (1 at 720p, 2 at 1440p…)
    this.w = 0; this.h = 0;
    this.state = { mode: 'hidden' };
    this.source = null;          // optional () => state, polled every frame
    this.col = { ...TOKENS };
    this.tokT = 0;
    this.noT = 0;                // 'no' flash timer (ms timestamp)
    this.reduceFlash = false;
    this.hideOS = false;
    this.menuHover = null;
    this.widths = new Map();     // measured label widths, by font + text
    this.layout = { k: 1, boxes: [], labels: [] }; // last bracket/label layout (harness)
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
    this.k = Math.max(1, Math.round(h / 720));
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
    const g = this.g, s = this.state, k = this.k;
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
      this.square(mx, my, 8 * k, this.col.bone);
      return;
    }

    // ---- game mode: world marks first, pointer on top
    const ptrOn = pointerDevice && s.pointer !== false;
    const noFlash = ptrOn && now - this.noT < 250;
    const ptrLabel = ptrOn && !noFlash && (s.kind === 'act' || s.kind === 'far') && s.label
      ? { text: s.label, far: s.kind === 'far' } : null;
    const lay = this.layoutMarks(s.brackets || [], ptrLabel, mx, my);
    if (s.brackets) s.brackets.forEach((b, i) => this.bracket(b, lay.boxes[i], lay.groups[i], time));
    if (s.focus) this.focusBox(s.focus);
    if (s.readout) this.readout(s.readout);
    if (!ptrOn) return;
    if (noFlash) { this.at(mx, my, () => this.noGlyph()); return; }
    switch (s.kind) {
      case 'move': this.pixels(DIAMOND, mx, my, this.col.bone); break;
      case 'act': this.actGlyph(mx, my, lay.pointer, 1, s.red); break;
      case 'far': this.actGlyph(mx, my, lay.pointer, 0.5, s.red); break;
      case 'aim': this.at(mx, my, () => this.aimGlyph(s.spread)); break;
      default: this.rects(CROSS, mx, my, this.col.bone); break;
    }
  }

  // ---------- layout: where each verb label goes
  // Labels sit right of their bracket (or of the pointer). When one would run
  // into another bracket or label, it flips left or drops a line; if nothing
  // fits, a minor label is left out. Neighbours of the hovered bracket lose
  // their labels so the one under the pointer reads cleanly.
  layoutMarks(brackets, ptr, mx, my) {
    const k = this.k, M = 2 * k, gap = 8 * k, lineH = 14 * k, textH = 12 * k;
    const boxes = brackets.map((b) => {
      const w = Math.max(14 * k, b.w), h = Math.max(14 * k, b.h);
      return { x0: Math.round(b.x - w / 2), y0: Math.round(b.y - h / 2), x1: Math.round(b.x + w / 2), y1: Math.round(b.y + h / 2) };
    });
    const hov = brackets.findIndex((b) => b.hovered);
    const labels = [];
    const hit = (r, q, m = M) => r.x0 < q.x1 + m && r.x1 + m > q.x0 && r.y0 < q.y1 + m && r.y1 + m > q.y0;
    const arm = 7 * k;
    const cornersOf = (b) => [
      { x0: b.x0 - k, y0: b.y0 - k, x1: b.x0 + arm, y1: b.y0 + arm },
      { x0: b.x1 - arm, y0: b.y0 - k, x1: b.x1 + k, y1: b.y0 + arm },
      { x0: b.x0 - k, y0: b.y1 - arm, x1: b.x0 + arm, y1: b.y1 + k },
      { x0: b.x1 - arm, y0: b.y1 - arm, x1: b.x1 + k, y1: b.y1 + k },
    ];
    // own: index of the bracket the label belongs to (-1 for the pointer's)
    const owners = [];
    const free = (r, own) => {
      if (r.x0 < 4 || r.x1 > this.w - 4 || r.y0 < 2 || r.y1 > this.h - 2) return false;
      for (let i = 0; i < boxes.length; i++) {
        if (i === own) continue;
        // keep a label as far from other brackets as from its own, so it
        // can't be read as belonging to the neighbour
        if (own === -1 && i === hov) { for (const c of cornersOf(boxes[i])) if (hit(r, c)) return false; } else if (hit(r, boxes[i], gap)) return false;
      }
      for (const q of labels) if (hit(r, q)) return false;
      return true;
    };
    const rectAt = (x, y, need) => ({ x0: x - k, y0: y - k, x1: x + need + k, y1: y + textH });
    const place = (spots, need, own, force) => {
      for (const [x, y] of spots) {
        const r = rectAt(Math.round(x), Math.round(y), need);
        if (free(r, own)) return r;
      }
      if (!force) return null;
      // nothing clear: the first spot that stays on screen
      for (const [x, y] of spots) {
        const r = rectAt(Math.round(x), Math.round(y), need);
        if (r.x0 >= 4 && r.x1 <= this.w - 4) return r;
      }
      return rectAt(Math.round(spots[0][0]), Math.round(spots[0][1]), need);
    };

    // the pointer's own label first: it is what the player is reading
    let pointer = null;
    if (ptr) {
      const need = this.textWidth(ptr.text, fontLabel(k), 1.3 * k) + (ptr.far ? 4 * k + GO_W * k : 0);
      const x = mx + 14 * k, xl = mx - 14 * k - need, y = my - 6 * k;
      const spots = [[x, y], [x, y + lineH], [xl, y], [xl, y + lineH], [x, y - lineH], [xl, y - lineH]];
      // a small thing's verb reads best just outside its bracket, at the pointer's height
      const hb = hov >= 0 ? boxes[hov] : null;
      if (hb && hb.x1 - hb.x0 <= 64 * k) spots.unshift([Math.max(x, hb.x1 + gap), y], [Math.min(xl, hb.x0 - gap - need), y]);
      const r = place(spots, need, -1, true);
      labels.push(r); owners.push(-1);
      pointer = { x: r.x0 + k, y: r.y0 + k, far: ptr.far, text: ptr.text };
    }

    // then the brackets' labels: key target first, then nearest first
    const groups = brackets.map(() => null);
    const order = brackets.map((b, i) => i).sort((a, b) => (brackets[a].pri ?? 0) - (brackets[b].pri ?? 0));
    for (const i of order) {
      const b = brackets[i], bx = boxes[i];
      if (!b.label && !b.key && !b.far) continue;
      if (b.hovered && pointer) continue; // the pointer carries its verb
      if (hov >= 0 && i !== hov) {
        const h = boxes[hov];
        const dx = Math.max(0, h.x0 - bx.x1, bx.x0 - h.x1), dy = Math.max(0, h.y0 - bx.y1, bx.y0 - h.y1);
        if (Math.hypot(dx, dy) < 48 * k) continue;
      }
      const capW = b.key ? this.keyCapWidth(b.key) : 0;
      const need = (b.key ? capW + 4 * k : 0) + (b.label ? this.textWidth(b.label, fontLabel(k), 1.3 * k) + 4 * k : 0) + (b.far ? GO_W * k : 0);
      const xr = bx.x1 + gap, xl = bx.x0 - gap - need, y = bx.y0;
      const r = place([[xr, y], [xl, y], [xr, y + lineH], [xl, y + lineH]], need, i, !!b.key || b.hovered);
      if (!r) continue;
      labels.push(r); owners.push(i);
      groups[i] = { x: r.x0 + k, y: r.y0 + k, capW };
    }
    this.layout = { k, hov, arm, boxes, labels: labels.map((r, i) => ({ ...r, owner: owners[i] })) };
    return { boxes, groups, pointer };
  }

  // ---------- primitives (on the pixel grid, ink outline for contrast)
  // Draw fn() in 720p units around (x, y): scaled by the integer k.
  at(x, y, fn) {
    const g = this.g;
    g.save();
    g.translate(Math.round(x), Math.round(y));
    g.scale(this.k, this.k);
    fn();
    g.restore();
  }

  // axis-aligned bar as a rect (crisper than stroked lines)
  bar(x, y, w, h, color) { this.g.fillStyle = color; this.g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

  // Unit rects [x, y, w, h] around (x0, y0), scaled by k, with an ink outline.
  rects(list, x0, y0, color) {
    const k = this.k;
    for (const [x, y, w, h] of list) this.bar(x0 + (x - 1) * k, y0 + (y - 1) * k, (w + 2) * k, (h + 2) * k, this.col.ink);
    for (const [x, y, w, h] of list) this.bar(x0 + x * k, y0 + y * k, w * k, h * k, color);
  }

  // Unit pixels [i, j] around (x0, y0), scaled by k, with an ink outline.
  pixels(list, x0, y0, color) {
    const k = this.k;
    for (const [i, j] of list) this.bar(x0 + (i - 1) * k, y0 + (j - 1) * k, 3 * k, 3 * k, this.col.ink);
    for (const [i, j] of list) this.bar(x0 + i * k, y0 + j * k, k, k, color);
  }

  square(x, y, s, color) {
    const o = this.k;
    this.bar(x - s / 2 - o, y - s / 2 - o, s + 2 * o, s + 2 * o, this.col.ink);
    this.bar(x - s / 2, y - s / 2, s, s, color);
  }

  // A frame of thickness t inside (x0, y0)–(x1, y1).
  ring(x0, y0, x1, y1, t, color) {
    this.bar(x0, y0, x1 - x0, t, color);
    this.bar(x0, y1 - t, x1 - x0, t, color);
    this.bar(x0, y0 + t, t, y1 - y0 - 2 * t, color);
    this.bar(x1 - t, y0 + t, t, y1 - y0 - 2 * t, color);
  }

  // Corner brackets in screen px; arm, th and the outline o are in screen px.
  corners(x0, y0, x1, y1, arm, th, color, outline = true, o = this.k) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const segs = [
      [x0, y0, arm, th], [x0, y0, th, arm],
      [x1 - arm, y0, arm, th], [x1 - th, y0, th, arm],
      [x0, y1 - th, arm, th], [x0, y1 - arm, th, arm],
      [x1 - arm, y1 - th, arm, th], [x1 - th, y1 - arm, th, arm],
    ];
    if (outline) for (const [sx, sy, w, h] of segs) this.bar(sx - o, sy - o, w + 2 * o, h + 2 * o, this.col.ink);
    for (const [sx, sy, w, h] of segs) this.bar(sx, sy, w, h, color);
  }

  label(text, x, y, color, alpha = 1, font = fontLabel(this.k), track = 1.3 * this.k) {
    if (!text) return 0;
    const g = this.g;
    g.save();
    g.globalAlpha *= alpha;
    g.font = font;
    if ('letterSpacing' in g) g.letterSpacing = track + 'px';
    g.textBaseline = 'top';
    g.lineJoin = 'round';
    g.strokeStyle = this.col.ink; g.lineWidth = 3 * this.k;
    g.strokeText(text, Math.round(x), Math.round(y));
    g.fillStyle = color;
    g.fillText(text, Math.round(x), Math.round(y));
    g.restore();
    return this.textWidth(text, font, track);
  }

  textWidth(text, font = fontLabel(this.k), track = 1.3 * this.k) {
    const key = font + '|' + track + '|' + text;
    let w = this.widths.get(key);
    if (w === undefined) {
      const g = this.g;
      g.save();
      g.font = font;
      if ('letterSpacing' in g) g.letterSpacing = track + 'px';
      w = g.measureText(text).width;
      g.restore();
      if (this.widths.size > 200) this.widths.clear();
      this.widths.set(key, w);
    }
    return w;
  }

  keyCapWidth(text) {
    return Math.max(11, Math.ceil(this.textWidth(text, fontLabel(1), 0)) + 6) * this.k;
  }

  keyCap(text, x, y, color) {
    const w = this.keyCapWidth(text) / this.k;
    const tw = this.textWidth(text, fontLabel(1), 0);
    this.at(x, y, () => {
      const g = this.g;
      this.bar(-1, -1, w + 2, 15, this.col.ink);
      g.strokeStyle = color; g.lineWidth = 1;
      g.strokeRect(0.5, 0.5, w - 1, 12);
      g.font = fontLabel(1);
      if ('letterSpacing' in g) g.letterSpacing = '0px';
      g.fillStyle = color; g.textBaseline = 'top';
      g.fillText(text, Math.round((w - tw) / 2), 1);
    });
    return w * this.k;
  }

  doorGlyph(cx, cy, color) {
    this.at(cx, cy, () => {
      const g = this.g;
      const w = 12, h = 14, x = -w / 2, y = -h / 2;
      this.bar(x - 1, y - 1, w + 2, h + 2, this.col.ink);
      g.strokeStyle = color; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      this.bar(-0.5, y + 2, 1, h - 4, color);
    });
  }

  // World interaction bracket.
  //  b: { x, y, w, h, label, alpha, red, far, door, key, hovered }
  //  box: its screen rect; grp: where its key cap / verb / go chevrons go (or null)
  bracket(b, box, grp, time) {
    const g = this.g, k = this.k;
    const color = b.red ? this.col.redHi : this.col.bone;
    const pulse = b.hovered ? 1 : 0.85 + 0.15 * Math.sin(time * Math.PI * 2 / 1.2);
    g.save();
    g.globalAlpha = (b.alpha ?? 1) * pulse;
    this.corners(box.x0, box.y0, box.x1, box.y1, 6 * k, 2 * k, color);
    if (b.door) this.doorGlyph(b.x, b.y, color);
    if (grp) {
      let lx = grp.x;
      if (b.key) lx += this.keyCap(b.key, lx, grp.y - k, color) + 4 * k;
      if (b.label) lx += this.label(b.label, lx, grp.y, color) + 4 * k;
      if (b.far) this.pixels(GO, lx, grp.y + k, color);
    }
    g.restore();
  }

  // The pointer over a usable thing: small corner brackets and a centre dot;
  // its verb (and the go chevrons when it is out of reach) sit where the layout put them.
  actGlyph(x, y, lab, alpha, red) {
    const g = this.g, k = this.k;
    const color = red ? this.col.redHi : this.col.bone;
    g.save();
    g.globalAlpha = alpha;
    this.corners(x - 9 * k, y - 9 * k, x + 9 * k, y + 9 * k, 5 * k, k, color);
    this.bar(x - 2 * k, y - 2 * k, 4 * k, 4 * k, this.col.ink); this.bar(x - k, y - k, 2 * k, 2 * k, color);
    g.restore();
    if (!lab) return;
    // the verb stays fully legible; only the glyph dims when out of reach
    g.save();
    g.globalAlpha = alpha < 1 ? 0.8 : 1;
    const w = this.label(lab.text, lab.x, lab.y, color);
    if (lab.far) this.pixels(GO, lab.x + w + 4 * k, lab.y + k, color);
    g.restore();
  }

  // 'no': a slashed square (unit coords, drawn through at())
  noGlyph() {
    const g = this.g;
    const c = this.col.redHi;
    const segs = [[-7, -7, 14, 2], [-7, 5, 14, 2], [-7, -5, 2, 10], [5, -5, 2, 10]];
    for (const [x, y, w, h] of segs) this.bar(x - 1, y - 1, w + 2, h + 2, this.col.ink);
    for (const [x, y, w, h] of segs) this.bar(x, y, w, h, c);
    g.lineCap = 'square';
    g.strokeStyle = this.col.ink; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-4, 4); g.lineTo(4, -4); g.stroke();
    g.strokeStyle = c; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-4, 4); g.lineTo(4, -4); g.stroke();
  }

  // 'aim': a red dot, with the spread ring while nothing is locked (unit coords)
  aimGlyph(spread) {
    const g = this.g;
    const c = this.col.redHi;
    if (spread) {
      const r = Math.round(spread);
      g.strokeStyle = this.col.ink; g.lineWidth = 3;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = c; g.lineWidth = 1; g.globalAlpha = 0.85;
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    this.bar(-2, -2, 4, 4, this.col.ink);
    this.bar(-1, -1, 2, 2, c);
  }

  // Focus box: f: { x, y, size, f, solid, los, alpha }
  focusBox(f) {
    const g = this.g, k = this.k;
    const s = Math.round(f.size);
    const x0 = Math.round(f.x - s / 2), y0 = Math.round(f.y - s / 2), x1 = x0 + s, y1 = y0 + s;
    g.save();
    g.globalAlpha = f.alpha ?? 1;
    const color = f.solid ? this.col.redHi : this.col.bone;
    if (f.solid) {
      // a 2 px red frame with an ink line either side, so it holds up on red-lit floors
      this.ring(x0 - k, y0 - k, x1 + k, y1 + k, 4 * k, this.col.ink);
      this.ring(x0, y0, x1, y1, 2 * k, color);
    } else {
      // corner ticks close in as focus builds
      const arm = Math.max(4 * k, Math.round(s * (0.16 + 0.34 * f.f)));
      this.corners(x0, y0, x1, y1, arm, 2 * k, color);
    }
    if (!f.los) {
      const d = Math.round(s * 0.28);
      const cx = Math.round(f.x), cy = Math.round(f.y);
      const cross = (col, w) => {
        g.strokeStyle = col; g.lineWidth = w;
        g.beginPath(); g.moveTo(cx - d, cy - d); g.lineTo(cx + d, cy + d); g.moveTo(cx + d, cy - d); g.lineTo(cx - d, cy + d); g.stroke();
      };
      cross(this.col.ink, 4 * k); cross(color, 2 * k);
    }
    g.restore();
  }

  // Aim readout: loaded rounds over the reserve, beside the box or pointer.
  readout(r) {
    const g = this.g, k = this.k;
    g.save();
    g.globalAlpha = r.alpha ?? 1;
    const top = Math.round(r.y - 12 * k);
    const a = String(r.loaded).padStart(2, '0'), b = '/' + String(r.reserve).padStart(2, '0');
    // a dark plate behind it, so it reads over a lit poster or a red wall
    const w = Math.max(this.textWidth(a, fontMono(k), 0.5 * k), this.textWidth(b, fontMonoS(k), 0.5 * k),
      r.extra ? this.textWidth(r.extra, fontMonoS(k), 0.5 * k) : 0);
    const h = (r.extra ? 41 : 28) * k;
    g.fillStyle = 'rgba(7,8,10,.72)';
    g.fillRect(Math.round(r.x - 4 * k), top - 3 * k, Math.round(w + 8 * k), h);
    this.label(a, r.x, top, r.loaded > 0 ? this.col.bone : this.col.redHi, 1, fontMono(k), 0.5 * k);
    this.label(b, r.x, top + 15 * k, this.col.bone, 0.7, fontMonoS(k), 0.5 * k);
    if (r.extra) this.label(r.extra, r.x, top + 28 * k, this.col.boneDim, 1, fontMonoS(k), 0.5 * k);
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
    const k = this.k;
    this.corners(r.left - 3 * k, r.top - 3 * k, r.right + 3 * k, r.bottom + 3 * k, 6 * k, k, this.col.bone, false);
  }
}
