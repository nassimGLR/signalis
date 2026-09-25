// Keyboard, mouse and gamepad input, normalised into a small action set.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    // clicked: canvas click (gameplay). anyClick: any click anywhere (menus, text).
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, left: false, right: false, moved: false, clicked: false, anyClick: false };
    this.pad = null;
    this.padPrev = {};
    this.padEdge = new Set();
    this.lastDevice = 'kb';

    window.addEventListener('keydown', (e) => {
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.lastDevice = 'kb';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.ny = -(e.clientY / window.innerHeight) * 2 + 1;
      this.mouse.moved = true;
      this.lastDevice = 'kb';
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.left = true; this.mouse.clicked = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.anyClick = true; });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

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
    this.mouse.clicked = false;
    this.mouse.anyClick = false;
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.pressed.has(c)); }

  // ----- actions -----
  moveVector() {
    let x = 0, y = 0;
    if (this.down('KeyW', 'ArrowUp')) y -= 1;
    if (this.down('KeyS', 'ArrowDown')) y += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.pad) {
      const ax = this.pad.axes;
      if (Math.hypot(ax[0], ax[1]) > 0.2) { x += ax[0]; y += ax[1]; }
      if (this.padDown('up')) y -= 1;
      if (this.padDown('down')) y += 1;
      if (this.padDown('left')) x -= 1;
      if (this.padDown('right')) x += 1;
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

  get run() { return this.down('ShiftLeft', 'ShiftRight') || this.padDown('b') || this.padDown('lb'); }
  get aim() { return this.mouse.right || this.down('Space', 'KeyK') || this.padDown('lt'); }
  get fire() { return this.mouse.clicked || this.hit('KeyJ', 'KeyF') || this.padEdge.has('rt') || this.padEdge.has('x'); }
  get interact() { return this.hit('KeyE', 'Enter', 'NumpadEnter') || this.padEdge.has('a'); }
  get reload() { return this.hit('KeyR') || this.padEdge.has('y'); }
  get inventory() { return this.hit('Tab', 'KeyI') || this.padEdge.has('select') || this.padEdge.has('y') && false; }
  get map() { return this.hit('KeyM') || this.padEdge.has('rb'); }
  get pause() { return this.hit('Escape', 'KeyP') || this.padEdge.has('start'); }

  // menu navigation
  get up() { return this.hit('KeyW', 'ArrowUp') || this.padEdge.has('up'); }
  get downNav() { return this.hit('KeyS', 'ArrowDown') || this.padEdge.has('down'); }
  get left() { return this.hit('KeyA', 'ArrowLeft') || this.padEdge.has('left'); }
  get right() { return this.hit('KeyD', 'ArrowRight') || this.padEdge.has('right'); }
  get confirm() { return this.hit('KeyE', 'Enter', 'Space', 'NumpadEnter') || this.padEdge.has('a'); }
  get back() { return this.hit('Escape', 'Backspace', 'KeyQ', 'Tab') || this.padEdge.has('b'); }
}
