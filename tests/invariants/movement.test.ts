// Movement — individual fire & movement and the two doctrinal invariants
// (design doc §8, §9.3): "one foot on the ground" (never more than
// MAX_SIMULTANEOUS_MOVERS bounding at any tick) and "no move without
// fire" (nobody bounds without COVERING_FIRE_MIN able shooters down).
// Property-tested every tick across seeds — the design doc's Phase 7
// gate is this suite across 100 seeds; the multi-seed sweep lives in
// the last test.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import {
  MAX_SIMULTANEOUS_MOVERS,
  COVERING_FIRE_MIN,
} from '../../src/sim/config';

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

function orderSectionForward(sim: Simulation): void {
  for (const f of sim.friendlies) {
    sim.applyOrder({
      type: 'move', manId: f.id, target: { x: f.pos.x + 25, z: f.pos.z - 10 },
    });
  }
}

describe('movement and the doctrinal invariants', () => {
  it('a man bounds to his target and ends prone on it', () => {
    const sim = makeSim(0x5eed);
    const bell = sim.friendlies[2]!;
    const target = { x: bell.pos.x + 30, z: bell.pos.z };
    sim.applyOrder({ type: 'move', manId: bell.id, target });
    let stood = false;
    for (let t = 0; t < 120 * 60 && bell.moveTarget; t++) {
      sim.step();
      if (bell.stance === 'stand' && bell.bounding) stood = true;
    }
    expect(bell.moveTarget).toBeNull();
    expect(Math.hypot(bell.pos.x - target.x, bell.pos.z - target.z)).toBeLessThanOrEqual(1.5);
    expect(bell.stance).toBe('prone');
    expect(stood).toBe(true); // he was up and exposed while bounding
  });

  it('never more than MAX_SIMULTANEOUS_MOVERS bounding at any tick', () => {
    const sim = makeSim(0xbeef);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    orderSectionForward(sim);
    for (let t = 0; t < 90 * 60; t++) {
      sim.step();
      const movers = sim.friendlies.filter((f) => f.bounding).length;
      expect(movers).toBeLessThanOrEqual(MAX_SIMULTANEOUS_MOVERS);
    }
    // And the section did actually make ground.
    expect(sim.friendlies.some((f) => f.moveTarget === null)).toBe(true);
  });

  it('no move without fire: nobody bounds when the section cannot shoot', () => {
    const sim = makeSim(0xcafe);
    // Dry the whole section out — nobody can provide covering fire.
    for (const f of sim.friendlies) {
      f.ammo.currentMag = 0;
      f.ammo.spareMags = 0;
      f.ammo.bandolier = 0;
    }
    orderSectionForward(sim);
    for (let t = 0; t < 30 * 60; t++) {
      sim.step();
      expect(sim.friendlies.filter((f) => f.bounding).length).toBe(0);
    }
    // Orders still stand — the section is halted, not amnesiac.
    expect(sim.friendlies.every((f) => f.moveTarget !== null)).toBe(true);
  });

  it('a pinned man does not get up', () => {
    const sim = makeSim(0xdead);
    const marsh = sim.friendlies[5]!;
    sim.applyOrder({
      type: 'move', manId: marsh.id, target: { x: marsh.pos.x + 20, z: marsh.pos.z },
    });
    for (let t = 0; t < 10 * 60; t++) {
      marsh.suppression = 0.95; // held pinned throughout
      sim.step();
      expect(marsh.bounding).toBe(false);
    }
  });

  it('a casualty who cannot move lies where he fell', () => {
    const sim = makeSim(0xf00d);
    const novak = sim.friendlies[6]!;
    novak.wound = { severity: 'serious', location: 'thigh', atTick: 0, cryUntil: null };
    const before = { ...novak.pos };
    sim.applyOrder({
      type: 'move', manId: novak.id, target: { x: novak.pos.x + 20, z: novak.pos.z },
    });
    for (let t = 0; t < 10 * 60; t++) sim.step();
    expect(novak.pos).toEqual(before);
    expect(novak.moveTarget).toBeNull(); // the order never took
  });

  it('holds both invariants across 100 seeds (the Phase 7 gate)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const sim = makeSim(seed * 7919);
      sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
      orderSectionForward(sim);
      for (let t = 0; t < 20 * 60; t++) {
        sim.step();
        let movers = 0;
        let covering = 0;
        for (const f of sim.friendlies) {
          if (f.bounding) movers++;
        }
        expect(movers).toBeLessThanOrEqual(MAX_SIMULTANEOUS_MOVERS);
        // If anyone is moving, the covering-fire condition held when the
        // newest bound started; weak form checked every tick: movers>0
        // implies the section retains at least COVERING_FIRE_MIN men who
        // are not bounding and are alive.
        if (movers > 0) {
          for (const f of sim.friendlies) {
            if (!f.bounding && f.wound === null) covering++;
          }
          expect(covering).toBeGreaterThanOrEqual(COVERING_FIRE_MIN);
        }
      }
    }
  }, 120000);
});
