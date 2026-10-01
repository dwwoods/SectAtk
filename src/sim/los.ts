// 2.5D LOS — ray vs heightfield + meadow + canopy rasters.
// The sim's truth: can position A see position B, given terrain, grass
// concealment, and tree canopy. The renderer's camera ray (Phase 3) MAY
// disagree with the sim's LOS (the sim's LOS is the truth; the renderer
// draws what the commander sees through the fog of war — they answer
// different questions). But the sim's LOS is the ground truth that the
// knowledge system uses to update the commander's picture.

import type { Heightfield } from '../worldgen/heightfield';
import type { Meadow } from '../worldgen/meadow';
import type { Canopy } from '../worldgen/foliage';
import type { Soldier } from './soldier';
import { EYE_HEIGHT } from './config';

export interface LOSResult {
  /** True if the line is clear (terrain doesn't block). */
  clear: boolean;
  /** Concealment factor from grass and canopy along the ray (0 = no
      concealment, 1 = fully concealed). */
  concealment: number;
  /** Distance in metres. */
  distance: number;
}

/**
 * 2.5D LOS check from (x0, z0) at height h0 to (x1, z1) at height h1.
 * Returns whether the line is clear of terrain, and the concealment
 * contributed by the meadow and canopy along the path.
 *
 * Heights are in metres above the terrain (eye height, or torso height
 * for a prone man). The sim adds the terrain height to get absolute
 * elevation for the ray.
 */
export function losBetween(
  x0: number, z0: number, h0: number,
  x1: number, z1: number, h1: number,
  heightfield: Heightfield,
  meadow: Meadow,
  canopy: Canopy,
): LOSResult {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.5) return { clear: true, concealment: 0, distance: dist };

  const steps = Math.max(3, Math.ceil(dist / 2)); // sample every 2 m
  let maxConcealment = 0;

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x0 + dx * t;
    const z = z0 + dz * t;

    // Interpolated ray height at this sample point.
    const rayH = h0 + (h1 - h0) * t;

    // Terrain height at this point.
    const terrainH = heightfield.heightAt(x, z);

    // If terrain rises above the ray, the line is blocked.
    if (terrainH > rayH) {
      return { clear: false, concealment: maxConcealment, distance: dist };
    }

    // Meadow concealment along the path.
    const grass = meadow.concealmentAt(x, z);
    if (grass > maxConcealment) maxConcealment = grass;

    // Canopy concealment: if the ray passes through tree canopy, it adds
    // concealment. Canopy is at a height above the ground — we only count
    // it if the ray is within canopy range.
    const canopyDensity = canopy.densityAt(x, z);
    if (canopyDensity > 0.1 && rayH - terrainH < 15 && rayH - terrainH > 3) {
      // Ray is passing through the canopy layer.
      maxConcealment = Math.max(maxConcealment, canopyDensity * 0.7);
    }
  }

  return { clear: true, concealment: maxConcealment, distance: dist };
}

/** LOS between two soldiers, eye heights derived from stance and terrain.
    This is the gate on the fire paths: no clear line, no shot. */
export function soldierLos(
  a: Soldier,
  b: Soldier,
  world: { heightfield: Heightfield; meadow: Meadow; canopy: Canopy },
): LOSResult {
  const h0 = world.heightfield.heightAt(a.pos.x, a.pos.z) + EYE_HEIGHT[a.stance];
  const h1 = world.heightfield.heightAt(b.pos.x, b.pos.z) + EYE_HEIGHT[b.stance];
  return losBetween(
    a.pos.x, a.pos.z, h0,
    b.pos.x, b.pos.z, h1,
    world.heightfield, world.meadow, world.canopy,
  );
}