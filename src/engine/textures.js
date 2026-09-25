// Procedural low-resolution textures. Everything here is painted in code onto
// small canvases and sampled with nearest filtering so it reads as chunky,
// hand-pixelled 32-bit-era art.
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const rgba = rgb;

// Adds per-pixel value noise to a canvas region.
function speckle(g, w, h, amount, r, seed = 7) {
  const img = g.getImageData(0, 0, w, h);
  const R = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (R() - 0.5) * amount;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

function carpet(base, dark, light, seed) {
  const [c, g] = canvas(32, 32);
  g.fillStyle = rgb(...base); g.fillRect(0, 0, 32, 32);
  const R = rng(seed);
  // a low-contrast weave: short horizontal flecks rather than salt-and-pepper
  const mid = base.map((v, j) => (v + light[j]) / 2), low = base.map((v, j) => (v + dark[j]) / 2);
  for (let i = 0; i < 150; i++) {
    g.fillStyle = rgb(...(R() > 0.5 ? mid : low));
    g.fillRect((R() * 32) | 0, (R() * 32) | 0, 1 + (R() > 0.6 ? 1 : 0), 1);
  }
  // tile seams every 16 px and a faint inset square per tile
  g.fillStyle = rgb(...dark);
  for (let i = 0; i < 32; i += 16) { g.fillRect(0, i, 32, 1); g.fillRect(i, 0, 1, 32); }
  g.fillStyle = rgba(...light, 0.22);
  for (let ty = 0; ty < 32; ty += 16) for (let tx = 0; tx < 32; tx += 16) {
    g.fillRect(tx + 3, ty + 3, 10, 1); g.fillRect(tx + 3, ty + 12, 10, 1); g.fillRect(tx + 3, ty + 3, 1, 10); g.fillRect(tx + 12, ty + 3, 1, 10);
  }
  return toTexture(c);
}

// Irregular grime blotches.
function grime(g, w, h, count, color, seed = 3, maxR = 10) {
  const R = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = R() * w, y = R() * h, r = 2 + R() * maxR;
    g.fillStyle = color;
    for (let k = 0; k < 14; k++) {
      const a = R() * Math.PI * 2, d = R() * r;
      const s = 1 + R() * 3;
      g.fillRect((x + Math.cos(a) * d) | 0, (y + Math.sin(a) * d) | 0, s, s);
    }
  }
}

function rivet(g, x, y, light = 'rgba(255,255,255,0.35)', dark = 'rgba(0,0,0,0.5)') {
  g.fillStyle = dark; g.fillRect(x, y, 2, 2);
  g.fillStyle = light; g.fillRect(x, y, 1, 1);
}

// ---------------------------------------------------------------------------
// A tiny hand-pixelled font (5 rows, variable width) for signage, screens and
// posters. Latin capitals, digits, some punctuation and the Cyrillic capitals
// used by the station's Russian glosses. Canvas text at these sizes blurs into
// grey mush once nearest-sampled; these stay crisp.
const G5 = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'], J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'], N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '##.'],
  ' ': ['..', '..', '..', '..', '..'], '.': ['.', '.', '.', '.', '#'], ',': ['.', '.', '.', '#', '#'],
  '-': ['...', '...', '###', '...', '...'], '/': ['..#', '..#', '.#.', '#..', '#..'],
  ':': ['.', '#', '.', '#', '.'], '!': ['#', '#', '#', '.', '#'], '?': ['##.', '..#', '.#.', '...', '.#.'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'], '<': ['..#', '.#.', '#..', '.#.', '..#'],
  '_': ['...', '...', '...', '...', '###'], '(': ['.#', '#.', '#.', '#.', '.#'], ')': ['#.', '.#', '.#', '.#', '#.'],
  '—': ['....', '....', '####', '....', '....'], '·': ['.', '.', '#', '.', '.'], "'": ['#', '#', '.', '.', '.'],
  '+': ['...', '.#.', '###', '.#.', '...'], '=': ['...', '###', '...', '###', '...'], '#': ['#.#', '###', '#.#', '###', '#.#'],
  '%': ['#.#', '..#', '.#.', '#..', '#.#'], '[': ['##', '#.', '#.', '#.', '##'], ']': ['##', '.#', '.#', '.#', '##'],
  '§': ['.##', '#..', '###', '..#', '##.'], '×': ['...', '#.#', '.#.', '#.#', '...'], '"': ['#.#', '#.#', '...', '...', '...'],
  // Cyrillic capitals (shared shapes point at the Latin glyphs)
  Б: ['###', '#..', '##.', '#.#', '##.'], Г: ['###', '#..', '#..', '#..', '#..'],
  Д: ['.##.', '.#.#', '.#.#', '####', '#..#'], Ж: ['#.#.#', '#.#.#', '.###.', '#.#.#', '#.#.#'],
  З: ['##.', '..#', '.#.', '..#', '##.'], И: ['#..#', '#.##', '##.#', '#..#', '#..#'],
  Л: ['.###', '.#.#', '.#.#', '.#.#', '##.#'],
  П: ['###', '#.#', '#.#', '#.#', '#.#'], У: ['#.#', '#.#', '.##', '..#', '##.'],
  Ф: ['.###.', '#.#.#', '#.#.#', '.###.', '..#..'], Ц: ['#.#.', '#.#.', '#.#.', '#.#.', '####'],
  Ч: ['#.#', '#.#', '.##', '..#', '..#'], Ш: ['#.#.#', '#.#.#', '#.#.#', '#.#.#', '#####'],
  Щ: ['#.#.#', '#.#.#', '#.#.#', '#####', '....#'], Ъ: ['##..', '.#..', '.##.', '.#.#', '.##.'],
  Ы: ['#...#', '#...#', '##..#', '#.#.#', '##..#'], Ь: ['#..', '#..', '##.', '#.#', '##.'],
  Э: ['##.', '..#', '.##', '..#', '##.'], Ю: ['#.##.', '#.#.#', '###.#', '#.#.#', '#.##.'],
  Я: ['.##', '#.#', '.##', '#.#', '#.#'],
};
const SAME = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X' };
// Letters with a mark above: the base glyph plus one row drawn two pixels over
// the cap height (the 7px line pitch leaves exactly that row free).
const ACCENT = { Й: ['И', '.##.'], Ё: ['E', '#.#'] };
function glyph(ch) {
  const c = ch.toUpperCase();
  if (ACCENT[c]) return G5[ACCENT[c][0]];
  return G5[c] || G5[SAME[c]] || G5['?'];
}

// Width in pixels of `text` at `scale`, with 1px (×scale) letter spacing.
export function pixelTextWidth(text, scale = 1, spacing = 1) {
  let w = 0;
  for (const ch of String(text)) w += (glyph(ch)[0].length + spacing) * scale;
  return Math.max(0, w - spacing * scale);
}

// Paints `text` with its top-left at (x, y). align: 'left' | 'center' | 'right'.
export function pixelText(g, text, x, y, color, { scale = 1, align = 'left', spacing = 1 } = {}) {
  const w = pixelTextWidth(text, scale, spacing);
  let cx = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x);
  g.fillStyle = color;
  for (const ch of String(text)) {
    const rows = glyph(ch);
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let i = 0; i < row.length; i++) if (row[i] === '#') g.fillRect(cx + i * scale, y + r * scale, scale, scale);
    }
    const acc = ACCENT[ch.toUpperCase()];
    if (acc) for (let i = 0; i < acc[1].length; i++) if (acc[1][i] === '#') g.fillRect(cx + i * scale, y - 2 * scale, scale, scale);
    cx += (rows[0].length + spacing) * scale;
  }
  return w;
}

const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

export const Tex = {
  floorPlate: () => memo('floorPlate', () => {
    const [c, g] = canvas(32, 32);
    g.fillStyle = rgb(78, 84, 86); g.fillRect(0, 0, 32, 32);
    // two plates per tile with bevelled seams
    for (const [x, y, w, h] of [[0, 0, 32, 16], [0, 16, 32, 16]]) {
      g.fillStyle = rgb(92, 98, 99); g.fillRect(x + 1, y + 1, w - 2, 1);
      g.fillStyle = rgb(40, 44, 46); g.fillRect(x, y + h - 1, w, 1);
      g.fillStyle = rgb(52, 56, 58); g.fillRect(x + w - 1, y, 1, h);
      rivet(g, x + 2, y + 3); rivet(g, x + w - 4, y + 3);
      rivet(g, x + 2, y + h - 4); rivet(g, x + w - 4, y + h - 4);
    }
    // tread pattern
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 4; y < 32; y += 4) for (let x = (y % 8 ? 6 : 8); x < 30; x += 6) g.fillRect(x, y, 2, 1);
    speckle(g, 32, 32, 18, 1, 11);
    grime(g, 32, 32, 3, 'rgba(20,18,16,0.18)', 5, 6);
    return toTexture(c);
  }),

  floorGrate: () => memo('floorGrate', () => {
    const [c, g] = canvas(32, 32);
    g.fillStyle = rgb(8, 9, 10); g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 32; i += 4) {
      g.fillStyle = rgb(70, 74, 72); g.fillRect(i, 0, 2, 32);
      g.fillStyle = rgb(96, 100, 96); g.fillRect(i, 0, 1, 32);
    }
    for (let j = 0; j < 32; j += 8) {
      g.fillStyle = rgb(60, 63, 62); g.fillRect(0, j, 32, 2);
      g.fillStyle = rgb(110, 112, 106); g.fillRect(0, j, 32, 1);
    }
    g.fillStyle = rgb(30, 32, 33); g.fillRect(0, 31, 32, 1); g.fillRect(31, 0, 1, 32);
    speckle(g, 32, 32, 20, 1, 21);
    return toTexture(c);
  }),

  floorTileWhite: () => memo('floorTileWhite', () => {
    const [c, g] = canvas(32, 32);
    g.fillStyle = rgb(150, 160, 158); g.fillRect(0, 0, 32, 32);
    g.fillStyle = rgb(96, 106, 106);
    for (let i = 0; i < 32; i += 8) { g.fillRect(i, 0, 1, 32); g.fillRect(0, i, 32, 1); }
    speckle(g, 32, 32, 16, 1, 31);
    grime(g, 32, 32, 4, 'rgba(60,50,40,0.18)', 33, 8);
    return toTexture(c);
  }),

  // Institutional carpet tile: umber with a darker border and a worn path.
  floorCarpet: () => memo('floorCarpet', () => carpet([74, 56, 42], [58, 42, 32], [96, 76, 56], 44)),
  // Cold slate carpet for the observation deck.
  floorCarpetSlate: () => memo('floorCarpetSlate', () => carpet([52, 58, 64], [38, 43, 48], [74, 82, 88], 45)),

  floorConcrete: () => memo('floorConcrete', () => {
    const [c, g] = canvas(32, 32);
    g.fillStyle = rgb(66, 68, 66); g.fillRect(0, 0, 32, 32);
    speckle(g, 32, 32, 30, 1, 51);
    grime(g, 32, 32, 6, 'rgba(24,22,20,0.25)', 52, 9);
    g.fillStyle = rgb(40, 42, 40); g.fillRect(0, 0, 32, 1); g.fillRect(0, 0, 1, 32);
    return toTexture(c);
  }),

  // Wall textures are one tile wide and span the full wall height.
  wallPanel: () => memo('wallPanel', () => {
    const [c, g] = canvas(32, 80);
    g.fillStyle = rgb(92, 104, 102); g.fillRect(0, 0, 32, 80);
    // upper panels
    g.fillStyle = rgb(104, 116, 113); g.fillRect(1, 2, 30, 44);
    g.fillStyle = rgb(70, 80, 79); g.fillRect(1, 46, 30, 1); g.fillRect(31, 2, 1, 44);
    g.fillStyle = rgb(126, 136, 132); g.fillRect(1, 2, 30, 1);
    // vent slats
    g.fillStyle = rgb(48, 54, 54);
    for (let y = 10; y < 22; y += 3) g.fillRect(8, y, 16, 1);
    // accent band
    g.fillStyle = rgb(150, 30, 34); g.fillRect(0, 50, 32, 3);
    g.fillStyle = rgb(90, 16, 20); g.fillRect(0, 53, 32, 1);
    // lower wainscot
    g.fillStyle = rgb(46, 52, 54); g.fillRect(0, 54, 32, 26);
    g.fillStyle = rgb(60, 66, 68); g.fillRect(0, 54, 32, 1);
    g.fillStyle = rgb(30, 34, 36); g.fillRect(15, 54, 1, 26);
    rivet(g, 3, 58); rivet(g, 27, 58); rivet(g, 3, 75); rivet(g, 27, 75);
    rivet(g, 3, 5); rivet(g, 27, 5);
    speckle(g, 32, 80, 14, 1, 61);
    grime(g, 32, 80, 3, 'rgba(20,16,14,0.25)', 62, 8);
    // drip streaks
    const R = rng(63);
    for (let i = 0; i < 3; i++) {
      const x = (R() * 30) | 0, y0 = (R() * 40) | 0, len = 6 + R() * 20;
      g.fillStyle = 'rgba(30,24,20,0.25)'; g.fillRect(x, y0, 1, len);
    }
    return toTexture(c);
  }),

  wallMedical: () => memo('wallMedical', () => {
    const [c, g] = canvas(32, 80);
    g.fillStyle = rgb(170, 180, 176); g.fillRect(0, 0, 32, 80);
    g.fillStyle = rgb(120, 132, 130);
    for (let y = 0; y < 80; y += 8) g.fillRect(0, y, 32, 1);
    for (let x = 0; x < 32; x += 8) g.fillRect(x, 0, 1, 80);
    g.fillStyle = rgb(60, 130, 124); g.fillRect(0, 48, 32, 4);
    g.fillStyle = rgb(94, 104, 104); g.fillRect(0, 60, 32, 20);
    speckle(g, 32, 80, 16, 1, 71);
    grime(g, 32, 80, 5, 'rgba(70,40,30,0.25)', 72, 9);
    return toTexture(c);
  }),

  wallConcrete: () => memo('wallConcrete', () => {
    const [c, g] = canvas(32, 80);
    g.fillStyle = rgb(84, 86, 82); g.fillRect(0, 0, 32, 80);
    speckle(g, 32, 80, 34, 1, 81);
    g.fillStyle = rgb(56, 58, 56);
    for (let y = 19; y < 80; y += 20) g.fillRect(0, y, 32, 1);
    g.fillRect(31, 0, 1, 80);
    g.fillStyle = rgb(40, 42, 40); g.fillRect(0, 64, 32, 16);
    grime(g, 32, 80, 6, 'rgba(16,14,12,0.3)', 82, 10);
    return toTexture(c);
  }),

  wallWood: () => memo('wallWood', () => {
    const [c, g] = canvas(32, 80);
    g.fillStyle = rgb(72, 48, 34); g.fillRect(0, 0, 32, 80);
    const R = rng(91);
    for (let x = 0; x < 32; x += 8) {
      const tone = 60 + R() * 20;
      g.fillStyle = rgb(tone + 10, tone - 14, tone - 30); g.fillRect(x, 0, 8, 80);
      g.fillStyle = rgb(34, 22, 16); g.fillRect(x, 0, 1, 80);
      for (let y = 0; y < 80; y += 2) {
        if (R() > 0.7) { g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(x + 1 + ((R() * 6) | 0), y, 1, 2 + R() * 4); }
      }
    }
    g.fillStyle = rgb(40, 28, 20); g.fillRect(0, 60, 32, 2);
    g.fillStyle = rgb(38, 30, 26); g.fillRect(0, 62, 32, 18);
    speckle(g, 32, 80, 12, 1, 92);
    return toTexture(c);
  }),

  door: (label = '', stripe = true) => memo('door' + label + stripe, () => {
    const [c, g] = canvas(32, 80);
    g.fillStyle = rgb(60, 66, 68); g.fillRect(0, 0, 32, 80);
    // two leaves
    g.fillStyle = rgb(118, 124, 120); g.fillRect(2, 2, 13, 76); g.fillRect(17, 2, 13, 76);
    g.fillStyle = rgb(140, 144, 138); g.fillRect(2, 2, 13, 1); g.fillRect(17, 2, 13, 1);
    g.fillStyle = rgb(24, 26, 28); g.fillRect(15, 0, 2, 80);
    // window slits
    g.fillStyle = rgb(20, 30, 34); g.fillRect(6, 12, 5, 14); g.fillRect(21, 12, 5, 14);
    g.fillStyle = rgb(60, 80, 86); g.fillRect(6, 12, 5, 1); g.fillRect(21, 12, 5, 1);
    if (stripe) {
      for (let i = -80; i < 32; i += 6) {
        g.fillStyle = rgb(170, 30, 34);
        g.beginPath(); g.moveTo(i, 80); g.lineTo(i + 3, 80); g.lineTo(i + 3 + 14, 62); g.lineTo(i + 14, 62); g.fill();
      }
      g.fillStyle = rgb(210, 200, 180); g.fillRect(0, 61, 32, 1);
    }
    if (label) {
      const w = pixelTextWidth(label);
      g.fillStyle = rgb(24, 26, 28); g.fillRect(16 - Math.ceil(w / 2) - 2, 35, w + 4, 9);
      pixelText(g, label, 16, 37, rgb(226, 220, 204), { align: 'center' });
    }
    rivet(g, 4, 30); rivet(g, 27, 30); rivet(g, 4, 50); rivet(g, 27, 50);
    speckle(g, 32, 80, 16, 1, 101);
    return toTexture(c, false);
  }),

  metal: (tone = 90, seed = 5) => memo('metal' + tone + seed, () => {
    const [c, g] = canvas(16, 16);
    g.fillStyle = rgb(tone, tone + 4, tone + 4); g.fillRect(0, 0, 16, 16);
    speckle(g, 16, 16, 22, 1, seed);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 15, 16, 1); g.fillRect(15, 0, 1, 16);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 16, 1);
    return toTexture(c);
  }),

  hazard: () => memo('hazard', () => {
    const [c, g] = canvas(32, 8);
    g.fillStyle = rgb(24, 24, 24); g.fillRect(0, 0, 32, 8);
    g.fillStyle = rgb(190, 150, 40);
    for (let i = -8; i < 40; i += 8) {
      g.beginPath(); g.moveTo(i, 8); g.lineTo(i + 4, 8); g.lineTo(i + 8, 0); g.lineTo(i + 4, 0); g.fill();
    }
    speckle(g, 32, 8, 20, 1, 111);
    return toTexture(c);
  }),

  screen: (lines = [], color = [90, 220, 160], seed = 1) => memo('screen' + lines.join('|') + color + seed, () => {
    const [c, g] = canvas(48, 32);
    g.fillStyle = rgb(color[0] * 0.08, color[1] * 0.1, color[2] * 0.1); g.fillRect(0, 0, 48, 32);
    lines.forEach((l, i) => pixelText(g, l, 3, 3 + i * 7, rgb(...color)));
    if (!lines.length) {
      const R = rng(seed);
      g.fillStyle = rgb(...color);
      for (let y = 3; y < 30; y += 3) g.fillRect(3, y, 6 + R() * 36, 1);
    }
    for (let y = 1; y < 32; y += 2) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, y, 48, 1); }
    return toTexture(c, false);
  }),

  // Stencilled wall sign: English on top, the Russian gloss beneath in a band.
  sign: (text, bg = [180, 170, 150], fg = [30, 26, 24], gloss = '') => memo('sign' + text + bg + gloss, () => {
    const [c, g] = canvas(80, 20);
    g.fillStyle = rgb(...bg); g.fillRect(0, 0, 80, 20);
    g.fillStyle = rgb(bg[0] * 0.6, bg[1] * 0.6, bg[2] * 0.6); g.fillRect(0, 19, 80, 1); g.fillRect(79, 0, 1, 20);
    g.fillStyle = rgb(bg[0] * 1.1, bg[1] * 1.1, bg[2] * 1.1); g.fillRect(0, 0, 80, 1);
    if (gloss) {
      pixelText(g, text, 40, 3, rgb(...fg), { align: 'center' });
      g.fillStyle = rgb(...fg); g.fillRect(4, 10, 72, 1);
      pixelText(g, gloss, 40, 12, rgb(...fg.map((v, i) => v * 0.55 + bg[i] * 0.45)), { align: 'center' });
    } else {
      pixelText(g, text, 40, 5, rgb(...fg), { align: 'center', scale: text.length <= 9 ? 2 : 1 });
    }
    speckle(g, 80, 20, 16, 1, text.length * 13);
    return toTexture(c, false);
  }),

  // Station posters, 48×64. Our own slogans and drawings; each carries a short
  // Russian gloss. kind 0 THE STATION ENDURES · 1 LISTEN ONLY TO ORDERS ·
  // 2 NO UNIT ALONE · 3 A CUSTODIAN IS NEVER IDLE · 4 REPORT ALL DREAMS
  poster: (kind = 0) => memo('poster' + kind, () => {
    const [c, g] = canvas(48, 72);
    const gloss = (a, b, col) => { pixelText(g, a, 24, 58, col, { align: 'center' }); if (b) pixelText(g, b, 24, 65, col, { align: 'center' }); };
    const R = rng(120 + kind);
    const bone = rgb(222, 212, 188), ink = rgb(28, 26, 26), red = rgb(172, 28, 34);
    const lines = (ls, y, col, x = 4) => ls.forEach((t, i) => pixelText(g, t, x, y + i * 7, col));
    if (kind === 0) {
      // a pale planet over a red field, the station ring as a line across it
      g.fillStyle = bone; g.fillRect(0, 0, 48, 72);
      g.fillStyle = red; g.fillRect(0, 0, 48, 34);
      g.fillStyle = rgb(236, 226, 202); g.beginPath(); g.arc(24, 20, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgb(196, 184, 160); g.fillRect(13, 22, 22, 2); g.fillRect(15, 26, 18, 1);
      g.fillStyle = ink; g.fillRect(2, 19, 44, 2);
      g.fillStyle = red; g.fillRect(4, 36, 40, 1);
      lines(['THE', 'STATION', 'ENDURES'], 37, ink);
      gloss('СТАНЦИЯ', 'ВЫСТОИТ', rgb(128, 70, 64));
    } else if (kind === 1) {
      // a headset in profile over a single red bar
      g.fillStyle = rgb(30, 32, 34); g.fillRect(0, 0, 48, 72);
      g.fillStyle = bone;
      g.beginPath(); g.arc(24, 18, 11, Math.PI, 0); g.fill();
      g.fillStyle = rgb(30, 32, 34); g.beginPath(); g.arc(24, 18, 8, Math.PI, 0); g.fill();
      g.fillStyle = bone; g.fillRect(11, 17, 6, 9); g.fillRect(31, 17, 6, 9);
      g.fillRect(34, 26, 2, 4); g.fillRect(26, 29, 10, 2);
      g.fillStyle = red; g.fillRect(4, 33, 40, 3);
      lines(['LISTEN', 'ONLY TO', 'ORDERS'], 37, bone);
      gloss('СЛУШАЙ', 'ПРИКАЗ', rgb(150, 144, 130));
    } else if (kind === 2) {
      // two figures side by side, a third alone and struck through
      g.fillStyle = rgb(206, 200, 184); g.fillRect(0, 0, 48, 72);
      g.strokeStyle = ink; g.lineWidth = 1; g.strokeRect(3.5, 3.5, 41, 29);
      const fig = (x) => { g.fillRect(x + 1, 8, 3, 3); g.fillRect(x, 12, 5, 8); g.fillRect(x, 20, 2, 7); g.fillRect(x + 3, 20, 2, 7); };
      g.fillStyle = ink; fig(8); fig(15);
      g.fillStyle = rgb(90, 88, 84); fig(32);
      g.fillStyle = red;
      for (let i = 0; i < 16; i++) g.fillRect(28 + i, 25 - i, 2, 2);
      lines(['NO UNIT', 'ALONE'], 37, ink);
      gloss('НЕ ХОДИ', 'ОДИН', rgb(120, 110, 100));
    } else if (kind === 3) {
      // a spanner across a gear wheel on dark teal
      g.fillStyle = rgb(34, 58, 60); g.fillRect(0, 0, 48, 72);
      g.fillStyle = rgb(62, 96, 96);
      g.beginPath(); g.arc(24, 18, 12, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.fillRect(24 + Math.cos(a) * 13 - 2, 18 + Math.sin(a) * 13 - 2, 4, 4); }
      g.fillStyle = rgb(34, 58, 60); g.beginPath(); g.arc(24, 18, 5, 0, Math.PI * 2); g.fill();
      g.fillStyle = bone;
      for (let i = 0; i < 22; i++) g.fillRect(13 + i, 29 - i, 3, 3);
      g.fillRect(32, 5, 6, 3); g.fillRect(35, 8, 3, 3); g.fillRect(10, 27, 3, 5); g.fillRect(13, 30, 5, 3);
      g.fillStyle = red; g.fillRect(4, 34, 40, 2);
      lines(['A CUSTODIAN', 'IS NEVER', 'IDLE'], 37, bone, 3);
      gloss('БЕЗ', 'ПРОСТОЯ', rgb(140, 170, 166));
    } else {
      // a crescent over a report slot, the arrow says where dreams go
      g.fillStyle = rgb(24, 26, 38); g.fillRect(0, 0, 48, 72);
      g.fillStyle = bone; g.beginPath(); g.arc(18, 14, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgb(24, 26, 38); g.beginPath(); g.arc(22, 11, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgb(140, 136, 150);
      for (let i = 0; i < 3; i++) g.fillRect(28 + i * 4, 8 + i * 3, 3, 1);
      g.fillStyle = red; g.fillRect(31, 17, 3, 7); g.fillRect(29, 22, 7, 2); g.fillRect(30, 24, 5, 1); g.fillRect(31, 25, 3, 1);
      g.fillStyle = rgb(150, 146, 136); g.fillRect(24, 27, 17, 5);
      g.fillStyle = rgb(24, 26, 38); g.fillRect(26, 29, 13, 1);
      lines(['REPORT', 'ALL', 'DREAMS'], 37, bone);
      gloss('СООБЩАЙ', 'О СНАХ', rgb(130, 128, 150));
    }
    speckle(g, 48, 72, 22, 1, 130 + kind);
    // fold line, a torn corner, tape
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 36, 48, 1);
    g.clearRect(42 + (R() * 3 | 0), 66, 6, 6);
    g.fillStyle = 'rgba(220,210,180,0.55)'; g.fillRect(1, 0, 6, 2); g.fillRect(41, 0, 6, 2);
    return toTexture(c, false);
  }),

  books: (seed = 1) => memo('books' + seed, () => {
    const [c, g] = canvas(32, 32);
    g.fillStyle = rgb(20, 14, 10); g.fillRect(0, 0, 32, 32);
    const R = rng(seed + 200);
    for (let shelf = 0; shelf < 4; shelf++) {
      let x = 0;
      const y = shelf * 8;
      while (x < 32) {
        const w = 1 + ((R() * 3) | 0);
        const h = 5 + ((R() * 3) | 0);
        const hues = [[120, 30, 30], [40, 60, 70], [90, 80, 60], [50, 70, 50], [140, 120, 90], [70, 40, 60]];
        const col = hues[(R() * hues.length) | 0];
        const k = 0.6 + R() * 0.5;
        g.fillStyle = rgb(col[0] * k, col[1] * k, col[2] * k);
        g.fillRect(x, y + 8 - h - 1, w, h);
        if (R() > 0.6) { g.fillStyle = 'rgba(220,200,160,0.5)'; g.fillRect(x, y + 8 - h + 1, w, 1); }
        x += w + (R() > 0.85 ? 2 : 0);
      }
      g.fillStyle = rgb(62, 42, 28); g.fillRect(0, y + 7, 32, 1);
    }
    return toTexture(c, false);
  }),

  wood: () => memo('wood', () => {
    const [c, g] = canvas(16, 16);
    g.fillStyle = rgb(92, 62, 40); g.fillRect(0, 0, 16, 16);
    const R = rng(301);
    for (let y = 0; y < 16; y++) {
      g.fillStyle = `rgba(40,24,12,${0.1 + R() * 0.25})`;
      g.fillRect(0, y, 16, 1);
      if (R() > 0.7) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect((R() * 16) | 0, y, 3, 1); }
    }
    return toTexture(c);
  }),

  fabric: (r, gg, b, seed = 1) => memo('fabric' + r + gg + b + seed, () => {
    const [c, g] = canvas(16, 16);
    g.fillStyle = rgb(r, gg, b); g.fillRect(0, 0, 16, 16);
    speckle(g, 16, 16, 20, 1, seed);
    g.fillStyle = 'rgba(0,0,0,0.15)';
    for (let i = 0; i < 16; i += 2) g.fillRect(0, i, 16, 1);
    return toTexture(c);
  }),

  cryoGlass: () => memo('cryoGlass', () => {
    const [c, g] = canvas(16, 32);
    const grad = g.createLinearGradient(0, 0, 16, 0);
    grad.addColorStop(0, rgb(40, 90, 100)); grad.addColorStop(0.5, rgb(120, 190, 196)); grad.addColorStop(1, rgb(40, 90, 100));
    g.fillStyle = grad; g.fillRect(0, 0, 16, 32);
    const R = rng(401);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(230,250,255,${R() * 0.5})`; g.fillRect((R() * 16) | 0, (R() * 32) | 0, 1, 1); }
    speckle(g, 16, 32, 20, 1, 402);
    return toTexture(c, false);
  }),

  splat: (kind = 'blood', seed = 1) => memo('splat' + kind + seed, () => {
    const [c, g] = canvas(32, 32);
    const R = rng(seed + 500);
    const col = kind === 'blood' ? [70, 6, 10] : kind === 'oil' ? [10, 10, 12] : [40, 30, 20];
    for (let i = 0; i < 9; i++) {
      const x = 16 + (R() - 0.5) * 14, y = 16 + (R() - 0.5) * 14, r = 2 + R() * 6;
      g.fillStyle = rgb(col[0] * (0.8 + R() * 0.4), col[1], col[2], 0.85);
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
    for (let i = 0; i < 20; i++) {
      g.fillStyle = rgb(...col, 0.8);
      g.fillRect((R() * 32) | 0, (R() * 32) | 0, 1 + (R() * 2 | 0), 1 + (R() * 2 | 0));
    }
    return toTexture(c, false);
  }),

  glint: () => memo('glint', () => {
    const [c, g] = canvas(8, 8);
    g.fillStyle = '#fff';
    g.fillRect(3, 0, 2, 8); g.fillRect(0, 3, 8, 2);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(2, 2, 4, 4);
    return toTexture(c, false);
  }),

  planet: (seed = 7) => memo('planet' + seed, () => {
    const [c, g] = canvas(128, 64);
    const R = rng(seed);
    const bands = [];
    for (let i = 0; i < 18; i++) bands.push([R(), R()]);
    const img = g.createImageData(128, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 128; x++) {
        const v = y / 64;
        let s = 0;
        for (let i = 0; i < bands.length; i++) s += Math.sin(v * (8 + i * 3) * Math.PI + bands[i][0] * 6 + Math.sin(x / 128 * Math.PI * 2 * (1 + (i % 3)) + bands[i][1] * 6) * 0.35) * (1 / (i + 1));
        s = s * 0.5 + 0.5;
        // storm
        const dx = (x - 84) / 10, dy = (y - 40) / 5;
        const storm = Math.exp(-(dx * dx + dy * dy));
        const i4 = (y * 128 + x) * 4;
        const base = [170 + s * 60, 150 + s * 50, 120 + s * 40];
        img.data[i4] = base[0] * (1 - storm * 0.3) + storm * 120;
        img.data[i4 + 1] = base[1] * (1 - storm * 0.5);
        img.data[i4 + 2] = base[2] * (1 - storm * 0.5);
        img.data[i4 + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    speckle(g, 128, 64, 12, 1, seed + 1);
    const t = toTexture(c);
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }),

  stars: () => memo('stars', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    const R = rng(777);
    for (let i = 0; i < 140; i++) {
      const b = 80 + R() * 175;
      g.fillStyle = rgb(b, b, b * (0.9 + R() * 0.2));
      g.fillRect((R() * 128) | 0, (R() * 128) | 0, 1, 1);
    }
    return toTexture(c);
  }),

  paper: () => memo('paper', () => {
    const [c, g] = canvas(16, 16);
    g.fillStyle = rgb(214, 206, 186); g.fillRect(0, 0, 16, 16);
    g.fillStyle = rgb(90, 86, 80);
    for (let y = 3; y < 15; y += 2) g.fillRect(2, y, 8 + ((y * 7) % 5), 1);
    speckle(g, 16, 16, 14, 1, 601);
    return toTexture(c, false);
  }),

  // Rugs, one look per kind so rooms keep their own identity:
  //   'warm'   quiet rooms: ochre wool, bone edge, woven umber bands
  //   'teal'   the original lozenge rug (unused on the map; kept for callers)
  //   'felt'   crew quarters: a plain blue-grey utility mat, stitched edge
  //   'runner' archive: dark olive runner with bone stripes at both ends
  rug: (kind = 'teal') => memo('rug-' + kind, () => {
    const [c, g] = canvas(32, 32);
    const R = rng(71 + kind.length);
    const flecks = (a, b, n = 120) => {
      for (let i = 0; i < n; i++) { g.fillStyle = R() > 0.5 ? a : b; g.fillRect((R() * 32) | 0, (R() * 32) | 0, 2, 1); }
    };
    const frame = (inset, col) => {
      g.fillStyle = col;
      g.fillRect(inset, inset, 32 - inset * 2, 1); g.fillRect(inset, 31 - inset, 32 - inset * 2, 1);
      g.fillRect(inset, inset, 1, 32 - inset * 2); g.fillRect(31 - inset, inset, 1, 32 - inset * 2);
    };
    if (kind === 'warm') {
      // muted rust-ochre wool, umber edge, a bone inner frame and a stitched
      // centre row: soft, not a plank floor
      g.fillStyle = rgb(118, 80, 52); g.fillRect(0, 0, 32, 32);
      flecks(rgb(128, 88, 58), rgb(106, 72, 46), 160);
      frame(0, rgb(66, 44, 30)); frame(1, rgb(84, 56, 38));
      frame(4, rgb(168, 150, 116));
      g.fillStyle = rgb(150, 110, 72);
      for (let x = 8; x < 24; x += 2) g.fillRect(x, 15 + ((x >> 1) & 1), 1, 1);
      g.fillStyle = rgb(92, 60, 40);
      g.fillRect(7, 7, 2, 2); g.fillRect(23, 7, 2, 2); g.fillRect(7, 23, 2, 2); g.fillRect(23, 23, 2, 2);
    } else if (kind === 'felt') {
      g.fillStyle = rgb(70, 78, 86); g.fillRect(0, 0, 32, 32);
      flecks(rgb(76, 84, 92), rgb(64, 71, 78), 90);
      frame(0, rgb(46, 50, 56));
      g.fillStyle = rgb(104, 110, 112);
      for (let t = 2; t < 30; t += 2) { g.fillRect(t, 2, 1, 1); g.fillRect(t, 29, 1, 1); g.fillRect(2, t, 1, 1); g.fillRect(29, t, 1, 1); }
    } else if (kind === 'runner') {
      g.fillStyle = rgb(62, 66, 44); g.fillRect(0, 0, 32, 32);
      flecks(rgb(70, 74, 50), rgb(54, 58, 38));
      frame(0, rgb(40, 40, 28));
      g.fillStyle = rgb(186, 176, 146);
      for (const x of [3, 5, 26, 28]) g.fillRect(x, 2, 1, 28);
      g.fillStyle = rgb(120, 96, 60);
      g.fillRect(8, 15, 16, 2);
    } else {
      g.fillStyle = rgb(40, 62, 64); g.fillRect(0, 0, 32, 32);
      flecks(rgb(48, 72, 74), rgb(34, 52, 54));
      frame(1, rgb(170, 160, 136));
      frame(3, rgb(120, 60, 44));
      g.fillStyle = rgb(150, 140, 118);
      for (let i = 0; i < 8; i++) { g.fillRect(16 - i, 8 + i, 1, 1); g.fillRect(15 + i, 8 + i, 1, 1); g.fillRect(16 - i, 23 - i, 1, 1); g.fillRect(15 + i, 23 - i, 1, 1); }
    }
    return toTexture(c, false);
  }),

  // Tape reel face (the top cap of a reel cylinder): hub, three windows, tape pack.
  reel: (full = 0.7) => memo('reel' + full, () => {
    const [c, g] = canvas(24, 24);
    g.clearRect(0, 0, 24, 24);
    g.fillStyle = rgb(150, 154, 150); g.beginPath(); g.arc(12, 12, 11.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(62, 44, 32); g.beginPath(); g.arc(12, 12, 4 + 7 * full, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(84, 62, 46); g.beginPath(); g.arc(12, 12, 3.5 + 7 * full, 0, Math.PI * 2); g.lineWidth = 1; g.strokeStyle = rgb(84, 62, 46); g.stroke();
    g.fillStyle = rgb(18, 18, 20);
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      g.beginPath(); g.arc(12 + Math.cos(a) * 7.5, 12 + Math.sin(a) * 7.5, 2.6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = rgb(210, 206, 196); g.beginPath(); g.arc(12, 12, 2.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(40, 40, 42); g.fillRect(11, 11, 2, 2);
    g.fillStyle = rgb(230, 226, 214); g.fillRect(11, 1, 2, 2); // index mark so rotation reads
    return toTexture(c, false);
  }),

  // Round pressure gauge face (the needle is a separate mesh).
  gauge: () => memo('gauge', () => {
    const [c, g] = canvas(16, 16);
    g.clearRect(0, 0, 16, 16);
    g.fillStyle = rgb(150, 120, 60); g.beginPath(); g.arc(8, 8, 7.8, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(226, 220, 204); g.beginPath(); g.arc(8, 8, 6.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = rgb(40, 40, 40);
    for (let i = 0; i <= 6; i++) { const a = Math.PI * (0.75 + i * 0.25); g.fillRect(8 + Math.cos(a) * 5 - 0.5, 8 + Math.sin(a) * 5 - 0.5, 1, 1); }
    g.fillStyle = rgb(172, 28, 34);
    for (let i = 0; i < 3; i++) { const a = Math.PI * (2.0 + i * 0.12); g.fillRect(8 + Math.cos(a) * 5 - 0.5, 8 + Math.sin(a) * 5 - 0.5, 1, 1); }
    return toTexture(c, false);
  }),

  // Backup deck status screen: teal-white on near-black. state: 'ready' | 'write'
  deckScreen: (state = 'ready') => memo('deckScreen' + state, () => {
    const [c, g] = canvas(48, 24);
    g.fillStyle = rgb(8, 16, 18); g.fillRect(0, 0, 48, 24);
    const hi = rgb(190, 238, 232), lo = rgb(96, 150, 146);
    pixelText(g, 'BACKUP DECK', 3, 3, hi);
    g.fillStyle = lo; g.fillRect(3, 9, 42, 1);
    pixelText(g, state === 'write' ? 'WRITING' : 'READY', 3, 11, hi);
    pixelText(g, 'ЗАПИСЬ', 3, 17, lo);
    // level meter
    g.fillStyle = lo;
    for (let i = 0; i < 4; i++) g.fillRect(34 + i * 3, 21 - (i + 1) * 2 - (state === 'write' ? 2 : 0), 2, (i + 1) * 2 + (state === 'write' ? 2 : 0));
    for (let y = 1; y < 24; y += 2) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, y, 48, 1); }
    return toTexture(c, false);
  }),

  // Sector plan screen: a blueprint of the given room rectangles in teal lines.
  // rects: [{x0,z0,x1,z1,here?}], title: string, gloss: string
  plan: (key, rects, title = '', gloss = '') => memo('plan' + key, () => {
    const W = 64, H = 48;
    const [c, g] = canvas(W, H);
    g.fillStyle = rgb(8, 18, 22); g.fillRect(0, 0, W, H);
    g.fillStyle = rgb(18, 40, 44);
    for (let x = 0; x < W; x += 4) g.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    pixelText(g, title, 2, 2, rgb(196, 236, 230));
    if (gloss) pixelText(g, gloss, W - 2, 2, rgb(90, 150, 146), { align: 'right' });
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of rects) { x0 = Math.min(x0, r.x0); z0 = Math.min(z0, r.z0); x1 = Math.max(x1, r.x1 + 1); z1 = Math.max(z1, r.z1 + 1); }
    const s = Math.min((W - 6) / (x1 - x0), (H - 12) / (z1 - z0));
    const ox = Math.floor((W - (x1 - x0) * s) / 2), oz = 9 + Math.floor((H - 10 - (z1 - z0) * s) / 2);
    for (const r of rects) {
      const rx = ox + Math.round((r.x0 - x0) * s), rz = oz + Math.round((r.z0 - z0) * s);
      const rw = Math.max(2, Math.round((r.x1 + 1 - r.x0) * s)), rh = Math.max(2, Math.round((r.z1 + 1 - r.z0) * s));
      if (r.here) { g.fillStyle = rgb(120, 30, 36); g.fillRect(rx, rz, rw, rh); }
      g.fillStyle = rgb(130, 214, 206);
      g.fillRect(rx, rz, rw, 1); g.fillRect(rx, rz + rh - 1, rw, 1); g.fillRect(rx, rz, 1, rh); g.fillRect(rx + rw - 1, rz, 1, rh);
    }
    for (let y = 1; y < H; y += 2) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y, W, 1); }
    return toTexture(c, false);
  }),

  emblem: () => memo('emblem', () => {
    // Station insignia: a ring crossed by a horizon line with a small falling mark.
    const [c, g] = canvas(32, 32);
    g.clearRect(0, 0, 32, 32);
    g.strokeStyle = rgb(170, 30, 34); g.lineWidth = 3;
    g.beginPath(); g.arc(16, 16, 11, 0, Math.PI * 2); g.stroke();
    g.fillStyle = rgb(170, 30, 34); g.fillRect(2, 15, 28, 3);
    g.fillRect(15, 20, 3, 6);
    return toTexture(c, false);
  }),
};
