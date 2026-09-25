// Procedural sound. Everything is synthesised at runtime with WebAudio:
// ambient drones, radio static, footsteps, gunfire, UI blips, enemy voices,
// and a small generative score for the quiet rooms.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.staticLevel = 0;
    this.musicMode = 'none';
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.enabled = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain(); this.sfx.gain.value = 0.9; this.sfx.connect(this.master);
    this.amb = ctx.createGain(); this.amb.gain.value = 0.0; this.amb.connect(this.master);
    this.mus = ctx.createGain(); this.mus.gain.value = 0.0; this.mus.connect(this.master);

    // shared reverb (generated impulse)
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.impulse(2.8, 2.2);
    this.verbSend = ctx.createGain(); this.verbSend.gain.value = 0.35;
    this.verbSend.connect(this.verb).connect(this.master);

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
    n.connect(hp).connect(bp).connect(crackle).connect(this.staticGain).connect(this.master);
    n.start();
  }

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
    n.connect(f).connect(g).connect(this.sfx); n.start(t, Math.random()); n.stop(t + 0.06);
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

  thud(vol = 0.5, freq = 60) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now();
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq * 2, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.1);
    const g = ctx.createGain(); this.env(g, t, 0.002, vol, 0.25);
    o.connect(g).connect(this.sfx); g.connect(this.verbSend); o.start(t); o.stop(t + 0.35);
    const n = this.noise();
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
    const ng = ctx.createGain(); this.env(ng, t, 0.002, vol * 0.6, 0.12);
    n.connect(f).connect(ng).connect(this.sfx); n.start(t); n.stop(t + 0.2);
  }

  locked() {
    if (!this.enabled) return;
    this.thud(0.3, 90);
    this.blip(180, 0.12, 'square', 0.08);
    this.blip(140, 0.18, 'square', 0.08, 0.12);
  }

  blip(freq = 880, dur = 0.06, type = 'square', vol = 0.06, delay = 0) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = this.now() + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); this.env(g, t, 0.002, vol, dur);
    o.connect(g).connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }

  uiMove() { this.blip(1320, 0.03, 'square', 0.035); }
  uiSelect() { this.blip(660, 0.05, 'square', 0.05); this.blip(990, 0.08, 'square', 0.05, 0.05); }
  uiBack() { this.blip(520, 0.05, 'square', 0.05); this.blip(330, 0.08, 'square', 0.05, 0.05); }
  pickup() {
    [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.12, 'triangle', 0.07, i * 0.06));
  }
  typeTick() { this.blip(1800 + Math.random() * 400, 0.012, 'square', 0.012); }

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

  heartbeat() {
    this.thud(0.35, 45);
    setTimeout(() => this.thud(0.25, 40), 170);
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
    this.mus.gain.setTargetAtTime(mode === 'memory' ? 0.5 : 0.42, t, 1.2);

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
