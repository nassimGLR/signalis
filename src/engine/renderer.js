// Low-resolution renderer with a pixel-perfect presentation pass.
//
// The scene is drawn into a small render target (about 360 lines by default)
// with nearest filtering. A single full-screen pass then scales it up by a
// whole number, so every scene pixel becomes an exact k×k block, and applies
// the grade: a light saturation lift that lets signal reds through, a mild
// S-curve with lifted shadows, posterisation to ~20 levels per channel and a
// light 4×4 Bayer dither on the low-res grid.
//
// Everything that used to make the picture murky (barrel curvature, scanlines,
// aperture grille, film grain, rolling bar, chromatic fringe) is still here but
// off unless an option or an event turns it on. Glitches are for events only:
// uGlitch at or below 0.14 (the old ambient "threat" feed) does not tear.
//
// Uniforms (all on `renderer.uniforms`):
//   legacy : uTime uGlitch uDamage uFade uLevels uCurve uScan uTint uRedAlert
//   new    : uMenu     0..1  menu open — 8 levels, 70% desaturated, 40% darker
//            uCritical 0..1  0.5 = FAILING (periodic tear + red split),
//                            1.0 = CRITICAL (25% saturation + static bursts)
//            uTear     0..1  event row tears (0.06 = a few single rows)
//            uSweep    -1 | 0..1  signal-loss band position (top → bottom)
//            uGrain uFringe uVignette uDither uSat uCalm (reduce flashing)
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;

// Shared uniform used by every PSX material to snap vertices to the low-res grid.
export const psxUniforms = {
  uSnap: { value: new THREE.Vector2(240, 135) },
};

// Patch a material so its vertices wobble on a coarse screen grid, like the
// fixed-point GTE on the original PlayStation.
export function psx(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = psxUniforms.uSnap;
    shader.vertexShader = 'uniform vec2 uSnap;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      {
        vec4 snapped = gl_Position;
        snapped.xyz /= snapped.w;
        snapped.xy = floor(snapped.xy * uSnap + 0.5) / uSnap;
        snapped.xyz *= gl_Position.w;
        gl_Position = snapped;
      }`,
    );
  };
  material.customProgramCacheKey = () => 'psx';
  return material;
}

const POST_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tScene;
uniform vec2 uLowRes;
uniform vec2 uOutRes;
uniform float uTime;
uniform float uGlitch;
uniform float uDamage;
uniform float uFade;
uniform float uLevels;
uniform float uCurve;
uniform float uScan;
uniform float uTint;      // 0 = normal grade, 1 = memory (cold, washed)
uniform float uRedAlert;
uniform float uMenu;
uniform float uCritical;
uniform float uTear;
uniform float uSweep;
uniform float uGrain;
uniform float uFringe;
uniform float uVignette;
uniform float uDither;
uniform float uSat;
uniform float uCalm;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// 4x4 ordered dither, centred on zero (-0.47 .. +0.47)
float bayer4(vec2 p) {
  p = mod(p, 4.0);
  int i = int(p.x) + int(p.y) * 4;
  float m = 0.0;
  if (i == 0) m = 0.0;   else if (i == 1) m = 8.0;   else if (i == 2) m = 2.0;   else if (i == 3) m = 10.0;
  else if (i == 4) m = 12.0; else if (i == 5) m = 4.0;  else if (i == 6) m = 14.0; else if (i == 7) m = 6.0;
  else if (i == 8) m = 3.0;  else if (i == 9) m = 11.0; else if (i == 10) m = 1.0; else if (i == 11) m = 9.0;
  else if (i == 12) m = 15.0; else if (i == 13) m = 7.0; else if (i == 14) m = 13.0; else m = 5.0;
  return (m + 0.5) / 16.0 - 0.5;
}

vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // saturated reds pass through untouched by the tint
  float redness = clamp((c.r - max(c.g, c.b)) * 2.5, 0.0, 1.0);
  vec3 s = max(mix(vec3(l), c, uSat), 0.0);
  vec3 tinted = s * mix(vec3(0.97, 1.0, 1.03), vec3(1.0), redness);
  // mild S-curve, then lift the shadows so black is never quite dead
  vec3 sc = clamp(tinted, 0.0, 1.0);
  sc = mix(sc, sc * sc * (3.0 - 2.0 * sc), 0.16);
  vec3 g = mix(vec3(0.020, 0.025, 0.030), vec3(1.0), sc);
  // memory grade: washed, cyan-white, low contrast
  vec3 mem = mix(vec3(0.10, 0.14, 0.16), vec3(0.86, 0.95, 0.97), pow(max(l, 0.0), 0.8));
  return mix(g, mem, uTint);
}

// Is a periodic event active? period seconds, jitter seconds, duration seconds.
float periodic(float period, float jitter, float dur, float seed) {
  float w = floor(uTime / period);
  float t0 = w * period + hash(w * 1.7 + seed) * jitter;
  float t = uTime - t0;
  return step(0.0, t) * step(t, dur);
}

void main() {
  vec2 uv = vUv;
  // optional barrel curvature (CRT option)
  if (uCurve > 0.0) {
    vec2 cc = uv * 2.0 - 1.0;
    cc *= 1.0 + uCurve * dot(cc, cc);
    uv = cc * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }
  }

  // Everything below is evaluated per low-res pixel, so each one is an exact block.
  vec2 lp = floor(uv * uLowRes);
  vec2 luv = (lp + 0.5) / uLowRes;
  float frame = floor(uTime * 24.0);
  float row = lp.y;
  float calm = 1.0 - 0.6 * uCalm;

  // ---------------- events: tears, splits, static ----------------
  // small uGlitch values (ambient feeds) do nothing; events start above 0.14
  float g = clamp((uGlitch - 0.14) / 0.86, 0.0, 1.5) * calm;
  float failEvt = step(0.45, uCritical) * periodic(8.0, 2.0, 0.12, 3.0) * calm;
  float critEvt = step(0.95, uCritical) * periodic(3.2, 1.6, 0.22, 9.0) * (1.0 - uCalm);
  float tear = uTear * calm + failEvt * 0.25 + critEvt * 0.15;

  float tearRow = step(1.0 - (g * 0.35 + tear * 0.35), hash(row * 0.73 + frame));
  float band = floor(luv.y * 24.0);
  float tearBand = step(1.0 - g * 0.12, hash(band * 1.31 + frame * 0.7));
  float shift = tearRow * (hash(row + frame) - 0.5) * 0.05 * max(g, min(1.0, tear * 3.0 + failEvt))
              + tearBand * (hash(band + frame) - 0.5) * 0.12 * g;

  // signal-loss sweep: a band of static travelling down the screen
  float sweepBand = 0.0;
  if (uSweep >= 0.0) {
    float yTop = 1.0 - luv.y;                 // 0 at the top of the screen
    float dy = abs(yTop - uSweep);
    sweepBand = 1.0 - smoothstep(0.02, 0.07, dy);
    shift += sweepBand * (hash(row * 3.1 + frame) - 0.5) * 0.08;
  }

  vec2 suv = luv;
  suv.x += floor(shift * uLowRes.x + 0.5) / uLowRes.x;   // tears stay on the pixel grid

  // chromatic split, in whole low-res pixels (off unless an option or event asks)
  float ca = floor(uFringe + g * 3.0 + failEvt * 2.0 + critEvt * 2.0 + min(1.0, tear * 6.0) + uDamage * 2.0 * calm + 0.5);
  vec3 col;
  if (ca > 0.0) {
    float o = ca / uLowRes.x;
    col.r = texture2D(tScene, suv + vec2(o, 0.0)).r;
    col.g = texture2D(tScene, suv).g;
    col.b = texture2D(tScene, suv - vec2(o, 0.0)).b;
  } else {
    col = texture2D(tScene, suv).rgb;
  }

  col = grade(col);

  // legacy low-health pulse (kept so older callers still work; subtle now)
  col = mix(col, col * vec3(1.25, 0.55, 0.5) + vec3(0.03, 0.0, 0.0), uRedAlert * 0.6);
  // damage flash
  col = mix(col, vec3(0.55, 0.02, 0.04), uDamage * 0.45 * calm);

  // condition: FAILING greys a little, CRITICAL drains to 25% saturation
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  float critSat = 1.0 - 0.75 * clamp(uCritical, 0.0, 1.0);
  col = mix(vec3(l), col, critSat);

  // static: grain option, critical bursts, the sweep band
  float n = hash2(lp + vec2(frame * 7.13, frame * 3.71)) - 0.5;
  col += n * (uGrain + g * 0.12);
  col = mix(col, vec3(n + 0.5) * 0.55, clamp(critEvt * 0.35 + sweepBand * 0.85, 0.0, 1.0));

  // menu open: a drained, darker, coarser world behind the panel
  float lm = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(vec3(lm), col, 0.3) * 0.6, uMenu);

  // vignette (15% at the corners)
  float edge = length(luv * 2.0 - 1.0);
  float vig = smoothstep(1.45, 0.35, edge);
  col *= 1.0 - uVignette * (1.0 - vig);

  col *= uFade;

  // posterise with a light ordered dither, on the low-res grid
  float levels = mix(uLevels, 8.0, uMenu);
  col += bayer4(lp) * uDither / levels;
  col = floor(clamp(col, 0.0, 1.0) * levels + 0.5) / levels;

  // ---------------- CRT option (off by default) ----------------
  if (uScan > 0.0) {
    float rowPos = fract(uv.y * uLowRes.y);
    col *= 1.0 - uScan * pow(abs(rowPos - 0.5) * 2.0, 2.0);
    float grille = 0.94 + 0.06 * sin(gl_FragCoord.x * 2.094);
    col *= mix(1.0, grille, uScan);
    float roll = smoothstep(0.0, 0.05, abs(fract(uv.y * 0.6 - uTime * 0.07) - 0.5));
    col *= 1.0 - uScan * 0.08 * (1.0 - roll);
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

const LUMA_POINT = new THREE.Vector3();

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.gl.setPixelRatio(1);
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = THREE.BasicShadowMap;
    this.gl.setClearColor(0x000000, 1);
    canvas.style.imageRendering = 'pixelated';

    // 'auto' picks the whole-number scale that gives ~300–400 lines.
    this.lowHeight = 'auto';
    this.pixelPerfect = true;
    this.scale = 1;
    this.target = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: this.target.texture },
        uLowRes: { value: new THREE.Vector2(640, 360) },
        uOutRes: { value: new THREE.Vector2(1280, 720) },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uDamage: { value: 0 },
        uFade: { value: 1 },
        uLevels: { value: 20 },
        uCurve: { value: 0 },
        uScan: { value: 0 },
        uTint: { value: 0 },
        uRedAlert: { value: 0 },
        uMenu: { value: 0 },
        uCritical: { value: 0 },
        uTear: { value: 0 },
        uSweep: { value: -1 },
        uGrain: { value: 0 },
        uFringe: { value: 0 },
        uVignette: { value: 0.15 },
        uDither: { value: 0.45 },
        uSat: { value: 1.1 },
        uCalm: { value: 0 },
      },
    });
    this.postScene = new THREE.Scene();
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get uniforms() { return this.post.uniforms; }

  // h: a line count (240/270/320/360…) or 'auto' / 0 / null.
  setLowHeight(h) {
    this.lowHeight = (h === 'auto' || !h) ? 'auto' : Number(h);
    this.resize();
  }

  setPixelPerfect(on) {
    this.pixelPerfect = on !== false;
    this.resize();
  }

  // Convenience for applySettings: takes the §3.4 settings object.
  setOptions(s = {}) {
    const u = this.post.uniforms;
    if ('crt' in s) { u.uScan.value = s.crt ? 0.35 : 0; u.uCurve.value = s.crt ? 0.035 : 0; }
    if ('grain' in s) u.uGrain.value = s.grain ? 0.045 : 0;
    if ('reduceFlash' in s) u.uCalm.value = s.reduceFlash ? 1 : 0;
    let dirty = false;
    if ('pixelPerfect' in s && (s.pixelPerfect !== false) !== this.pixelPerfect) { this.pixelPerfect = s.pixelPerfect !== false; dirty = true; }
    if ('res' in s) {
      const h = (s.res === 'auto' || !s.res) ? 'auto' : Number(s.res);
      if (h !== this.lowHeight) { this.lowHeight = h; dirty = true; }
    }
    if (dirty) this.resize();
  }

  resize() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const W = Math.max(1, Math.round(cssW * dpr));
    const H = Math.max(1, Math.round(cssH * dpr));
    const short = Math.min(W, H);
    const auto = this.lowHeight === 'auto';
    let outW, outH;
    if (this.pixelPerfect) {
      let k;
      if (auto) {
        k = Math.max(1, Math.floor(short / 300));
        if (short >= 400) k = Math.max(k, 2);
      } else {
        k = Math.max(1, Math.round(short / this.lowHeight));
      }
      this.scale = k;
      this.lowW = Math.max(1, Math.floor(W / k));
      this.lowH = Math.max(1, Math.floor(H / k));
      outW = this.lowW * k;
      outH = this.lowH * k;
    } else {
      // fit: the short side gets exactly the requested line count, stretched to fill
      const lines = auto ? Math.max(200, Math.round(short / Math.max(1, Math.floor(short / 330)))) : this.lowHeight;
      if (W >= H) { this.lowH = lines; this.lowW = Math.round(lines * W / H); }
      else { this.lowW = lines; this.lowH = Math.round(lines * H / W); }
      this.scale = short / lines;
      outW = W; outH = H;
    }
    this.gl.setSize(outW, outH, false);
    const st = this.canvas.style;
    st.width = (outW / dpr) + 'px';
    st.height = (outH / dpr) + 'px';
    st.left = Math.floor((W - outW) / 2 / dpr) + 'px';
    st.top = Math.floor((H - outH) / 2 / dpr) + 'px';
    st.right = 'auto';
    st.bottom = 'auto';
    this.outW = outW; this.outH = outH; this.dpr = dpr;
    this.target.setSize(this.lowW, this.lowH);
    this.post.uniforms.uLowRes.value.set(this.lowW, this.lowH);
    this.post.uniforms.uOutRes.value.set(outW, outH);
    // PSX wobble: half-pixel snap at low line counts, off at 320 lines and above
    if (this.lowH >= 320 && this.lowW >= 320) psxUniforms.uSnap.value.set(1e5, 1e5);
    else psxUniforms.uSnap.value.set(this.lowW, this.lowH);
    const aspect = this.lowW / this.lowH;
    this.aspect = aspect;
    if (this.onResize) this.onResize(aspect);
  }

  render(scene, camera, time) {
    this.lastScene = scene;
    this.lastCamera = camera;
    this.post.uniforms.uTime.value = time;
    this.gl.setRenderTarget(this.target);
    this.gl.clear();
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }

  // Harness helper: re-renders the last frame and measures luma on the low-res
  // grid. `graded` (default) measures what the player sees after the grade;
  // `points` ([[x,y,z], …] in world space) also reports the luma under each
  // projected point, e.g. a room's floor tiles. Returns
  // { mean, median, p10, p90, dark, w, h, points: { mean, n } | null }.
  debugLuma({ graded = true, points = null, scene = this.lastScene, camera = this.lastCamera } = {}) {
    if (!scene || !camera) return null;
    const w = this.lowW, h = this.lowH;
    this.gl.setRenderTarget(this.target);
    this.gl.clear();
    this.gl.render(scene, camera);
    let rt = this.target;
    if (graded) {
      if (!this.probe) {
        this.probe = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
      }
      this.probe.setSize(w, h);
      this.gl.setRenderTarget(this.probe);
      this.gl.render(this.postScene, this.postCam);
      rt = this.probe;
    }
    const buf = new Uint8Array(w * h * 4);
    this.gl.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    this.gl.setRenderTarget(null);
    const lum = new Float32Array(w * h);
    let sum = 0, dark = 0;
    for (let i = 0; i < w * h; i++) {
      const v = (0.299 * buf[i * 4] + 0.587 * buf[i * 4 + 1] + 0.114 * buf[i * 4 + 2]) / 255;
      lum[i] = v; sum += v;
      if (v < 0.04) dark++;
    }
    const sorted = Array.from(lum).sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    let pts = null;
    if (points && points.length) {
      let ps = 0, pn = 0;
      for (const p of points) {
        LUMA_POINT.set(p[0], p[1], p[2]).project(camera);
        if (LUMA_POINT.z > 1 || Math.abs(LUMA_POINT.x) > 1 || Math.abs(LUMA_POINT.y) > 1) continue;
        const px = Math.min(w - 1, Math.floor((LUMA_POINT.x * 0.5 + 0.5) * w));
        const py = Math.min(h - 1, Math.floor((LUMA_POINT.y * 0.5 + 0.5) * h));
        ps += lum[py * w + px]; pn++;
      }
      pts = { mean: pn ? ps / pn : 0, n: pn };
    }
    return { mean: sum / (w * h), median: q(0.5), p10: q(0.1), p90: q(0.9), dark: dark / (w * h), w, h, points: pts };
  }
}
