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
import type { Vec2 } from '../types';
import {
  MAX_SIMULTANEOUS_MOVERS,
  COVERING_FIRE_MIN,
  PINNED_SUPPRESSION,
  MOVE_SPEED,
  BOUND_LENGTH,
  BOUND_PAUSE,
  CONTACT_DASH_DIST,
  CONTACT_CRAWL_DIST,
  CRAWL_SPEED,
  CONTACT_REACT_COOLDOWN,
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
    if (f.contactPhase) continue; // reacting to contact takes priority
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
// ── contact reaction — Battle Drill 2, dash-down-crawl ──────────────────────
// Dash – Down – Crawl – Observe – Sights – Fire. Triggered off a near-miss
// or a nearby casualty (simulation.ts hooks this off the ballistics near-
// miss/wound results). Involuntary: everyone reacts, so it is NOT gated by
// MAX_SIMULTANEOUS_MOVERS / COVERING_FIRE_MIN like an ordered bound — but it
// is short (one dash + one crawl) and cannot fire while it's happening
// (effectiveRof() in soldier.ts gates on contactPhase).

const CONTACT_ARRIVE_RADIUS = 0.5;

/** Start a contact reaction for `soldier`, dashing roughly away from and
    perpendicular to `shooterPos`. No-op if he's already reacting, already
    bounding, dead, or can't move. Deterministic: the left/right pick comes
    from the soldier's id, never from the RNG (the sim's RNG stream must
    stay identical whether or not contact reactions happen to fire this
    tick — see simulation-determinism.test.ts). */
export function triggerContactReaction(soldier: Soldier, shooterPos: Vec2): void {
  if (soldier.contactPhase) return;
  if (soldier.bounding) return;
  if (soldier.contactCooldown > 0) return;
  if (!isAlive(soldier) || !canMove(soldier)) return;

  const dx = soldier.pos.x - shooterPos.x;
  const dz = soldier.pos.z - shooterPos.z;
  const dist = Math.hypot(dx, dz) || 1;
  const awayX = dx / dist;
  const awayZ = dz / dist;

  // Deterministic left/right pick from the soldier id — never Math.random
  // and never the seeded RNG (this must not perturb the sim's rng stream).
  let hash = 0;
  for (let i = 0; i < soldier.id.length; i++) hash = (hash * 31 + soldier.id.charCodeAt(i)) | 0;
  const side = (hash & 1) === 0 ? 1 : -1;
  const perpX = -awayZ * side;
  const perpZ = awayX * side;

  // Roughly away, with a perpendicular component — "away/perpendicular
  // from the incoming fire direction", not a dead-straight retreat.
  let dirX = awayX * 0.6 + perpX * 0.8;
  let dirZ = awayZ * 0.6 + perpZ * 0.8;
  const dirLen = Math.hypot(dirX, dirZ) || 1;
  dirX /= dirLen;
  dirZ /= dirLen;

  soldier.contactOrigin = { x: soldier.pos.x, z: soldier.pos.z };
  soldier.contactDir = { x: dirX, z: dirZ };
  soldier.contactPhase = 'dash';
  soldier.contactTarget = {
    x: soldier.pos.x + dirX * CONTACT_DASH_DIST,
    z: soldier.pos.z + dirZ * CONTACT_DASH_DIST,
  };
  soldier.stance = 'stand'; // dashing — exposed, like a bound
}

/** One tick of contact-reaction movement for the section. Independent of
    processMovement's bound machinery and its mover cap — this is
    involuntary and brief. */
export function processContactReactions(friendlies: Soldier[], dt: number): void {
  for (const f of friendlies) {
    if (f.contactCooldown > 0) f.contactCooldown = Math.max(0, f.contactCooldown - dt);
    if (!f.contactPhase) continue;
    if (!isAlive(f) || !canMove(f) || !f.contactTarget) {
      endContactReaction(f);
      continue;
    }

    const target = f.contactTarget;
    const dx = target.x - f.pos.x;
    const dz = target.z - f.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist <= CONTACT_ARRIVE_RADIUS) {
      advanceContactPhase(f);
      continue;
    }

    const speed = f.contactPhase === 'dash' ? MOVE_SPEED.stand : CRAWL_SPEED;
    const step = Math.min(speed * dt, dist);
    f.pos.x += (dx / dist) * step;
    f.pos.z += (dz / dist) * step;
    f.heading = Math.atan2(dz, dx);
    if (step >= dist) advanceContactPhase(f);
  }
}

function advanceContactPhase(f: Soldier): void {
  if (f.contactPhase === 'dash') {
    // Down: go prone, then crawl a further offset in the same direction
    // so he is NOT on the spot he was seen going down on.
    f.stance = 'prone';
    f.contactPhase = 'crawl';
    const dir = f.contactDir ?? { x: 0, z: 0 };
    f.contactTarget = {
      x: f.pos.x + dir.x * CONTACT_CRAWL_DIST,
      z: f.pos.z + dir.z * CONTACT_CRAWL_DIST,
    };
  } else {
    // Crawl complete — adopt a fire position (Observe – Sights – Fire;
    // the fire side resumes on its own once contactPhase clears).
    endContactReaction(f);
  }
}

function endContactReaction(f: Soldier): void {
  f.contactPhase = null;
  f.contactTarget = null;
  f.contactDir = null;
  f.contactOrigin = null;
  f.contactCooldown = CONTACT_REACT_COOLDOWN;
  f.stance = 'prone';
}
