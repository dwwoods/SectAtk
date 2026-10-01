// Worldgen — single source of truth for looks AND tactics (design doc §10).
// Owns the heightfield, meadow raster, foliage canopy raster, and distance
// field. The sim's LOS, exposure, and ballistics query this; the renderer's
// terrain mesh, grass rendering, and tree placement query the same data.
//
// The reference's register-as-modelled discipline (§7.1): every building
// registers its box as it is modelled. Here, every raster is baked from
// the same noise toolkit, so the sim and renderer see the same world.

import { bakeHeightfield, type Heightfield } from './heightfield';
import { bakeMeadow, type Meadow } from './meadow';
import { bakeCanopy, type Canopy } from './foliage';
import { makeDF, type DistField } from './distanceField';

export interface WorldGen {
  heightfield: Heightfield;
  meadow: Meadow;
  canopy: Canopy;
  /** Distance to nearest cover feature (terrain fold, copse edge). */
  coverDF: DistField;
}

export function bakeWorld(seed = 20260728): WorldGen {
  const heightfield = bakeHeightfield(seed);
  const meadow = bakeMeadow(heightfield, seed);
  const canopy = bakeCanopy(heightfield, seed);

  // Build a cover distance field from terrain convexity (ridges). A ridge
  // is where the terrain is locally convex: the second derivative (Laplacian
  // of height) is negative. The magnitude of the Laplacian at a point tells
  // how sharp the feature is — and the forward slope of a ridge is the best
  // cover a prone man can have.
  const coverPoints: Array<{ x: number; z: number; t: number }> = [];
  const step = 8; // metres
  for (let x = -280; x <= 280; x += step) {
    for (let z = -280; z <= 280; z += step) {
      const h = heightfield.heightAt(x, z);
      const hE = heightfield.heightAt(x + step, z);
      const hW = heightfield.heightAt(x - step, z);
      const hN = heightfield.heightAt(x, z + step);
      const hS = heightfield.heightAt(x, z - step);
      // Discrete Laplacian: positive = concave (hollow), negative = convex (crest).
      const laplacian = hE + hW + hN + hS - 4 * h;
      // A ridge is a point of strong convexity (negative Laplacian).
      if (laplacian < -0.5) {
        const strength = Math.min(1, -laplacian / 3);
        coverPoints.push({ x, z, t: strength });
      }
    }
  }

  const coverDF = makeDF(coverPoints, 128);

  return { heightfield, meadow, canopy, coverDF };
}