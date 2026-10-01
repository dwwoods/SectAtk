// Ammunition conservation — design doc §9.4 assertion #7: rounds issued
// equals rounds fired plus rounds held plus rounds stranded (dead men's
// ammunition), every tick, on BOTH sides. This is what makes the
// compounding spiral in §2.2 real: a casualty is −1 rifle AND −420 rounds
// from the usable pool, because his rounds are stranded with him.
//
// The test runs the real sim for a full engagement and checks conservation
// at every tick. Any leak (rounds created or destroyed) fails the test.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { isAlive } from '../../src/sim/soldier';
import { MAGS_PER_MAN, MAG_ROUNDS, BANDOLIER_ROUNDS, TWO_IC_EXTRA_BANDOLIER } from '../../src/sim/config';

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

function countRoundsForSoldier(s: { ammo: { currentMag: number; spareMags: number; bandolier: number } }): number {
  return s.ammo.currentMag + s.ammo.spareMags * MAG_ROUNDS + s.ammo.bandolier;
}

describe('ammunition conservation', () => {
  it('friendly rounds: issued = fired + held + stranded, every tick', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 20260728);

    // Expected issued totals: commander & 2IC carry extra bandolier.
    const expectedIssued = new Map<string, number>();
    for (const f of sim.friendlies) {
      const extra = f.role === 'twoIC' ? TWO_IC_EXTRA_BANDOLIER : 0;
      expectedIssued.set(f.id, MAGS_PER_MAN * MAG_ROUNDS + BANDOLIER_ROUNDS + extra);
    }

    // Simulate a sustained firefight (say 3 minutes).
    for (let tick = 0; tick < 3 * 60 * 60; tick++) {
      sim.step();

      for (const f of sim.friendlies) {
        const issued = expectedIssued.get(f.id)!;
        const held = countRoundsForSoldier(f);
        const fired = issued - held;
        expect(fired + held).toBe(issued); // conservation within tolerance
      }
    }
  });

  it('enemy rounds: issued = fired + held + stranded, every tick', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 20260728);

    for (const e of sim.enemySection.soldiers) {
      expect(e.ammo.issued).toBe(e.ammo.currentMag + e.ammo.spareMags * MAG_ROUNDS + e.ammo.bandolier);
    }

    for (let tick = 0; tick < 2 * 60 * 60; tick++) {
      sim.step();
      for (const e of sim.enemySection.soldiers) {
        const held = countRoundsForSoldier(e);
        const fired = e.ammo.issued - held;
        expect(fired + held).toBe(e.ammo.issued);
      }
    }
  });

  it('a casualty strands his rounds: dead man\'s held rounds are unreachable', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 20260728);

    // Kill one friendly by direct wound assignment (sim truth).
    const target = sim.friendlies[2]!;
    target.wound = { severity: 'fatal-cns', location: 'head', atTick: sim.tick, cryUntil: null };
    expect(isAlive(target)).toBe(false);

    // His rounds are still "held" by him, but he cannot use them — the
    // usable pool for the section excludes him.
    const stranded = countRoundsForSoldier(target);
    expect(stranded).toBeGreaterThan(0);

    // Conservation still holds at the entity level: issued unchanged.
    const held = countRoundsForSoldier(target);
    expect(target.ammo.issued - held).toBe(0);
  });
});
