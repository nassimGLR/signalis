// Procedural 2D art: inventory icons and memory illustrations.
// Painted with canvas primitives, then quantised with ordered dithering to a
// small palette so they read as low-colour pixel art.
import { Tex, rng } from '../engine/textures.js';

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function ditherToPalette(g, w, h, palette, strength = 48) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 8) continue;
    const t = (BAYER[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * strength;
    const r = d[i] + t, gg = d[i + 1] + t, b = d[i + 2] + t;
    let best = 0, bd = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const p = palette[k];
      const dd = (r - p[0]) ** 2 + (gg - p[1]) ** 2 + (b - p[2]) ** 2;
      if (dd < bd) { bd = dd; best = k; }
    }
    d[i] = palette[best][0]; d[i + 1] = palette[best][1]; d[i + 2] = palette[best][2];
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  return [c, g];
}

// ---------------- icons ----------------
const ICON_PAL = [[8, 8, 10], [40, 42, 46], [90, 94, 98], [160, 164, 160], [226, 220, 204], [170, 30, 36], [230, 70, 60]];

export function drawIcon(id) {
  const [c, g] = cv(48, 48);
  g.clearRect(0, 0, 48, 48);
  const fill = (col, ...r) => { g.fillStyle = col; g.fillRect(...r); };
  switch (id) {
    case 'pistol':
      fill('#5a5e62', 8, 16, 30, 8);
      fill('#8a8e90', 8, 16, 30, 2);
      fill('#2a2c30', 26, 22, 9, 16);
      fill('#3c3e42', 27, 24, 6, 13);
      fill('#2a2c30', 22, 24, 5, 5);
      fill('#1a1a1c', 36, 18, 4, 3);
      fill('#b02028', 12, 19, 3, 2);
      break;
    case 'ammo':
      fill('#6a5e40', 10, 18, 28, 20);
      fill('#8a7e56', 10, 18, 28, 3);
      fill('#3a3226', 10, 35, 28, 3);
      for (let i = 0; i < 5; i++) { fill('#c8a050', 12 + i * 5, 10, 3, 9); fill('#e8d090', 12 + i * 5, 10, 3, 2); }
      fill('#e2dccc', 14, 25, 20, 6);
      fill('#2a2a2a', 16, 27, 16, 2);
      break;
    case 'sealant':
      fill('#8a9294', 17, 14, 14, 26);
      fill('#b4bcbc', 17, 14, 4, 26);
      fill('#b02028', 17, 22, 14, 8);
      fill('#e2dccc', 20, 24, 8, 4);
      fill('#3a3e42', 20, 8, 8, 6);
      fill('#1a1a1c', 28, 9, 6, 3);
      break;
    case 'nanite':
      fill('#304048', 20, 8, 8, 6);
      fill('#9ae8f0', 18, 14, 12, 24);
      fill('#d0fbff', 19, 15, 3, 22);
      fill('#50a8b8', 18, 30, 12, 8);
      fill('#e2dccc', 18, 38, 12, 3);
      for (let i = 0; i < 6; i++) fill('#ffffff', 21 + (i * 7) % 7, 18 + i * 3, 1, 1);
      break;
    case 'keycard':
      fill('#c8c4b4', 8, 14, 32, 22);
      fill('#b02028', 8, 14, 32, 6);
      fill('#6a6e70', 12, 23, 9, 10);
      fill('#2a2c30', 24, 24, 12, 2);
      fill('#2a2c30', 24, 28, 8, 2);
      fill('#d0a040', 30, 30, 6, 4);
      break;
    case 'fuse':
      fill('#d8d2c0', 12, 18, 24, 12);
      fill('#f0ead8', 12, 18, 24, 3);
      fill('#8a8e90', 6, 19, 6, 10);
      fill('#8a8e90', 36, 19, 6, 10);
      fill('#b0b4b4', 6, 19, 6, 2); fill('#b0b4b4', 36, 19, 6, 2);
      fill('#b02028', 20, 22, 8, 4);
      break;
    case 'photo':
      fill('#e2dccc', 9, 9, 30, 30);
      fill('#303436', 12, 12, 24, 20);
      fill('#a0968a', 18, 20, 16, 12);
      fill('#101214', 16, 22, 5, 10); fill('#101214', 16, 19, 4, 4);
      fill('#101214', 23, 25, 4, 7); fill('#101214', 23, 23, 4, 3);
      fill('#e2dccc', 12, 31, 24, 1);
      break;
    case 'obol':
      g.fillStyle = '#6a6c70'; g.beginPath(); g.arc(24, 25, 14, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b8bcbe'; g.beginPath(); g.arc(24, 24, 13, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8a8e90'; g.beginPath(); g.arc(24, 24, 10, 0, Math.PI * 2); g.fill();
      fill('#4a4c50', 15, 26, 18, 3);
      fill('#4a4c50', 18, 29, 12, 2);
      fill('#4a4c50', 23, 15, 2, 11);
      fill('#d8dcdc', 25, 16, 5, 7);
      break;
    default:
      fill('#555', 12, 12, 24, 24);
  }
  ditherToPalette(g, 48, 48, ICON_PAL, 10);
  // re-clear background (dither made everything opaque)
  const img = g.getImageData(0, 0, 48, 48);
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 8 && img.data[i + 1] === 8 && img.data[i + 2] === 10) img.data[i + 3] = 0;
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------- memory illustrations ----------------
const MEM_PAL = [[10, 16, 20], [34, 52, 60], [76, 104, 112], [132, 168, 174], [196, 226, 228], [240, 252, 250], [150, 60, 60]];

// A woman in a long coat and a shorter figure with a chin-length bob, seen from
// behind. Drawn as silhouettes.
function figureCoat(g, x, y, s, col) {
  g.fillStyle = col;
  g.beginPath();
  g.ellipse(x, y, 7 * s, 8.5 * s, 0, 0, Math.PI * 2); g.fill();          // head
  g.fillRect(x - 8 * s, y - 4 * s, 3 * s, 16 * s);                        // tied-back hair fall
  g.beginPath();
  g.moveTo(x - 4 * s, y + 7 * s);
  g.lineTo(x - 17 * s, y + 16 * s);
  g.lineTo(x - 22 * s, y + 80 * s);
  g.lineTo(x + 20 * s, y + 80 * s);
  g.lineTo(x + 17 * s, y + 16 * s);
  g.lineTo(x + 4 * s, y + 7 * s);
  g.closePath(); g.fill();
}

function figureBob(g, x, y, s, col) {
  g.fillStyle = col;
  g.beginPath(); g.ellipse(x, y, 7.5 * s, 8 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillRect(x - 8.5 * s, y - 2 * s, 17 * s, 10 * s);                     // bob
  g.beginPath();
  g.moveTo(x - 3 * s, y + 8 * s);
  g.lineTo(x - 14 * s, y + 15 * s);
  g.lineTo(x - 15 * s, y + 70 * s);
  g.lineTo(x + 15 * s, y + 70 * s);
  g.lineTo(x + 14 * s, y + 15 * s);
  g.lineTo(x + 3 * s, y + 8 * s);
  g.closePath(); g.fill();
}

export function drawMemory(key) {
  const W = 320, H = 180;
  const [c, g] = cv(W, H);
  const R = rng(key.length * 77);
  if (key === 'window') {
    // bright planet-lit window filling the frame
    g.fillStyle = '#16222a'; g.fillRect(0, 0, W, H);
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0c1418'); sky.addColorStop(1, '#223038');
    g.fillStyle = sky; g.fillRect(30, 12, 260, 140);
    for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(230,250,250,${R()})`; g.fillRect(30 + R() * 260, 12 + R() * 70, 1, 1); }
    // planet
    g.save();
    g.beginPath(); g.rect(30, 12, 260, 140); g.clip();
    g.beginPath(); g.arc(170, 230, 170, 0, Math.PI * 2); g.clip();
    g.drawImage(Tex.planet(7).image, 0, 60, 340, 200);
    const sh = g.createLinearGradient(0, 0, W, 0);
    sh.addColorStop(0, 'rgba(255,255,255,0.15)'); sh.addColorStop(0.6, 'rgba(0,0,0,0)'); sh.addColorStop(0.95, 'rgba(0,0,0,0.8)');
    g.fillStyle = sh; g.fillRect(0, 0, W, H);
    g.restore();
    g.strokeStyle = 'rgba(240,250,250,0.8)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(170, 74, 230, 16, -0.05, Math.PI, Math.PI * 2); g.stroke();
    // mullions
    g.fillStyle = '#0a1014';
    g.fillRect(0, 0, W, 12); g.fillRect(0, 152, W, 28); g.fillRect(0, 0, 30, H); g.fillRect(290, 0, 30, H);
    g.fillRect(114, 12, 5, 140); g.fillRect(202, 12, 5, 140);
    g.fillRect(30, 96, 260, 4);
    // silhouettes
    figureCoat(g, 132, 70, 1.35, '#05090b');
    figureBob(g, 186, 88, 1.25, '#05090b');
    // the hand on the shoulder
    g.fillStyle = '#05090b';
    g.beginPath(); g.moveTo(150, 94); g.quadraticCurveTo(165, 96, 176, 105); g.lineTo(174, 110); g.quadraticCurveTo(163, 104, 150, 102); g.fill();
    // rim light on the figures
    g.fillStyle = 'rgba(220,250,250,0.9)';
    g.fillRect(118, 62, 2, 10); g.fillRect(178, 82, 2, 8);
    ditherToPalette(g, W, H, MEM_PAL, 40);
  } else if (key === 'promise') {
    // looking up out of a cryo pod: frost at the edges, a figure leaning over
    g.fillStyle = '#c8e8ea'; g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(160, 40, 10, 160, 60, 200);
    glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.4, '#a8d0d4'); glow.addColorStop(1, '#203238');
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
    // ceiling light strips
    g.fillStyle = '#ffffff';
    g.fillRect(60, 10, 200, 4); g.fillRect(100, 24, 120, 3);
    // figure leaning over the glass
    g.fillStyle = '#0a1418';
    g.beginPath(); g.ellipse(160, 80, 26, 30, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(90, 180); g.quadraticCurveTo(100, 110, 160, 104); g.quadraticCurveTo(220, 110, 230, 180); g.fill();
    // loose hair strands falling forward
    g.fillRect(132, 70, 6, 50); g.fillRect(184, 72, 6, 46);
    // hand pressed to the glass
    g.beginPath(); g.ellipse(214, 132, 16, 20, 0.2, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 4; i++) { g.save(); g.translate(206 + i * 7, 116); g.rotate(-0.1 + i * 0.08); g.fillRect(-2.5, -18, 5, 20); g.restore(); }
    // frost
    for (let i = 0; i < 2600; i++) {
      const a = R() * Math.PI * 2;
      const rr = 110 + Math.pow(R(), 0.5) * 120;
      const x = 160 + Math.cos(a) * rr * 1.4, y = 90 + Math.sin(a) * rr * 0.8;
      g.fillStyle = `rgba(236,252,252,${0.3 + R() * 0.7})`;
      g.fillRect(x, y, 1 + R() * 2, 1 + R() * 2);
    }
    // condensation on glass
    for (let i = 0; i < 40; i++) {
      const x = R() * W, y = R() * H;
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x, y, 1, 3 + R() * 8);
    }
    ditherToPalette(g, W, H, MEM_PAL, 44);
  } else if (key === 'ending') {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 300; i++) { const b = R() * 255; g.fillStyle = `rgb(${b},${b},${b})`; g.fillRect(R() * W, R() * H, 1, 1); }
    // dish silhouette
    g.fillStyle = '#9a2a2a';
    g.beginPath(); g.ellipse(110, 120, 60, 22, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(114, 116, 52, 16, -0.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9a2a2a';
    g.fillRect(104, 128, 10, 52);
    g.beginPath(); g.moveTo(112, 118); g.lineTo(150, 88); g.lineTo(152, 90); g.lineTo(114, 121); g.fill();
    // outgoing rings
    g.strokeStyle = '#e8e2d4';
    for (let i = 0; i < 5; i++) { g.globalAlpha = 1 - i * 0.18; g.beginPath(); g.arc(152, 88, 14 + i * 22, -1.2, 0.2); g.stroke(); }
    g.globalAlpha = 1;
    ditherToPalette(g, W, H, [[0, 0, 0], [60, 20, 22], [154, 42, 42], [120, 120, 118], [232, 226, 212]], 30);
  }
  return c;
}
