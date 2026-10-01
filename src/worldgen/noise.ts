// Gradient noise toolkit ported from the Hoshi-no-Tani reference (§7.1).
// Same PERM table, GX/GY gradients, mulberry32 seeding — the worldgen
// heightfield is built from this, so the renderer's terrain mesh (Phase 2)
// matches the sim's LOS heightfield deterministically.
//
// PERM table is initialised once at module load with a fixed seed, so every
// invocation of noise2 with the same arguments produces the same result
// regardless of evaluation order. This is what the determinism gate depends
// on: the worldgen noise is pure even though the table is shared.

const TAU = Math.PI * 2;

function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// mulberry32 — same as sim/rng.ts, inlined here so noise.ts has zero
// dependencies. Seed is fixed: the PERM table is a one-time bake.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
const GX = new Float32Array(256);
const GY = new Float32Array(256);

// Initialise once at module scope with a fixed seed. The reference uses
// seed 20240715; we use a different seed for our own terrain.
(function initNoise() {
  const r = mulberry32(20260728);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (r() * (i + 1)) | 0;
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]!;
  for (let i = 0; i < 256; i++) {
    const a = r() * TAU;
    GX[i] = Math.cos(a);
    GY[i] = Math.sin(a);
  }
})();

// 2D gradient noise. Returns values in ~[-1, 1].
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const X = xi & 255;
  const Y = yi & 255;
  const a = PERM[X + PERM[Y]!]!;
  const b = PERM[X + 1 + PERM[Y]!]!;
  const c = PERM[X + PERM[Y + 1]!]!;
  const d = PERM[X + 1 + PERM[Y + 1]!]!;
  const n00 = GX[a]! * xf + GY[a]! * yf;
  const n10 = GX[b]! * (xf - 1) + GY[b]! * yf;
  const n01 = GX[c]! * xf + GY[c]! * (yf - 1);
  const n11 = GX[d]! * (xf - 1) + GY[d]! * (yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4;
}

// Fractional Brownian Motion. Returns values in ~[-1, 1].
export function fbm2(
  x: number,
  y: number,
  oct = 5,
  lac = 2.03,
  gain = 0.5,
): number {
  let a = 0.5;
  let f = 1;
  let s = 0;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f, y * f);
    n += a;
    a *= gain;
    f *= lac;
  }
  return s / n;
}

// Ridged noise. Returns values in ~[-1, 1].
export function ridged(
  x: number,
  y: number,
  oct = 5,
  lac = 2.07,
  gain = 0.5,
): number {
  let a = 0.5;
  let f = 1;
  let s = 0;
  let n = 0;
  let w = 1;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise2(x * f, y * f));
    const vv = v * v * w;
    w = clamp(vv * 1.6, 0, 1);
    s += a * vv;
    n += a;
    a *= gain;
    f *= lac;
  }
  return (s / n) * 2 - 1;
}

export { clamp, lerp, smoothstep };