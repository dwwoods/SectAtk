// Distance field — a Jump Flood approximation ported from the reference's
// `makeDF`. Used for cover proximity; later, also for pathfinding nodes
// and smoke/wind interaction.
//
// The reference builds a DF over path points; here we build it over a
// generic set of points (cover features, later enemy positions, etc.) and
// expose a query function.

import { clamp, lerp } from './noise';
import { DF_RES, WORLD_SIZE, HALF } from './config';

export interface DistField {
  /** Distance to nearest feature in metres, plus interpolated parameter `t`. */
  query(x: number, z: number): { d: number; t: number };
}

/**
 * Build a distance field from a set of seed points. Each point has a
 * position (x,z) and a scalar parameter `t` (0..1, e.g. the "type" or
 * "strength" of the nearest feature). The field is bilinearly interpolated.
 */
export function makeDF(
  points: ReadonlyArray<{ x: number; z: number; t: number }>,
  res = DF_RES,
): DistField {
  const cell = WORLD_SIZE / res;
  const dist = new Float32Array(res * res).fill(1e9);
  const par = new Float32Array(res * res);
  const sx = new Int16Array(res * res).fill(-9999);
  const sy = new Int16Array(res * res).fill(-9999);

  for (const p of points) {
    const gx = Math.round((p.x + HALF) / cell);
    const gy = Math.round((p.z + HALF) / cell);
    if (gx < 0 || gy < 0 || gx >= res || gy >= res) continue;
    const i = gy * res + gx;
    if (dist[i]! > 0) {
      dist[i] = 0;
      sx[i] = gx;
      sy[i] = gy;
      par[i] = p.t;
    }
  }

  const relax = (i: number, j: number) => {
    if (sx[j]! === -9999) return;
    const gx = i % res;
    const gy = (i / res) | 0;
    const dx = sx[j]! - gx;
    const dy = sy[j]! - gy;
    const d = dx * dx + dy * dy;
    if (d < dist[i]!) {
      dist[i] = d;
      sx[i] = sx[j]!;
      sy[i] = sy[j]!;
      par[i] = par[j]!;
    }
  };

  // Two-pass jump flood: propagate from top-left, then bottom-right.
  for (let it = 0; it < 2; it++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x;
        if (x > 0) relax(i, i - 1);
        if (y > 0) relax(i, i - res);
        if (x > 0 && y > 0) relax(i, i - res - 1);
        if (x < res - 1 && y > 0) relax(i, i - res + 1);
      }
    }
    for (let y = res - 1; y >= 0; y--) {
      for (let x = res - 1; x >= 0; x--) {
        const i = y * res + x;
        if (x < res - 1) relax(i, i + 1);
        if (y < res - 1) relax(i, i + res);
        if (x < res - 1 && y < res - 1) relax(i, i + res + 1);
        if (x > 0 && y < res - 1) relax(i, i + res - 1);
      }
    }
  }

  for (let i = 0; i < res * res; i++) {
    dist[i] = Math.sqrt(dist[i]!) * cell;
  }

  return {
    query(x, z) {
      const fx = clamp((x + HALF) / cell, 0, res - 1.001);
      const fy = clamp((z + HALF) / cell, 0, res - 1.001);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const i = y0 * res + x0;
      return {
        d: lerp(lerp(dist[i]!, dist[i + 1]!, tx), lerp(dist[i + res]!, dist[i + res + 1]!, tx), ty),
        t: lerp(lerp(par[i]!, par[i + 1]!, tx), lerp(par[i + res]!, par[i + res + 1]!, tx), ty),
      };
    },
  };
}