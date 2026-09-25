// Low-poly 3D item models plus the ONE shared offscreen WebGL renderer that
// the interface uses for inventory thumbnails, the item turntable, the inspect
// view and the self-model. Every model here is an original design built from
// primitives; small canvas textures carry the printed and scratched details.
//
// Public API
//   buildItemModel(id) -> THREE.Group   (metres, centred; userData.radius / .view)
//   itemThumb(id, px)  -> HTMLCanvasElement (px×px, cached, posterised)
//   stage              -> { render(scene, camera, w, h, dest2d, opts) } shared renderer
//   ItemView           -> turntable / inspect helper bound to a 2D canvas
//   posterize(imageData, levels, strength)
import * as THREE from 'three';

// ------------------------------------------------------------------ palette
const C = {
  gun: 0x4a4f55, gunDark: 0x2e3236, gunBlack: 0x1a1b1e,
  bone: 0xd9d2c2, boneDim: 0xa9a393, paper: 0xd9d2c2,
  red: 0xb3141f, teal: 0x6fc3c9, sodium: 0xe0c85a,
  steel: 0xa3a8ab, steelDark: 0x686d70, brass: 0xc29a48, copper: 0x9a5530,
  olive: 0x55553f, rubber: 0x1b1c1f,
};

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Per-channel posterise with a 4×4 ordered dither. Alpha is thresholded so
// silhouettes stay crisp over the interface.
export function posterize(img, levels = 12, strength = 0.55) {
  const d = img.data, w = img.width, h = img.height;
  const step = 255 / (levels - 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 110) { d[i + 3] = 0; continue; }
      d[i + 3] = 255;
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * step * strength;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c] + t;
        d[i + c] = Math.max(0, Math.min(255, Math.round(v / step) * step));
      }
    }
  }
  return img;
}

// ------------------------------------------------------------------ helpers
function lam(color, extra = {}) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
}
function texCanvas(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}
function mapMat(tex, extra = {}) { return new THREE.MeshLambertMaterial({ map: tex, flatShading: true, ...extra }); }

function add(group, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  group.add(m);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CY = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s, 1);

// Small pixel lettering for textures. Canvas text is fine here: the result is
// quantised to a handful of pixels anyway.
function txt(g, s, x, y, size, color, font = 'L7 Mono, monospace', weight = '500', align = 'left') {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = 'alphabetic';
  g.fillText(s, x, y);
}

// ------------------------------------------------------------------ models
const BUILDERS = {
  // P-17 sidearm: a blunt service pistol, slide over an angular frame.
  pistol() {
    const g = new THREE.Group();
    const slide = lam(C.gun), frame = lam(C.gunDark), black = lam(C.gunBlack), red = lam(C.red), grip = lam(0x3d342d);
    add(g, B(0.178, 0.033, 0.026), slide, 0.012, 0.066, 0);
    add(g, B(0.05, 0.006, 0.027), black, -0.052, 0.084, 0);                  // rear top plate
    for (let i = 0; i < 4; i++) add(g, B(0.003, 0.028, 0.0275), black, -0.07 + i * 0.007, 0.066, 0); // serrations
    add(g, B(0.132, 0.022, 0.024), frame, 0.004, 0.04, 0);
    add(g, B(0.01, 0.012, 0.012), black, 0.102, 0.062, 0);                    // muzzle crown
    add(g, B(0.006, 0.008, 0.006), black, 0.092, 0.086, 0);                   // front sight
    add(g, B(0.01, 0.009, 0.022), black, -0.072, 0.087, 0);                   // rear sight
    add(g, B(0.038, 0.104, 0.028), frame, -0.056, -0.006, 0, 0, 0, -0.24);     // grip
    add(g, B(0.03, 0.07, 0.0295), grip, -0.058, -0.006, 0, 0, 0, -0.24);       // grip panels
    add(g, B(0.046, 0.009, 0.031), black, -0.07, -0.058, 0, 0, 0, -0.24);      // magazine base
    add(g, B(0.046, 0.005, 0.012), frame, 0.006, 0.013, 0);                    // guard bottom
    add(g, B(0.005, 0.026, 0.012), frame, 0.029, 0.024, 0);                    // guard front
    add(g, B(0.005, 0.016, 0.006), black, 0.0, 0.024, 0, 0, 0, 0.25);          // trigger
    add(g, B(0.02, 0.011, 0.0282), red, -0.032, 0.066, 0);                     // custodial issue band
    add(g, B(0.012, 0.004, 0.0284), lam(C.bone), 0.03, 0.074, 0);             // index mark
    g.userData.view = { yaw: -0.5, pitch: 0.32, tilt: 0 };
    return g;
  },

  // Pistol rounds: a card carton with a lifted lid and rounds standing inside.
  ammo() {
    const g = new THREE.Group();
    const label = texCanvas(64, 32, (c, w, h) => {
      c.fillStyle = '#d6cfbd'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#1c1a18'; c.fillRect(0, 0, w, 7);
      txt(c, 'P-17 · 9×19', 3, 6, 6, '#d6cfbd');
      txt(c, '×24', 3, 22, 14, '#1c1a18', 'Sofia Sans Condensed, sans-serif', '800');
      txt(c, 'ПАТРОНЫ', 34, 21, 7, '#1c1a18');
      c.fillStyle = '#b3141f'; c.fillRect(0, h - 5, w, 5);
      for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? '#d6cfbd' : '#1c1a18'; c.fillRect(34 + i * 3, 25, 2, 2); }
    });
    const carton = lam(C.olive);
    const lab = mapMat(label);
    const mats = [carton, carton, carton, carton, lab, carton];
    add(g, B(0.084, 0.044, 0.056), mats, 0, 0, 0);
    // open lid hinged at the back
    const lid = add(g, B(0.086, 0.004, 0.058), lam(0x6a6a50), 0, 0.034, -0.046, -1.05, 0, 0);
    lid.position.set(0, 0.046, -0.04);
    const brass = lam(C.brass), tip = lam(C.copper);
    for (let ix = 0; ix < 5; ix++) for (let iz = 0; iz < 3; iz++) {
      if (ix === 4 && iz === 2) continue;
      const x = -0.032 + ix * 0.016, z = -0.016 + iz * 0.016;
      add(g, CY(0.0052, 0.0052, 0.014, 6), brass, x, 0.026, z);
      add(g, CY(0.0015, 0.0048, 0.008, 6), tip, x, 0.037, z);
    }
    g.userData.view = { yaw: 0.55, pitch: 0.55 };
    return g;
  },

  // Sealant: a squat pressure canister for hull patching — a valve block with
  // a pressure gauge on top and a short applicator wand bent forward.
  sealant() {
    const g = new THREE.Group();
    const band = texCanvas(64, 32, (c, w, h) => {
      c.fillStyle = '#cfc9ba'; c.fillRect(0, 0, w, h);
      for (let i = -2; i < 18; i++) { c.fillStyle = '#e0c85a'; c.beginPath(); c.moveTo(i * 4, 0); c.lineTo(i * 4 + 2, 0); c.lineTo(i * 4 + 6, 6); c.lineTo(i * 4 + 4, 6); c.fill(); }
      c.fillStyle = '#1c1a18'; c.fillRect(0, 6, w, 1);
      txt(c, 'HULL SEALANT', 3, 17, 8, '#1c1a18', 'Sofia Sans Condensed, sans-serif', '800');
      txt(c, 'ГЕРМЕТИК · 40', 3, 25, 6, '#3a3834');
      c.fillStyle = '#b3141f'; c.fillRect(48, 11, 12, 14);
      txt(c, 'L7', 49, 22, 8, '#f0ebe0', 'Sofia Sans Condensed, sans-serif', '800');
    });
    band.wrapS = THREE.RepeatWrapping;
    const gauge = texCanvas(16, 16, (c) => {
      c.fillStyle = '#e8e2d4'; c.beginPath(); c.arc(8, 8, 8, 0, 7); c.fill();
      c.strokeStyle = '#1c1a18'; c.lineWidth = 1; c.beginPath(); c.arc(8, 8, 6, Math.PI * 0.8, Math.PI * 2.2); c.stroke();
      c.strokeStyle = '#b3141f'; c.beginPath(); c.moveTo(8, 8); c.lineTo(12, 4); c.stroke();
    });
    const body = mapMat(band), cap = lam(0xb9b3a4), metal = lam(C.steel), dark = lam(C.gunDark);
    add(g, CY(0.031, 0.031, 0.078, 12), [body, cap, cap], 0, -0.01, 0);
    add(g, new THREE.SphereGeometry(0.031, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), cap, 0, 0.029, 0);
    add(g, CY(0.0315, 0.0315, 0.006, 12), dark, 0, -0.049, 0);                 // foot ring
    add(g, B(0.022, 0.018, 0.02), metal, 0, 0.066, 0);                          // valve block
    add(g, CY(0.009, 0.009, 0.006, 10), metal, 0, 0.066, 0.013, Math.PI / 2, 0, 0);
    add(g, CY(0.0085, 0.0085, 0.001, 10), [mapMat(gauge), mapMat(gauge), mapMat(gauge)], 0, 0.066, 0.0165, Math.PI / 2, 0, 0);
    add(g, CY(0.004, 0.004, 0.05, 6), dark, 0.03, 0.074, 0, 0, 0, Math.PI / 2 - 0.2); // wand
    add(g, CY(0.0025, 0.005, 0.014, 6), lam(C.red), 0.058, 0.08, 0, 0, 0, Math.PI / 2 - 0.2); // tip
    add(g, B(0.006, 0.02, 0.012), dark, -0.012, 0.08, 0, 0, 0, 0.5);            // lever
    g.userData.view = { yaw: -0.35, pitch: 0.34 };
    return g;
  },

  // Nanite ampoule: a glass vial with a luminous teal charge.
  nanite() {
    const g = new THREE.Group();
    const glass = new THREE.MeshLambertMaterial({ color: 0xbfe6e8, transparent: true, opacity: 0.38, depthWrite: false });
    const fluid = new THREE.MeshLambertMaterial({ color: 0x3fa6ad, emissive: 0x1d6b72, flatShading: true });
    const metal = lam(C.steel), bone = lam(C.bone);
    add(g, CY(0.0095, 0.0095, 0.044, 10), fluid, 0, -0.01, 0);
    add(g, CY(0.0125, 0.0125, 0.066, 10), glass, 0, 0, 0);
    add(g, CY(0.006, 0.0125, 0.014, 10), glass, 0, 0.04, 0);
    add(g, CY(0.0025, 0.006, 0.022, 8), glass, 0, 0.058, 0);
    add(g, CY(0.0135, 0.0135, 0.01, 10), metal, 0, -0.036, 0);
    add(g, CY(0.013, 0.013, 0.012, 10), bone, 0, 0.012, 0);
    g.userData.view = { yaw: 0.3, pitch: 0.25 };
    return g;
  },

  // Security keycard. Front: office band and a scratched-out photo. Back:
  // a stripe and a return address.
  keycard() {
    const g = new THREE.Group();
    const front = texCanvas(96, 64, (c, w, h) => {
      c.fillStyle = '#cfc8b6'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#b3141f'; c.fillRect(0, 0, w, 14);
      txt(c, 'SECURITY · DECK 2', 4, 10, 8, '#f0ebe0', 'Sofia Sans Condensed, sans-serif', '800');
      c.fillStyle = '#6a6e70'; c.fillRect(6, 20, 24, 30);
      c.strokeStyle = '#2a2c30'; c.lineWidth = 1;
      for (let i = 0; i < 14; i++) { c.beginPath(); c.moveTo(6 + Math.random() * 24, 20 + Math.random() * 30); c.lineTo(6 + Math.random() * 24, 20 + Math.random() * 30); c.stroke(); }
      txt(c, 'VARGA, I.', 36, 28, 9, '#1c1a18', 'Sofia Sans Condensed, sans-serif', '800');
      txt(c, 'CHIEF · CLR 3', 36, 38, 7, '#3a3834');
      c.fillStyle = '#c29a48'; c.fillRect(70, 44, 16, 12);
      c.fillStyle = '#8a6a2a'; c.fillRect(74, 44, 1, 12); c.fillRect(70, 50, 16, 1);
      txt(c, 'Н-0417', 36, 56, 7, '#3a3834');
    });
    const back = texCanvas(96, 64, (c, w, h) => {
      c.fillStyle = '#cfc8b6'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#16171a'; c.fillRect(0, 8, w, 13);
      txt(c, 'IF FOUND RETURN TO', 5, 34, 7, '#3a3834');
      txt(c, 'SECURITY OFFICE, DECK 2', 5, 43, 7, '#3a3834');
      for (let i = 0; i < 30; i++) { c.fillStyle = '#1c1a18'; c.fillRect(5 + i * 2.6, 50, Math.random() < 0.5 ? 1 : 2, 9); }
    });
    back.center.set(0.5, 0.5); back.rotation = Math.PI;
    const edge = lam(0xbdb6a3);
    add(g, B(0.086, 0.054, 0.002), [edge, edge, edge, edge, mapMat(front), mapMat(back)], 0, 0, 0);
    g.userData.view = { yaw: -0.45, pitch: 0.2, tilt: 0.12 };
    return g;
  },

  // Breaker fuse: ceramic cartridge with metal ferrules and blades.
  fuse() {
    const g = new THREE.Group();
    const band = texCanvas(64, 16, (c, w, h) => {
      c.fillStyle = '#ddd6c6'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#b3141f'; c.fillRect(0, 4, w, 8);
      txt(c, '400A', 4, 11, 8, '#f0ebe0', 'L7 Mono, monospace', '500');
      txt(c, '400A', 36, 11, 8, '#f0ebe0', 'L7 Mono, monospace', '500');
    });
    band.wrapS = THREE.RepeatWrapping;
    const body = mapMat(band), cap = lam(0xcfc8b8), metal = lam(C.steel);
    add(g, CY(0.013, 0.013, 0.062, 10), [body, cap, cap], 0, 0, 0, 0, 0, Math.PI / 2);
    add(g, CY(0.0145, 0.0145, 0.012, 10), metal, -0.034, 0, 0, 0, 0, Math.PI / 2);
    add(g, CY(0.0145, 0.0145, 0.012, 10), metal, 0.034, 0, 0, 0, 0, Math.PI / 2);
    add(g, B(0.02, 0.012, 0.002), metal, -0.05, 0, 0);
    add(g, B(0.02, 0.012, 0.002), metal, 0.05, 0, 0);
    g.userData.view = { yaw: -0.35, pitch: 0.35 };
    return g;
  },

  // A photograph: our own window illustration on the front, a lab stamp behind.
  photo() {
    const g = new THREE.Group();
    const front = texCanvas(96, 72, (c, w, h) => {
      c.fillStyle = '#e4dfd2'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#16222a'; c.fillRect(5, 5, w - 10, h - 17);
      const sky = c.createLinearGradient(0, 5, 0, h - 12);
      sky.addColorStop(0, '#0c1418'); sky.addColorStop(1, '#3b5058');
      c.fillStyle = sky; c.fillRect(8, 8, w - 16, h - 23);
      c.fillStyle = '#7d949a'; c.beginPath(); c.arc(56, 88, 40, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0a1014'; c.fillRect(34, 8, 2, h - 23); c.fillRect(62, 8, 2, h - 23);
      c.fillStyle = '#05090b';
      c.beginPath(); c.ellipse(40, 30, 4, 5, 0, 0, 7); c.fill(); c.fillRect(33, 34, 14, 22);
      c.beginPath(); c.ellipse(55, 36, 4, 4, 0, 0, 7); c.fill(); c.fillRect(50, 39, 11, 17);
      txt(c, 'L-7', 7, h - 3, 7, '#8f8b80');
    });
    const back = texCanvas(96, 72, (c, w, h) => {
      c.fillStyle = '#d9d2c2'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#b3141f'; c.lineWidth = 1; c.strokeRect(10.5, 10.5, 44, 16);
      txt(c, 'OBS. DECK', 14, 22, 8, '#b3141f', 'Sofia Sans Condensed, sans-serif', '800');
      txt(c, 'PRINT 0114', 10, 40, 7, '#6b6b66');
      c.strokeStyle = '#4a4640'; c.beginPath(); c.moveTo(12, 56); c.bezierCurveTo(30, 50, 50, 62, 80, 54); c.stroke();
    });
    back.center.set(0.5, 0.5); back.rotation = Math.PI;
    const edge = lam(0xd8d2c4);
    add(g, B(0.09, 0.068, 0.0012), [edge, edge, edge, edge, mapMat(front), mapMat(back)], 0, 0, 0);
    g.userData.view = { yaw: 0.35, pitch: 0.18, tilt: -0.06 };
    return g;
  },

  // Obol: worn silver coin. A boat on one face; "FOR W." scratched on the other.
  obol() {
    const g = new THREE.Group();
    const faceA = texCanvas(48, 48, (c) => {
      c.fillStyle = '#a9adae'; c.beginPath(); c.arc(24, 24, 24, 0, 7); c.fill();
      c.strokeStyle = '#7d8183'; c.lineWidth = 2; c.beginPath(); c.arc(24, 24, 21, 0, 7); c.stroke();
      c.fillStyle = '#6a6e70';
      c.beginPath(); c.moveTo(10, 28); c.lineTo(38, 28); c.lineTo(33, 34); c.lineTo(15, 34); c.closePath(); c.fill();
      c.fillRect(23, 12, 2, 16);
      c.beginPath(); c.moveTo(25, 13); c.lineTo(34, 25); c.lineTo(25, 25); c.closePath(); c.fill();
      c.fillStyle = '#c8cbcb'; c.fillRect(12, 36, 24, 1);
    });
    const faceB = texCanvas(48, 48, (c) => {
      c.fillStyle = '#b2b5b6'; c.beginPath(); c.arc(24, 24, 24, 0, 7); c.fill();
      c.strokeStyle = '#8a8e90'; c.lineWidth = 2; c.beginPath(); c.arc(24, 24, 21, 0, 7); c.stroke();
      c.save(); c.translate(24, 26); c.rotate(-0.12);
      txt(c, 'FOR W.', 0, 4, 13, '#55595c', "'L7 Hand', cursive", '400', 'center');
      c.restore();
    });
    const rim = lam(0x8e9294);
    add(g, CY(0.0135, 0.0135, 0.0028, 20), [rim, mapMat(faceA), mapMat(faceB)], 0, 0, 0, Math.PI / 2, 0, 0);
    g.userData.view = { yaw: 0.35, pitch: 0.2 };
    return g;
  },

  // ARC PRONG: a two-tined contact stunner with a charge window.
  prong() {
    const g = new THREE.Group();
    const rubber = lam(C.rubber), body = lam(0x4d5155), metal = lam(C.steel);
    const glow = new THREE.MeshLambertMaterial({ color: C.teal, emissive: 0x2e7a80, flatShading: true });
    add(g, CY(0.013, 0.015, 0.09, 8), rubber, -0.07, 0, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 4; i++) add(g, CY(0.0155, 0.0155, 0.004, 8), lam(0x2a2b2f), -0.1 + i * 0.02, 0, 0, 0, 0, Math.PI / 2);
    add(g, B(0.06, 0.034, 0.03), body, 0.0, 0.002, 0);
    add(g, B(0.03, 0.008, 0.031), glow, 0.0, 0.012, 0);
    add(g, B(0.008, 0.006, 0.01), lam(C.red), -0.02, 0.021, 0);
    add(g, B(0.05, 0.004, 0.004), metal, 0.055, 0.004, 0.009);
    add(g, B(0.05, 0.004, 0.004), metal, 0.055, 0.004, -0.009);
    add(g, B(0.006, 0.006, 0.006), glow, 0.081, 0.004, 0.009);
    add(g, B(0.006, 0.006, 0.006), glow, 0.081, 0.004, -0.009);
    g.userData.view = { yaw: -0.55, pitch: 0.35 };
    return g;
  },

  // CAUTERY FLARE: a grey casing with a sodium band, cap and pull ring.
  flare() {
    const g = new THREE.Group();
    const band = texCanvas(64, 32, (c, w, h) => {
      c.fillStyle = '#50555a'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e0c85a'; c.fillRect(0, 8, w, 14);
      txt(c, 'CAUTERY', 3, 19, 10, '#1c1a18', 'Sofia Sans Condensed, sans-serif', '800');
      txt(c, 'ПРИЖИГАНИЕ', 34, 18, 6, '#1c1a18');
      txt(c, 'DO NOT HOLD', 3, 29, 6, '#c9c3b4');
    });
    band.wrapS = THREE.RepeatWrapping;
    const casing = mapMat(band), cap = lam(C.gunBlack), metal = lam(C.steel);
    add(g, CY(0.014, 0.014, 0.15, 10), [casing, cap, cap], 0, 0, 0, 0, 0, Math.PI / 2);
    add(g, CY(0.0155, 0.0155, 0.024, 10), cap, 0.085, 0, 0, 0, 0, Math.PI / 2);
    add(g, new THREE.TorusGeometry(0.009, 0.0018, 4, 10), metal, -0.086, 0, 0, 0, Math.PI / 2, 0);
    g.userData.view = { yaw: -0.4, pitch: 0.4 };
    return g;
  },

  // Sector plan: a folded print of a deck layout.
  plan() {
    const g = new THREE.Group();
    const print = texCanvas(64, 96, (c, w, h) => {
      c.fillStyle = '#d9d2c2'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#6b7a80'; c.lineWidth = 1;
      for (let i = 0; i < 7; i++) c.strokeRect(6 + (i * 13) % 40 + 0.5, 12 + i * 11 + 0.5, 14 + (i * 7) % 12, 9);
      c.strokeStyle = '#2a2d30'; c.strokeRect(4.5, 8.5, w - 9, h - 16);
      txt(c, 'SECTOR PLAN', 4, 6, 6, '#1c1a18');
      c.fillStyle = '#b3141f'; c.fillRect(w - 12, h - 6, 8, 3);
    });
    const m = mapMat(print, { side: THREE.DoubleSide });
    add(g, new THREE.PlaneGeometry(0.06, 0.09), m, -0.028, 0, 0.004, -Math.PI / 2 + 0.05, 0, 0.16);
    add(g, new THREE.PlaneGeometry(0.06, 0.09), m, 0.03, 0.006, 0, -Math.PI / 2 + 0.05, 0, -0.2);
    g.userData.view = { yaw: 0.3, pitch: 0.9 };
    return g;
  },

  // Fallback: a stencilled supply crate.
  generic() {
    const g = new THREE.Group();
    const side = texCanvas(32, 32, (c, w, h) => {
      c.fillStyle = '#4c4f53'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#34373a'; c.strokeRect(1.5, 1.5, w - 3, h - 3);
      txt(c, 'L7', 8, 21, 12, '#bdb6a3', 'Sofia Sans Condensed, sans-serif', '800');
    });
    const m = mapMat(side);
    add(g, B(0.07, 0.06, 0.07), m, 0, 0, 0);
    add(g, B(0.074, 0.006, 0.074), lam(0x2e3033), 0, 0.028, 0);
    add(g, B(0.074, 0.006, 0.074), lam(0x2e3033), 0, -0.028, 0);
    g.userData.view = { yaw: 0.6, pitch: 0.45 };
    return g;
  },
};
const ALIASES = { tool: 'prong', ampoule: 'nanite', coin: 'obol', card: 'keycard', map: 'plan' };

export function buildItemModel(id) {
  const key = BUILDERS[id] ? id : BUILDERS[ALIASES[id]] ? ALIASES[id] : 'generic';
  const g = BUILDERS[key]();
  g.name = 'item:' + id;
  const box = new THREE.Box3().setFromObject(g);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // recentre so the model turns around its middle
  for (const ch of g.children) ch.position.sub(sphere.center);
  g.userData.radius = sphere.radius;
  g.userData.id = id;
  g.userData.view = g.userData.view || { yaw: 0.5, pitch: 0.35 };
  return g;
}

// ------------------------------------------------------------------ shared stage
// One offscreen WebGL context for the whole interface. Views are rendered into
// the bottom-left corner of a fixed-size drawing buffer (no resize churn) and
// copied into the caller's 2D canvas.
const MAX_W = 360, MAX_H = 256;
class Stage {
  constructor() { this.gl = null; this.failed = false; }
  ensure() {
    if (this.gl || this.failed) return !!this.gl;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = MAX_W; canvas.height = MAX_H;
      const r = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      r.setPixelRatio(1);
      r.setSize(MAX_W, MAX_H, false);
      r.outputColorSpace = THREE.LinearSRGBColorSpace;
      r.setScissorTest(true);
      this.gl = r;
      this.canvas = canvas;
    } catch (e) {
      this.failed = true;
    }
    return !!this.gl;
  }
  // Render `scene` through `camera` at w×h and copy the result into `dest`
  // (a 2D context). opts: { posterize: levels|0, dither, clear: css colour|null }
  render(scene, camera, w, h, dest, opts = {}) {
    if (!this.ensure()) return false;
    w = Math.min(w, MAX_W); h = Math.min(h, MAX_H);
    const r = this.gl;
    r.setViewport(0, 0, w, h);
    r.setScissor(0, 0, w, h);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, true);
    r.render(scene, camera);
    dest.clearRect(0, 0, w, h);
    if (opts.clear) { dest.fillStyle = opts.clear; dest.fillRect(0, 0, w, h); }
    if (opts.posterize) {
      if (!this.tmp || this.tmp.width < w || this.tmp.height < h) {
        this.tmp = document.createElement('canvas');
        this.tmp.width = MAX_W; this.tmp.height = MAX_H;
        this.tctx = this.tmp.getContext('2d', { willReadFrequently: true });
      }
      const t = this.tctx;
      t.clearRect(0, 0, w, h);
      t.drawImage(this.canvas, 0, MAX_H - h, w, h, 0, 0, w, h);
      const img = posterize(t.getImageData(0, 0, w, h), opts.posterize, opts.dither ?? 0.55);
      t.putImageData(img, 0, 0);
      dest.drawImage(this.tmp, 0, 0, w, h, 0, 0, w, h);
    } else {
      dest.drawImage(this.canvas, 0, MAX_H - h, w, h, 0, 0, w, h);
    }
    return true;
  }
}
export const stage = new Stage();

// Standard item lighting: a warm bone key from the upper left, one cool rim
// from behind, and a dim hemisphere fill.
function itemScene() {
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xd7dcde, 0x2a2522, 2.0));
  const key = new THREE.DirectionalLight(0xfff1dc, 4.6);
  key.position.set(-1.2, 1.6, 1.4);
  s.add(key);
  const rim = new THREE.DirectionalLight(0xbfe3e6, 3.6);
  rim.position.set(1.4, 0.8, -1.6);
  s.add(rim);
  const pivot = new THREE.Group();
  s.add(pivot);
  return { scene: s, pivot };
}

// Frame a model: returns the camera distance that fits its bounding sphere.
function fitDistance(radius, fovDeg, fill = 0.82) {
  return radius / Math.sin((fovDeg * Math.PI / 180) / 2) / fill;
}

// ------------------------------------------------------------------ thumbnails
const thumbCache = new Map();
let thumbKit = null;
export function itemThumb(id, px = 48) {
  const k = id + '@' + px;
  if (thumbCache.has(k)) return thumbCache.get(k);
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  const g = c.getContext('2d');
  if (!thumbKit) {
    const { scene, pivot } = itemScene();
    thumbKit = { scene, pivot, cam: new THREE.PerspectiveCamera(26, 1, 0.01, 10) };
  }
  const model = buildItemModel(id);
  const v = model.userData.view;
  thumbKit.pivot.clear();
  thumbKit.pivot.add(model);
  model.rotation.set(0, v.yaw, v.tilt || 0);
  const d = fitDistance(model.userData.radius, 26, 0.9);
  thumbKit.cam.position.set(0, Math.sin(v.pitch) * d, Math.cos(v.pitch) * d);
  thumbKit.cam.lookAt(0, 0, 0);
  const ok = stage.render(thumbKit.scene, thumbKit.cam, px, px, g, { posterize: 10, dither: 0.6 });
  thumbKit.pivot.remove(model);
  disposeTree(model);
  if (!ok) return null;
  thumbCache.set(k, c);
  return c;
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
  });
}

// ------------------------------------------------------------------ turntable / inspect
// Binds a 2D canvas (logical w×h pixels, displayed upscaled with
// image-rendering: pixelated) to a rotating item.
export class ItemView {
  constructor(canvas, { spin = 0.55, fov = 24, fill = 0.78, levels = 12 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.spin = spin;
    this.fov = fov;
    this.fill = fill;
    this.levels = levels;
    const { scene, pivot } = itemScene();
    this.scene = scene;
    this.pivot = pivot;
    this.cam = new THREE.PerspectiveCamera(fov, canvas.width / canvas.height, 0.01, 10);
    this.model = null;
    this.id = null;
    this.yaw = 0; this.pitch = 0.3; this.zoom = 1;
    this.flip = 0; this.flipTarget = 0;
    this.dragging = false;
    this.idle = 0;
  }
  setItem(id) {
    if (id === this.id) return;
    if (this.model) { this.pivot.remove(this.model); disposeTree(this.model); this.model = null; }
    this.id = id;
    if (!id) { this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); return; }
    this.model = buildItemModel(id);
    this.pivot.add(this.model);
    const v = this.model.userData.view;
    this.yaw = v.yaw; this.pitch = v.pitch; this.model.rotation.z = v.tilt || 0;
    this.flip = this.flipTarget = 0;
    this.zoom = 1;
  }
  turnOver() { this.flipTarget += Math.PI; }
  update(dt) {
    if (!this.model) return;
    if (!this.dragging) { this.idle += dt; if (this.idle > 0.8) this.yaw += dt * this.spin; }
    this.flip += (this.flipTarget - this.flip) * Math.min(1, dt * 7);
    this.model.rotation.x = this.flip;
    this.pivot.rotation.y = this.yaw;
    const d = fitDistance(this.model.userData.radius, this.fov, this.fill) / this.zoom;
    const p = Math.max(-1.2, Math.min(1.35, this.pitch));
    this.cam.aspect = this.canvas.width / this.canvas.height;
    this.cam.updateProjectionMatrix();
    this.cam.position.set(0, Math.sin(p) * d, Math.cos(p) * d);
    this.cam.lookAt(0, 0, 0);
    stage.render(this.scene, this.cam, this.canvas.width, this.canvas.height, this.ctx, { posterize: this.levels, dither: 0.5 });
  }
  drag(dx, dy) { this.yaw += dx * 0.012; this.pitch += dy * 0.01; this.idle = 0; }
  wheel(sign) { this.zoom = Math.max(0.7, Math.min(2.4, this.zoom * (sign < 0 ? 1.15 : 1 / 1.15))); this.idle = 0; }
  dispose() {
    if (this.model) { disposeTree(this.model); this.pivot.remove(this.model); this.model = null; }
    this.id = null;
  }
}
