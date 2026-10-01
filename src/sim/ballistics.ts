// Ballistics — hit resolution against exposure, cover, and range. Drives
// the sim's fire model: each shot has a hit probability derived from the
// target's exposure profile, shooter dispersion, range, and cover. Misses
// produce near-miss rounds that contribute suppression.

import type { RngState } from './rng';
import { nextFloat } from './rng';
import type { ExposureProfile } from './exposure';
import { DISPERSION_100M, NEAR_MISS_RADIUS, SUPPRESSION_PER_ROUND } from './config';
import type { Wound } from './wounds';
import { createWound, rollWoundLocation, rollWoundSeverity } from './wounds';

export interface ShotResult {
  /** True if the round hit the target. */
  hit: boolean;
  /** Miss distance in metres (0 if hit). */
  missDistance: number;
  /** If hit, the wound inflicted. */
  wound: Wound | null;
  /** Suppression contributed to the target by this round. */
  suppressionAdded: number;
}

export interface ShotParams {
  /** Shooter's position. */
  sx: number; sz: number;
  /** Target's position. */
  tx: number; tz: number;
  /** Target's exposure profile (from exposure.ts). */
  targetProfile: ExposureProfile;
  /** Range in metres. */
  range: number;
  /** Cover modifier (0..1, 0 = full cover, 1 = no cover). From LOS
      concealment + terrain fold proximity. */
  coverFactor: number;
  /** Shooter's suppression (degrades aim). */
  shooterSuppression: number;
}

/**
 * Resolve a single shot. This is called per-round by the fire system;
 * for a burst of N rounds, call this N times with the same RNG advancing.
 */
export function resolveShot(
  rng: RngState,
  params: ShotParams,
  currentTick: number,
): ShotResult {
  // Base hit probability: a standing man at 100 m in the open.
  // Dispersion grows with range and shooter suppression.
  const dispersion = DISPERSION_100M * (params.range / 100)
    * (1 + params.shooterSuppression * 0.5);

  // Effective hit probability from the target's exposure profile.
  // The profile multiplier modifies the effective target size.
  const hitProb = params.targetProfile.multiplier * 0.7
    * params.coverFactor
    / (1 + (dispersion / 2) ** 2);

  // Roll for hit.
  const roll = nextFloat(rng);
  const hit = roll < hitProb;

  if (hit) {
    // Hit! Roll location and severity.
    const location = rollWoundLocation(rng);
    const severity = rollWoundSeverity(rng);
    const wound = createWound(severity, location, currentTick, rng);
    return {
      hit: true,
      missDistance: 0,
      wound,
      suppressionAdded: 0,
    };
  }

  // Miss: compute miss distance (Rayleigh-distributed).
  const missDist = dispersion * Math.sqrt(-2 * Math.log(1 - nextFloat(rng)));
  const suppressionAdded = missDist <= NEAR_MISS_RADIUS
    ? SUPPRESSION_PER_ROUND * (1 - missDist / NEAR_MISS_RADIUS)
    : 0;

  return {
    hit: false,
    missDistance: missDist,
    wound: null,
    suppressionAdded,
  };
}