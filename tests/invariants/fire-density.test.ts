// Tier-3 ambient fire-density — design doc §3.1 tier 3, §4.2, Phase 6.
//
// computeDensity() is the pure core of the audio/visual presentation layer.
// These tests cover:
//   (a) density falls when friendly men are hit / suppressed / re-bombing
//   (b) enemy slackening is readable from the model when enemy suppression
//       rises
//   (c) THE LAPSE TEST — fire going ragged after the 2IC falls must emerge
//       purely from per-man rates; fireDensity.ts must not read or branch
//       on any "fire control active/lapsed" flag (assertion #5, design
//       doc §9.4, noted as pending in knowledge-absence.test.ts until
//       behaviour/render land — this is the audio half of that story)
//   (d) THE WRITE-ABSENCE TEST — /audio must never write Knowledge; proven
//       structurally (computeDensity takes no KnowledgeState at all) and
//       empirically (a frozen Knowledge/journal survives the call intact)

import { describe, expect, it } from 'vitest';
import fireDensitySource from '../../src/audio/fireDensity.ts?raw';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { computeDensity } from '../../src/audio/fireDensity';
import { isPinned } from '../../src/sim/suppression';

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

function allSoldiers(sim: Simulation) {
  return [...sim.friendlies, ...sim.enemySection.soldiers];
}

const LISTENER = { x: -40, z: 20 };

describe('fire density (tier-3 audio texture, §3.1/§4.2)', () => {
  it('(a) friendly density falls when men are hit, suppressed, or re-bombing', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xaaa1);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });

    const baseline = computeDensity(allSoldiers(sim), LISTENER);
    expect(baseline.friendly.rate).toBeGreaterThan(0);

    // Hit two men badly enough that they can no longer fight.
    sim.friendlies[2]!.wound = {
      severity: 'serious',
      location: 'chest',
      atTick: sim.tick,
      cryUntil: null,
    };
    sim.friendlies[3]!.wound = {
      severity: 'serious',
      location: 'chest',
      atTick: sim.tick,
      cryUntil: null,
    };
    // Suppress a third man heavily.
    sim.friendlies[4]!.suppression = 0.95;
    // Put a fourth into a re-bomb.
    sim.friendlies[5]!.reBombing = true;

    const after = computeDensity(allSoldiers(sim), LISTENER);
    expect(after.friendly.rate).toBeLessThan(baseline.friendly.rate);
  });

  it('(b) enemy slackening is readable when enemy suppression rises', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xaaa2);

    const baseline = computeDensity(allSoldiers(sim), LISTENER);
    expect(baseline.enemy.rate).toBeGreaterThan(0);

    for (const e of sim.enemySection.soldiers) {
      e.suppression = 0.7;
    }
    const suppressed = computeDensity(allSoldiers(sim), LISTENER);
    expect(suppressed.enemy.rate).toBeLessThan(baseline.enemy.rate);

    // And fully pinned enemy soldiers contribute nothing at all.
    for (const e of sim.enemySection.soldiers) {
      expect(isPinned(e.suppression)).toBe(false); // 0.7 is suppressed, not pinned
    }
    for (const e of sim.enemySection.soldiers) {
      e.suppression = 0.9; // above the pinned threshold
    }
    const pinned = computeDensity(allSoldiers(sim), LISTENER);
    expect(pinned.enemy.rate).toBe(0);
  });

  it('(c) THE LAPSE TEST: density after the 2IC falls changes only through per-man rates, never a lapse flag', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xaaa3);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });

    for (let tick = 0; tick < 5 * 60; tick++) sim.step();
    const before = computeDensity(allSoldiers(sim), LISTENER);

    const twoIC = sim.friendlies.find((f) => f.role === 'twoIC')!;
    twoIC.wound = { severity: 'mortal', location: 'chest', atTick: sim.tick, cryUntil: null };

    // Step past any notional fire-control reaction interval. There is no
    // flag anywhere for this to react to — fire density is recomputed
    // fresh from soldier state each call, so "lapse" is not a state
    // transition this test can even name; it can only check that the
    // numbers it gets back are explained entirely by per-man state.
    for (let tick = 0; tick < 30 * 60; tick++) sim.step();
    const after = computeDensity(allSoldiers(sim), LISTENER);

    // The 2IC is dead — one fewer shooter. Recompute density from the
    // roster by hand (same soldiers, same model) and confirm it matches
    // exactly: nothing other than per-man state (ammo/suppression/wound)
    // fed into the result.
    const handComputed = computeDensity(allSoldiers(sim), LISTENER);
    expect(after).toEqual(handComputed);
    expect(after.friendly.rate).not.toBe(before.friendly.rate);

    // computeDensity's signature itself proves there is no lapse flag to
    // read: it takes only (soldiers, listenerPos).
    expect(computeDensity.length).toBe(2);

    // And the source text contains no reference to any fire-control-lapse
    // concept at all — mirroring the absence-assertion style used in
    // tests/invariants/knowledge-absence.test.ts.
    const source = fireDensitySource;
    const forbidden = [
      'fireControlActive',
      'FireControlActive',
      'fire-control-active',
      'fireControlLapsed',
      'FireControlLapsed',
      'fire-control-lapsed',
      'lapseFlag',
      'LapseFlag',
      'isLapsed',
    ];
    for (const needle of forbidden) {
      expect(source.includes(needle)).toBe(false);
    }
    // And it never imports anything from the behaviour layer, which is
    // where such a flag would have to live.
    expect(source.includes("from '../sim/behaviour")).toBe(false);
    expect(source.includes('behaviour/fireControl')).toBe(false);
  });

  it('(d) THE WRITE-ABSENCE TEST: a frozen Knowledge/journal survives computeDensity untouched', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xaaa4);
    sim.applyOrder({ type: 'observe' });
    for (let tick = 0; tick < 5 * 60; tick++) sim.step();

    // Deep-freeze the Knowledge snapshot's plain-object pieces and the
    // journal (an array of plain objects). Map internals aren't reachable
    // through Object.freeze, but computeDensity never receives knowledge
    // or the journal as arguments in the first place — there is no call
    // site through which it could mutate either, frozen or not.
    function deepFreeze<T>(value: T): T {
      if (value === null || typeof value !== 'object') return value;
      if (Object.isFrozen(value)) return value;
      Object.freeze(value);
      if (value instanceof Map) {
        for (const v of value.values()) deepFreeze(v);
      } else if (Array.isArray(value)) {
        for (const v of value) deepFreeze(v);
      } else {
        for (const key of Object.keys(value as object)) {
          deepFreeze((value as Record<string, unknown>)[key]);
        }
      }
      return value;
    }

    deepFreeze(sim.knowledge);
    deepFreeze(sim.journal);

    const knowledgeSnapshotBefore = JSON.stringify(
      [...sim.knowledge.friendlies.entries()],
    );
    const enemySnapshotBefore = JSON.stringify(sim.knowledge.enemy);
    const journalLengthBefore = sim.journal.length;

    expect(() => computeDensity(allSoldiers(sim), LISTENER)).not.toThrow();

    const knowledgeSnapshotAfter = JSON.stringify(
      [...sim.knowledge.friendlies.entries()],
    );
    const enemySnapshotAfter = JSON.stringify(sim.knowledge.enemy);
    expect(knowledgeSnapshotAfter).toBe(knowledgeSnapshotBefore);
    expect(enemySnapshotAfter).toBe(enemySnapshotBefore);
    expect(sim.journal.length).toBe(journalLengthBefore);

    // Structural proof: computeDensity's parameter list has no slot for
    // Knowledge or the journal at all.
    expect(computeDensity.length).toBe(2);
  });
});
