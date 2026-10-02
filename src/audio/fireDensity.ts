// Tier-3 ambient fire-density model — friendly and enemy fire rate as
// perceivable texture (design doc §3.1 tier 3, §4.2, Phase 6).
//
// This module is the pure, testable core: a function of soldier state and a
// listener position, nothing else. It NEVER reads or writes Knowledge — it
// does not even take a KnowledgeState parameter, by construction, so there
// is no path by which /audio could collapse the three information tiers
// into two. It never reads any "fire control active/lapsed" flag either:
// fire going ragged when the 2IC falls must EMERGE from individual
// soldiers' per-man rates (ammo, suppression, wounds), never from a flag
// this module branches on (design §4.2 — nothing may notify the player
// that fire control has lapsed).
//
// Presentation (WebAudio cracks, visual fallback) lives in cues.ts and
// screenEdge.ts and consumes the output of computeDensity() each render
// frame. This file has no DOM/AudioContext dependency so it is testable
// under vitest without a browser.

import type { Soldier } from '../sim/soldier';
import { isAlive, effectiveRof } from '../sim/soldier';
import { ENEMY_ROF, MAG_ROUNDS } from '../sim/config';
import { isPinned } from '../sim/suppression';
import type { Vec2 } from '../sim/types';
import { ATTENUATION_REF_DIST } from './config';

/** Perceived fire texture for one side, as heard/seen from a listener. */
export interface SideDensity {
  /** Distance-attenuated aggregate effective rounds/sec. Not sim truth —
      a perceived quantity, which is the point of a tier-3 texture. */
  rate: number;
  /** Bearing (radians, atan2(dx, dz) world convention) from the listener
      to the ammo-weighted centroid of this side's contributing shooters. */
  bearing: number;
  /** Angular width (radians, circular standard deviation) of the
      contributing shooters around `bearing`. 0 = a single point source. */
  spread: number;
}

export interface FireDensity {
  friendly: SideDensity;
  enemy: SideDensity;
}

const SILENT: SideDensity = { rate: 0, bearing: 0, spread: 0 };

/** Inverse-distance attenuation, clamped so nothing inside the reference
    distance is boosted above full weight. Pure function of distance. */
function attenuation(distanceM: number): number {
  const d = Math.max(distanceM, ATTENUATION_REF_DIST);
  return ATTENUATION_REF_DIST / d;
}

/** Total rounds a soldier is currently carrying (mag + spares + bandolier).
    Used only as an ammo-weighting for the centroid direction — never
    exposed to Knowledge; this module has no connection to Knowledge at
    all. */
function totalAmmo(s: Soldier): number {
  return s.ammo.currentMag + s.ammo.spareMags * MAG_ROUNDS + s.ammo.bandolier;
}

/** Enemy effective rate of fire, mirroring the probabilistic model enemy
    soldiers actually fire under in src/sim/enemy/position.ts
    (processEnemyFire): ENEMY_ROF scaled down by suppression, gated by
    pinning and by having any rounds left at all. Enemy soldiers carry the
    same `fireIntent`/`effectiveRof` shape as friendlies (soldier.ts is
    shared), but the enemy fire loop does not consult fireIntent — it uses
    ENEMY_ROF directly — so the density model mirrors that loop instead of
    calling effectiveRof() for the enemy side. */
function enemyEffectiveRof(s: Soldier): number {
  if (!isAlive(s)) return 0;
  if (isPinned(s.suppression)) return 0;
  if (s.ammo.currentMag === 0 && s.ammo.spareMags === 0 && s.ammo.bandolier === 0) return 0;
  const rofMult = 1 - s.suppression * 0.8;
  return ENEMY_ROF * Math.max(0, rofMult);
}

/** Weighted circular standard deviation of a set of angles around a known
    weighted mean angle. 0 for a single/concentrated source, growing toward
    ~2.14 (sqrt(2*ln) blows up) as the source scatters toward uniform. */
function circularSpread(bearings: Array<{ angle: number; weight: number }>): number {
  let sumW = 0;
  let sumCos = 0;
  let sumSin = 0;
  for (const b of bearings) {
    sumW += b.weight;
    sumCos += b.weight * Math.cos(b.angle);
    sumSin += b.weight * Math.sin(b.angle);
  }
  if (sumW <= 0) return 0;
  const resultant = Math.hypot(sumCos, sumSin) / sumW;
  const clamped = Math.min(1, Math.max(1e-6, resultant));
  return Math.sqrt(-2 * Math.log(clamped));
}

function computeSideDensity(
  side: Soldier[],
  listenerPos: Vec2,
  rofFn: (s: Soldier) => number,
): SideDensity {
  let totalRate = 0;
  let ammoWeightSum = 0;
  let centroidX = 0;
  let centroidZ = 0;
  const bearings: Array<{ angle: number; weight: number }> = [];

  for (const s of side) {
    if (!isAlive(s)) continue;
    const rof = rofFn(s);
    if (rof <= 0) continue;

    const dx = s.pos.x - listenerPos.x;
    const dz = s.pos.z - listenerPos.z;
    const distance = Math.max(0.01, Math.hypot(dx, dz));
    const attenuatedRate = rof * attenuation(distance);
    if (attenuatedRate <= 0) continue;

    totalRate += attenuatedRate;

    const ammoWeight = Math.max(0, totalAmmo(s));
    centroidX += s.pos.x * ammoWeight;
    centroidZ += s.pos.z * ammoWeight;
    ammoWeightSum += ammoWeight;

    bearings.push({ angle: Math.atan2(dx, dz), weight: attenuatedRate });
  }

  if (totalRate <= 0 || ammoWeightSum <= 0) return SILENT;

  centroidX /= ammoWeightSum;
  centroidZ /= ammoWeightSum;
  const bearing = Math.atan2(centroidX - listenerPos.x, centroidZ - listenerPos.z);
  const spread = circularSpread(bearings);

  return { rate: totalRate, bearing, spread };
}

/**
 * Pure core of the tier-3 ambient fire-density channel. Takes the full
 * soldier roster (both sides — friendly and enemy soldiers mixed in one
 * array, as Simulation.world holds them) and a listener position, and
 * returns a perceivable (distance-attenuated) summary of each side's
 * current fire activity.
 *
 * Deliberately does NOT take a KnowledgeState, a Journal, or any
 * "fire control active" flag — there is nothing here to read from or
 * write to Knowledge, and fire going ragged after the 2IC falls emerges
 * purely from the per-man `effectiveRof`/`enemyEffectiveRof` of whichever
 * soldiers are still standing.
 */
export function computeDensity(soldiers: Soldier[], listenerPos: Vec2): FireDensity {
  const friendlySide = soldiers.filter((s) => s.side === 'friendly');
  const enemySide = soldiers.filter((s) => s.side === 'enemy');
  return {
    friendly: computeSideDensity(friendlySide, listenerPos, effectiveRof),
    enemy: computeSideDensity(enemySide, listenerPos, enemyEffectiveRof),
  };
}
