// Section command layer (design doc §8, §10). Section-level verbs that
// translate into per-man move targets, executed by individual fire &
// movement — so every section manoeuvre is gated by the same two
// doctrinal invariants as a lone rifleman's bound.
//
// Wires the doctrinal withdrawal (§2.5 requires it; the decision tree's
// root can demand it) and the section assault — battle drill 5: Charlie
// (fire support) holds while Delta (the assault group) fights THROUGH the
// position on an offset axis to its far side, never onto its lip
// (behaviour/fireteam.ts for the split and the shared line-formation
// geometry). A mauled section falls back to one line under the F&M gates.

import type { Soldier } from '../soldier';
import type { Vec2 } from '../types';
import { isAlive, canMove, canFight } from '../soldier';
import {
  BASELINE_SPACING,
  ASSAULT_THROUGH_DEPTH,
  ASSAULT_MIN_TEAM,
  ASSAULT_OFFSET_ANGLE_DEG,
} from '../config';
import { teamOf, centroidOf, offsetAxis, lineUp } from './fireteam';

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

/**
 * Battle drill 5 — the attack, per the excalidraw: Charlie (fire support)
 * holds the believed enemy position under fire while Delta (the assault
 * group) bounds in on an axis OFFSET from the direct fire-support→enemy
 * line, to a line ASSAULT_THROUGH_DEPTH beyond the believed position, so
 * the assault fights through to the far side (drill 6 reorganises there)
 * rather than onto the lip — and so Charlie can keep firing until the
 * assault's own geometry masks it (simulation.ts's mask check).
 *
 * A mauled section with fewer than ASSAULT_MIN_TEAM able Delta men cannot
 * sustain the two-team technique and falls back to the old whole-section
 * single line through the position.
 */
export interface AssaultResult {
  /** True when the offset two-team assault ran; false when the section
      fell back to one whole-section line. */
  split: boolean;
  /** Men given a move target by this call. */
  count: number;
}

export function sectionAssault(friendlies: Soldier[], believedEnemy: Vec2): AssaultResult {
  const charlie = teamOf(friendlies, 'C');
  const delta = teamOf(friendlies, 'D');
  const deltaAble = delta.filter((f) => isAlive(f) && canFight(f) && canMove(f));

  if (deltaAble.length < ASSAULT_MIN_TEAM) {
    return { split: false, count: fallbackAssault(friendlies, believedEnemy) };
  }

  // Fire support holds its ground — clear any stale move target. It keeps
  // firing on its own: the existing per-tick fire step reads fireIntent
  // and LOS exactly as it always has: no change needed here.
  for (const f of charlie) {
    if (isAlive(f)) f.moveTarget = null;
  }

  const charlieAble = charlie.filter((f) => isAlive(f));
  const supportFrom = charlieAble.length > 0 ? centroidOf(charlieAble) : centroidOf(deltaAble);
  const axis = offsetAxis(supportFrom, believedEnemy, ASSAULT_OFFSET_ANGLE_DEG);
  const centre = {
    x: believedEnemy.x + axis.x * ASSAULT_THROUGH_DEPTH,
    z: believedEnemy.z + axis.z * ASSAULT_THROUGH_DEPTH,
  };
  const count = lineUp(deltaAble, centre, axis, BASELINE_SPACING);
  return { split: true, count };
}

/** The old whole-section behaviour: every able man forms a line through
    the believed position, along the direct axis from the section's own
    centroid. Used only when the section is too mauled to split. */
function fallbackAssault(friendlies: Soldier[], believedEnemy: Vec2): number {
  const able = friendlies.filter((f) => isAlive(f) && canMove(f));
  if (able.length === 0) return 0;

  const centroid = centroidOf(able);
  const ax = believedEnemy.x - centroid.x;
  const az = believedEnemy.z - centroid.z;
  const ad = Math.hypot(ax, az) || 1;
  const ux = ax / ad;
  const uz = az / ad;
  const centre = {
    x: believedEnemy.x + ux * ASSAULT_THROUGH_DEPTH,
    z: believedEnemy.z + uz * ASSAULT_THROUGH_DEPTH,
  };
  return lineUp(able, centre, { x: ux, z: uz }, BASELINE_SPACING);
}
