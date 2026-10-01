// Wound model — severity + location -> can he shout, sound off, fight, move.
// This is the mechanic that drives information asymmetry (design doc §3.2):
// the worst casualties are the quietest. A man shot through the throat drops
// without a sound; a man shot through the thigh screams the place down.

import { MINOR_WOUND_CRY_CHANCE, MORTAL_CRY_DURATION, MINOR_CRY_DURATION } from './config';
import type { RngState } from './rng';
import { nextFloat } from './rng';

export type WoundSeverity =
  | 'fatal-cns'  // Killed outright (CNS strike). Silent.
  | 'mortal'     // Mortally wounded, will die. Cries then stops.
  | 'serious'    // Seriously wounded. Screams, can't fight or move.
  | 'minor';     // Wounded, degraded in all functions.

export type WoundLocation =
  | 'throat'
  | 'head'
  | 'chest'
  | 'abdomen'
  | 'thigh'
  | 'leg'
  | 'arm';

export interface Wound {
  severity: WoundSeverity;
  location: WoundLocation;
  /** The tick at which this wound was inflicted. */
  atTick: number;
  /** If the soldier cries out, the tick at which they stop (null = doesn't cry). */
  cryUntil: number | null;
}

// ── gating table (design doc §3.2) ─────────────────────────────────────────

/**
 * Can the soldier shout (cry out) after this wound?
 * Note: "may call out" for minor wounds is probabilistic.
 */
export function canShout(wound: Wound, rng: RngState): boolean {
  if (wound.severity === 'fatal-cns') return false;
  if (wound.location === 'throat') return false;
  if (wound.severity === 'mortal') return true; // cries briefly
  if (wound.severity === 'serious') return true; // screams
  if (wound.severity === 'minor') return nextFloat(rng) < MINOR_WOUND_CRY_CHANCE;
  return false;
}

/**
 * Can the soldier answer a "sound off" call?
 * Three-valued: effective / hit / no answer. This determines what the
 * commander hears (or doesn't).
 */
export function canSoundOff(wound: Wound): boolean {
  if (wound.severity === 'fatal-cns') return false;
  if (wound.severity === 'mortal') return true; // one answer, then silence
  return true; // serious and minor can answer "hit"
}

/**
 * Did a mortal-wound soldier go silent (cry period expired)?
 * Returns true if the mortal's cryUntil has passed.
 */
export function mortalHasGoneSilent(wound: Wound, currentTick: number): boolean {
  if (wound.severity !== 'mortal') return false;
  if (wound.cryUntil === null) return false;
  return currentTick >= wound.cryUntil;
}

/**
 * Can the soldier fight after this wound?
 */
export function canFightFromWound(wound: Wound): boolean {
  // Only minor wounds leave a man able to fight (degraded). Fatal, mortal,
  // and serious wounds take him out of the fight.
  return wound.severity === 'minor';
}

/**
 * Can the soldier move after this wound?
 */
export function canMoveFromWound(wound: Wound): boolean {
  // Only minor wounds allow movement (degraded).
  return wound.severity === 'minor';
}

/**
 * Create a wound. `cryUntil` is set based on the gating table.
 */
export function createWound(
  severity: WoundSeverity,
  location: WoundLocation,
  currentTick: number,
  rng: RngState,
): Wound {
  let cryUntil: number | null = null;

  if (severity === 'mortal') {
    // Mortal: cries briefly then stops.
    if (location !== 'throat') {
      cryUntil = currentTick + MORTAL_CRY_DURATION * 60; // in ticks
    }
  } else if (severity === 'serious') {
    // Serious: screams continuously.
    if (location !== 'throat') {
      cryUntil = Infinity; // screams until silenced
    }
  } else if (severity === 'minor') {
    // Minor: may call out.
    if (location !== 'throat' && nextFloat(rng) < MINOR_WOUND_CRY_CHANCE) {
      cryUntil = currentTick + MINOR_CRY_DURATION * 60;
    }
  }
  // fatal-cns: never cries.

  return { severity, location, atTick: currentTick, cryUntil };
}

/**
 * Roll a wound location from a hit. The distribution is roughly body-mass
 * proportional, with the throat being the rare but critical case.
 */
export function rollWoundLocation(rng: RngState): WoundLocation {
  const roll = nextFloat(rng);
  if (roll < 0.02) return 'throat'; // 2%
  if (roll < 0.10) return 'head'; // 8%
  if (roll < 0.35) return 'chest'; // 25%
  if (roll < 0.55) return 'abdomen'; // 20%
  if (roll < 0.70) return 'thigh'; // 15%
  if (roll < 0.85) return 'leg'; // 15%
  return 'arm'; // 15%
}

/**
 * Roll wound severity from a hit. Skewed: most hits are minor or serious;
 * fatal CNS is rare (~5%).
 */
export function rollWoundSeverity(rng: RngState): WoundSeverity {
  const roll = nextFloat(rng);
  if (roll < 0.05) return 'fatal-cns';
  if (roll < 0.15) return 'mortal';
  if (roll < 0.50) return 'serious';
  return 'minor';
}