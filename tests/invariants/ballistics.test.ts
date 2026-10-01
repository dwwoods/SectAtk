// Ballistics unit tests — hit probability from exposure, near-miss
// suppression, wound creation on hit. Deterministic given the seeded RNG.

import { describe, expect, it } from 'vitest';
import { createRng } from '../../src/sim/rng';
import { resolveShot, type ShotParams } from '../../src/sim/ballistics';
import { SUPPRESSION_PER_ROUND, NEAR_MISS_RADIUS } from '../../src/sim/config';

const tick = 100;

function makeParams(overrides: Partial<ShotParams> = {}): ShotParams {
  return {
    sx: 0, sz: 0,
    tx: 100, tz: 0,
    targetProfile: { multiplier: 1.0, hasTell: false },
    range: 100,
    coverFactor: 1.0,
    shooterSuppression: 0,
    ...overrides,
  };
}

describe('ballistics', () => {
  it('a standing man in the open at 100m is hit more often than a prone man', () => {
    const rngOpen = createRng(0xaaa);
    const rngProne = createRng(0xbbb);
    const openParams = makeParams({ targetProfile: { multiplier: 1.0, hasTell: false } });
    const proneParams = makeParams({ targetProfile: { multiplier: 0.25, hasTell: false } });

    let openHits = 0, proneHits = 0;
    for (let i = 0; i < 500; i++) {
      if (resolveShot(rngOpen, openParams, tick).hit) openHits++;
      if (resolveShot(rngProne, proneParams, tick).hit) proneHits++;
    }
    expect(openHits).toBeGreaterThan(proneHits * 2);
  });

  it('near misses (within NEAR_MISS_RADIUS) add suppression; distant misses add none', () => {
    const rng = createRng(0xccc);
    const params = makeParams();
    let totalSuppression = 0;
    let nearMisses = 0;

    for (let i = 0; i < 1000; i++) {
      const result = resolveShot(rng, params, tick);
      if (!result.hit) {
        if (result.missDistance <= NEAR_MISS_RADIUS) {
          nearMisses++;
          expect(result.suppressionAdded).toBeGreaterThan(0);
        } else {
          expect(result.suppressionAdded).toBe(0);
        }
      }
      totalSuppression += result.suppressionAdded;
    }

    // With a 100m target and base hit prob, some shots miss close.
    expect(nearMisses).toBeGreaterThan(0);
    expect(totalSuppression).toBeGreaterThan(0);
  });

  it('per-round suppression is bounded by SUPPRESSION_PER_ROUND', () => {
    const rng = createRng(0xddd);
    const params = makeParams({ targetProfile: { multiplier: 0.05, hasTell: false } });
    for (let i = 0; i < 2000; i++) {
      const result = resolveShot(rng, params, tick);
      expect(result.suppressionAdded).toBeLessThanOrEqual(SUPPRESSION_PER_ROUND);
    }
  });

  it('hits create wounds; the wound is non-null and has severity/location', () => {
    const rng = createRng(0xeee);
    const params = makeParams({ targetProfile: { multiplier: 1.0, hasTell: false }, range: 20 });
    let hits = 0;
    for (let i = 0; i < 500; i++) {
      const result = resolveShot(rng, params, tick);
      if (result.hit) {
        hits++;
        expect(result.wound).not.toBeNull();
        expect(result.wound!.severity.length).toBeGreaterThan(0);
        expect(result.wound!.location.length).toBeGreaterThan(0);
        expect(result.wound!.atTick).toBe(tick);
      }
    }
    expect(hits).toBeGreaterThan(0);
  });

  it('hit probability is deterministic for a fixed seed', () => {
    const rng1 = createRng(0x1234);
    const rng2 = createRng(0x1234);
    const p1 = makeParams();
    const p2 = makeParams();
    for (let i = 0; i < 100; i++) {
      const a = resolveShot(rng1, p1, tick);
      const b = resolveShot(rng2, p2, tick);
      expect(a.hit).toBe(b.hit);
      expect(a.missDistance).toBe(b.missDistance);
    }
  });
});