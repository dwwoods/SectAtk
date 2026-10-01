// Ammunition model — used by BOTH sides (design doc §2.4). Magazines,
// bandolier, expenditure, and re-bombing. The key invariant: for any
// soldier at any tick, rounds issued = rounds in mags + rounds in bandolier
// + rounds fired + rounds stranded (dead men's ammo). This is asserted in
// tests/invariants/ammunition-conservation.test.ts.

import { MAGS_PER_MAN, MAG_ROUNDS, BANDOLIER_ROUNDS, REBOMB_DURATION, RELOAD_DURATION } from './config';
import type { Soldier } from './soldier';

export interface AmmoState {
  /** Rounds remaining in the magazine currently in the weapon. */
  currentMag: number;
  /** Number of full magazines in reserve. Max MAGS_PER_MAN. */
  spareMags: number;
  /** Loose rounds carried for refilling magazines. */
  bandolier: number;
  /** Total rounds ever issued to this soldier (for conservation tests). */
  issued: number;
}

export function createAmmo(
  mags = MAGS_PER_MAN,
  bandolier = BANDOLIER_ROUNDS,
): AmmoState {
  return {
    currentMag: MAG_ROUNDS,
    spareMags: mags - 1,
    bandolier,
    issued: mags * MAG_ROUNDS + bandolier,
  };
}

/** Expended rounds for a burst. Returns rounds actually fired (may be less
    than requested if the current mag runs out). */
export function expend(
  state: AmmoState,
  roundsRequested: number,
): number {
  const canFire = Math.min(roundsRequested, state.currentMag);
  state.currentMag -= canFire;
  return canFire;
}

/** Called after every tick. Handles magazine swaps and re-bombing timers.
    Returns a list of events (empty array = nothing happened). */
export function processAmmoTick(
  soldier: Soldier,
  dt: number,
): AmmoEvent[] {
  const events: AmmoEvent[] = [];
  const ammo = soldier.ammo;

  // Handle reload/re-bomb timer.
  if (soldier.reloadT > 0) {
    soldier.reloadT -= dt;
    if (soldier.reloadT <= 0) {
      soldier.reloadT = 0;
      if (soldier.reBombing) {
        // Re-bomb complete: one magazine refilled from bandolier.
        const refill = Math.min(MAG_ROUNDS, ammo.bandolier);
        ammo.bandolier -= refill;
        ammo.spareMags += 1;
        soldier.reBombing = false;
        events.push({ type: 're-bomb-complete' });
      } else {
        // Reload complete: swapped a spare mag.
        if (ammo.spareMags > 0) {
          ammo.currentMag = MAG_ROUNDS;
          ammo.spareMags -= 1;
          events.push({ type: 'reload-complete' });
        } else if (ammo.bandolier > 0) {
          // No spare mags but has bandolier — start re-bombing.
          startRebomb(soldier);
        }
      }
    }
    return events;
  }

  // Mag empty?
  if (ammo.currentMag === 0) {
    if (ammo.spareMags > 0) {
      // Swap to a fresh mag.
      soldier.reloadT = RELOAD_DURATION;
      soldier.reBombing = false;
      events.push({ type: 'reload-start' });
    } else if (ammo.bandolier > 0) {
      // No spares — must re-bomb before continuing.
      startRebomb(soldier);
      events.push({ type: 're-bomb-start' });
    }
    // else: completely dry.
  }

  return events;
}

/** Put a soldier into the re-bombing state (bandolier → magazine, takes
    REBOMB_DURATION, not firing throughout). Called when a mag runs dry
    with no spares, and by the 2IC's proactive rotation (fireControl). */
export function startRebomb(soldier: Soldier): void {
  soldier.reloadT = REBOMB_DURATION;
  soldier.reBombing = true;
}

export type AmmoEvent =
  | { type: 'reload-start' }
  | { type: 'reload-complete' }
  | { type: 're-bomb-start' }
  | { type: 're-bomb-complete' };