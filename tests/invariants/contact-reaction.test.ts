// Battle Drill 2 — "reaction to effective fire": Dash – Down – Crawl –
// Observe – Sights – Fire, plus speculative area fire at a believed (not
// LOS'd) enemy position (design doc §8, Phase 7 ext.).

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { Clock, type SpeedMultiplier } from '../../src/sim/clock';
import { createRifleman, createEnemy, effectiveRof } from '../../src/sim/soldier';
import { createAmmo } from '../../src/sim/ammunition';
import {
  triggerContactReaction,
  processContactReactions,
} from '../../src/sim/behaviour/individual';
import { applyAreaFire } from '../../src/sim/behaviour/areaFire';
import { FIXED_DT, CONTACT_DASH_DIST, MAG_ROUNDS } from '../../src/sim/config';

function makeScenario(): Scenario {
  return {
    friendlyStart: [
      { name: 'Cpl. Harris', role: 'commander', pos: { x: -40, z: 20 } },
      { name: 'L/Cpl. Doyle', role: 'twoIC', pos: { x: -35, z: 25 } },
      { name: 'Pte. Bell', role: 'rifleman', pos: { x: -45, z: 22 } },
      { name: 'Pte. Okafor', role: 'rifleman', pos: { x: -38, z: 28 } },
      { name: 'Pte. Lindqvist', role: 'rifleman', pos: { x: -42, z: 18 } },
      { name: 'Pte. Marsh', role: 'rifleman', pos: { x: -48, z: 26 } },
      { name: 'Pte. Novak', role: 'rifleman', pos: { x: -36, z: 22 } },
      { name: 'Pte. Whitlock', role: 'rifleman', pos: { x: -44, z: 30 } },
    ],
    enemyPosition: { x: 60, z: -10 },
    enemySpread: 3,
    enemyHeading: Math.PI,
  };
}

const world = bakeWorld(20260728);

describe('contact reaction — Battle Drill 2 (dash-down-crawl)', () => {
  it('a man never ends his reaction on his initial contact position', () => {
    const soldier = createRifleman('t-1', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    const origin = { x: soldier.pos.x, z: soldier.pos.z };
    const shooterPos = { x: -50, z: 0 };

    triggerContactReaction(soldier, shooterPos);
    expect(soldier.contactPhase).toBe('dash');

    for (let t = 0; t < 60 * 10 && soldier.contactPhase; t++) {
      processContactReactions([soldier], FIXED_DT);
    }

    expect(soldier.contactPhase).toBeNull();
    const moved = Math.hypot(soldier.pos.x - origin.x, soldier.pos.z - origin.z);
    expect(moved).toBeGreaterThan(CONTACT_DASH_DIST * 0.5);
  });

  it('effectiveRof is 0 for the whole dash and the whole crawl, and resumes after', () => {
    const soldier = createRifleman('t-2', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    soldier.fireIntent = 'rapid';
    expect(effectiveRof(soldier)).toBeGreaterThan(0); // sanity: can fire normally

    triggerContactReaction(soldier, { x: -50, z: 0 });
    let sawDash = false;
    let sawCrawl = false;
    for (let t = 0; t < 60 * 10 && soldier.contactPhase; t++) {
      if (soldier.contactPhase === 'dash') sawDash = true;
      if (soldier.contactPhase === 'crawl') sawCrawl = true;
      expect(effectiveRof(soldier)).toBe(0);
      processContactReactions([soldier], FIXED_DT);
    }

    expect(sawDash).toBe(true);
    expect(sawCrawl).toBe(true);
    expect(effectiveRof(soldier)).toBeGreaterThan(0); // fires again once settled
  });

  it('does not trigger a man already bounding, dead, or unable to move', () => {
    const bounding = createRifleman('t-3', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    bounding.bounding = true;
    triggerContactReaction(bounding, { x: -50, z: 0 });
    expect(bounding.contactPhase).toBeNull();

    const dead = createRifleman('t-4', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    dead.wound = { severity: 'fatal-cns', location: 'head', atTick: 0, cryUntil: null };
    triggerContactReaction(dead, { x: -50, z: 0 });
    expect(dead.contactPhase).toBeNull();
  });
});

describe('speculative area fire — Battle Drill 2', () => {
  it('consumes real ammo via the same expend() path as direct fire; rounds conserve', () => {
    const shooter = createRifleman('t-5', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    const issued = shooter.ammo.issued;
    const enemies = [createEnemy('e-1', { x: 20, z: 0 }, 0, createAmmo(4, 0))];

    let fired = 0;
    for (let i = 0; i < 20; i++) {
      // Keep him fed between mags, same as the ammo system would via reload.
      if (shooter.ammo.currentMag === 0 && shooter.ammo.spareMags > 0) {
        shooter.ammo.currentMag = MAG_ROUNDS;
        shooter.ammo.spareMags -= 1;
      }
      if (applyAreaFire(shooter, { x: 20, z: 0 }, enemies)) fired++;
    }

    expect(fired).toBeGreaterThan(0);
    const held = shooter.ammo.currentMag + shooter.ammo.spareMags * MAG_ROUNDS + shooter.ammo.bandolier;
    expect(issued - held).toBe(fired); // conservation: issued = fired + held
  });

  it('suppresses an enemy more when the belief is accurate than when it is 30m wrong', () => {
    const makeEnemy = () => createEnemy('e-1', { x: 20, z: 0 }, 0, createAmmo(4, 0));

    const accurateEnemy = makeEnemy();
    const accurateShooter = createRifleman('t-6', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    applyAreaFire(accurateShooter, { x: 20, z: 0 }, [accurateEnemy]); // dead-on

    const wrongEnemy = makeEnemy();
    const wrongShooter = createRifleman('t-7', 'rifleman', 'Test', { x: 0, z: 0 }, 0, createAmmo());
    applyAreaFire(wrongShooter, { x: 50, z: 0 }, [wrongEnemy]); // 30 m off

    expect(accurateEnemy.suppression).toBeGreaterThan(0);
    expect(wrongEnemy.suppression).toBe(0); // outside AREA_FIRE_RADIUS entirely
    expect(accurateEnemy.suppression).toBeGreaterThan(wrongEnemy.suppression);
  });
});

describe('determinism — contact-reaction and area-fire fields', () => {
  function serialize(sim: Simulation): string {
    const values: number[] = [];
    for (const s of sim.world.values()) {
      values.push(
        s.pos.x, s.pos.z,
        s.contactPhase === 'dash' ? 1 : s.contactPhase === 'crawl' ? 2 : 0,
        s.contactTarget?.x ?? -9999, s.contactTarget?.z ?? -9999,
        s.contactDir?.x ?? -9999, s.contactDir?.z ?? -9999,
        s.contactOrigin?.x ?? -9999, s.contactOrigin?.z ?? -9999,
        s.contactCooldown,
        s.ammo.currentMag, s.ammo.spareMags, s.ammo.bandolier,
        s.suppression,
      );
    }
    const buf = Float64Array.from(values, (n) => (n === 0 ? 0 : n));
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i]!;
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }

  function run(seed: number, ticks: number, speed: SpeedMultiplier): string {
    const sim = new Simulation(makeScenario(), world, seed);
    const clock = new Clock((dt) => sim.step(dt));
    clock.setSpeed(speed);
    while (clock.tickCount < ticks) clock.advance(FIXED_DT);
    expect(clock.tickCount).toBe(ticks);
    return serialize(sim);
  }

  it('2000 ticks at 1x is byte-identical to 2000 ticks at 2x', () => {
    const SEED = 0xc0ffee;
    const TICKS = 2000;
    expect(run(SEED, TICKS, 2)).toBe(run(SEED, TICKS, 1));
  });
});
