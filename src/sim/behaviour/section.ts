// Section command layer (design doc §8, §10). Section-level verbs that
// translate into per-man move targets, executed by individual fire &
// movement — so every section manoeuvre is gated by the same two
// doctrinal invariants as a lone rifleman's bound.
//
// MVP wires the doctrinal withdrawal (§2.5 requires it; the decision
// tree's root can demand it). The assault phases arrive post-MVP.

import type { Soldier } from '../soldier';
import type { Vec2 } from '../types';
import { isAlive, canMove } from '../soldier';
import { BASELINE_SPACING } from '../config';

/**
 * Doctrinal withdrawal to a rally point: the section falls back by
 * bounds and reforms on a line at the rally, perpendicular to the
 * direction of withdrawal, so it arrives facing back the way it came.
 * Casualties who cannot move are left where they fell (§5) — that is
 * the design's weight, not an oversight.
 */
export function sectionWithdraw(friendlies: Soldier[], rally: Vec2): number {
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

  // Line at the rally, perpendicular to the withdrawal direction.
  const wx = rally.x - cx;
  const wz = rally.z - cz;
  const wd = Math.hypot(wx, wz) || 1;
  const px = -wz / wd;
  const pz = wx / wd;

  const half = (able.length - 1) / 2;
  for (let i = 0; i < able.length; i++) {
    const offset = (i - half) * BASELINE_SPACING;
    const man = able[i]!;
    man.moveTarget = { x: rally.x + px * offset, z: rally.z + pz * offset };
  }
  return able.length;
}
