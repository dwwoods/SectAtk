// The withdrawal made doctrinal (design doc §2.5, §8): sequenced release
// (furthest-from-the-threat first, next released only once the previous
// has begun his bound), smoke thrown toward the believed threat and
// advected by the wind, and out-of-contact halting the plan for the
// commander to re-decide rather than auto-continuing to the rally.

import { describe, expect, it } from 'vitest';
import { Clock, type SpeedMultiplier } from '../../src/sim/clock';
import { Simulation, type Scenario, type Order } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { sectionWithdraw } from '../../src/sim/behaviour/section';
import { createRifleman, effectiveRof } from '../../src/sim/soldier';
import { createAmmo } from '../../src/sim/ammunition';
import { createRng, nextFloat } from '../../src/sim/rng';
import { soldierLos, losBetween } from '../../src/sim/los';
import {
  FIXED_DT,
  SMOKE_GRENADES_PER_SECTION,
  OUT_OF_CONTACT_SECONDS,
  MAX_SIMULTANEOUS_MOVERS,
} from '../../src/sim/config';
import { updateEnemyPosition, type Journal, type Evidence } from '../../src/sim/knowledge/knowledge';

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

function makeSim(seed: number): Simulation {
  return new Simulation(makeScenario(), world, seed);
}

function evidence(tick = 1): Evidence {
  return { kind: 'observation', tick, sourceId: 'sec-1', note: 'test evidence' };
}

describe('withdrawal — sequenced release', () => {
  it('(a) release order matches distance-from-threat ordering across 20 seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed * 104729);
      const threat = { x: 60, z: -10 };
      const soldiers = Array.from({ length: 8 }, (_, i) =>
        createRifleman(
          `sec-${i + 1}`,
          i === 0 ? 'commander' : 'rifleman',
          `man-${i}`,
          { x: (nextFloat(rng) - 0.5) * 100, z: (nextFloat(rng) - 0.5) * 100 },
          nextFloat(rng) * Math.PI * 2,
          createAmmo(),
        ),
      );
      const plan = sectionWithdraw(soldiers, { x: -200, z: 0 }, threat);
      expect(plan.entries.length).toBe(soldiers.length);

      const byId = new Map(soldiers.map((s) => [s.id, s]));
      const distances = plan.entries.map((e) => {
        const man = byId.get(e.id)!;
        return Math.hypot(man.pos.x - threat.x, man.pos.z - threat.z);
      });
      for (let i = 1; i < distances.length; i++) {
        expect(distances[i - 1]!).toBeGreaterThanOrEqual(distances[i]!);
      }
    }
  });

  it('(b) unreleased men retain nonzero effectiveRof while a released man bounds', () => {
    const sim = makeSim(0x5eed);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    sim.applyOrder({ type: 'withdraw', rally: { x: -300, z: 120 } });

    let sawBounderWithCover = false;
    for (let t = 0; t < 30 * 60 && !sawBounderWithCover; t++) {
      sim.step();
      const bounders = sim.friendlies.filter((f) => f.bounding);
      if (bounders.length === 0) continue;
      const unreleased = sim.friendlies.filter((f) => !f.bounding && f.moveTarget === null && f.wound === null);
      if (unreleased.length === 0) continue;
      expect(unreleased.some((f) => effectiveRof(f) > 0)).toBe(true);
      sawBounderWithCover = true;
    }
    expect(sawBounderWithCover).toBe(true);
  });

  it('(c) smoke blocks soldierLos through the cloud, and stops blocking once removed', () => {
    const a = createRifleman('a', 'commander', 'A', { x: -20, z: 0 }, 0, createAmmo());
    const b = createRifleman('b', 'rifleman', 'B', { x: 20, z: 0 }, 0, createAmmo());

    // Clear without smoke (flat terrain, real worldgen — nothing between them).
    expect(soldierLos(a, b, world, []).clear).toBe(true);

    const cloud = { id: 'smoke-0', pos: { x: 0, z: 0 }, radius: 8, remaining: 60 };
    expect(soldierLos(a, b, world, [cloud]).clear).toBe(false);

    // Expiry is "the cloud is gone" — an empty cloud list is the same as
    // never having thrown it.
    expect(soldierLos(a, b, world, []).clear).toBe(true);
  });

  it('(c2) smoke cloud actually expires and stops blocking LOS inside the sim', () => {
    const sim = makeSim(0xface);
    const j: Journal = [];
    updateEnemyPosition(sim.knowledge, j, { x: 60, z: -10 }, evidence());
    sim.applyOrder({ type: 'smoke' });
    expect(sim.smokeClouds.length).toBe(1);

    // Drive the clock past SMOKE_DURATION_SECONDS.
    for (let t = 0; t < 65 * 60; t++) sim.step();
    expect(sim.smokeClouds.length).toBe(0);
  });

  it('(d) wind advection is deterministic: same seed twice → identical cloud positions', () => {
    function run(): { x: number; z: number; remaining: number } {
      const sim = makeSim(0xd00d);
      const j: Journal = [];
      updateEnemyPosition(sim.knowledge, j, { x: 60, z: -10 }, evidence());
      sim.applyOrder({ type: 'smoke' });
      for (let t = 0; t < 30 * 60; t++) sim.step();
      const cloud = sim.smokeClouds[0]!;
      return { x: cloud.pos.x, z: cloud.pos.z, remaining: cloud.remaining };
    }
    const r1 = run();
    const r2 = run();
    expect(r2).toEqual(r1);

    // And the bake itself is deterministic from the seed.
    const w1 = bakeWorld(42);
    const w2 = bakeWorld(42);
    expect(w2.windAngle).toBe(w1.windAngle);
  });

  it('(e) out-of-contact fires once and halts the plan where it stands', () => {
    const sim = makeSim(0xbeef);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    // A permanent, map-covering smoke wall — the cleanest deterministic way
    // to guarantee no enemy ever has LOS, without depending on real terrain/
    // range nuances. (It also happens to exercise the smoke-blocks-LOS path
    // for real, inside the sim's own fire/observation code.)
    sim.smokeClouds.push({ id: 'wall', pos: { x: 10, z: 5 }, radius: 5000, remaining: 1_000_000 });
    // A rally far enough away that the plan cannot possibly finish before
    // the out-of-contact clock (OUT_OF_CONTACT_SECONDS) runs out, so the
    // halt is unambiguous.
    sim.applyOrder({ type: 'withdraw', rally: { x: -2000, z: 1500 } });

    let outOfContactEvents = 0;
    const outOfContactTicks = Math.round(OUT_OF_CONTACT_SECONDS / FIXED_DT);
    for (let t = 0; t < outOfContactTicks + 120; t++) {
      const events = sim.step();
      outOfContactEvents += events.filter((e) => e.type === 'out-of-contact').length;
    }

    expect(outOfContactEvents).toBe(1);
    expect(sim.withdrawalPlan).not.toBeNull();
    expect(sim.withdrawalPlan!.halted).toBe(true);
    // Not finished: with a rally this far away, somebody is still mid-
    // withdrawal (released or not) when the halt lands.
    expect(sim.friendlies.some((f) => f.moveTarget !== null)).toBe(true);

    // Halted really means halted: running on further doesn't release more
    // men or fire a second event.
    const releasedAtHalt = sim.withdrawalPlan!.released;
    for (let t = 0; t < 120; t++) {
      const events = sim.step();
      outOfContactEvents += events.filter((e) => e.type === 'out-of-contact').length;
    }
    expect(outOfContactEvents).toBe(1);
    expect(sim.withdrawalPlan!.released).toBe(releasedAtHalt);
  });

  it('(f) smoke inventory never goes negative, and the order no-ops at zero', () => {
    const sim = makeSim(0x5a1e);
    const j: Journal = [];
    updateEnemyPosition(sim.knowledge, j, { x: 60, z: -10 }, evidence());

    for (let i = 0; i < SMOKE_GRENADES_PER_SECTION + 3; i++) {
      sim.applyOrder({ type: 'smoke' });
    }
    expect(sim.smokeInventory).toBe(0);
    expect(sim.smokeClouds.length).toBe(SMOKE_GRENADES_PER_SECTION);

    // One more for good measure: still a no-op, never negative.
    sim.applyOrder({ type: 'smoke' });
    expect(sim.smokeInventory).toBe(0);
    expect(sim.smokeClouds.length).toBe(SMOKE_GRENADES_PER_SECTION);
  });

  it('(g) the new state is deterministic: 2000 ticks at 1x matches 2x', () => {
    const SEED = 0x7a11;
    const TICKS = 2000;

    const ORDER_LOG: Array<{ atTick: number; order: Order }> = [
      { atTick: 50, order: { type: 'set-fire-intent', intent: 'hold' } },
      { atTick: 300, order: { type: 'smoke' } },
      { atTick: 800, order: { type: 'withdraw', rally: { x: -250, z: 140 } } },
    ];

    function serialize(sim: Simulation): string {
      const values: number[] = [
        sim.tick,
        sim.smokeInventory,
        sim.noContactTicks,
        sim.smokeClouds.length,
        sim.smokeClouds[0]?.pos.x ?? -9999,
        sim.smokeClouds[0]?.pos.z ?? -9999,
        sim.smokeClouds[0]?.remaining ?? -9999,
        sim.withdrawalPlan ? sim.withdrawalPlan.released : -1,
        sim.withdrawalPlan ? (sim.withdrawalPlan.halted ? 1 : 0) : -1,
      ];
      for (const f of sim.friendlies) {
        values.push(
          f.pos.x, f.pos.z,
          f.moveTarget?.x ?? -9999, f.moveTarget?.z ?? -9999,
          f.bounding ? 1 : 0,
        );
      }
      return JSON.stringify(values);
    }

    function run(speed: SpeedMultiplier): string {
      const sim = new Simulation(makeScenario(), world, SEED);
      const j: Journal = [];
      updateEnemyPosition(sim.knowledge, j, { x: 60, z: -10 }, evidence());

      let orderIdx = 0;
      const clock = new Clock((dt) => {
        const due = sim.tick + 1;
        while (orderIdx < ORDER_LOG.length && ORDER_LOG[orderIdx]!.atTick < due) {
          sim.applyOrder(ORDER_LOG[orderIdx]!.order);
          orderIdx++;
        }
        sim.step(dt);
      });
      clock.setSpeed(speed);
      while (clock.tickCount < TICKS) clock.advance(FIXED_DT);
      return serialize(sim);
    }

    expect(run(2)).toBe(run(1));
    expect(run(4)).toBe(run(1));
  });

  it('losBetween with no clouds argument matches an explicit empty list (back-compat default)', () => {
    const h = world.heightfield.heightAt(30, 10);
    const withDefault = losBetween(-20, 0, h + 1.6, 20, 0, h + 1.6, world.heightfield, world.meadow, world.canopy);
    const withEmpty = losBetween(-20, 0, h + 1.6, 20, 0, h + 1.6, world.heightfield, world.meadow, world.canopy, []);
    expect(withDefault).toEqual(withEmpty);
  });

  it('a withdrawal still respects MAX_SIMULTANEOUS_MOVERS under sequenced release', () => {
    const sim = makeSim(0x5eed);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    sim.applyOrder({ type: 'withdraw', rally: { x: -300, z: 120 } });
    for (let t = 0; t < 180 * 60; t++) {
      sim.step();
      const movers = sim.friendlies.filter((f) => f.bounding).length;
      expect(movers).toBeLessThanOrEqual(MAX_SIMULTANEOUS_MOVERS);
    }
  });
});
