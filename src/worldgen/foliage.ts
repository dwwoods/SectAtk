// Foliage raster — canopy density for LOS (canopy blocks observation/fire
// like terrain, but is "soft": it reduces the chance of a clean sightline
// rather than making it impossible) and, later, the renderer's tree
// placement density (Phase 2).
//
// Trees grow in copses, not uniformly: a low-frequency mask biases the
// distribution so the battlefield reads as fields with scattered woods,
// and the sim's canopy LOS uses the same raster the renderer will plant
// trees from.

import { fbm2, clamp, lerp } from './noise';
import { MASK_RES, WORLD_SIZE, HALF } from './config';
import type { Heightfield } from './heightfield';

export interface Canopy {
  /** Canopy density in [0,1] at world-space (x,z). */
  densityAt(x: number, z: number): number;
}

export function bakeCanopy(hf: Heightfield, seed = 20260728): Canopy {
  const ox = (seed % 991) * 0.31;
  const oz = ((seed / 991) | 0) * 0.47;

  const data = new Float32Array(MASK_RES * MASK_RES);

  for (let j = 0; j < MASK_RES; j++) {
    const wz = (j / (MASK_RES - 1)) * WORLD_SIZE - HALF;
    for (let i = 0; i < MASK_RES; i++) {
      const wx = (i / (MASK_RES - 1)) * WORLD_SIZE - HALF;
      const n = hf.normalAt(wx, wz, 6.0);
      const slope = 1 - n.y;
      const c = fbm2((wx + ox) * 0.004, (wz + oz) * 0.004, 3); // copse-scale patches
      const d = fbm2((wx + ox) * 0.05, (wz + oz) * 0.05, 2); // per-tree jitter
      let density = clamp(c * 1.6 + d * 0.35, 0, 1);
      // Trees avoid steep ground and the very crest line.
      density *= 1 - clamp((slope - 0.18) / 0.25, 0, 1);
      data[j * MASK_RES + i] = clamp(density, 0, 1);
    }
  }

  return {
    densityAt(x, z) {
      const fx = clamp((x + HALF) / WORLD_SIZE, 0, 0.999999);
      const fz = clamp((z + HALF) / WORLD_SIZE, 0, 0.999999);
      const xi = fx * (MASK_RES - 1);
      const zi = fz * (MASK_RES - 1);
      const x0 = Math.floor(xi);
      const z0 = Math.floor(zi);
      const tx = xi - x0;
      const tz = zi - z0;
      const i = z0 * MASK_RES + x0;
      const c00 = data[i]!;
      const c10 = data[i + 1]!;
      const c01 = data[i + MASK_RES]!;
      const c11 = data[i + MASK_RES + 1]!;
      return lerp(lerp(c00, c10, tx), lerp(c01, c11, tx), tz);
    },
  };
}