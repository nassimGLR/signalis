// The receiver module (plan §7.2): Wren's own maintenance band, 20.0–200.0 kHz.
//
// Stations (texts in story.js RADIO):
//   · the RELAY LOOP — a numbers loop reading the relay-room code; where it
//     sits is rolled per save within 90–160 kHz
//   · two fragments of Overseer Ostrov on fixed frequencies (the second only
//     comes in clearly from the east wing)
//   · the ARRAY QUEUE carrier, strongest near the array
//   · the UNDERTONE, anything below 40 kHz: static, a counting voice, and it
//     stirs up every Hollow in earshot. The security bulletin forbids it.
//
// B's RECEIVER tab reads this object directly as `ctx.radio`:
//   { on, freq, band:[20,200], setFreq(f), step(d), stations(), lock }
// `on` also reads true while the tab is open (the tab tunes a powered set),
// and `lock` is one stable object per station, so the tab's DECODE box types
// each payload once.
//
// In play: T / middle click toggles it, the wheel or Q / E tunes (0.5 kHz a
// notch; hold Q / E to sweep). While it is on, E tunes instead of
// interacting (F still interacts). A small RX readout shows at the top right.
import { audio } from '../engine/audio.js';
import { RADIO } from './story.js';

export const BAND = [20, 200];
export const UNDERTONE_KHZ = 40;
const LOCK_KHZ = 1.0;        // a payload decodes within this of the carrier…
const LOCK_MIN = 0.5;        // …if the station comes in at least this strong
const NOTCH = 0.5;
const SWEEP = 6;             // kHz/s while Q / E is held
const AGITATE_S = 2.5;       // the Undertone sends a stir out this often
const VIEW_MS = 250;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r1 = (v) => Math.round(v * 10) / 10;

// Signal strength by sector: [01 west, 02 concourse, 03 east wing, 04 array].
const REACH = {
  numbers: [0.9, 0.9, 0.8, 0.6],
  fragA: [0.8, 0.8, 0.7, 0.6],
  fragB: [0.3, 0.4, 0.85, 0.9],
  beacon: [0.3, 0.45, 0.8, 1],
  undertone: [0.6, 0.7, 0.8, 0.9],
};

export class Receiver {
  // save: { has, on, freq, codeF } from a v2 backup, or null
  constructor(game, save = null) {
    this.game = game;
    this.has = !!(save && save.has);
    this.power = !!(save && save.on);
    this.freq = save && save.freq ? clamp(save.freq, BAND[0], BAND[1]) : 118;
    // the relay loop sits somewhere in 90–160 kHz, rolled once per save
    this.codeF = save && save.codeF ? save.codeF : 90 + NOTCH * Math.floor(Math.random() * ((160 - 90) / NOTCH + 1));
    this.viewAt = -1e9;
    this.sector = '01';
    this.undertone = 0;
    this.agitateT = AGITATE_S;
    this.holdT = 0;
    this.sounding = false;
    this.lastLock = null;
    this.onLock = null;       // (station, fromTab) → void, set by the game
    this.defs = [
      { id: 'numbers', f: this.codeF },
      { id: 'fragA', f: RADIO.fragA.f },
      { id: 'fragB', f: RADIO.fragB.f },
      { id: 'beacon', f: RADIO.beacon.f },
      { id: 'undertone', f: RADIO.undertone.f },
    ].map((s) => ({ ...s, label: RADIO[s.id].label, text: RADIO[s.id].text, lockObj: { f: s.f, text: RADIO[s.id].text, id: s.id, label: RADIO[s.id].label } }));
  }

  serialize() { return { has: this.has, on: this.power, freq: r1(this.freq), codeF: this.codeF }; }

  // ---- B's contract
  get band() { return BAND; }
  get viewing() { return performance.now() - this.viewAt < VIEW_MS; }
  get on() { return this.has && (this.power || this.viewing); }
  setFreq(f) { this.freq = r1(clamp(Number(f) || BAND[0], BAND[0], BAND[1])); }
  step(d) { this.setFreq(this.freq + (Number(d) || 0)); }
  stations() {
    this.viewAt = performance.now();
    return this.defs.map((s) => ({ f: s.f, strength: this.strength(s), payload: s.label, id: s.id }));
  }
  get lock() {
    if (!this.on) return null;
    const s = this.nearest();
    return s && Math.abs(s.f - this.freq) <= LOCK_KHZ && this.strength(s) >= LOCK_MIN ? s.lockObj : null;
  }

  strength(s) {
    const i = Math.max(0, ['01', '02', '03', '04'].indexOf(this.sector));
    return (REACH[s.id] || REACH.numbers)[i];
  }

  nearest() {
    let best = null, bd = Infinity;
    for (const s of this.defs) {
      const d = Math.abs(s.f - this.freq);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---- play
  toggle() {
    if (!this.has) return false;
    this.power = !this.power;
    audio.click(0, this.power ? 2600 : 1400, 0.3);
    return true;
  }

  // Per frame, in play and while paused (the tab). ctx: { playing, sector,
  // input (play only), noise(x, z, r), pos }. Returns the Undertone level 0..1.
  update(dt, ctx = {}) {
    if (ctx.sector) this.sector = ctx.sector;
    const I = ctx.input;
    if (I && this.has && this.power && ctx.playing) {
      // Q / E tune only from the keyboard (touch sends ACT as its own key);
      // the wheel and the pad D-pad always tune
      const kb = I.lastDevice === 'kb';
      const t = kb ? I.tune : (I.mouse.wheel ? Math.sign(I.mouse.wheel) : I.padEdge.has('right') ? 1 : I.padEdge.has('left') ? -1 : 0);
      if (t) { this.step(t * NOTCH); this.holdT = 0; }
      const held = kb ? (I.down('KeyE') ? 1 : 0) - (I.down('KeyQ') ? 1 : 0) : 0;
      if (held) { this.holdT += dt; if (this.holdT > 0.3) this.step(held * SWEEP * dt); } else this.holdT = 0;
    }
    if (!this.on) {
      if (this.sounding) { audio.carrier(null); this.sounding = false; }
      this.undertone = 0;
      this.lastLock = null;
      this.readout(false);
      return 0;
    }
    // carrier: the tone comes up out of the hiss near a station
    const s = this.nearest();
    const d = s ? Math.abs(s.f - this.freq) : 99;
    const heard = s && this.strength(s) >= 0.3 ? d : 9;
    audio.carrier(heard);
    this.sounding = true;
    // the Undertone
    this.undertone = this.freq < UNDERTONE_KHZ ? clamp(0.25 + (UNDERTONE_KHZ - this.freq) / 20, 0, 1) : 0;
    if (this.undertone > 0 && ctx.playing && ctx.noise && ctx.pos) {
      this.agitateT -= dt;
      if (this.agitateT <= 0) {
        this.agitateT = AGITATE_S;
        ctx.noise(ctx.pos.x, ctx.pos.z, 4 + 6 * this.undertone);
      }
    } else this.agitateT = Math.min(this.agitateT, 0.8);
    // a new lock
    const L = this.lock;
    if (L !== this.lastLock) {
      this.lastLock = L;
      if (L && this.onLock) this.onLock(this.defs.find((q) => q.lockObj === L), !ctx.playing);
    }
    this.readout(!!ctx.playing, L);
    return this.undertone;
  }

  // The in-play readout: a small mono line at the top right while the set is
  // on (and nothing else is open). It carries the frequency, a five-bar meter
  // and LOCK / UNDERTONE.
  readout(show, L = null) {
    let el = this.el;
    if (!el) {
      if (!show || typeof document === 'undefined') return;
      el = this.el = document.getElementById('rx-readout') || document.createElement('div');
      el.id = 'rx-readout';
      el.style.cssText = 'position:fixed;top:14px;right:18px;z-index:2;pointer-events:none;font:500 12px/1.25 var(--font-mono,"L7 Mono",monospace);'
        + 'letter-spacing:.08em;color:var(--bone,#e8e2d4);text-align:right;text-shadow:0 0 2px #000,0 1px 0 #000;white-space:pre;';
      (document.getElementById('ui') || document.body).appendChild(el);
    }
    el.style.display = show ? '' : 'none';
    if (!show) return;
    const s = this.nearest();
    const sig = s ? this.strength(s) * Math.max(0, 1 - Math.abs(s.f - this.freq) / 4) : 0;
    const bars = '▮'.repeat(Math.round(sig * 5)) + '▯'.repeat(5 - Math.round(sig * 5));
    const tag = this.undertone > 0 ? 'UNDERTONE' : L ? 'LOCK' : '';
    const text = `RX ${this.freq.toFixed(1).padStart(5, '0')} kHz ${bars}${tag ? '\n' + tag : ''}`;
    if (text !== this._text) {
      this._text = text;
      el.textContent = text;
      el.style.color = this.undertone > 0 ? 'var(--red-hi,#ff2a3a)' : 'var(--bone,#e8e2d4)';
    }
  }

  // Title / death / level teardown: silence and hide.
  shutdown() {
    if (this.sounding) audio.carrier(null);
    this.sounding = false;
    this.readout(false);
  }
}
