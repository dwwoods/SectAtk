// Individual fire & movement (design doc §8, Phase 7). A man ordered to
// move does it in BOUNDS: up, a short rush toward the target, back down
// prone, pause while others go. Two doctrinal conditions gate every
// bound, and both are invariants property-tested every tick
// (tests/invariants/movement.test.ts):
//
//   "One foot on the ground" — at no tick may more than
//   MAX_SIMULTANEOUS_MOVERS men be bounding.
//
//   "No move without fire" — nobody bounds unless at least
//   COVERING_FIRE_MIN non-moving men are currently able to fire.
//
// A bounding man is stood up (exposure pays for speed), does not fire,
// and goes prone the moment his bound ends. A pinned man does not get
// up. A casualty who cannot move lies where he fell (§5).

import type { Soldier } from '../soldier';
import { isAlive, canMove, effectiveRof } from '../soldier';
import {
  MAX_SIMULTANEOUS_MOVERS,
  COVERING_FIRE_MIN,
  PINNED_SUPPRESSION,
  MOVE_SPEED,
  BOUND_LENGTH,
  BOUND_PAUSE,
} from '../config';

const ARRIVE_RADIUS = 1.0;

/** One tick of individual fire & movement for the section. */
export function processMovement(friendlies: Soldier[], dt: number): void {
  // Advance men already mid-bound.
  for (const f of friendlies) {
    if (f.boundCooldown > 0) f.boundCooldown = Math.max(0, f.boundCooldown - dt);
    if (!f.bounding) continue;
    if (!isAlive(f) || !canMove(f) || !f.moveTarget) {
      endBound(f);
      continue;
    }
    const dx = f.moveTarget.x - f.pos.x;
    const dz = f.moveTarget.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= ARRIVE_RADIUS) {
      f.moveTarget = null;
      endBound(f);
      continue;
    }
    const step = Math.min(MOVE_SPEED[f.stance] * dt, f.boundRemaining, dist);
    f.pos.x += (dx / dist) * step;
    f.pos.z += (dz / dist) * step;
    f.heading = Math.atan2(dz, dx);
    f.boundRemaining -= step;
    if (f.boundRemaining <= 0) {
      endBound(f);
      if (Math.hypot(f.moveTarget.x - f.pos.x, f.moveTarget.z - f.pos.z) <= ARRIVE_RADIUS) {
        f.moveTarget = null;
      }
    }
  }

  // Count movers and covering fire AFTER advancing: the conditions gate
  // STARTING a bound, not finishing one.
  let movers = 0;
  let covering = 0;
  for (const f of friendlies) {
    if (!isAlive(f)) continue;
    if (f.bounding) movers++;
    else if (effectiveRof(f) > 0) covering++;
  }

  // Start new bounds, deterministic order (array order = section order).
  for (const f of friendlies) {
    if (movers >= MAX_SIMULTANEOUS_MOVERS) break;
    if (covering < COVERING_FIRE_MIN) break; // no move without fire
    if (f.bounding || !f.moveTarget) continue;
    if (!isAlive(f) || !canMove(f)) continue;
    if (f.boundCooldown > 0) continue;
    if (f.suppression >= PINNED_SUPPRESSION) continue; // pinned
    if (f.reloadT > 0 || f.reBombing) continue; // finish the drill first

    // A man who steps off stops covering — count him out BEFORE the
    // bounding flag zeroes his ROF.
    const wasCovering = effectiveRof(f) > 0;
    f.bounding = true;
    f.stance = 'stand';
    f.boundRemaining = BOUND_LENGTH;
    movers++;
    if (wasCovering) covering--;
  }
}

function endBound(f: Soldier): void {
  f.bounding = false;
  f.boundRemaining = 0;
  f.stance = 'prone';
  f.boundCooldown = BOUND_PAUSE;
}
