// Procedural sound. Everything is synthesised at runtime with WebAudio:
// ambient drones, radio static, footsteps, gunfire, UI relay clicks, enemy
// voices, and a small generative score for the quiet rooms.
//
// Buses: world (sfx, ambience, static, reverb) → muffle low-pass → master;
// music → master; ui → master. menuMuffle(true) closes the world low-pass to
// 400 Hz while a menu is open. click/blip/thud/locked are used both by the
// game and by menus, so they follow the ui bus while the muffle is on.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.staticLevel = 0;
    this.musicMode = 'none';
    this.muffled = false;
    this._volume = 0.8;
  }

  // Master volume 0..1 (settings.volume). Safe to set before init().
  get volume() { return this._volume; }
  set volume(v) {
    this._volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.setTargetAtTime(this._volume, this.now(), 0.05);
  }
  setVolume(v) { this.volume = v; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.enabled = true;

    this.master = ctx.createGain();
    this.master.gain.value = this._volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // world bus: everything that happens "in the station", muffled by menus
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.7;
    this.world = ctx.createGain(); this.world.gain.value = 1;
    this.world.connect(this.muffle).connect(this.master);

    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.world);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.0; this.amb.connect(this.world);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.0; this.mus.connect(this.master);
    this.ui = ctx.createGain(); this.ui.gain.value = 0.9; this.ui.connect(this.master);

    // shared reverb (generated impulse)
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.8, 2.2);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.35;
    this.verbSend.connect(this.verb).connect(this.world);

    this.noiseBuf = this.makeNoise(2);
    this.buildAmbience();
    this.buildStatic();
  }

  now() { return this.ctx.currentTime; }

  makeNoise(seconds) {
    const len = this.ctx.sampleRate * seconds;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  impulse(seconds, decay) {
    const rate = this.ctx.sampleRate, len = rate * seconds;
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noise(loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop;
    return s;
  }

  // ---------- continuous layers ----------
  buildAmbience() {
    const ctx = this.ctx;
    // deep hull drone: detuned saws through a slow-moving lowpass
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = 0.22;
    for (const f of [41.2, 41.7, 61.8, 82.3]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = f > 60 ? 0.3 : 0.5;
      o.connect(og).connect(lp); o.start();
    }
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    lp.connect(g).connect(this.amb);

    // air handler hiss
    const n = this.noise(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.4;
    const ng = ctx.createGain(); ng.gain.value = 0.025;
    n.connect(bp).connect(ng).connect(this.amb); n.start();

    // mains hum
    const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 100;
    const hg = ctx.createGain(); hg.gain.value = 0.012;
    hum.connect(hg).connect(this.amb); hum.start();
    this.humGain = hg;
    this.droneFilter = lp;
  }

  buildStatic() {
    const ctx = this.ctx;
    const n = this.noise(true);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 3200; bp.gain.value = 8;
    this.staticGain = ctx.createGain(); this.staticGain.gain.value = 0;
    // crackle modulation
    const crackle = ctx.createGain(); crackle.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 13;
    const lg = ctx.createGain(); lg.gain.value = 0.5;
    lfo.connect(lg).connect(crackle.gain); lfo.start();
    n.connect(hp).connect(bp).connect(crackle).connect(this.staticGain).connect(this.world);
    n.start();
  }

  // Menus open: close the world bus down to 400 Hz and pull it back a little.
  menuMuffle(on) {
    this.muffled = !!on;
    if (!this.enabled) return;
    const t = this.now();
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setTargetAtTime(on ? 400 : 20000, t, on ? 0.04 : 0.12);
    this.world.gain.setTargetAtTime(on ? 0.7 : 1, t, 0.08);
    this.mus.gain.setTargetAtTime(this.musicMode === 'none' ? 0 : (on ? 0.25 : (this.musicMode === 'memory' ? 0.5 : 0.42)), t, 0.2);
  }

  // Output for one-shots shared by the game and the menus.
  out() { return this.muffled ? this.ui : this.sfx; }

  setAmbience(level, powered = false) {
    if (!this.enabled) return;
    const t = this.now();
    this.amb.gain.setTargetAtTime(level, t, 0.8);
    this.humGain.gain.setTargetAtTime(powered ? 0.03 : 0.008, t, 0.5);
    this.droneFilter.Q.setTargetAtTime(powered ? 3 : 7, t, 1);
  }

  setStatic(level) {
    if (!this.enabled) return;
    this.staticLevel = level;
    this.staticGain.gain.setTargetAtTime(Math.min(0.35, level * 0.35), this.now(), 0.08);
  }

  // ---------- one shots ----------
  env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  footstep(surface = 'plate', heavy = false) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const n = this.noise();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (surface === 'grate') {
      f.type = 'bandpass'; f.frequency.value = 2200 + Math.random() * 600; f.Q.value = 4;
      this.env(g, t, 0.002, heavy ? 0.5 : 0.35, 0.09);
      // metallic ring
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 480 + Math.random() * 80;
      const og = ctx.createGain(); this.env(og, t, 0.001, 0.025, 0.12);
      const of = ctx.createBiquadFilter(); of.type = 'bandpass'; of.frequency.value = 1400; of.Q.value = 10;
      o.connect(of).connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.2);
    } else if (surface === 'carpet') {
      f.type = 'lowpass'; f.frequency.value = 500; this.env(g, t, 0.005, 0.25, 0.06);
    } else {
      f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 300; f.Q.value = 2;
      this.env(g, t, 0.002, heavy ? 0.6 : 0.4, 0.08);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
      const og = ctx.createGain(); this.env(og, t, 0.002, 0.25, 0.08);
      o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.12);
    }
    n.connect(f).connect(g).connect(this.sfx);
    g.connect(this.verbSend);
    n.start(t, Math.random()); n.stop(t + 0.2);
  }

  gunshot() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(6000, t); f.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const g = ctx.createGain(); this.env(g, t, 0.001, 1.2, 0.3);
    n.connect(f).connect(g); g.connect(this.sfx); g.connect(this.verbSend);
    n.start(t); n.stop(t + 0.5);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.18);
    const og = ctx.createGain(); this.env(og, t, 0.001, 1.0, 0.2);
    o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.3);
    // mechanical click
    this.click(0.05, 3000, 0.15);
  }

  click(delay = 0, freq = 2500, vol = 0.25) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now() + delay;
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 8;
    const g = ctx.createGain(); this.env(g, t, 0.001, vol, 0.03);
    n.connect(f).connect(g).connect(this.out()); n.start(t, Math.random()); n.stop(t + 0.06);
  }

  dryFire() { this.click(0, 1800, 0.3); this.click(0.04, 1200, 0.15); }

  reload() {
    this.click(0.0, 1500, 0.3);
    this.click(0.25, 900, 0.3);
    this.click(0.55, 2200, 0.35);
    this.click(0.62, 1400, 0.25);
  }

  door(open = true) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    // servo whine
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(open ? 90 : 140, t); o.frequency.linearRampToValueAtTime(open ? 150 : 80, t + 0.6);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.05); g.gain.setValueAtTime(0.12, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(f).connect(g).connect(this.sfx); o.start(t); o.stop(t + 0.8);
    // pneumatic hiss
    const n = this.noise();
    const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 2500;
    const ng = ctx.createGain(); this.env(ng, t, 0.01, 0.2, 0.5);
    n.connect(nf).connect(ng).connect(this.sfx); ng.connect(this.verbSend);
    n.start(t); n.stop(t + 0.6);
    // clunk at end
    setTimeout(() => this.thud(0.4, 70), 600);
  }

  thud(vol = 0.5, freq = 60, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now() + delay, bus = this.out();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.1);
    const g = ctx.createGain(); this.env(g, t, 0.002, vol, 0.25);
    o.connect(g).connect(bus); if (!this.muffled) g.connect(this.verbSend); o.start(t); o.stop(t + 0.35);
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const ng = ctx.createGain(); this.env(ng, t, 0.002, vol * 0.6, 0.12);
    n.connect(f).connect(ng).connect(bus); n.start(t); n.stop(t + 0.2);
  }

  // Denied: a relay that tries to close and drops back, over a dull knock.
  locked() {
    if (!this.enabled) return;
    this.thud(0.3, 90);
    this.click(0.0, 900, 0.3);
    this.click(0.09, 700, 0.22);
    this.softThunk(0.12, 70, 0.18);
  }

  blip(freq = 880, dur = 0.06, type = 'square', vol = 0.06, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now() + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); this.env(g, t, 0.002, vol, dur);
    o.connect(g).connect(this.out()); o.start(t); o.stop(t + dur + 0.05);
  }

  // A tick of filtered noise: the body of every relay click. Always on the UI bus.
  tick(delay = 0, freq = 3000, vol = 0.15, q = 6, len = 0.018) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now() + delay;
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); this.env(g, t, 0.0008, vol, len);
    n.connect(f).connect(g).connect(this.ui); n.start(t, Math.random()); n.stop(t + len + 0.03);
  }

  // A soft, felt thunk (a key bottoming out). Always on the UI bus.
  softThunk(delay = 0, freq = 110, vol = 0.14) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now() + delay;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 1.6, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const g = ctx.createGain(); this.env(g, t, 0.002, vol, 0.07);
    o.connect(g).connect(this.ui); o.start(t); o.stop(t + 0.12);
  }

  // UI: relay clicks and soft thunks — no square-wave beeps.
  uiMove() { this.tick(0, 3400 + Math.random() * 300, 0.1, 8, 0.012); }
  uiSelect() { this.tick(0, 2400, 0.2, 6); this.tick(0.028, 1500, 0.14, 5); this.softThunk(0.03, 120, 0.12); }
  uiBack() { this.tick(0, 1700, 0.16, 5); this.softThunk(0.02, 85, 0.13); }
  pickup() {
    if (!this.enabled) return;
    this.click(0, 1800, 0.18);
    this.thud(0.18, 110, 0.02);
    const ctx = this.ctx, t = this.now() + 0.06;
    [[392, 0], [587, 0.09]].forEach(([f, d]) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); this.env(g, t + d, 0.004, 0.05, 0.35);
      o.connect(g).connect(this.out()); o.start(t + d); o.stop(t + d + 0.45);
    });
  }
  typeTick() { this.tick(0, 4200 + Math.random() * 800, 0.035, 4, 0.008); }

  hurt() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    this.thud(0.7, 50);
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 1;
    const g = ctx.createGain(); this.env(g, t, 0.005, 0.5, 0.35);
    n.connect(f).connect(g).connect(this.sfx); n.start(t); n.stop(t + 0.5);
    // digital distress chirp
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    const og = ctx.createGain(); this.env(og, t, 0.002, 0.08, 0.25);
    o.connect(og).connect(this.sfx); o.start(t); o.stop(t + 0.3);
  }

  // Enemy vocalisation: a formant-swept buzz, detuned and torn.
  groan(pan = 0, vol = 0.25, pitch = 1) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const dur = 0.8 + Math.random() * 0.8;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    const base = (70 + Math.random() * 30) * pitch;
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * (0.7 + Math.random() * 0.2), t + dur);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = base * 1.51;
    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 7;
    f1.frequency.setValueAtTime(500, t); f1.frequency.linearRampToValueAtTime(900 + Math.random() * 600, t + dur * 0.5);
    f1.frequency.linearRampToValueAtTime(350, t + dur);
    const trem = ctx.createGain(); trem.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9 + Math.random() * 12;
    const lg = ctx.createGain(); lg.gain.value = 0.4; lfo.connect(lg).connect(trem.gain);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.1); g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(f1); o2.connect(f1);
    f1.connect(trem).connect(g).connect(p).connect(this.sfx);
    g.connect(this.verbSend);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(t + dur + 0.1); });
  }

  screech(pan = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 12;
    f.frequency.setValueAtTime(2400, t); f.frequency.exponentialRampToValueAtTime(700, t + 0.4);
    const g = ctx.createGain(); this.env(g, t, 0.01, 0.6, 0.4);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    n.connect(f).connect(g).connect(p).connect(this.sfx); g.connect(this.verbSend);
    n.start(t); n.stop(t + 0.5);
    this.groan(pan, 0.3, 1.6);
  }

  impact(flesh = true) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = flesh ? 'lowpass' : 'bandpass';
    f.frequency.value = flesh ? 700 : 3500; f.Q.value = flesh ? 1 : 6;
    const g = ctx.createGain(); this.env(g, t, 0.001, flesh ? 0.5 : 0.3, flesh ? 0.12 : 0.08);
    n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.2);
  }

  collapse() { this.thud(0.6, 45); setTimeout(() => this.thud(0.35, 60), 180); }

  // Sub-bass heartbeat (55 Hz). The caller repeats it every ~0.9 s.
  heartbeat() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    [[55, 0, 0.5], [48, 0.17, 0.32]].forEach(([f, d, v]) => {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.35, t + d); o.frequency.exponentialRampToValueAtTime(f, t + d + 0.05);
      const g = ctx.createGain(); this.env(g, t + d, 0.006, v, 0.16);
      o.connect(g).connect(this.master); o.start(t + d); o.stop(t + d + 0.25);
    });
  }

  // Door relay: a hard double clack and a low latch knock.
  latch() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    for (const [d, f, v] of [[0, 2600, 0.4], [0.035, 1400, 0.3]]) {
      const n = this.noise();
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 5;
      const g = ctx.createGain(); this.env(g, t + d, 0.0008, v, 0.025);
      n.connect(bp).connect(g).connect(this.sfx); g.connect(this.verbSend);
      n.start(t + d, Math.random()); n.stop(t + d + 0.06);
    }
    this.thud(0.35, 55, 0.04);
  }

  // Backup deck: capstan motor, tape hiss with flutter, a relay at the end.
  tapeSpool(seconds = 1.2) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now(), end = t + seconds;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.25);
    o.frequency.setValueAtTime(150, end - 0.2); o.frequency.exponentialRampToValueAtTime(60, end);
    const flut = ctx.createOscillator(); flut.frequency.value = 7;
    const fg = ctx.createGain(); fg.gain.value = 4; flut.connect(fg).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 520; lp.Q.value = 1.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.15); g.gain.setValueAtTime(0.06, end - 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(lp).connect(g).connect(this.sfx);
    const n = this.noise(true);
    const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 5200; hp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.05, t + 0.1); ng.gain.setValueAtTime(0.05, end - 0.15);
    ng.gain.exponentialRampToValueAtTime(0.0001, end);
    n.connect(hp).connect(ng).connect(this.sfx);
    [o, flut, n].forEach((x) => { x.start(t); x.stop(end + 0.05); });
    this.click(0, 2200, 0.25);
    setTimeout(() => { this.click(0, 1600, 0.3); this.thud(0.2, 90); }, seconds * 1000);
  }

  // Pneumatic locker: a rush up the tube, a thump as the carrier lands, a hiss.
  pneumatic() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    n.connect(f).connect(g).connect(this.out()); n.start(t, Math.random()); n.stop(t + 0.6);
    this.thud(0.45, 60, 0.5);
    const h = this.noise();
    const hf = ctx.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 3000;
    const hg = ctx.createGain(); this.env(hg, t + 0.55, 0.01, 0.12, 0.5);
    h.connect(hf).connect(hg).connect(this.out()); h.start(t + 0.55, Math.random()); h.stop(t + 1.2);
  }

  // Finishing stomp: boot impact, a crunch, a short metallic crack.
  stomp() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    this.thud(0.9, 42);
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 1.4;
    const g = ctx.createGain(); this.env(g, t, 0.001, 0.55, 0.14);
    n.connect(f).connect(g).connect(this.sfx); g.connect(this.verbSend);
    n.start(t, Math.random()); n.stop(t + 0.25);
    this.click(0.01, 3800, 0.3);
    this.click(0.05, 2600, 0.2);
  }

  // Scuttle wick: a strike, then a sizzling burn for `seconds`.
  flare(seconds = 3) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now(), end = t + seconds;
    const s = this.noise();
    const sf = ctx.createBiquadFilter(); sf.type = 'highpass'; sf.frequency.value = 2500;
    const sg = ctx.createGain(); this.env(sg, t, 0.002, 0.4, 0.12);
    s.connect(sf).connect(sg).connect(this.sfx); s.start(t, Math.random()); s.stop(t + 0.2);
    const n = this.noise(true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1600; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.25); g.gain.setValueAtTime(0.22, end - 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const crackle = ctx.createGain(); crackle.gain.value = 0.7;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 23;
    const lg = ctx.createGain(); lg.gain.value = 0.3; lfo.connect(lg).connect(crackle.gain);
    n.connect(bp).connect(crackle).connect(g).connect(this.sfx); g.connect(this.verbSend);
    const roar = ctx.createOscillator(); roar.type = 'sawtooth'; roar.frequency.value = 58;
    const rl = ctx.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 220;
    const rg = ctx.createGain(); rg.gain.setValueAtTime(0.0001, t + 0.1);
    rg.gain.exponentialRampToValueAtTime(0.05, t + 0.3); rg.gain.exponentialRampToValueAtTime(0.0001, end);
    roar.connect(rl).connect(rg).connect(this.sfx);
    [n, lfo, roar].forEach((x) => { x.start(t); x.stop(end + 0.05); });
  }

  // Shunt cartridge surge: a mains buzz torn by crackle, then a snap.
  arc() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now(), end = t + 0.5;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 241;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
    const g = ctx.createGain(); this.env(g, t, 0.003, 0.25, 0.45);
    const gate = ctx.createGain(); gate.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 31;
    const lg = ctx.createGain(); lg.gain.value = 0.4; lfo.connect(lg).connect(gate.gain);
    o.connect(bp); o2.connect(bp); bp.connect(gate).connect(g).connect(this.sfx); g.connect(this.verbSend);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(end); });
    this.click(0, 5200, 0.45);
    this.click(0.46, 3000, 0.35);
  }

  // Receiver carrier. delta: distance in kHz from the nearest station, or
  // null to switch it off. Near a station the tone comes up out of the hiss.
  carrier(delta) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    if (!this.carrierNodes) {
      const tone = ctx.createOscillator(); tone.type = 'sine'; tone.frequency.value = 1020;
      const tone2 = ctx.createOscillator(); tone2.type = 'sine'; tone2.frequency.value = 1020 * 1.5;
      const tg = ctx.createGain(); tg.gain.value = 0;
      const t2g = ctx.createGain(); t2g.gain.value = 0.3;
      tone.connect(tg); tone2.connect(t2g).connect(tg);
      const n = this.noise(true);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.5;
      const ng = ctx.createGain(); ng.gain.value = 0;
      n.connect(bp).connect(ng);
      const out = ctx.createGain(); out.gain.value = 1;
      tg.connect(out); ng.connect(out); out.connect(this.master);
      [tone, tone2, n].forEach((x) => x.start());
      this.carrierNodes = { tone, tone2, tg, ng };
    }
    const c = this.carrierNodes;
    if (delta === null || delta === undefined || delta === false) {
      c.tg.gain.setTargetAtTime(0, t, 0.05); c.ng.gain.setTargetAtTime(0, t, 0.05);
      return;
    }
    const d = Math.abs(Number(delta)) || 0;
    const lock = Math.max(0, 1 - d / 2.5);
    c.tg.gain.setTargetAtTime(0.07 * lock * lock, t, 0.05);
    c.ng.gain.setTargetAtTime(0.03 + 0.09 * (1 - lock), t, 0.05);
    c.tone.frequency.setTargetAtTime(1020 + d * 60, t, 0.05);
    c.tone2.frequency.setTargetAtTime((1020 + d * 60) * 1.5, t, 0.05);
  }

  powerUp() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(30, t); o.frequency.exponentialRampToValueAtTime(240, t + 2.5);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 2.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(f).connect(g).connect(this.sfx); g.connect(this.verbSend); o.start(t); o.stop(t + 3.3);
    setTimeout(() => { this.thud(0.8, 40); this.click(0, 900, 0.5); }, 2300);
  }

  radioBurst(len = 0.4) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
    const g = ctx.createGain(); this.env(g, t, 0.01, 0.25, len);
    n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + len + 0.05);
  }

  distantClank() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const freqs = [310, 437, 612, 890];
    const pan = Math.random() * 2 - 1;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    const out = ctx.createGain(); out.gain.value = 0.05 + Math.random() * 0.05;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    out.connect(lp).connect(p); p.connect(this.verbSend); p.connect(this.amb);
    for (const fq of freqs) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fq * (0.9 + Math.random() * 0.2);
      const g = ctx.createGain(); this.env(g, t, 0.002, 0.3, 1.5 + Math.random());
      o.connect(g).connect(out); o.start(t); o.stop(t + 3);
    }
  }

  // ---------- music ----------
  // A slow, generative "quiet room" piece: a detuned electric-piano arpeggio
  // over a pad in D minor, with tape wobble. Plays while in a safe room.
  setMusic(mode) {
    if (!this.enabled || mode === this.musicMode) return;
    this.musicMode = mode;
    const t = this.now();
    clearInterval(this.musicTimer);
    if (this.padNodes) {
      const old = this.padNodes;
      old.gain.gain.setTargetAtTime(0.0001, t, 0.6);
      setTimeout(() => old.oscs.forEach((o) => o.stop()), 3000);
      this.padNodes = null;
    }
    if (mode === 'none') { this.mus.gain.setTargetAtTime(0, t, 0.8); return; }
    this.mus.gain.setTargetAtTime(this.muffled ? 0.25 : (mode === 'memory' ? 0.5 : 0.42), t, 1.2);

    const ctx = this.ctx;
    const padG = ctx.createGain(); padG.gain.value = 0.0001;
    padG.gain.setTargetAtTime(0.09, t, 2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    padG.connect(lp).connect(this.mus); lp.connect(this.verbSend);
    const chords = mode === 'memory'
      ? [[146.8, 220, 277.2], [130.8, 196, 261.6], [116.5, 174.6, 233.1], [110, 164.8, 220]]
      : [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [130.8, 164.8, 196], [110, 138.6, 164.8]];
    const oscs = [];
    const voices = chords[0].map((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = f * 1.004;
      const vg = ctx.createGain(); vg.gain.value = 0.3;
      const vg2 = ctx.createGain(); vg2.gain.value = 0.08;
      o.connect(vg).connect(padG); o2.connect(vg2).connect(padG);
      o.start(); o2.start(); oscs.push(o, o2);
      return [o, o2];
    });
    // tape wobble
    const wob = ctx.createOscillator(); wob.frequency.value = 0.35;
    const wg = ctx.createGain(); wg.gain.value = 1.2;
    wob.connect(wg); voices.forEach(([a, b]) => { wg.connect(a.detune); wg.connect(b.detune); });
    wob.start(); oscs.push(wob);
    this.padNodes = { gain: padG, oscs };

    let step = 0;
    const scale = mode === 'memory'
      ? [587.3, 659.3, 698.5, 880, 987.8, 1174.7]
      : [587.3, 698.5, 880, 783.9, 659.3, 523.3, 440];
    const beat = mode === 'memory' ? 700 : 620;
    this.musicTimer = setInterval(() => {
      const bar = Math.floor(step / 8) % chords.length;
      if (step % 8 === 0) {
        const tt = this.now();
        chords[bar].forEach((f, i) => {
          voices[i][0].frequency.setTargetAtTime(f, tt, 0.4);
          voices[i][1].frequency.setTargetAtTime(f * 1.004, tt, 0.4);
        });
      }
      // sparse bell arpeggio
      if (Math.random() < (step % 2 === 0 ? 0.8 : 0.35)) {
        const root = chords[bar][0] * 4;
        const pool = scale.filter((f) => f >= root * 0.9 || Math.random() < 0.5);
        const f = pool[(step * 3 + bar) % pool.length];
        this.bell(f * (Math.random() < 0.15 ? 0.5 : 1), 0.05);
      }
      step++;
    }, beat);
  }

  bell(freq, vol = 0.05) {
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const m = ctx.createOscillator(); m.type = 'sine'; m.frequency.value = freq * 3.01;
    const mg = ctx.createGain(); mg.gain.value = freq * 0.6;
    mg.gain.setValueAtTime(freq * 0.8, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    m.connect(mg).connect(o.frequency);
    const g = ctx.createGain(); this.env(g, t, 0.004, vol, 2.2);
    o.connect(g).connect(this.mus); g.connect(this.verbSend);
    o.start(t); m.start(t); o.stop(t + 2.5); m.stop(t + 2.5);
  }

  // Title sting: a descending detuned chord swallowed by static.
  sting() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    [220, 207.7, 155.6, 110].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      o.frequency.linearRampToValueAtTime(f * 0.97, t + 4);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
      lp.frequency.exponentialRampToValueAtTime(200, t + 4);
      const g = ctx.createGain(); this.env(g, t + i * 0.05, 0.02, 0.08, 4);
      o.connect(lp).connect(g).connect(this.sfx); g.connect(this.verbSend);
      o.start(t); o.stop(t + 4.5);
    });
    this.radioBurst(1.2);
  }
}

export const audio = new Audio();
