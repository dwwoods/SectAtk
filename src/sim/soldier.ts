// Soldier model — stance, weapon, suppression, morale, and role.
// This is the entity the sim steps every tick. Each soldier belongs to a
// side: `friendly` (the player's section of 8) or `enemy` (static position).

import type { StanceName, Vec2 } from './types';
import type { AmmoState } from './ammunition';
import type { Wound } from './wounds';
import type { FireIntent } from './config';
import { INTENT_ROF, MORALE_CASUALTY_PENALTY, MORALE_RECOVERY } from './config';

export type SoldierSide = 'friendly' | 'enemy';
export type SoldierRole = 'commander' | 'twoIC' | 'rifleman';

export interface Soldier {
  id: string;
  side: SoldierSide;
  role: SoldierRole;
  name: string;

  pos: Vec2;
  heading: number; // radians
  stance: StanceName;

  // Ammunition (both sides use the same model).
  ammo: AmmoState;

  // Suppression & morale.
  suppression: number; // 0..1
  morale: number; // 0..1

  // Wound, or null if unhurt.
  wound: Wound | null;

  // Fire control.
  fireIntent: FireIntent;
  /** Seconds remaining before the current reload/re-bomb completes.
      0 = not reloading. */
  reloadT: number;
  /** True when re-bombing (bandolier → magazine). */
  reBombing: boolean;

  /** Rounds fired this tick (set by ballistics, read by ammo). */
  roundsFiredThisTick: number;

  // Movement (individual fire & movement, Phase 7).
  /** Where this man has been ordered to go, or null. */
  moveTarget: Vec2 | null;
  /** True while mid-bound (up and running — not firing, exposed). */
  bounding: boolean;
  /** Metres left in the current bound before going back down. */
  boundRemaining: number;
  /** Seconds before this man may start his next bound. */
  boundCooldown: number;
}

export function isAlive(s: Soldier): boolean {
  if (!s.wound) return true;
  return s.wound.severity !== 'fatal-cns' && s.wound.severity !== 'mortal';
}

/** Update morale: decays toward 0.5 slowly (ongoing stress), recovers
    toward 1.0 when out of contact. The effect on gameplay is that
    suppression decay is slower when morale is low, making the section
    harder to shake off suppression after a casualty. */
export function updateMorale(s: Soldier, nearbyCasualty: boolean, dt: number): void {
  if (nearbyCasualty) {
    s.morale = Math.max(0, s.morale - MORALE_CASUALTY_PENALTY);
  }
  // Drift toward 0.5 (baseline stress) while in contact, recover toward
  // 1.0 when out of contact (suppression < 0.1).
  if (s.suppression < 0.1) {
    s.morale = Math.min(1, s.morale + MORALE_RECOVERY * dt);
  } else {
    s.morale = Math.max(0.3, s.morale - MORALE_RECOVERY * 0.3 * dt);
  }
}

/** Can this soldier fight? Wounds may degrade or prevent it. */
export function canFight(s: Soldier): boolean {
  if (!s.wound) return true;
  if (s.wound.severity === 'fatal-cns' || s.wound.severity === 'mortal' || s.wound.severity === 'serious') {
    return false;
  }
  // Minor wound: degraded but can fight.
  return true;
}

/** Can this soldier move? A man who can neither fight nor move lies
    where he fell (design doc §5). */
export function canMove(s: Soldier): boolean {
  if (!s.wound) return true;
  if (s.wound.severity === 'fatal-cns' || s.wound.severity === 'mortal' || s.wound.severity === 'serious') {
    return false;
  }
  return true;
}

/** Effective rate of fire for a soldier, accounting for suppression and
    wound state. Returns rounds-per-second this tick. */
export function effectiveRof(s: Soldier): number {
  if (!canFight(s)) return 0;
  if (s.bounding) return 0; // up and running — not firing
  if (s.suppression >= 0.85) return 0; // pinned
  if (s.reloadT > 0 || s.reBombing) return 0; // not firing
  if (s.ammo.currentMag === 0) return 0; // empty

  const baseRof = INTENT_ROF[s.fireIntent];

  // Suppression multiplier: a logistic-like curve, so ROF degrades gently
  // at first, then sharply near SUPPRESSION_HALF_LEVEL.
  const supMult = 1 / (1 + Math.exp(8 * (s.suppression - 0.5)));
  // Minor wound: halved rate.
  const woundMult = s.wound?.severity === 'minor' ? 0.5 : 1;

  return baseRof * supMult * woundMult;
}

/** Create a friendly rifleman with standard ammunition. */
export function createRifleman(
  id: string,
  role: SoldierRole,
  name: string,
  pos: Vec2,
  heading: number,
  ammo: AmmoState,
): Soldier {
  return {
    id,
    side: 'friendly',
    role,
    name,
    pos,
    heading,
    stance: 'prone',
    ammo,
    suppression: 0,
    morale: 1.0,
    wound: null,
    fireIntent: 'hold',
    reloadT: 0,
    reBombing: false,
    roundsFiredThisTick: 0,
    moveTarget: null,
    bounding: false,
    boundRemaining: 0,
    boundCooldown: 0,
  };
}

/** Create an enemy rifleman. */
export function createEnemy(
  id: string,
  pos: Vec2,
  heading: number,
  ammo: AmmoState,
): Soldier {
  return {
    id,
    side: 'enemy',
    role: 'rifleman',
    name: `Enemy ${id}`,
    pos,
    heading,
    stance: 'prone',
    ammo,
    suppression: 0,
    morale: 1.0,
    wound: null,
    fireIntent: 'hold',
    reloadT: 0,
    reBombing: false,
    roundsFiredThisTick: 0,
    moveTarget: null,
    bounding: false,
    boundRemaining: 0,
    boundCooldown: 0,
  };
}