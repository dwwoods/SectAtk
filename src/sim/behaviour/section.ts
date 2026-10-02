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

// ── doctrinal withdrawal — sequenced release (design doc §2.5, §8) ─────────
// The drill: the man furthest from the threat (rear-most) moves first;
// the next is released only once the previous has begun his bound; the
// rest are the cover — they are never given a moveTarget, so they keep
// firing under the same F&M gates as any other bound. The plan is plain
// serializable data held on Simulation; `processWithdrawal` advances it
// one release at a time, driven from the step pipeline before
// `processMovement`.

export interface WithdrawalPlanEntry {
  id: string;
  target: Vec2;
}

export interface WithdrawalPlan {
  /** Release order: index 0 moves first (furthest from the threat). */
  entries: WithdrawalPlanEntry[];
  /** Count of entries that have been given a moveTarget so far. */
  released: number;
  /** True once out-of-contact has frozen the plan: no further releases.
      Men already moving finish their current bound, then hold — the
      commander re-decides (a fresh 'withdraw' order replans whoever has
      not yet arrived). */
  halted: boolean;
}

/**
 * Doctrinal withdrawal to a rally point: the section falls back by
 * bounds and reforms on a line at the rally, perpendicular to the
 * direction of withdrawal, so it arrives facing back the way it came.
 * Casualties who cannot move are left where they fell (§5) — that is
 * the design's weight, not an oversight.
 *
 * Returns a WithdrawalPlan rather than moving everyone at once: the
 * entries are ORDERED rear-most-relative-to-the-threat first (distance
 * from `threat` — the believed enemy position — descending; falling back
 * to the section's facing, most-rearward-along-heading first, when the
 * enemy has not been located). Nobody's moveTarget is set here —
 * `processWithdrawal` releases entries one at a time from the step
 * pipeline.
 */
export function sectionWithdraw(
  friendlies: Soldier[],
  rally: Vec2,
  threat: Vec2 | null,
): WithdrawalPlan {
  const able = friendlies.filter((f) => isAlive(f) && canMove(f));
  if (able.length === 0) return { entries: [], released: 0, halted: false };

  let cx = 0;
  let cz = 0;
  for (const f of able) {
    cx += f.pos.x;
    cz += f.pos.z;
  }
  cx /= able.length;
  cz /= able.length;

  // Line at the rally, perpendicular to the withdrawal direction. Slots
  // are assigned in section order (stable, independent of release order)
  // so the reformed line looks the same regardless of who went first.
  const wx = rally.x - cx;
  const wz = rally.z - cz;
  const wd = Math.hypot(wx, wz) || 1;
  const px = -wz / wd;
  const pz = wx / wd;

  const half = (able.length - 1) / 2;
  const slotted = able.map((man, i) => {
    const offset = (i - half) * BASELINE_SPACING;
    return {
      man,
      target: { x: rally.x + px * offset, z: rally.z + pz * offset },
    };
  });

  // Release order: furthest from the threat first (rear-most = safest to
  // expose while moving). No believed threat → use the section's facing:
  // most rearward along the average heading goes first.
  let ordered: typeof slotted;
  if (threat) {
    ordered = [...slotted].sort((a, b) => {
      const da = Math.hypot(a.man.pos.x - threat.x, a.man.pos.z - threat.z);
      const db = Math.hypot(b.man.pos.x - threat.x, b.man.pos.z - threat.z);
      return db - da; // descending: furthest first
    });
  } else {
    let hx = 0;
    let hz = 0;
    for (const { man } of slotted) {
      hx += Math.cos(man.heading);
      hz += Math.sin(man.heading);
    }
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    ordered = [...slotted].sort((a, b) => {
      const pa = a.man.pos.x * hx + a.man.pos.z * hz;
      const pb = b.man.pos.x * hx + b.man.pos.z * hz;
      return pa - pb; // ascending: most rearward along facing first
    });
  }

  return {
    entries: ordered.map(({ man, target }) => ({ id: man.id, target })),
    released: 0,
    halted: false,
  };
}

/**
 * One tick of sequenced release: give the next man in line his moveTarget
 * only once the previous one has begun his bound (or was skipped because
 * he arrived, died, or was immobilised before moving). Unreleased men are
 * never touched — they keep covering because they were never given
 * anywhere to go. A halted plan (out-of-contact) does nothing until the
 * commander re-decides.
 */
export function processWithdrawal(plan: WithdrawalPlan | null, friendlies: Soldier[]): void {
  if (!plan || plan.halted) return;
  if (plan.released >= plan.entries.length) return;

  if (plan.released === 0) {
    releaseEntry(plan, friendlies, 0);
    return;
  }

  const prev = plan.entries[plan.released - 1]!;
  const prevMan = friendlies.find((f) => f.id === prev.id) ?? null;
  const prevBegun =
    !prevMan ||
    prevMan.bounding ||
    prevMan.moveTarget === null || // arrived, or his order never took
    !isAlive(prevMan) ||
    !canMove(prevMan);
  if (prevBegun) {
    releaseEntry(plan, friendlies, plan.released);
  }
}

function releaseEntry(plan: WithdrawalPlan, friendlies: Soldier[], index: number): void {
  const entry = plan.entries[index];
  plan.released = index + 1;
  if (!entry) return;
  const man = friendlies.find((f) => f.id === entry.id);
  if (man && isAlive(man) && canMove(man)) {
    man.moveTarget = { ...entry.target };
  }
}

/** True once every entry has been released and every one of those men has
    arrived (or can no longer move) — the plan has nothing left to do. */
export function isWithdrawalFinished(plan: WithdrawalPlan, friendlies: Soldier[]): boolean {
  if (plan.released < plan.entries.length) return false;
  for (const entry of plan.entries) {
    const man = friendlies.find((f) => f.id === entry.id);
    if (man && man.moveTarget !== null) return false;
  }
  return true;
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
