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

  floorCarpet: () => memo('floorCarpet', () => {
    const [c, g] = canvas(32, 32);
    g.fillStyle = rgb(58, 26, 30); g.fillRect(0, 0, 32, 32);
    const R = rng(44);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = R() > 0.5 ? rgb(70, 32, 36) : rgb(44, 20, 24);
      g.fillRect((R() * 32) | 0, (R() * 32) | 0, 1, 1);
    }
    g.fillStyle = rgb(84, 56, 44);
    for (let i = 0; i < 32; i += 16) { g.fillRect(0, i + 7, 32, 1); g.fillRect(i + 7, 0, 1, 32); }
    return toTexture(c);
  }),

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
    g.fillStyle = rgb(220, 214, 200);
    g.font = 'bold 7px monospace';
    g.textAlign = 'center';
    if (label) g.fillText(label, 16, 40);
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
    g.fillStyle = rgb(...color);
    g.font = '6px monospace';
    lines.forEach((l, i) => g.fillText(l, 3, 8 + i * 7));
    if (!lines.length) {
      const R = rng(seed);
      for (let y = 3; y < 30; y += 3) g.fillRect(3, y, 6 + R() * 36, 1);
    }
    for (let y = 0; y < 32; y += 2) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, y, 48, 1); }
    return toTexture(c, false);
  }),

  sign: (text, bg = [180, 170, 150], fg = [30, 26, 24]) => memo('sign' + text + bg, () => {
    const [c, g] = canvas(64, 16);
    g.fillStyle = rgb(...bg); g.fillRect(0, 0, 64, 16);
    g.fillStyle = rgb(bg[0] * 0.6, bg[1] * 0.6, bg[2] * 0.6); g.fillRect(0, 15, 64, 1); g.fillRect(63, 0, 1, 16);
    g.fillStyle = rgb(...fg);
    g.font = 'bold 8px monospace';
    g.textAlign = 'center';
    g.fillText(text, 32, 11);
    speckle(g, 64, 16, 18, 1, text.length * 13);
    return toTexture(c, false);
  }),

  poster: (kind = 0) => memo('poster' + kind, () => {
    const [c, g] = canvas(32, 48);
    const R = rng(120 + kind);
    if (kind === 0) {
      // "THE STATION ENDURES" — planet & station ring motif
      g.fillStyle = rgb(196, 184, 160); g.fillRect(0, 0, 32, 48);
      g.fillStyle = rgb(160, 28, 32); g.fillRect(0, 0, 32, 30);
      g.fillStyle = rgb(230, 220, 196);
      g.beginPath(); g.arc(16, 18, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = rgb(160, 28, 32); g.fillRect(4, 17, 24, 2);
      g.fillStyle = rgb(30, 26, 26); g.fillRect(15, 6, 2, 22);
      g.font = 'bold 5px monospace'; g.fillStyle = rgb(30, 26, 26);
      g.fillText('THE', 3, 36); g.fillText('STATION', 3, 41); g.fillText('ENDURES', 3, 46);
    } else if (kind === 1) {
      // "LISTEN ONLY TO YOUR SUPERVISOR"
      g.fillStyle = rgb(28, 30, 32); g.fillRect(0, 0, 32, 48);
      g.fillStyle = rgb(210, 200, 176);
      g.beginPath(); g.arc(16, 16, 8, Math.PI, 0); g.fill();
      g.fillRect(8, 16, 16, 3);
      g.fillStyle = rgb(170, 30, 34); g.fillRect(6, 22, 20, 2);
      g.fillStyle = rgb(28, 30, 32); g.fillRect(14, 10, 4, 4);
      g.font = 'bold 5px monospace'; g.fillStyle = rgb(210, 200, 176);
      g.fillText('LISTEN', 4, 33); g.fillText('ONLY TO', 4, 39); g.fillText('ORDERS', 4, 45);
    } else {
      // safety diagram
      g.fillStyle = rgb(206, 200, 184); g.fillRect(0, 0, 32, 48);
      g.strokeStyle = rgb(40, 40, 40); g.lineWidth = 1;
      g.strokeRect(3.5, 3.5, 25, 25);
      g.fillStyle = rgb(40, 40, 40);
      g.fillRect(14, 8, 4, 6); g.fillRect(12, 14, 8, 8); g.fillRect(10, 22, 3, 5); g.fillRect(19, 22, 3, 5);
      g.fillStyle = rgb(170, 30, 34);
      g.beginPath(); g.moveTo(5, 27); g.lineTo(27, 5); g.lineTo(27, 7); g.lineTo(7, 27); g.fill();
      g.font = 'bold 5px monospace'; g.fillStyle = rgb(40, 40, 40);
      g.fillText('NO UNIT', 3, 37); g.fillText('ALONE', 3, 43);
    }
    speckle(g, 32, 48, 26, 1, 130 + kind);
    // torn corner & fold
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 24, 32, 1);
    g.clearRect(28 + (R() * 3 | 0), 44, 4, 4);
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
