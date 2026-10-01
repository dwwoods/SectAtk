// Speculative area fire — Battle Drill 2, "reaction to effective fire"
// (design doc §8/§10, Phase 7 ext.). Real sections return fire at the
// suspected area before the enemy is actually located. When a man has no
// LOS'd target, the section is in contact, and Knowledge holds a believed
// enemy position, he fires at that believed area at his ordered rate:
// rounds come off his real ammunition (the SAME expend() path as direct
// fire, so the ammunition-conservation invariant is untouched), and
// suppression lands on real enemy soldiers, scaled by how close the
// believed point is to each one's true position. No hits are rolled in
// MVP — area fire only ever produces suppression.

import type { Soldier } from '../soldier';
import type { Vec2 } from '../types';
import { isAlive } from '../soldier';
import { expend } from '../ammunition';
import { AREA_FIRE_RADIUS, AREA_FIRE_SUPPRESS_FACTOR, SUPPRESSION_PER_ROUND } from '../config';

/**
 * Fire one round at the believed enemy area. Returns true if a round was
 * actually expended (false if the shooter's magazine was empty — the
 * ammo system picks up the reload next tick, same as direct fire).
 */
export function applyAreaFire(shooter: Soldier, believedPos: Vec2, enemies: Soldier[]): boolean {
  const fired = expend(shooter.ammo, 1);
  if (fired === 0) return false;

  for (const e of enemies) {
    if (!isAlive(e)) continue;
    const d = Math.hypot(e.pos.x - believedPos.x, e.pos.z - believedPos.z);
    if (d >= AREA_FIRE_RADIUS) continue;
    const falloff = 1 - d / AREA_FIRE_RADIUS;
    const amount = SUPPRESSION_PER_ROUND * AREA_FIRE_SUPPRESS_FACTOR * falloff;
    e.suppression = Math.min(1, e.suppression + amount);
  }
  return true;
}
