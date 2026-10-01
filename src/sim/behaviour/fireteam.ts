// Fireteam movement technique (design doc §8, §10, the excalidraw tactics
// diagram). The section fights as two half-sections — Charlie (fire
// support) and Delta (the assault group) — so one team can hold the
// enemy's heads down while the other closes under an offset axis. The
// 2IC's fire-control duties (behaviour/fireControl.ts) remain section-wide
// and untouched; this module only decides who is on which team and the
// shared line-formation geometry both section.ts and simulation.ts use.

import type { Soldier } from '../soldier';
import type { Vec2 } from '../types';
import { isAlive, canMove } from '../soldier';

export type Fireteam = 'C' | 'D';

/**
 * Fixed split, assigned once at scenario setup, by roster order: Charlie =
 * the commander + the first three riflemen in the roster; Delta = the 2IC
 * + the next three riflemen. The commander stays with the team he can see
 * and talk to; the 2IC goes forward with the assault, where his ammunition
 * discipline and re-bomb rotation (fireControl.ts, unchanged) matter most.
 */
export function assignFireteams(friendlies: Soldier[]): void {
  let riflemanIndex = 0;
  for (const f of friendlies) {
    if (f.role === 'commander') {
      f.fireteam = 'C';
    } else if (f.role === 'twoIC') {
      f.fireteam = 'D';
    } else {
      f.fireteam = riflemanIndex < 3 ? 'C' : 'D';
      riflemanIndex++;
    }
  }
}

/** All men on the given team, in roster order. */
export function teamOf(friendlies: Soldier[], team: Fireteam): Soldier[] {
  return friendlies.filter((f) => f.fireteam === team);
}

/** Centroid of a group of soldiers' positions. */
export function centroidOf(soldiers: Soldier[]): Vec2 {
  let cx = 0;
  let cz = 0;
  for (const s of soldiers) {
    cx += s.pos.x;
    cz += s.pos.z;
  }
  const n = soldiers.length || 1;
  return { x: cx / n, z: cz / n };
}

/**
 * Unit vector from `from` to `to`, rotated by `angleDeg` — the assault
 * axis, offset from the direct fire-support→enemy line so support can keep
 * shooting until the assault masks it.
 */
export function offsetAxis(from: Vec2, to: Vec2, angleDeg: number): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  const ux = dx / d;
  const uz = dz / d;
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: ux * cos - uz * sin, z: ux * sin + uz * cos };
}

/**
 * Line a team up on a line perpendicular to `axisUnit`, centred at
 * `centre`, `spacing` metres apart, in roster order — deterministic. Only
 * able (alive, can-move) men get a move target; casualties who cannot move
 * are left where they fell (§5) and the line forms around them.
 */
export function lineUp(
  team: Soldier[],
  centre: Vec2,
  axisUnit: Vec2,
  spacing: number,
): number {
  const able = team.filter((f) => isAlive(f) && canMove(f));
  if (able.length === 0) return 0;

  const px = -axisUnit.z;
  const pz = axisUnit.x;
  const half = (able.length - 1) / 2;
  for (let i = 0; i < able.length; i++) {
    const offset = (i - half) * spacing;
    const man = able[i]!;
    man.moveTarget = { x: centre.x + px * offset, z: centre.z + pz * offset };
  }
  return able.length;
}
