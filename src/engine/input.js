// Keyboard, mouse, touch and gamepad input, normalised into a small action set.
//
// Mouse model (plan §3.5 / §6.2):
//  - Buttons are tracked per physical button (0 left, 1 middle, 2 right,
//    3 back, 4 forward) from mouse events, so chorded presses (RMB held + LMB)
//    register properly.
//  - A press only counts for gameplay when it starts on the game canvas.
//    `anyClick` stays "any left press anywhere" for menus and dialogue.
//  - `leftClick` is a short left press (released within 220 ms and 8 px),
//    `dblClick` is the second of two clicks within 300 ms and 12 px.
//  - Every release also records how long the press lasted (`upMs`), how far
//    the pointer travelled (`upDist`) and whether it was a clean canvas press
//    (`upOk`), so the controller can read a slow click on the spot as a click.
//  - `consumeMouse()` drops this frame's edges and marks held buttons stale,
//    so a click that dismissed a dialog can't turn into a walk or an aim.
//  - Canvas taps from touch screens feed the same click path (tap-to-go).
const CLICK_MS = 220, CLICK_PX = 8, DBL_MS = 300, DBL_PX = 12;
const TOUCH_GUARD_MS = 800; // ignore compatibility mouse events after a touch

function makeMouse() {
  return {
    x: 0, y: 0, nx: 0, ny: 0, inside: false, inWindow: false, moved: false, movedAt: 0,
    // held (physical)
    left: false, right: false, middle: false,
    // per-button state: index = MouseEvent.button
    down: [false, false, false, false, false],
    stale: [false, false, false, false, false],   // held since before a consumeMouse()
    onCanvas: [false, false, false, false, false], // press began on the canvas
    downAt: [0, 0, 0, 0, 0], downX: [0, 0, 0, 0, 0], downY: [0, 0, 0, 0, 0],
    hit: [false, false, false, false, false],     // canvas press edge this frame
    up: [false, false, false, false, false],      // release edge this frame
    click: [false, false, false, false, false],   // short canvas click edge (on release)
    upMs: [0, 0, 0, 0, 0], upDist: [0, 0, 0, 0, 0], // the press that ended this frame
    upOk: [false, false, false, false, false],       // …began on the canvas and wasn't stale
    dbl: [false, false, false, false, false],
    lastClickAt: [0, 0, 0, 0, 0], lastClickX: [0, 0, 0, 0, 0], lastClickY: [0, 0, 0, 0, 0],
    // legacy / contract names
    clicked: false,     // left press on the canvas this frame (fire while aiming)
    anyClick: false,    // any left press anywhere this frame (menus, text)
    rightHit: false, middleHit: false, backHit: false, fwdHit: false,
    wheel: 0,
    tap: false,         // this frame's click came from a touch tap
    get leftDownAt() { return this.down[0] ? this.downAt[0] : 0; },
    get leftDownX() { return this.downX[0]; },
    get leftDownY() { return this.downY[0]; },
    get leftUp() { return this.up[0]; },
    get leftClick() { return this.click[0]; },
    get dblClick() { return this.dbl[0]; },
  };
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.mouse = makeMouse();
    this.pad = null;
    this.padPrev = {};
    this.padEdge = new Set();
    this.lastDevice = 'kb';     // 'kb' (keyboard or mouse) | 'pad' | 'touch'
    this.lastTouchT = -1e9;
    this.touchMove = null;      // set by the on-screen stick
    this._rect = null;

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'CapsLock'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'kb';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.releaseAll(); });

    const fromTouch = (e) => performance.now() - this.lastTouchT < TOUCH_GUARD_MS
      || (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);

    window.addEventListener('mousemove', (e) => {
      if (fromTouch(e)) return;
      this.setPointer(e.clientX, e.clientY);
      this.mouse.moved = true;
      this.mouse.inWindow = true;
      this.mouse.movedAt = performance.now();
      this.lastDevice = 'kb';
    });
    window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) this.mouse.inWindow = false; });
    canvas.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    canvas.addEventListener('mouseleave', () => {
      this.mouse.inside = false;
      // leaving the canvas (or passing over a menu) drops a walk-hold
      if (this.mouse.down[0]) { this.mouse.stale[0] = true; }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (fromTouch(e)) return;
      if (e.button === 1) e.preventDefault(); // no autoscroll
      this.press(e.button, e.clientX, e.clientY, true);
    });
    window.addEventListener('mousedown', (e) => {
      if (fromTouch(e)) { if (e.button === 0) this.mouse.anyClick = true; return; }
      if (e.button === 0) this.mouse.anyClick = true;
      if (e.button === 2) this.mouse.rightHit = true; // menus: RMB is "back"
      if (e.target !== canvas) this.press(e.button, e.clientX, e.clientY, false);
      this.lastDevice = 'kb';
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault(); // no browser back/forward
      if (fromTouch(e)) return;
      this.release(e.button, e.clientX, e.clientY, e.timeStamp);
    });
    window.addEventListener('auxclick', (e) => { if (e.button === 3 || e.button === 4 || e.button === 1) e.preventDefault(); });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.deltaY) this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    // touch taps on the canvas (outside the on-screen controls) → tap-to-go / tap-to-use
    const taps = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.lastTouchT = performance.now();
      this.lastDevice = 'touch';
      taps.set(e.pointerId, { t: performance.now(), x: e.clientX, y: e.clientY });
    });
    const tapEnd = (e, cancel) => {
      if (e.pointerType !== 'touch') return;
      this.lastTouchT = performance.now();
      const s = taps.get(e.pointerId);
      taps.delete(e.pointerId);
      if (!s || cancel) return;
      if (performance.now() - s.t <= 350 && Math.hypot(e.clientX - s.x, e.clientY - s.y) <= 14) {
        this.setPointer(e.clientX, e.clientY);
        const m = this.mouse;
        const now = performance.now();
        m.click[0] = true; m.tap = true;
        if (now - m.lastClickAt[0] <= DBL_MS && Math.hypot(e.clientX - m.lastClickX[0], e.clientY - m.lastClickY[0]) <= DBL_PX * 2) {
          m.dbl[0] = true; m.lastClickAt[0] = 0;
        } else { m.lastClickAt[0] = now; m.lastClickX[0] = e.clientX; m.lastClickY[0] = e.clientY; }
      }
    };
    window.addEventListener('pointerup', (e) => tapEnd(e, false));
    window.addEventListener('pointercancel', (e) => tapEnd(e, true));
  }

  // Canvas-relative normalised device coordinates. Another layer may letterbox
  // the canvas, so always measure against its bounding rect.
  canvasRect() {
    const r = this.canvas.getBoundingClientRect();
    return r.width > 0 ? r : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  setPointer(cx, cy) {
    const m = this.mouse;
    m.x = cx; m.y = cy;
    const r = this.canvasRect();
    m.nx = ((cx - r.left) / r.width) * 2 - 1;
    m.ny = -((cy - r.top) / r.height) * 2 + 1;
    m.inside = cx >= r.left && cx <= r.left + r.width && cy >= r.top && cy <= r.top + r.height;
  }

  press(b, x, y, onCanvas) {
    const m = this.mouse;
    if (b < 0 || b > 4) return;
    if (m.down[b]) return;
    m.down[b] = true;
    m.stale[b] = false;
    m.onCanvas[b] = onCanvas;
    m.downAt[b] = performance.now();
    m.downX[b] = x; m.downY[b] = y;
    if (onCanvas) {
      m.hit[b] = true;
      this.setPointer(x, y);
      if (b === 0) m.clicked = true;
      if (b === 1) m.middleHit = true;
      if (b === 3) m.backHit = true;
      if (b === 4) m.fwdHit = true;
    }
    this.syncHeld();
  }

  release(b, x, y) {
    const m = this.mouse;
    if (b < 0 || b > 4 || !m.down[b]) return;
    m.down[b] = false;
    m.up[b] = true;
    const now = performance.now();
    m.upMs[b] = now - m.downAt[b];
    m.upDist[b] = Math.hypot(x - m.downX[b], y - m.downY[b]);
    m.upOk[b] = m.onCanvas[b] && !m.stale[b];
    if (m.onCanvas[b] && !m.stale[b] && now - m.downAt[b] <= CLICK_MS && Math.hypot(x - m.downX[b], y - m.downY[b]) <= CLICK_PX) {
      m.click[b] = true;
      if (now - m.lastClickAt[b] <= DBL_MS && Math.hypot(x - m.lastClickX[b], y - m.lastClickY[b]) <= DBL_PX) {
        m.dbl[b] = true; m.lastClickAt[b] = 0;
      } else { m.lastClickAt[b] = now; m.lastClickX[b] = x; m.lastClickY[b] = y; }
    }
    m.stale[b] = false;
    this.syncHeld();
  }

  releaseAll() {
    const m = this.mouse;
    for (let b = 0; b < 5; b++) { m.down[b] = false; m.stale[b] = false; }
    this.syncHeld();
  }

  syncHeld() {
    const m = this.mouse;
    m.left = m.down[0]; m.middle = m.down[1]; m.right = m.down[2];
  }

  // Held on the canvas and not carried over from a menu or dialog.
  held(b) { const m = this.mouse; return m.down[b] && m.onCanvas[b] && !m.stale[b]; }

  // Drop this frame's mouse edges; buttons still held stay inert until released.
  consumeMouse() {
    const m = this.mouse;
    for (let b = 0; b < 5; b++) {
      m.hit[b] = m.up[b] = m.click[b] = m.dbl[b] = false;
      if (m.down[b]) m.stale[b] = true;
    }
    m.clicked = m.rightHit = m.middleHit = m.backHit = m.fwdHit = m.tap = false;
    m.wheel = 0;
  }

  // On-screen touch controls press keys through these.
  virtualDown(code) {
    if (!this.keys.has(code)) this.pressed.add(code);
    this.keys.add(code);
    this.lastDevice = 'touch';
  }
  virtualUp(code) { this.keys.delete(code); }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pad = null;
    for (const p of pads) if (p && p.connected) { this.pad = p; break; }
    this.padEdge.clear();
    if (!this.pad) return;
    const b = this.pad.buttons;
    const map = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
    for (const [name, i] of Object.entries(map)) {
      const down = b[i] && (b[i].pressed || b[i].value > 0.5);
      if (down && !this.padPrev[name]) { this.padEdge.add(name); this.lastDevice = 'pad'; }
      this.padPrev[name] = down;
    }
    const ax = this.pad.axes;
    if (Math.hypot(ax[0], ax[1]) > 0.3 || Math.hypot(ax[2] || 0, ax[3] || 0) > 0.3) this.lastDevice = 'pad';
  }

  padDown(name) { return !!this.padPrev[name]; }

  endFrame() {
    this.pressed.clear();
    const m = this.mouse;
    for (let b = 0; b < 5; b++) m.hit[b] = m.up[b] = m.click[b] = m.dbl[b] = false;
    m.clicked = m.anyClick = m.rightHit = m.middleHit = m.backHit = m.fwdHit = m.tap = false;
    m.wheel = 0;
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  // ----- actions -----
  // Keyboard / stick / touch-stick movement (camera-relative, y+ = south).
  moveVector() {
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y -= 1;
    if (this.down('KeyS', 'ArrowDown')) y += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.touchMove) { x += this.touchMove.x; y += this.touchMove.y; }
    if (this.pad) {
      const ax = this.pad.axes;
      if (Math.hypot(ax[0], ax[1]) > 0.2) { x += ax[0]; y += ax[1]; }
      if (this.padDown('up')) y -= 1;
      if (this.padDown('down')) y += 1;
    }
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }

  aimStick() {
    if (!this.pad) return null;
    const ax = this.pad.axes;
    const x = ax[2] || 0, y = ax[3] || 0;
    return Math.hypot(x, y) > 0.35 ? { x, y } : null;
  }

  // Mouse button roles; `swapButtons` (options: swap aim) trades them.
  get goButton() { return this.swapButtons ? 2 : 0; }
  get readyButton() { return this.swapButtons ? 0 : 2; }

  get run() { return this.down('ShiftLeft', 'ShiftRight') || this.padDown('b'); }
  get aim() { return this.held(this.readyButton) || this.down('Space', 'KeyK') || this.padDown('lt'); }
  get fire() { return (this.mouse.hit[this.goButton] && !this.mouse.stale[this.goButton]) || this.hit('KeyJ') || this.padEdge.has('rt'); }
  get interact() { return this.hit('KeyF', 'KeyE', 'Enter', 'NumpadEnter') || this.padEdge.has('a'); }
  get reload() { return this.hit('KeyR') || this.mouse.fwdHit || this.padEdge.has('rb'); }
  get tool() { return this.hit('KeyC') || this.mouse.backHit || this.padEdge.has('lb'); }
  get modules() { return this.hit('KeyT') || this.mouse.middleHit || this.padEdge.has('select'); }
  get wheel() { return this.mouse.wheel; }
  get tune() {
    if (this.mouse.wheel) return Math.sign(this.mouse.wheel);
    if (this.hit('KeyE') || this.padEdge.has('right')) return 1;
    if (this.hit('KeyQ') || this.padEdge.has('left')) return -1;
    return 0;
  }
  get leftClick() { return this.mouse.click[0]; }
  get dblClick() { return this.mouse.dbl[0]; }
  get inventory() { return this.hit('Tab', 'KeyI') || this.padEdge.has('x'); }
  get map() { return this.hit('KeyM', 'CapsLock') || this.padEdge.has('y'); }
  get pause() { return this.hit('Escape', 'KeyP') || this.padEdge.has('start'); }

  // menu navigation
  get up() { return this.hit('KeyW', 'ArrowUp') || this.padEdge.has('up'); }
  get downNav() { return this.hit('KeyS', 'ArrowDown') || this.padEdge.has('down'); }
  get left() { return this.hit('KeyA', 'ArrowLeft') || this.padEdge.has('left'); }
  get right() { return this.hit('KeyD', 'ArrowRight') || this.padEdge.has('right'); }
  get confirm() { return this.hit('KeyE', 'Enter', 'Space', 'NumpadEnter') || this.padEdge.has('a'); }
  get back() { return this.hit('Escape', 'Backspace', 'KeyQ', 'Tab') || this.mouse.rightHit || this.padEdge.has('b'); }
}
