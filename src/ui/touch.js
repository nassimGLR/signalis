// On-screen controls for touch devices: a virtual stick on the left and an
// action cluster on the right. They press the same virtual keys as the
// keyboard (plan §3.5): FIRE → KeyJ, ACT → KeyE, TOOL → KeyC.
export function installTouch(input) {
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div class="t-stick"><div class="t-ring"><div class="t-knob"></div></div></div>
    <div class="t-top">
      <button class="t-btn small" data-code="Tab" aria-label="Inventory">INV</button>
      <button class="t-btn small" data-code="KeyM" aria-label="Map">MAP</button>
      <button class="t-btn small" data-code="Escape" aria-label="Pause"><span class="pz"></span></button>
    </div>
    <div class="t-pad">
      <button class="t-btn tool" data-code="KeyC">TOOL</button>
      <button class="t-btn" data-code="KeyR">RLD</button>
      <button class="t-btn" data-code="ShiftLeft" data-hold="1">RUN</button>
      <button class="t-btn aim" data-code="Space" data-hold="1">AIM</button>
      <button class="t-btn fire" data-code="KeyJ">FIRE</button>
      <button class="t-btn act" data-code="KeyE">ACT</button>
    </div>`;
  document.body.appendChild(root);

  const show = () => { document.body.classList.add('touching'); };
  window.addEventListener('touchstart', show, { passive: true, once: true });
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) show();

  // buttons
  for (const b of root.querySelectorAll('.t-btn')) {
    const code = b.dataset.code;
    const down = (e) => {
      e.preventDefault();
      b.classList.add('on');
      input.virtualDown(code);
      if (!b.dataset.hold) setTimeout(() => { input.virtualUp(code); b.classList.remove('on'); }, 90);
    };
    const up = (e) => {
      e.preventDefault();
      if (b.dataset.hold) { input.virtualUp(code); b.classList.remove('on'); }
    };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
  }

  // stick
  const zone = root.querySelector('.t-stick');
  const ring = root.querySelector('.t-ring');
  const knob = root.querySelector('.t-knob');
  let id = null, ox = 0, oy = 0;
  const R = 34;
  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    id = t.identifier; ox = t.clientX; oy = t.clientY;
    const zr = zone.getBoundingClientRect();
    ring.style.left = (ox - zr.left) + 'px';
    ring.style.top = (oy - zr.top) + 'px';
    ring.classList.add('on');
  }, { passive: false });
  zone.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== id) continue;
      let dx = t.clientX - ox, dy = t.clientY - oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = dx / l * R; dy = dy / l * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.hypot(dx, dy) / R;
      input.touchMove = m > 0.15 ? { x: dx / R, y: dy / R } : null;
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== id) continue;
      id = null;
      input.touchMove = null;
      knob.style.transform = '';
      ring.classList.remove('on');
    }
  };
  zone.addEventListener('touchend', end);
  zone.addEventListener('touchcancel', end);
}
