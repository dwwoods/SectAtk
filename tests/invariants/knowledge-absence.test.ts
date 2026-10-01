// Knowledge absence assertions — the spine of the information design
// (design doc §9.4). These are the assertions that would catch a silent
// leak destroying the core mechanic while every other test stayed green:
//
//  #3  Every belief in the journal traces to a specific piece of evidence.
//  #4  A silent-wound casualty produces no push-channel evidence.
//  #6  Enemy ammunition state is never exposed to the commander's Knowledge.
//
// (Assertions #1 markers-never-read-truth, #2 no-orders-on-unknown-info,
// and #5 no-notification-on-fire-control-lapse need render and behaviour
// modules and land with their phases — noted in docs/iteration-notes.md.)

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { createRng } from '../../src/sim/rng';
import { processSoundOff } from '../../src/sim/knowledge/elicited';
import {
  assertEveryEntryHasEvidence,
  assertNoEnemyAmmoInJournal,
} from '../../src/sim/knowledge/journal';
import type { Evidence } from '../../src/sim/knowledge/knowledge';

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

describe('knowledge assertions (§9.4)', () => {
  it('#3: every journal entry has evidence', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xabc);
    sim.applyOrder({ type: 'observe' });

    for (let tick = 0; tick < 30 * 60; tick++) {
      sim.step();
      if (tick % (20 * 60) === 0) {
        sim.applyOrder({ type: 'sound-off' });
        sim.applyOrder({ type: 'mag-check' });
      }
    }

    expect(() => assertEveryEntryHasEvidence(sim.journal)).not.toThrow();
    expect(sim.journal.length).toBeGreaterThan(0);
  });

  it('#4: silent-wound casualty produces no push-channel evidence', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xdef);
    const target = sim.friendlies[2]!;

    // Give him a silent wound (fatal CNS, throat) directly — the sim truth.
    target.wound = { severity: 'fatal-cns', location: 'throat', atTick: sim.tick, cryUntil: null };

    // Run the sim forward. The commander does NOT observe (no risk spent),
    // so no observation evidence can exist.
    for (let tick = 0; tick < 20 * 60; tick++) {
      sim.step();
    }

    // No journal entries about this man at all — no observation, no cry.
    expect(sim.journal.filter((e) => e.subject === target.id)).toHaveLength(0);

    // His knowledge status is still 'unknown'.
    const belief = sim.knowledge.friendlies.get(target.id)!;
    expect(belief.status).toBe('unknown');
    expect(belief.knownDead).toBe(false);
  });

  it('#4b: sound-off against silent casualty gives ambiguous "unknown"', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xdead);
    const target = sim.friendlies[2]!;
    target.wound = { severity: 'fatal-cns', location: 'throat', atTick: sim.tick, cryUntil: null };

    const result = processSoundOff(sim, sim.knowledge, sim.journal, createRng(0xbeef));
    expect(result.noAnswer).toContain(target.id);

    const belief = sim.knowledge.friendlies.get(target.id)!;
    expect(belief.status).toBe('unknown');
    expect(belief.knownDead).toBe(false);

    // The silence entry has evidence — the call was made and nothing came back.
    expect(() => assertEveryEntryHasEvidence(sim.journal)).not.toThrow();
  });

  it('#6: enemy ammunition never enters Knowledge or journal', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0x1234);
    sim.applyOrder({ type: 'observe' });

    for (let tick = 0; tick < 30 * 60; tick++) {
      sim.step();
    }

    expect(() => assertNoEnemyAmmoInJournal(sim.journal)).not.toThrow();
    expect(Object.hasOwn(sim.knowledge.enemy, 'ammo')).toBe(false);
  });

  it('#7: journal evidence kinds are all legitimate channel kinds', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0x999);
    sim.applyOrder({ type: 'observe' });

    for (let tick = 0; tick < 15 * 60; tick++) {
      sim.step();
      if (tick % (7 * 60) === 0) sim.applyOrder({ type: 'mag-check' });
    }

    const legalKinds: Evidence['kind'][] = ['observation', 'cry', 'sound-off', 'mag-check', 'silence'];
    for (const entry of sim.journal) {
      expect(legalKinds).toContain(entry.evidence.kind);
    }
  });
});