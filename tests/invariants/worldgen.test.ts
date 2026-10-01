// Worldgen tests — the worldgen is the single source of truth for looks
// AND tactics. These tests verify determinism (same seed → same world),
// the heightfield's validity (no NaN, sane bounds, normals), the meadow
// concealment raster's correspondence to the heightfield, and the canopy
// raster's bounds. The renderer (Phase 2) will sample this same data —
// if the look and the tactics drift apart, one of these tests will be the
// first place it shows.

import { describe, expect, it } from 'vitest';
import { bakeWorld, type WorldGen } from '../../src/worldgen';
import { WORLD_SIZE } from '../../src/worldgen/config';

const SAMPLES = [
  [-250, -250], [-100, 50], [0, 0], [100, -80], [200, 150], [250, 250],
  [-300, 300], [300, -300], [50, 200], [-200, -100],
] as const;

function sampleWorld(world: WorldGen): void {
  for (const [x, z] of SAMPLES) {
    const h = world.heightfield.heightAt(x, z);
    expect(Number.isFinite(h)).toBe(true);
    const n = world.heightfield.normalAt(x, z);
    const len = Math.hypot(n.x, n.y, n.z);
    expect(Math.abs(len - 1)).toBeLessThan(0.01);
    const conceal = world.meadow.concealmentAt(x, z);
    expect(conceal).toBeGreaterThanOrEqual(0);
    expect(conceal).toBeLessThanOrEqual(1);
    const canopy = world.canopy.densityAt(x, z);
    expect(canopy).toBeGreaterThanOrEqual(0);
    expect(canopy).toBeLessThanOrEqual(1);
    const df = world.coverDF.query(x, z);
    expect(Number.isFinite(df.d)).toBe(true);
    expect(df.d).toBeGreaterThanOrEqual(0);
  }
}

describe('worldgen', () => {
  it('same seed → identical world (determinism)', () => {
    const a = bakeWorld(20260728);
    const b = bakeWorld(20260728);
    for (const [x, z] of SAMPLES) {
      expect(a.heightfield.heightAt(x, z)).toBe(b.heightfield.heightAt(x, z));
      expect(a.meadow.concealmentAt(x, z)).toBe(b.meadow.concealmentAt(x, z));
    }
  });

  it('different seed → different world', () => {
    const a = bakeWorld(20260728);
    const b = bakeWorld(1);
    let anyDifferent = false;
    for (const [x, z] of SAMPLES) {
      if (a.heightfield.heightAt(x, z) !== b.heightfield.heightAt(x, z)) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  it('all rasters are finite, in-range, and normals are unit length', () => {
    const world = bakeWorld(20260728);
    sampleWorld(world);
  });

  it('world bounds: heights at the far corners are sampled safely (no NaN)', () => {
    const world = bakeWorld(20260728);
    const half = WORLD_SIZE / 2;
    for (const [x, z] of [[-half, -half], [half, half], [-half, half], [half, -half]] as const) {
      expect(Number.isFinite(world.heightfield.heightAt(x, z))).toBe(true);
      expect(Number.isFinite(world.meadow.concealmentAt(x, z))).toBe(true);
    }
  });

  it('concealment raster correlates with slope (steeper → less grass)', () => {
    const world = bakeWorld(20260728);
    // Sample a coarse grid; on average, high-slope points should have lower
    // concealment than low-slope points.
    let steepSum = 0, steepCount = 0, flatSum = 0, flatCount = 0;
    for (let x = -280; x <= 280; x += 20) {
      for (let z = -280; z <= 280; z += 20) {
        const n = world.heightfield.normalAt(x, z, 8);
        const slope = 1 - n.y;
        const c = world.meadow.concealmentAt(x, z);
        if (slope > 0.3) { steepSum += c; steepCount++; }
        else if (slope < 0.1) { flatSum += c; flatCount++; }
      }
    }
    const steepAvg = steepSum / Math.max(1, steepCount);
    const flatAvg = flatSum / Math.max(1, flatCount);
    expect(flatAvg).toBeGreaterThan(steepAvg);
  });

  it('heightfield has meaningful relief (not flat, not absurd)', () => {
    const world = bakeWorld(20260728);
    const hf = world.heightfield;
    const relief = hf.maxHeight() - hf.minHeight();
    // Rolling hills, not a cliff face.
    expect(relief).toBeGreaterThan(10);
    expect(relief).toBeLessThan(200);
  });

  it('distance field: at least one cover feature found, field is finite', () => {
    const world = bakeWorld(20260728);
    const { coverDF } = world;
    // Query at several points — the DF must be finite everywhere.
    let foundSmall = false;
    for (let x = -200; x <= 200; x += 20) {
      for (let z = -200; z <= 200; z += 20) {
        const { d } = coverDF.query(x, z);
        expect(Number.isFinite(d)).toBe(true);
        if (d < 10) foundSmall = true;
      }
    }
    // There should be at least one point near a cover feature.
    expect(foundSmall).toBe(true);
  });
});