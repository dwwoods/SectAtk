// Heightfield — the terrain the sim's 2.5D LOS and ballistics run against.
// The renderer's terrain mesh (Phase 2) samples this exact surface, so the
// look and the tactics can never drift apart (the reference's
// register-as-modelled discipline, §7.1).
//
// The landform here is not the reference's river-valley — SectAtk needs a
// rolling hillside with a dominant crest, a shallow reverse slope for the
// enemy position, and folds that give the section cover while closing. Same
// noise toolkit, different landform intent.

import { fbm2, noise2, ridged, lerp, clamp } from './noise';
import { HEIGHTMAP_RES, WORLD_SIZE, HALF } from './config';

export interface Heightfield {
  /** Ground height in metres at world-space (x, z). */
  heightAt(x: number, z: number): number;
  /** Terrain normal at (x, z), sampled over `e` metres. */
  normalAt(x: number, z: number, e?: number): { x: number; y: number; z: number };
  /** Max terrain height over the whole world (for sky/fog tuning later). */
  maxHeight(): number;
  /** Min terrain height over the whole world. */
  minHeight(): number;
}

function makeHeightfield(seed: number): Heightfield {
  // Deterministic offset into the noise domain — a different seed gives a
  // different world without changing the noise function.
  const ox = (seed % 1000) * 0.37;
  const oz = ((seed / 1000) | 0) * 0.53;

  const data = new Float32Array(HEIGHTMAP_RES * HEIGHTMAP_RES);
  let min = Infinity;
  let max = -Infinity;

  for (let j = 0; j < HEIGHTMAP_RES; j++) {
    const wz = (j / (HEIGHTMAP_RES - 1)) * WORLD_SIZE - HALF;
    for (let i = 0; i < HEIGHTMAP_RES; i++) {
      const wx = (i / (HEIGHTMAP_RES - 1)) * WORLD_SIZE - HALF;
      const h = terrainHeight(wx, wz, ox, oz);
      data[j * HEIGHTMAP_RES + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }

  return {
    heightAt(x, z) {
      // Clamp to world bounds — everything outside the world is treated as
      // the edge height, so LOS toward the boundary doesn't produce NaN.
      const fx = clamp((x + HALF) / WORLD_SIZE, 0, 0.999999);
      const fz = clamp((z + HALF) / WORLD_SIZE, 0, 0.999999);
      const xi = fx * (HEIGHTMAP_RES - 1);
      const zi = fz * (HEIGHTMAP_RES - 1);
      const x0 = Math.floor(xi);
      const z0 = Math.floor(zi);
      const tx = xi - x0;
      const tz = zi - z0;
      const i = z0 * HEIGHTMAP_RES + x0;
      const h00 = data[i]!;
      const h10 = data[i + 1]!;
      const h01 = data[i + HEIGHTMAP_RES]!;
      const h11 = data[i + HEIGHTMAP_RES + 1]!;
      return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
    },
    normalAt(x, z, e = 2.4) {
      const l = this.heightAt(x - e, z);
      const r = this.heightAt(x + e, z);
      const d = this.heightAt(x, z - e);
      const u = this.heightAt(x, z + e);
      const nx = l - r;
      const ny = 2 * e;
      const nz = d - u;
      const L = Math.hypot(nx, ny, nz) || 1;
      return { x: nx / L, y: ny / L, z: nz / L };
    },
    maxHeight() {
      return max;
    },
    minHeight() {
      return min;
    },
  };
}

function terrainHeight(wx: number, wz: number, ox: number, oz: number): number {
  const s = 0.0016; // feature scale — big hills ~600 m across
  let h = 0;
  // Rolling high ground: the dominant landform.
  h += fbm2((wx + ox) * s, (wz + oz) * s, 4) * 34;
  // Mid folds — enough to hide a prone section from a crest position.
  h += ridged((wx + ox) * s * 2.6 + 11, (wz + oz) * s * 2.6 - 7, 3) * 12;
  h += fbm2((wx + ox) * s * 6.1 - 3, (wz + oz) * s * 6.1 + 5, 3) * 5;
  // Small-scale roughness — the surface soldiers lie on, must not be flat.
  h += noise2((wx + ox) * s * 17.0, (wz + oz) * s * 17.0) * 1.1;
  return h;
}

export function bakeHeightfield(seed = 20260728): Heightfield {
  return makeHeightfield(seed);
}