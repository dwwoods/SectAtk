// Meadow raster — the concealment field. The reference bakes a 512² splat
// with grass mask/dryness; SectAtk's sim needs one number per texel: how
// concealingly tall the grass is at that point (0 = bare ground, 1 = deep
// long grass). This is the "concealment field, free" the design doc §7.1
// credits the reference for.
//
// The same raster feeds the renderer's instanced grass density (Phase 2),
// so where the grass LOOKS thick is exactly where the sim says a prone man
// is hidden — the register-as-modelled discipline applied to vegetation.

import { noise2, clamp, lerp } from './noise';
import { MASK_RES, WORLD_SIZE, HALF } from './config';
import type { Heightfield } from './heightfield';

export interface Meadow {
  /** Grass concealment in [0,1] at world-space (x,z). 1 = long dense grass. */
  concealmentAt(x: number, z: number): number;
  /** Mean grass height in metres (for the renderer's grass scale later). */
  heightAt(x: number, z: number): number;
}

export function bakeMeadow(hf: Heightfield, seed = 20260728): Meadow {
  const ox = (seed % 777) * 0.29;
  const oz = ((seed / 777) | 0) * 0.41;

  const data = new Float32Array(MASK_RES * MASK_RES);

  // Grass grows on gentle slopes, not on cliffs or in hollows; it's also
  // sparse on the highest exposed crests (wind-scoured) and densest in the
  // shallow folds where soldiers will want to lie.
  for (let j = 0; j < MASK_RES; j++) {
    const wz = (j / (MASK_RES - 1)) * WORLD_SIZE - HALF;
    for (let i = 0; i < MASK_RES; i++) {
      const wx = (i / (MASK_RES - 1)) * WORLD_SIZE - HALF;

      // Two-octave grass texture: tussocks (~68 m) and swales (~290 m).
      const cA = noise2((wx + ox) * 0.092 + 3.3, (wz + oz) * 0.092 + 3.3) * 0.5 + 0.5;
      const cB = noise2((wx + ox) * 0.0215 + 17.0, (wz + oz) * 0.0215 + 17.0) * 0.5 + 0.5;

      const n = hf.normalAt(wx, wz, 4.0);
      const slope = 1 - n.y;
      const h = hf.heightAt(wx, wz);

      let grass = lerp(cA, 0.6 + cB * 0.4, 0.5);
      grass *= lerp(1, 0.25, clamp((slope - 0.12) / 0.3, 0, 1)); // steep = bare
      grass *= lerp(1, 0.55, clamp((h - hf.maxHeight() + 8) / 8, 0, 1)); // crests wind-scoured
      grass = clamp(grass * 1.2 - 0.08, 0, 1);

      data[j * MASK_RES + i] = grass;
    }
  }

  const heightFromMask = (g: number): number => 0.4 + g * 1.1; // 0.4 m short grass … 1.5 m deep

  return {
    concealmentAt(x, z) {
      const fx = clamp((x + HALF) / WORLD_SIZE, 0, 0.999999);
      const fz = clamp((z + HALF) / WORLD_SIZE, 0, 0.999999);
      const xi = fx * (MASK_RES - 1);
      const zi = fz * (MASK_RES - 1);
      const x0 = Math.floor(xi);
      const z0 = Math.floor(zi);
      const tx = xi - x0;
      const tz = zi - z0;
      const i = z0 * MASK_RES + x0;
      const g00 = data[i]!;
      const g10 = data[i + 1]!;
      const g01 = data[i + MASK_RES]!;
      const g11 = data[i + MASK_RES + 1]!;
      return lerp(lerp(g00, g10, tx), lerp(g01, g11, tx), tz);
    },
    heightAt(x, z) {
      return heightFromMask(this.concealmentAt(x, z));
    },
  };
}