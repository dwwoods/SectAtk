// Baseline formation (design doc §8: "Section comes under fire;
// individual F&M into a baseline"). The section shakes out into an
// extended line perpendicular to the threat bearing, men at
// BASELINE_SPACING intervals, and gets there by individual fire &
// movement — so the one-foot-on-the-ground and no-move-without-fire
// invariants gate every bound of the shake-out too.

import type { Soldier } from '../soldier';
import type { Vec2 } from '../types';
import { isAlive, canMove } from '../soldier';
import { BASELINE_SPACING } from '../config';

/**
 * Assign each able man a slot on an extended line centred on the
 * section's centroid, perpendicular to the bearing toward the threat.
 * Returns the number of men given move targets. Casualties who cannot
 * move keep their position — the line forms around them, not over them.
 */
export function formBaseline(friendlies: Soldier[], threat: Vec2): number {
  const able = friendlies.filter((f) => isAlive(f) && canMove(f));
  if (able.length === 0) return 0;

  let cx = 0;
  let cz = 0;
  for (const f of able) {
    cx += f.pos.x;
    cz += f.pos.z;
  }
  cx /= able.length;
  cz /= able.length;

  // Unit vector along the line = perpendicular to centroid→threat.
  const bx = threat.x - cx;
  const bz = threat.z - cz;
  const bd = Math.hypot(bx, bz) || 1;
  const px = -bz / bd;
  const pz = bx / bd;

  // Slots symmetric about the centroid, in section order — deterministic.
  const half = (able.length - 1) / 2;
  for (let i = 0; i < able.length; i++) {
    const offset = (i - half) * BASELINE_SPACING;
    const man = able[i]!;
    man.moveTarget = { x: cx + px * offset, z: cz + pz * offset };
  }
  return able.length;
}
