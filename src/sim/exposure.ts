// Exposure — stance/posture -> hit probability. Drives the risk currency
// (design doc §2.1): the player spends his own or his men's exposure for
// information. Raising up to observe is not a free God-view — it is a
// decision with a visible tell and a real cost.

import type { StanceName, Vec2 } from './types';
import type { Meadow } from '../worldgen/meadow';
import type { DistField } from '../worldgen/distanceField';
import { clamp } from '../worldgen/noise';
import { STANCE_HIT_MULT, OBSERVATION_EXPOSURE_MULTIPLIER } from './config';

export interface ExposureProfile {
  /** Relative hit probability (0..1+). 1 = base exposure for a standing
      man in the open. */
  multiplier: number;
  /** Whether this exposed posture has a visible tell (the game never lies,
      it withholds — the observer can see you raising up). */
  hasTell: boolean;
}

/**
 * Compute the exposure profile for a soldier at a given position and
 * stance. Factors:
 * - Stance (prone < crouch < stand)
 * - Grass concealment (height at position vs soldier profile)
 * - Observing (explicit "look" action multiplies exposure)
 *
 * Returns a profile the ballistics system uses to compute hit probability.
 */
export function getExposureProfile(
  stance: StanceName,
  pos: Vec2,
  observing: boolean,
  meadow: Meadow,
): ExposureProfile {
  const stanceMult = STANCE_HIT_MULT[stance];

  // Grass concealment: a prone man in deep grass is very hard to hit.
  // A standing man in deep grass is still partially obscured.
  const concealment = meadow.concealmentAt(pos.x, pos.z);
  const grassEffect = 1 - concealment * grassReduction(stance);

  // Observing: the exposure tell.
  const obsMult = observing ? OBSERVATION_EXPOSURE_MULTIPLIER : 1.0;

  const multiplier = stanceMult * grassEffect * obsMult;

  return {
    multiplier: Math.max(0.05, multiplier), // floor so there's always a chance
    hasTell: observing,
  };
}

/**
 * Cover factor from the terrain distance field: how much the local ground
 * folds break up a target's silhouette. 1.0 = in the open, 0.35 = hugging
 * a strong ridge lip. A man right on the crest is silhouetted and pays for
 * it like a man in the open — the protection comes from being near a
 * feature, not on it.
 */
export function getCoverFactor(coverDF: DistField, x: number, z: number): number {
  const { d, t } = coverDF.query(x, z);
  const protection = t * Math.exp(-d / 10);
  return clamp(1 - protection, 0.35, 1);
}

/**
 * How much grass reduces hit probability, by stance.
 * Prone: grass breaks up the silhouette almost entirely.
 * Crouch: grass covers the lower body.
 * Stand: grass obscures legs but not upper body.
 */
function grassReduction(stance: StanceName): number {
  switch (stance) {
    case 'prone': return 0.85;
    case 'crouch': return 0.45;
    case 'stand': return 0.25;
  }
}