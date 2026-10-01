// Adaptive quality controller — the continuous downgrade loop from the
// Phase 0 profiling notes. Pure logic, no THREE: sustained over-budget
// cost steps the level down, sustained headroom steps it back up, spikes
// and the hysteresis band do nothing, and a cooldown separates changes.

import { describe, expect, it } from 'vitest';
import {
  createAdaptiveState,
  stepAdaptive,
  MAX_QUALITY_LEVEL,
  FRAME_BUDGET_MS,
} from '../../src/render/adaptiveQuality';

/** Feed `ms` of simulated time at a constant per-frame cost; returns the
    level changes the controller emitted. */
function run(s: ReturnType<typeof createAdaptiveState>, frameCost: number, ms: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < ms; t += frameCost) {
    const c = stepAdaptive(s, frameCost);
    if (c !== null) changes.push(c);
  }
  return changes;
}

describe('adaptive quality controller', () => {
  it('starts at full quality', () => {
    expect(createAdaptiveState().level).toBe(MAX_QUALITY_LEVEL);
  });

  it('downgrades after sustained over-budget frames', () => {
    const s = createAdaptiveState();
    const changes = run(s, FRAME_BUDGET_MS * 2, 2000);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]).toBe(MAX_QUALITY_LEVEL - 1);
    expect(s.level).toBeLessThan(MAX_QUALITY_LEVEL);
  });

  it('does not downgrade on a brief spike', () => {
    const s = createAdaptiveState();
    // 10s comfortable, one 200ms spike frame, 1s comfortable.
    run(s, 10, 10000);
    stepAdaptive(s, 200);
    run(s, 10, 1000);
    expect(s.level).toBe(MAX_QUALITY_LEVEL);
  });

  it('holds steady inside the hysteresis band (near but under budget)', () => {
    const s = createAdaptiveState();
    const changes = run(s, FRAME_BUDGET_MS * 0.9, 30000);
    expect(changes).toEqual([]);
    expect(s.level).toBe(MAX_QUALITY_LEVEL);
  });

  it('upgrades after sustained headroom, and clamps at MAX', () => {
    const s = createAdaptiveState();
    s.level = 0;
    const changes = run(s, 5, 60000);
    expect(changes.length).toBe(MAX_QUALITY_LEVEL);
    expect(changes[changes.length - 1]).toBe(MAX_QUALITY_LEVEL);
    expect(s.level).toBe(MAX_QUALITY_LEVEL);
    // Further headroom does nothing at MAX.
    expect(run(s, 5, 20000)).toEqual([]);
  });

  it('clamps at level 0 under hopeless load', () => {
    const s = createAdaptiveState();
    run(s, FRAME_BUDGET_MS * 4, 60000);
    expect(s.level).toBe(0);
    expect(run(s, FRAME_BUDGET_MS * 4, 10000)).toEqual([]);
  });

  it('separates consecutive changes by the cooldown', () => {
    const s = createAdaptiveState();
    const cost = FRAME_BUDGET_MS * 2;
    const times: number[] = [];
    let t = 0;
    for (; t < 60000 && s.level > 0; t += cost) {
      if (stepAdaptive(s, cost) !== null) times.push(t);
    }
    expect(times.length).toBe(MAX_QUALITY_LEVEL);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(2000);
    }
  });
});
