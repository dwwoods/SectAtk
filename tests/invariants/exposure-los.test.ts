// Exposure and LOS unit tests — the risk currency (§2.1) and the 2.5D
// sightline model. Prone must be cheaper than crouch cheaper than stand;
// grass must protect; a terrain ridge must block LOS; and the cover
// distance field must reduce hit probability near a feature.

import { describe, expect, it } from 'vitest';
import { bakeWorld } from '../../src/worldgen';
import { getExposureProfile, getCoverFactor } from '../../src/sim/exposure';
import { losBetween } from '../../src/sim/los';
import type { Vec2 } from '../../src/sim/types';

const world = bakeWorld(20260728);

describe('exposure model', () => {
  const pos: Vec2 = { x: 0, z: 0 };

  it('prone is cheaper than crouch is cheaper than stand', () => {
    const prone = getExposureProfile('prone', pos, false, world.meadow).multiplier;
    const crouch = getExposureProfile('crouch', pos, false, world.meadow).multiplier;
    const stand = getExposureProfile('stand', pos, false, world.meadow).multiplier;
    expect(prone).toBeLessThan(crouch);
    expect(crouch).toBeLessThan(stand);
  });

  it('observing multiplies exposure', () => {
    const base = getExposureProfile('stand', pos, false, world.meadow).multiplier;
    const observing = getExposureProfile('stand', pos, true, world.meadow).multiplier;
    expect(observing).toBeGreaterThan(base);
    // And it has a visible tell.
    expect(getExposureProfile('stand', pos, true, world.meadow).hasTell).toBe(true);
  });

  it('a prone man in deep grass is very hard to hit', () => {
    // Find a spot with strong concealment.
    let bestPos: Vec2 = pos;
    let bestConceal = 0;
    for (let x = -200; x <= 200; x += 20) {
      for (let z = -200; z <= 200; z += 20) {
        const c = world.meadow.concealmentAt(x, z);
        if (c > bestConceal) { bestConceal = c; bestPos = { x, z }; }
      }
    }
    expect(bestConceal).toBeGreaterThan(0.5); // the world has thick grass somewhere
    const openProfile = getExposureProfile('prone', pos, false, world.meadow);
    const grassProfile = getExposureProfile('prone', bestPos, false, world.meadow);
    expect(grassProfile.multiplier).toBeLessThan(openProfile.multiplier);
  });
});

describe('cover distance field', () => {
  it('cover factor is 1 (open) far from any feature and lower near one', () => {
    let minD = Infinity;
    let bestX = 0, bestZ = 0;
    let maxD = -Infinity;
    let openX = 0, openZ = 0;
    for (let x = -200; x <= 200; x += 12) {
      for (let z = -200; z <= 200; z += 12) {
        const d = world.coverDF.query(x, z).d;
        if (d < minD) { minD = d; bestX = x; bestZ = z; }
        if (d > maxD) { maxD = d; openX = x; openZ = z; }
      }
    }
    const nearCover = getCoverFactor(world.coverDF, bestX, bestZ);
    const inOpen = getCoverFactor(world.coverDF, openX, openZ);
    // Near a feature: more protection (lower factor). In open: ~1.
    expect(nearCover).toBeLessThan(inOpen);
    expect(inOpen).toBeCloseTo(1, 1);
  });

  it('cover factor is bounded in [0.35, 1]', () => {
    for (let x = -200; x <= 200; x += 40) {
      for (let z = -200; z <= 200; z += 40) {
        const cf = getCoverFactor(world.coverDF, x, z);
        expect(cf).toBeGreaterThanOrEqual(0.35);
        expect(cf).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('2.5D LOS', () => {
  it('line of sight is clear over short distance at same height', () => {
    // Find a point where the terrain is roughly flat, and check LOS
    // between two nearby positions.
    let found = false;
    for (let x = -200; x <= 200 && !found; x += 20) {
      for (let z = -200; z <= 200 && !found; z += 20) {
        const h0 = world.heightfield.heightAt(x, z);
        const h1 = world.heightfield.heightAt(x + 10, z + 10);
        if (Math.abs(h0 - h1) < 0.5) {
          const result = losBetween(
            x, z, 1.6,
            x + 10, z + 10, 1.6,
            world.heightfield, world.meadow, world.canopy,
          );
          if (result.clear) {
            found = true;
            expect(result.distance).toBeCloseTo(Math.hypot(10, 10), 0);
          }
        }
      }
    }
    expect(found).toBe(true);
  });

  it('terrain rising above the ray blocks LOS', () => {
    // Find a pair of points where the terrain between them rises above
    // the straight-line ray. Sample broadly.
    let blocked = false;
    for (let x = -200; x <= 200 && !blocked; x += 8) {
      for (let z = -200; z <= 200 && !blocked; z += 8) {
        const a = { x: x - 30, z: z - 20 };
        const b = { x: x + 30, z: z + 20 };
        const hA = world.heightfield.heightAt(a.x, a.z);
        const hB = world.heightfield.heightAt(b.x, b.z);
        if (Math.abs(hA - hB) > 3) continue;
        const result = losBetween(
          a.x, a.z, 1.6,
          b.x, b.z, 1.6,
          world.heightfield, world.meadow, world.canopy,
        );
        if (!result.clear) {
          blocked = true;
        }
      }
    }
    expect(blocked).toBe(true);
  });

  it('LOS returns concealment from grass/canopy even when clear — at least one sample has grass', () => {
    // Sample a broad range of rays across the meadow. The meadow has
    // grass on most of the map, so at least one ray should pick up
    // concealment.
    let maxConcealment = 0;
    for (let x = -200; x <= 200; x += 20) {
      for (let z = -200; z <= 200; z += 20) {
        const result = losBetween(
          x, z, 1.6,
          x + 40, z + 30, 1.6,
          world.heightfield, world.meadow, world.canopy,
        );
        if (result.clear && result.concealment > maxConcealment) {
          maxConcealment = result.concealment;
        }
      }
    }
    expect(maxConcealment).toBeGreaterThan(0);
  });
});