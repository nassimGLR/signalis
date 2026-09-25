// Low-resolution PSX-style renderer.
// The scene is drawn into a small render target (default 270 lines tall) with
// nearest filtering, then composited to the screen through a CRT pass that
// adds ordered dithering, colour quantisation, scanlines, barrel distortion,
// chromatic fringe, grain, and signal-loss glitches.
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
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

float bayer4(vec2 p) {
  p = mod(p, 4.0);
  int x = int(p.x); int y = int(p.y);
  int i = x + y * 4;
  float m[16];
  m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
  m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
  m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
  m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
  for (int k = 0; k < 16; k++) { if (k == i) return m[k] / 16.0; }
  return 0.0;
}

vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  // pull toward a cold, desaturated base but let saturated reds survive
  float redness = clamp((c.r - max(c.g, c.b)) * 2.2, 0.0, 1.0);
  vec3 desat = mix(vec3(l), c, 0.55 + 0.45 * redness);
  vec3 shadow = vec3(0.020, 0.030, 0.040);
  vec3 cold = desat * vec3(0.93, 1.0, 1.02);
  vec3 g = mix(shadow, vec3(1.0), cold);
  // memory grade: washed, cyan-white, low contrast
  vec3 mem = mix(vec3(0.10, 0.14, 0.16), vec3(0.86, 0.95, 0.97), pow(l, 0.8));
  return mix(g, mem, uTint);
}

void main() {
  vec2 uv = vUv;
  vec2 cc = uv * 2.0 - 1.0;
  cc *= 1.0 + uCurve * dot(cc, cc);
  uv = cc * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // signal glitches: tear individual low-res rows sideways
  float row = floor(uv.y * uLowRes.y);
  float band = floor(uv.y * 24.0);
  float t = floor(uTime * 24.0);
  float tearRow = step(1.0 - uGlitch * 0.35, hash(row * 0.73 + t));
  float tearBand = step(1.0 - uGlitch * 0.12, hash(band * 1.31 + t * 0.7));
  uv.x += (tearRow * (hash(row + t) - 0.5) * 0.05 + tearBand * (hash(band + t) - 0.5) * 0.12) * uGlitch;

  vec2 px = 1.0 / uLowRes;
  float edge = length(cc);
  float ca = (0.35 + edge * 0.9 + uGlitch * 3.0) * px.x;
  vec3 col;
  col.r = texture2D(tScene, uv + vec2(ca, 0.0)).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - vec2(ca, 0.0)).b;

  col = grade(col);

  // red alert pulse / damage flash
  col = mix(col, col * vec3(1.35, 0.35, 0.3) + vec3(0.06, 0.0, 0.0), uRedAlert);
  col = mix(col, vec3(0.55, 0.02, 0.04), uDamage * 0.55);

  // ordered dither + quantise in low-res pixel space
  vec2 lp = floor(uv * uLowRes);
  float d = bayer4(lp) - 0.5;
  col += d / uLevels;
  col = floor(col * uLevels + 0.5) / uLevels;

  // scanlines at output resolution, aligned to low-res rows
  float rowPos = fract(uv.y * uLowRes.y);
  float scan = 1.0 - uScan * pow(abs(rowPos - 0.5) * 2.0, 2.0);
  col *= scan;
  // faint aperture grille
  float grille = 0.94 + 0.06 * sin(gl_FragCoord.x * 2.094);
  col *= mix(1.0, grille, uScan);

  // grain + rolling interference bar
  float grain = hash2(lp + fract(uTime) * 91.7) - 0.5;
  col += grain * (0.045 + uGlitch * 0.12);
  float roll = smoothstep(0.0, 0.05, abs(fract(uv.y * 0.6 - uTime * 0.07) - 0.5));
  col *= 0.97 + 0.03 * roll;

  // vignette
  float vig = smoothstep(1.45, 0.35, edge);
  col *= mix(0.25, 1.0, vig);

  col *= uFade;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

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

    this.lowHeight = 270;
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
        uLowRes: { value: new THREE.Vector2(480, 270) },
        uOutRes: { value: new THREE.Vector2(1920, 1080) },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uDamage: { value: 0 },
        uFade: { value: 1 },
        uLevels: { value: 28 },
        uCurve: { value: 0.035 },
        uScan: { value: 0.35 },
        uTint: { value: 0 },
        uRedAlert: { value: 0 },
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

  setLowHeight(h) {
    this.lowHeight = h;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    const aspect = w / h;
    // the low-res buffer's short side is `lowHeight` pixels (portrait screens too)
    if (aspect >= 1) { this.lowH = this.lowHeight; this.lowW = Math.round(this.lowHeight * aspect); }
    else { this.lowW = this.lowHeight; this.lowH = Math.round(this.lowHeight / aspect); }
    this.target.setSize(this.lowW, this.lowH);
    this.post.uniforms.uLowRes.value.set(this.lowW, this.lowH);
    this.post.uniforms.uOutRes.value.set(w, h);
    psxUniforms.uSnap.value.set(this.lowW / 2, this.lowH / 2);
    this.aspect = aspect;
    if (this.onResize) this.onResize(aspect);
  }

  render(scene, camera, time) {
    this.post.uniforms.uTime.value = time;
    this.gl.setRenderTarget(this.target);
    this.gl.clear();
    this.gl.render(scene, camera);
    this.gl.setRenderTarget(null);
    this.gl.render(this.postScene, this.postCam);
  }
}
