// Suppression model tests — the shape of the suppression→ROF curve is a
// tuning handle (design doc §9.3: "Define win the firefight numerically").
// The curve must be monotonic, must reach ~1 at 0 suppression and ~0 at
// high suppression, and the decay must drain suppression when fire stops.

import { describe, expect, it } from 'vitest';
import {
  createSuppression,
  addSuppression,
  decaySuppression,
  suppressionRofMult,
  suppressionCurveSamples,
  isPinned,
} from '../../src/sim/suppression';

describe('suppression model', () => {
  it('starts at 0', () => {
    expect(createSuppression().level).toBe(0);
  });

  it('adds suppression up to a cap of 1', () => {
    const s = createSuppression();
    addSuppression(s, 0.3);
    addSuppression(s, 0.3);
    addSuppression(s, 0.3);
    addSuppression(s, 0.3);
    expect(s.level).toBe(1);
  });

  it('decays over time', () => {
    const s = createSuppression();
    addSuppression(s, 0.6);
    decaySuppression(s, 1);
    expect(s.level).toBeLessThan(0.6);
    // Never below zero.
    decaySuppression(s, 1000);
    expect(s.level).toBe(0);
  });

  it('ROF multiplier curve is monotonic non-increasing in suppression', () => {
    const samples = suppressionCurveSamples(50);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.rofMult).toBeLessThanOrEqual(samples[i - 1]!.rofMult);
    }
  });

  it('ROF multiplier at zero suppression is close to 1 (asymptotic)', () => {
    expect(suppressionRofMult(0)).toBeCloseTo(1, 1);
  });

  it('ROF multiplier at max suppression is very low', () => {
    expect(suppressionRofMult(1)).toBeLessThan(0.05);
  });

  it('half suppression gives half rate (the logistic midpoint)', () => {
    expect(suppressionRofMult(0.5)).toBeCloseTo(0.5, 1);
  });

  it('pinned threshold: beyond max level the man cannot fire', () => {
    expect(isPinned(0.8)).toBe(false);
    expect(isPinned(0.86)).toBe(true);
  });

  it('the plotted curve covers the full range and stays in [0,1]', () => {
    const samples = suppressionCurveSamples();
    expect(samples[0]!.suppression).toBe(0);
    expect(samples[samples.length - 1]!.suppression).toBe(1);
    for (const s of samples) {
      expect(s.rofMult).toBeGreaterThanOrEqual(0);
      expect(s.rofMult).toBeLessThanOrEqual(1);
    }
  });
});