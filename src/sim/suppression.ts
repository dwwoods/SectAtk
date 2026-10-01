// Suppression — accumulates from near-miss rounds, decays over time, and
// degrades a soldier's effective rate of fire. This is how the firefight
// is "won" numerically (design doc §9.3): suppression accumulates on the
// enemy, their ROF degrades, and when it holds below a threshold for a
// sustained period, the firefight is over. The PLAYER can never read this
// cleanly — it's sim truth, fed to the AAR.

import {
  SUPPRESSION_DECAY,
  SUPPRESSION_HALF_LEVEL,
  SUPPRESSION_MAX_LEVEL,
} from './config';

export interface SuppressionState {
  /** 0..1 accumulated suppression. */
  level: number;
  /** Rolling sum of suppression added in the last window (unused for
      gameplay, kept for the tuning curve plots). */
  recentAdded: number;
  /** Frames since last near-miss (for decay-rate diagnostics). */
  framesSinceLastHit: number;
}

export function createSuppression(): SuppressionState {
  return { level: 0, recentAdded: 0, framesSinceLastHit: 0 };
}

/** Add suppression from a near-miss round. */
export function addSuppression(
  state: SuppressionState,
  amount: number,
): void {
  state.level = Math.min(1, state.level + amount);
  state.recentAdded += amount;
  state.framesSinceLastHit = 0;
}

/** Decay suppression toward zero. Called every tick. */
export function decaySuppression(state: SuppressionState, dt: number): void {
  // Suppression decays slowly once incoming fire stops — a man stays
  // suppressed for a while even when the shooting stops.
  state.level = Math.max(0, state.level - SUPPRESSION_DECAY * dt);
  state.framesSinceLastHit += 1;
}

/** ROF multiplier from suppression level. Logistic: gentle then sharp. */
export function suppressionRofMult(level: number): number {
  return 1 / (1 + Math.exp(8 * (level - SUPPRESSION_HALF_LEVEL)));
}

/**
 * The suppression→ROF curve, sampled for plotting (design doc §4 gate:
 * "suppression and ROF curves plotted"). Also asserted in tests for
 * monotonicity and endpoints.
 */
export function suppressionCurveSamples(
  samples = 40,
): Array<{ suppression: number; rofMult: number }> {
  const out: Array<{ suppression: number; rofMult: number }> = [];
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    out.push({ suppression: s, rofMult: suppressionRofMult(s) });
  }
  return out;
}

/** Is this soldier pinned (cannot fire)? */
export function isPinned(level: number): boolean {
  return level >= SUPPRESSION_MAX_LEVEL;
}