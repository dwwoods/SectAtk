// Shared GLSL chunks — palette, noise, terrain sampling, fog, sky.
// Ported from the reference (§7.1) and trimmed to what a 600m hillside
// actually needs. The reference's shaders are optimised for a 2400m world;
// ours keep the same look with a fraction of the reach.
//
// The palette is the reference's — one place for every colour in the film,
// sRGB hex → linear at load (see §7.1: fully synthesised, no external
// assets).

export interface Palette {
  [key: string]: string;
}

export const PALETTE: Palette = {
  // sky & air
  skyZenith: '#4E80B4', skyUpper: '#7BA9CE', skyMid: '#A8CAE0', skyHorizon: '#E4DAC2',
  skyHorizonSun: '#FBE2AE', sunGlow: '#FFF1CE', sunDisc: '#FFFAEA', skyAnti: '#C8D4D6',
  haze: '#A9BCC7', mist: '#D6DDD4',
  // clouds
  cloudTop: '#FFF8EC', cloudBody: '#F6E7D2', cloudTerm: '#E8CFB4', cloudUnder: '#B7ACC3',
  cloudCore: '#9791B0', cloudRim: '#FFEFBE', cirrus: '#F3E6D6',
  // grass
  gTip: '#C6D46B', gUpper: '#93B84E', gMid: '#6C9A47', gLow: '#436E4F', gBase: '#2B564F',
  gTrans: '#E9EE7C', gSheen: '#EDF0C8', gDry: '#D9C079',
  gPatchA: '#87AC4B', gPatchB: '#6C9A56', gPatchC: '#9DBC5E', gPatchD: '#5F8A5A',
  // terrain
  tLit: '#93B159', tMid: '#6A924F', tShade: '#456A54', tHollow: '#33564F',
  ridgeNear: '#8FA9A2', ridgeMid: '#9CB0B4', ridgeFar: '#AEBCC9', ridgeFurthest: '#BFC8D4',
  bounce: '#AA9C64',
};

// hex → linear RGB string literal for glsl injection
function hexToLinear(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const lin = srgb.map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return { r: lin[0]!, g: lin[1]!, b: lin[2]! };
}

export function paletteGlsl(): string {
  const C: Record<string, string> = {};
  for (const k of Object.keys(PALETTE)) {
    const { r, g, b } = hexToLinear(PALETTE[k]!);
    C[k] = `vec3(${r.toFixed(5)},${g.toFixed(5)},${b.toFixed(5)})`;
  }
  return `
const vec3 K_SKY_ZEN   = ${C.skyZenith};
const vec3 K_SKY_UP    = ${C.skyUpper};
const vec3 K_SKY_MID   = ${C.skyMid};
const vec3 K_SKY_HOR   = ${C.skyHorizon};
const vec3 K_SKY_HORSUN= ${C.skyHorizonSun};
const vec3 K_SUN_GLOW  = ${C.sunGlow};
const vec3 K_SUN_DISC  = ${C.sunDisc};
const vec3 K_SKY_ANTI  = ${C.skyAnti};
const vec3 K_HAZE      = ${C.haze};
const vec3 K_MIST      = ${C.mist};
const vec3 K_GTIP      = ${C.gTip};
const vec3 K_GUPPER    = ${C.gUpper};
const vec3 K_GMID      = ${C.gMid};
const vec3 K_GLOW      = ${C.gLow};
const vec3 K_GBASE     = ${C.gBase};
const vec3 K_GTRANS    = ${C.gTrans};
const vec3 K_GSHEEN    = ${C.gSheen};
const vec3 K_GDRY      = ${C.gDry};
const vec3 K_GPATA     = ${C.gPatchA};
const vec3 K_GPATB     = ${C.gPatchB};
const vec3 K_GPATC     = ${C.gPatchC};
const vec3 K_GPATD     = ${C.gPatchD};
const vec3 K_TLIT      = ${C.tLit};
const vec3 K_TMID      = ${C.tMid};
const vec3 K_TSHADE    = ${C.tShade};
const vec3 K_THOLLOW   = ${C.tHollow};
const vec3 K_RIDGENEAR = ${C.ridgeNear};
const vec3 K_RIDGEMID  = ${C.ridgeMid};
const vec3 K_RIDGEFAR  = ${C.ridgeFar};
const vec3 K_RIDGEFUR  = ${C.ridgeFurthest};
const vec3 K_BOUNCE    = ${C.bounce};
`;
}

// Hash + value noise (GLSL mirrors of the JS noise toolkit).
export const GL_HASH = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p, int oct){ float a = 0.5, s = 0.0, n = 0.0;
  for(int i = 0; i < oct; i++){ s += a * vn2(p); n += a; a *= 0.5; p *= 2.03; }
  return s / n; }
float pn2(vec2 p){ return vn2(p)*2.0 - 1.0; }
`;

// NaN firewall — one non-finite texel becomes a visible black box; two ALU
// make it structurally impossible.
export const GL_SAFE = /* glsl */`
vec3 SAFE3(vec3 c){ return clamp(mix(vec3(0.0), c, equal(c, c)), vec3(0.0), vec3(64.0)); }
`;

// Standard GLSL3 boilerplate for RawShaderMaterial (three.js 0.180).
export const GL_UNI = /* glsl */`
precision highp float;
precision highp int;
uniform mat4 modelMatrix;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 viewMatrix;
uniform mat3 normalMatrix;
uniform vec3 cameraPosition;
in vec3 position;
`;

export const GL_FRAG_HEAD = /* glsl */`
precision highp float;
precision highp int;
`;

// Shared per-frame uniforms injected into every material.
export interface SharedUniforms {
  uTime: { value: number };
  uCamPos: { value: { x: number; y: number; z: number } };
  uSunDir: { value: { x: number; y: number; z: number } };
  uMeanWind: { value: { x: number; y: number } };
  uFogMul: { value: number };
}
