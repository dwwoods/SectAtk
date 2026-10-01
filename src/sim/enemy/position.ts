// Enemy position model — static concealed position, finite ammunition,
// suppression response. The enemy in MVP are static (do not manoeuvre),
// but they obey the same ammunition rules as the friendly section, and
// their ROF degrades with suppression.
//
// Design doc §2.4: "The enemy burns rounds too. The clock cuts both ways."
// This is the most productive small mechanic in the design — the enemy's
// endurance is a number the player can never count.

import type { Vec2 } from '../types';
import type { RngState } from '../rng';
import { nextFloat } from '../rng';
import { ENEMY_COUNT, ENEMY_INITIAL_ROUNDS, ENEMY_ROF, MAG_ROUNDS } from '../config';
import { createAmmo, expend, processAmmoTick } from '../ammunition';
import { createEnemy, isAlive, type Soldier } from '../soldier';
import { getExposureProfile, getCoverFactor, type ExposureProfile } from '../exposure';
import { resolveShot, type ShotParams } from '../ballistics';
import { isPinned } from '../suppression';
import type { Meadow } from '../../worldgen/meadow';
import type { DistField } from '../../worldgen/distanceField';

export interface EnemySection {
  soldiers: Soldier[];
  /** Section-average suppression, for the "fire slackening" texture. */
  sectionSuppression: number;
}

function setupRng(seed: number): RngState {
  return { state: seed >>> 0 };
}

export function createEnemySection(
  position: Vec2,
  spread: number,
  heading: number,
): EnemySection {
  const soldiers: Soldier[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const rng = setupRng(20260728 + i * 37);
    const offsetX = (i - (ENEMY_COUNT - 1) / 2) * spread;
    const offsetZ = (nextFloat(rng) - 0.5) * spread * 0.6;
    const ammo = createAmmo(Math.ceil(ENEMY_INITIAL_ROUNDS / MAG_ROUNDS), 0);
    soldiers.push(
      createEnemy(
        `enemy-${i}`,
        { x: position.x + offsetX, z: position.z + offsetZ },
        heading + (nextFloat(rng) - 0.5) * 0.5,
        ammo,
      ),
    );
  }
  return { soldiers, sectionSuppression: 0 };
}

/**
 * Process enemy fire for one tick. Each enemy soldier probabilistically
 * fires at his effective rate at the nearest alive friendly. Returns shot
 * results for the sim to apply (wounds, suppression) and to feed the
 * knowledge system (muzzle flashes are tier-1 observation triggers).
 */
export function processEnemyFire(
  enemy: EnemySection,
  friendlies: Soldier[],
  rng: RngState,
  meadow: Meadow,
  coverDF: DistField,
  tick: number,
): EnemyShot[] {
  const shots: EnemyShot[] = [];

  // Section-level suppression = mean of alive enemy soldiers.
  let totalSup = 0;
  let alive = 0;
  for (const s of enemy.soldiers) {
    if (s.wound && (s.wound.severity === 'fatal-cns' || s.wound.severity === 'mortal')) continue;
    totalSup += s.suppression;
    alive++;
  }
  enemy.sectionSuppression = alive > 0 ? totalSup / alive : 1;

  for (const s of enemy.soldiers) {
    if (!isAlive(s)) continue;
    if (isPinned(s.suppression)) continue;
    if (s.ammo.currentMag === 0 && s.ammo.spareMags === 0 && s.ammo.bandolier === 0) continue;

    // Fire at effective rate: per-tick probability = rof * dt.
    const rofMult = 1 - s.suppression * 0.8;
    const fireChance = ENEMY_ROF * rofMult / 60;
    if (nextFloat(rng) >= fireChance) {
      processAmmoTick(s, 1 / 60);
      continue;
    }

    // Find the nearest alive friendly.
    let nearest: Soldier | null = null;
    let nearestDist = Infinity;
    for (const f of friendlies) {
      if (!isAlive(f)) continue;
      const d = Math.hypot(f.pos.x - s.pos.x, f.pos.z - s.pos.z);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = f;
      }
    }
    if (!nearest) {
      processAmmoTick(s, 1 / 60);
      continue;
    }

    // Expend one round.
    const fired = expend(s.ammo, 1);
    if (fired === 0) {
      processAmmoTick(s, 1 / 60);
      continue;
    }

    const profile: ExposureProfile = getExposureProfile(
      nearest.stance,
      nearest.pos,
      false,
      meadow,
    );

    const params: ShotParams = {
      sx: s.pos.x, sz: s.pos.z,
      tx: nearest.pos.x, tz: nearest.pos.z,
      targetProfile: profile,
      range: nearestDist,
      coverFactor: getCoverFactor(coverDF, nearest.pos.x, nearest.pos.z),
      shooterSuppression: s.suppression,
    };

    const result = resolveShot(rng, params, tick);
    shots.push({ source: s, target: nearest, result });

    // Ammo bookkeeping for next tick.
    processAmmoTick(s, 1 / 60);
  }

  return shots;
}

export interface EnemyShot {
  source: Soldier;
  target: Soldier;
  result: ReturnType<typeof resolveShot>;
}