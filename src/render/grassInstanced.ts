// Instanced grass field — ported from the reference's 4-ring system (§7.1).
// Two rings for the 600m world: near (0-50m, 8m chunks) and mid (40-160m,
// 24m chunks). Each ring is a grid of chunk meshes with the reference's
// density law: the CPU over-draws each chunk at the density its NEAREST
// corner deserves, and the vertex shader rejects surplus blades per-blade
// based on true distance. The result is a perfectly smooth radial density
// gradient with no chunk banding.
//
// The meadow raster (from worldgen) provides the grass mask and tussock
// bands for blade height/color variation. Wind is analytic (no render
// target — the reference's windBandAnalytic is inlined in the VS).

import * as THREE from 'three';
import type { IUniform } from 'three';
import { GL_FRAG_HEAD, GL_SAFE, GL_HASH, GL_UNI, paletteGlsl } from './glsl';
import type { SharedUniforms } from './glsl';
import type { Heightfield } from '../worldgen/heightfield';
import type { Meadow } from '../worldgen/meadow';
import { WORLD_SIZE, HALF } from '../worldgen/config';

// ── ring config ────────────────────────────────────────────────────────────
interface RingDef {
  chunk: number;  // chunk size, metres
  blades: number; // max blades per chunk at density 1.0
  near: number;   // start fade-in, metres
  far: number;    // end fade-out, metres
  dn: number;     // density law reference distance
}

const RINGS: RingDef[] = [
  { chunk: 8,  blades: 64000,  near: 0,   far: 50,  dn: 7 },
  { chunk: 24, blades: 120000, near: 40,  far: 160, dn: 22 },
];

// ── blade geometry ─────────────────────────────────────────────────────────
// A quad strip, 3 segments (4 tris). The reference uses 3-5; 3 is enough
// for a visible blade curve at ~1 pixel width.
const SEGS = 3;

function buildBladeGeometry(): THREE.InstancedBufferGeometry {
  const n = Math.max(1, SEGS);
  const nv = 2 * n + 1;
  const vtx = new Float32Array(nv * 3);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const v = i / n;
    vtx[k] = 0; vtx[k + 1] = v; vtx[k + 2] = 0;
    vtx[k + 3] = 1; vtx[k + 4] = v; vtx[k + 5] = 0;
    k += 6;
  }
  vtx[k] = 0.5; vtx[k + 1] = 1; vtx[k + 2] = 0;

  const tri: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    tri.push(a, c, b, b, c, d);
  }
  const a = (n - 1) * 2;
  tri.push(a, 2 * n, a + 1);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vtx, 3));
  geo.setIndex(tri);
  return geo;
}

// ── instance buffer (stratified jitter + Fisher-Yates shuffle) ────────────
function buildInstanceBuffer(count: number, seed: number): Uint16Array {
  // mulberry32
  const rng = (() => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  const buf = new Uint16Array(count * 2);
  const side = Math.ceil(Math.sqrt(count));
  const cell = 1 / side;
  let k = 0;
  for (let i = 0; i < count; i++) {
    const gx = i % side, gy = (i / side) | 0;
    buf[k++] = Math.min(65535, ((gx + rng()) * cell) * 65535) | 0;
    buf[k++] = Math.min(65535, ((gy + rng()) * cell) * 65535) | 0;
  }
  for (let i = count - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    const ax = buf[i * 2]!, az = buf[i * 2 + 1]!;
    buf[i * 2] = buf[j * 2]!; buf[i * 2 + 1] = buf[j * 2 + 1]!;
    buf[j * 2] = ax; buf[j * 2 + 1] = az;
  }
  return buf;
}

// ── grass field ───────────────────────────────────────────────────────────
export class GrassField {
  private group = new THREE.Group();
  private rings: RingState[] = [];
  private shared: SharedUniforms;

  constructor(scene: THREE.Scene, hf: Heightfield, meadow: Meadow, shared: SharedUniforms) {
    this.shared = shared;
    scene.add(this.group);
    this.group.matrixAutoUpdate = false;

    const bladeGeo = buildBladeGeometry();
    const heightTex = makeHeightTexture(hf);
    const meadowTex = makeMeadowTexture(meadow);

    for (let ri = 0; ri < RINGS.length; ri++) {
      const R = RINGS[ri]!;
      const count = R.blades;
      const grid = Math.max(3, (Math.ceil(2 * R.far / R.chunk) + 1) | 1);

      // Build one geometry with the instance buffer; all chunks in this ring
      // share it.
      const geom = bladeGeo.clone();
      const ibuf = buildInstanceBuffer(count, 7000 + ri * 131);
      geom.setAttribute('iPos', new THREE.InstancedBufferAttribute(ibuf, 2, true));
      geom.instanceCount = count;

      const uni: Record<string, IUniform> = {
        uTime: shared.uTime as IUniform,
        uCamPos: { value: new THREE.Vector3() } as IUniform,
        uSunDir: shared.uSunDir as IUniform,
        uChunkSize: { value: R.chunk } as IUniform,
        uLod: { value: new THREE.Vector4(R.near, Math.max(7, R.near * 0.26), R.far, R.far * 0.26) } as IUniform,
        uLodB: { value: new THREE.Vector3(0.0011 * 1.7, 1.0, R.dn) } as IUniform,
        uWindGain: { value: 0.235 } as IUniform,
        uHeight: { value: heightTex } as IUniform,
        uMeadow: { value: meadowTex } as IUniform,
        uMeanWind: shared.uMeanWind as IUniform,
        uWindLag: { value: new THREE.Vector2(2.6, 0) } as IUniform,
        uCull: { value: new THREE.Vector3(0, 0, -1) } as IUniform,
      };      const mat = new THREE.RawShaderMaterial({
        vertexShader: VHEAD + GRASS_VS,
        fragmentShader: FHEAD + GRASS_FS,
        uniforms: uni,
        side: THREE.DoubleSide,
        glslVersion: THREE.GLSL3,
      });

      const meshes: THREE.Mesh[] = [];
      const half = (grid - 1) / 2;
      for (let j = 0; j < grid; j++) {
        for (let i = 0; i < grid; i++) {
          const cx = (i - half) * R.chunk;
          const cz = (j - half) * R.chunk;
          // Distance from nearest corner to the ring center.
          const cd = Math.hypot(Math.abs(cx), Math.abs(cz));
          const keep = R.dn / Math.max(cd, R.dn);
          const keepSq = keep * keep;
          // Gard: chunkKeep rides in modelMatrix[1][1] (the Y scale).
          const mesh = new THREE.Mesh(geom, mat);
          mesh.position.set(cx, 0, cz);
          mesh.scale.y = Math.max(0.01, keepSq);
          mesh.frustumCulled = true;
          this.group.add(mesh);
          meshes.push(mesh);
        }
      }
      this.rings.push({ meshes, geom, mat, R, grid });
    }
  }

  update(camera: THREE.Camera): void {
    // Sync per-frame uniforms once per ring — every mesh in a ring shares
    // the ring's material, so per-mesh writes would redo the same work
    // grid² times. (Cam pos re-typed as a Vector3 for the uniform type.)
    const camPos = this.shared.uCamPos.value;
    for (const ring of this.rings) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = ring.mat.uniforms as any;
      u.uCamPos.value.set(camPos.x, camPos.y, camPos.z);
      u.uTime.value = this.shared.uTime.value;
    }
    void camera;
  }

  dispose(): void {
    this.group.clear();
    for (const ring of this.rings) {
      ring.geom.dispose();
      ring.mat.dispose();
    }
    this.rings.length = 0;
  }
}

interface RingState {
  meshes: THREE.Mesh[];
  geom: THREE.BufferGeometry;
  mat: THREE.RawShaderMaterial;
  R: RingDef;
  grid: number;
}

// ── height texture (for grass VS to sample ground height) ─────────────────
function makeHeightTexture(hf: Heightfield): THREE.DataTexture {
  const RES = 256;
  const data = new Float32Array(RES * RES);
  for (let j = 0; j < RES; j++) {
    const wz = (j / (RES - 1)) * WORLD_SIZE - HALF;
    for (let i = 0; i < RES; i++) {
      const wx = (i / (RES - 1)) * WORLD_SIZE - HALF;
      data[j * RES + i] = hf.heightAt(wx, wz);
    }
  }
  const tex = new THREE.DataTexture(data, RES, RES, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

// ── meadow texture: R=tussock, G=swale, B=mask, A=dryness ────────────────
// Baked from the worldgen Meadow interface (the same source of truth the
// sim's exposure/LOS use — where the grass LOOKS thick is where the sim
// says a prone man is hidden).
function makeMeadowTexture(meadow: Meadow): THREE.DataTexture {
  const RES = 256;
  const data = new Uint8Array(RES * RES * 4);
  for (let j = 0; j < RES; j++) {
    const wz = (j / (RES - 1)) * WORLD_SIZE - HALF;
    for (let i = 0; i < RES; i++) {
      const wx = (i / (RES - 1)) * WORLD_SIZE - HALF;
      const c = meadow.concealmentAt(wx, wz);
      const idx = (j * RES + i) * 4;
      // R = tussock band, G = swale band (both from concealment for now),
      // B = grass mask, A = dryness (0).
      data[idx] = Math.round(c * 255);
      data[idx + 1] = Math.round(c * 255);
      data[idx + 2] = Math.round(c * 255);
      data[idx + 3] = 0;
    }
  }
  const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

// ── shader headers ────────────────────────────────────────────────────────
const VHEAD = GL_UNI + `
uniform float uTime;
uniform vec3 uCamPos;
uniform float uChunkSize;
uniform vec4  uLod;
uniform vec3  uLodB;
uniform float uWindGain;
uniform vec2  uMeanWind;
uniform vec2  uWindLag;
uniform vec3  uCull;
uniform sampler2D uHeight;
uniform sampler2D uMeadow;
${GL_HASH}
in vec2 iPos;
out vec3 vW;
out vec3 vN;
out float vT;
out float vBend;
out vec3 vTint;
out float vSide;
out float vOccl;
out float vVar;
`;

const FHEAD = GL_FRAG_HEAD + `
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform sampler2D uHeight;
uniform sampler2D uMeadow;
${GL_SAFE}
${GL_HASH}
${paletteGlsl()}
in vec3 vW;
in vec3 vN;
in float vT;
in float vBend;
in vec3 vTint;
in float vSide;
in float vOccl;
in float vVar;
out vec4 outColor;
`;

// ── grass vertex shader (simplified from reference) ──────────────────────
// Ports the key techniques: density law, meadow-driven height/color, wind
// bending via analytic gust, Bézier blade frame, LOD fade. Omits prepass,
// shadow, cloud, reflection, walker push, and wind RT.
const GRASS_VS = /* glsl */`
void degenerate(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

void main(){
  vec2 vtx = position.xy;
  vec2 cCen = vec2(modelMatrix[3][0], modelMatrix[3][2]);
  vec2 wxz = (cCen - vec2(uChunkSize * 0.5)) + iPos * uChunkSize;
  vec2 toB = wxz - uCamPos.xz;
  float d2 = dot(toB, toB);
  float invD = inversesqrt(max(d2, 1e-4));
  float dist = d2 * invD;

  // LOD fade
  float fadeIn  = uLod.x <= 0.01 ? 1.0 : smoothstep(uLod.x - uLod.y, uLod.x + uLod.y, dist);
  float fadeOut = uLod.z <= 0.0  ? 1.0 : 1.0 - smoothstep(uLod.z - uLod.w, uLod.z, dist);
  float fade = fadeIn * fadeOut;
  if(fade < 0.006) { degenerate(); return; }

  // Density law: reject surplus blades for smooth radial gradient.
  float rQ = hash12(wxz * 1.317 + 7.71);
  float dn = uLodB.z;
  float chunkKeep = modelMatrix[1][1];
  float xr = min(dn / max(dist, dn), 1.0);
  float bladeKeep = xr * xr * inversesqrt(max(xr, 1e-6));
  float need = rQ * chunkKeep;
  if(need > bladeKeep) { degenerate(); return; }
  float grow = clamp((bladeKeep - need) / max(bladeKeep * 0.22, 1e-5), 0.0, 1.0);
  if(grow <= 0.004) { degenerate(); return; }
  fade *= grow;

  // Sample meadow and terrain.
  float ground = texture(uHeight, wxz * 0.001667 + 0.5).r;
  vec4 md = texture(uMeadow, wxz * 0.001667 + 0.5);
  float mask = md.b;
  if(mask < 0.035) { degenerate(); return; }
  float clumpA = md.r, clumpB = md.g, dryv = md.a;

  // Per-blade hash.
  vec3 h3 = hash32(wxz * 0.9173 + 11.0);
  float rH = h3.x, rO = h3.y, rS = h3.z;
  float rP = hash12(wxz * 2.713 + 31.4);

  // Blade height from meadow tussocks.
  float hgt = (0.62 + rH * 0.58);
  hgt *= 0.68 + 0.74 * clumpB;
  hgt *= 0.84 + 0.38 * clumpA;
  hgt *= mix(1.24, 0.82, dryv);
  hgt *= mix(0.68, 1.0, mask);
  hgt *= uLodB.y;
  hgt = max(hgt, 0.08);

  float wid = (0.0082 + rS * 0.0070) * (0.84 + 0.40 * clumpA);
  wid = max(wid, dist * uLodB.x);

  float stiff = 0.52 + rS * 0.46 + clumpB * 0.10;

  // Blade orientation.
  float orient = rO * 6.2831853 + clumpA * 2.4;
  vec3 axis = vec3(cos(orient), 0.0, sin(orient));
  vec3 toCam = normalize(vec3(uCamPos.x - wxz.x, 0.0, uCamPos.z - wxz.y) + vec3(1e-5));
  float faceCam = smoothstep(16.0, 80.0, dist);
  axis = normalize(mix(axis, normalize(cross(vec3(0.0, 1.0, 0.0), toCam)), faceCam * 0.88));

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(up, axis) + vec3(1e-6));
  vec3 front = normalize(cross(side, up));

  vec3 p0 = vec3(wxz.x, ground - 0.035, wxz.y);
  vec3 iv2 = p0 + up * hgt * 0.965 + front * hgt * (0.20 + rH * 0.34);

  // Analytic wind (simplified: travelling wave, no RT).
  vec2 wind = uMeanWind * (1.0 + 0.5 * fbm2(wxz * 0.005 + uTime * vec2(0.04, 0.02), 3));
  float prof = log((max(hgt * 0.70, 0.015) + 0.06) / 0.06) * 0.19523;
  vec3 wind3 = vec3(wind.x, 0.0, wind.y) * prof;

  vec3 gE = vec3(0.0, -1.0, 0.0) * (1.6 + 1.4 * rH);
  vec3 gF = 0.25 * length(gE) * front;
  vec3 gv = (gE + gF) * 0.048;

  vec3 dir0 = normalize(iv2 - p0);
  float fd = 1.0 - abs(dot(normalize(wind3 + vec3(1e-5)), dir0));
  float fr = clamp(dot(iv2 - p0, up) / hgt, 0.0, 1.0);
  vec3 wf = wind3 * (0.30 + 0.95 * fd) * fr * uWindGain * (0.55 + 0.75 * hgt);

  // Quasi-static equilibrium.
  vec3 v2 = iv2 + (gv + wf) / max(stiff, 0.18);

  // Ringing.
  float fB = 1.85 + rS * 1.55;
  float ph = rQ * 6.2831853;
  float osc = sin(uTime * 6.2831853 * fB + ph);
  float excite = 0.3;
  float amp = (excite * 0.50) * (0.040 + 0.075 * (1.0 - stiff));
  vec2 wdirn = normalize(wind + vec2(1e-5));
  v2 += vec3(wdirn.x, 0.0, wdirn.y) * osc * amp * hgt;
  v2 += side * sin(uTime * 7.4 * (0.65 + rS) + ph * 2.3) * hgt * 0.020 * 0.35;

  // State corrections.
  v2 -= up * min(dot(up, v2 - p0), 0.0);
  vec3 d20 = v2 - p0;
  float lproj = length(d20 - up * dot(d20, up));
  vec3 v1 = p0 + hgt * up * max(1.0 - lproj / hgt, 0.05 * max(lproj / hgt, 1.0));
  float L0 = length(v2 - p0);
  float L1 = length(v1 - p0) + length(v2 - v1);
  float L = (2.0 * L0 + L1) / 3.0;
  float rr = hgt / max(L, 1e-4);
  v1 = p0 + rr * (v1 - p0);
  v2 = v1 + rr * (v2 - v1);

  // Bézier evaluation.
  float head = step(0.895, rP);
  float t = vtx.y;
  vec3 a = mix(p0, v1, t);
  vec3 b = mix(v1, v2, t);
  vec3 c = mix(a, b, t);
  vec3 tang = normalize(b - a + vec3(0.0, 1e-5, 0.0));

  float wprof = sqrt(1.0 - t) * (0.60 + 0.42 * smoothstep(0.0, 0.16, t));
  wprof = mix(wprof, wprof * 1.9, head * smoothstep(0.80, 0.99, t));
  float u = (vtx.x - 0.5);
  vec3 sideW = normalize(side - tang * dot(side, tang) + vec3(1e-6));
  vec3 pos = c + sideW * (u * wid * wprof * 2.0 * fade);
  pos = mix(p0 + vec3(0.0, 0.02, 0.0), pos, 0.30 + 0.70 * fade);

  vec3 faceN = normalize(cross(sideW, tang));
  vec3 N = normalize(faceN + sideW * (u * 2.0) * 0.66);

  vBend = clamp(1.0 - dot(normalize(v2 - p0), up), 0.0, 1.0);
  vT = t;
  vSide = u * 2.0;
  vW = pos;
  vN = N;
  vOccl = smoothstep(0.18, 1.05, hgt / (0.42 + 0.72 * clumpB));
  vVar = rS * 0.6 + rH * 0.4 + head * 2.0;
  vTint = vec3(clumpB, clumpA, clamp(dryv + (rH - 0.5) * 0.22, 0.0, 1.0));

  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
}
`;

// ── grass fragment shader ─────────────────────────────────────────────────
// Ports the reference's vertical hue path, meadow mosaic, per-blade jitter,
// and ambient occlusion. Omits shadow, cloud, and reflection passes.
const GRASS_FS = /* glsl */`
void main(){
  vec3 N = normalize(vN);
  vec3 toEye = uCamPos - vW;
  float vDist = length(toEye);
  vec3 V = toEye / max(vDist, 1e-4);
  if(!gl_FrontFacing) N = -N;
  float vHead = step(1.5, vVar);
  float vVarF = vVar - vHead * 2.0;
  float vAO = mix(0.34, 1.0, pow(vT, 0.55));

  // Vertical hue path.
  float t = vT;
  vec3 lit = mix(K_GLOW, K_GMID, smoothstep(0.00, 0.26, t));
  lit = mix(lit, K_GUPPER, smoothstep(0.20, 0.66, t));
  lit = mix(lit, K_GTIP, smoothstep(0.80, 1.00, t));
  vec3 mid = mix(K_GBASE, K_GMID, smoothstep(0.05, 0.80, t));
  vec3 shd = mix(K_GBASE * 0.82, K_GLOW, smoothstep(0.15, 0.95, t));

  // Meadow mosaic.
  lit = mix(lit, K_GPATC, smoothstep(0.35, 0.85, vTint.x) * 0.45);
  lit = mix(lit, K_GPATA, smoothstep(0.65, 0.15, vTint.x) * 0.35);
  mid = mix(mid, K_GPATB, smoothstep(0.3, 0.8, vTint.y) * 0.40);
  shd = mix(shd, K_THOLLOW, smoothstep(0.4, 0.9, vTint.y) * 0.35);
  float dry = smoothstep(0.68, 0.99, vTint.z) * smoothstep(0.45, 0.98, t);
  lit = mix(lit, K_GDRY, dry * 0.60);
  mid = mix(mid, K_GDRY * 0.72, dry * 0.42);

  // Per-blade jitter.
  float vj = 0.84 + 0.34 * vVarF;
  lit *= vj; mid *= vj * 0.98; shd *= 0.92 + 0.20 * vVarF;

  float ndl = dot(N, uSunDir);
  float selfShadow = mix(0.62, 1.0, pow(t, 0.75));
  float nearK = 1.0 - smoothstep(55.0, 240.0, vDist);
  N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.34 + 0.66 * nearK));

  float diff = max(ndl * 0.55 + 0.45, 0.0);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  float sheen = pow(max(dot(normalize(V + uSunDir), N), 0.0), 6.0);
  float windFl = smoothstep(0.5, 1.0, vBend) * nearK * 0.20;

  vec3 col = mix(shd, mid, diff * vAO);
  col = mix(col, lit, pow(diff * 0.55 + 0.45, 1.6) * vAO * selfShadow);
  col += rim * 0.08 * K_GTRANS;
  col += sheen * 0.12 * K_GSHEEN;
  col += windFl * K_GTRANS;

  // Fog.
  float d = max(vDist - 70.0, 0.0);
  float f = 1.0 - exp(-pow(d / 1200.0, 1.28) * 3.1 * 0.8);
  vec3 fogCol = mix(K_HAZE, K_MIST, 0.35);
  col = mix(col, fogCol, clamp(f, 0.0, 1.0));

  outColor = vec4(SAFE3(col), 1.0);
}
`;