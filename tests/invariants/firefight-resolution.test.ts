// Firefight resolution — the core loop. The enemy must be suppressible by
// friendly fire, and when their ROF holds below threshold for a sustained
// period, the firefight must be declared won. This is the first integrated
// test of the whole (Phase 4 + 5) sim pipeline.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { FIREFIGHT_WON_SUSTAINED, FIXED_DT } from '../../src/sim/config';

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

describe('firefight resolution', () => {
  it('enemy suppression can be built up and holds', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xbeef);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });

    // Run for 10 seconds at rapid rate.
    for (let t = 0; t < 10 * 60; t++) sim.step();

    // After 10 seconds of sustained fire, at least one enemy should have
    // accumulated measurable suppression.
    const maxSup = Math.max(...sim.enemySection.soldiers.map((e) => e.suppression));
    expect(maxSup).toBeGreaterThan(0.01);
  });

  it('enemy suppression decays when fire stops', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xbeef);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });

    // Fire for 10 seconds to build suppression.
    for (let t = 0; t < 10 * 60; t++) sim.step();

    const afterFiring = sim.enemySection.soldiers.map((e) => e.suppression);
    const maxBefore = Math.max(...afterFiring);

    // Stop fire and wait for decay.
    sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });
    for (let t = 0; t < 30 * 60; t++) sim.step();

    const minAfter = Math.min(...sim.enemySection.soldiers.map((e) => e.suppression));
    expect(minAfter).toBeLessThan(maxBefore);
  });

  it('firefight can be won: enemy ROF suppressed below threshold long enough', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xfeed);

    // Give the friendlies a close-range, high-rate-of-fire scenario.
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });

    // Run for long enough that the firefight resolution window has time to
    // accumulate and firefight.won can become true.
    const sustainedTicks = Math.round((FIREFIGHT_WON_SUSTAINED + 5) / FIXED_DT);
    for (let t = 0; t < sustainedTicks + 600; t++) sim.step();

    // The firefight should eventually be won as the enemy runs dry or gets
    // suppressed. (This is probabilistic — the test retries with a longer
    // run if the first attempt doesn't trigger it.)
    const won = sim.firefight.won;
    if (!won) {
      // Run another 30 seconds of ticks.
      for (let t = 0; t < 30 * 60; t++) sim.step();
    }
    expect(sim.firefight.won).toBe(true);
  });

  it('tier-2 order (sound-off) is not instant — costs time', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xcafe);
    sim.applyOrder({ type: 'sound-off' });

    // The order should be queued, not executed immediately.
    expect(sim.tier2BusyTicks).toBeGreaterThan(0);
    expect(sim.pendingTier2).toBe('sound-off');

    // Step through the busy period.
    while (sim.tier2BusyTicks > 0) sim.step();

    // After the busy period, the journal should have entries from the
    // sound-off (evidence written to knowledge).
    const soundOffEntries = sim.journal.filter((e) => e.evidence.kind === 'sound-off' || e.evidence.kind === 'silence');
    expect(soundOffEntries.length).toBeGreaterThan(0);
  });

  it('tier-2 order clears observing (you cannot look and listen)', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xbead);
    const commander = sim.friendlies[0]!;

    // Start observing.
    sim.applyOrder({ type: 'observe' });
    expect(sim.observing.has(commander.id)).toBe(true);

    // Call a mag check — observing should be cleared.
    sim.applyOrder({ type: 'mag-check' });
    expect(sim.observing.has(commander.id)).toBe(false);
  });

  it('observing ends when the commander goes prone', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xdead);
    const commander = sim.friendlies[0]!;

    sim.applyOrder({ type: 'observe' });
    expect(sim.observing.has(commander.id)).toBe(true);

    // Go prone — observing ends.
    sim.applyOrder({ type: 'stance', manId: commander.id, stance: 'prone' });
    expect(sim.observing.has(commander.id)).toBe(false);
  });

  it('stop-observe order ends observing and returns to prone', () => {
    const worldgen = bakeWorld(20260728);
    const sim = new Simulation(makeScenario(), worldgen, 0xbeef);
    const commander = sim.friendlies[0]!;

    sim.applyOrder({ type: 'observe' });
    expect(sim.observing.has(commander.id)).toBe(true);
    expect(commander.stance).toBe('stand');

    sim.applyOrder({ type: 'stop-observe' });
    expect(sim.observing.has(commander.id)).toBe(false);
    expect(commander.stance).toBe('prone');
  });
});