// AAR derivability — replaying the journal must reproduce the live
// Knowledge exactly. The belief snapshot is DERIVED state (design doc
// §3.4); if any code path writes a belief without journaling it, the
// equality here breaks while every other test stays green. This is the
// absence-style assert for the journal's completeness.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { beliefAtTick } from '../../src/aar/replay';
import type { KnowledgeState } from '../../src/sim/knowledge/knowledge';

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

function section(): Array<{ id: string; name: string }> {
  return makeScenario().friendlyStart.map((f, i) => ({ id: `sec-${i + 1}`, name: f.name }));
}

function snapshot(k: KnowledgeState): unknown {
  return {
    friendlies: [...k.friendlies.values()].map((b) => ({ ...b, position: b.position ? { ...b.position } : null })),
    enemy: { ...k.enemy },
  };
}

/** A busy 90 seconds: rapid fire both ways, the commander observing,
    sound-offs and mag-checks — maximum journal traffic. */
function runBusyFirefight(seed: number): Simulation {
  const sim = new Simulation(makeScenario(), bakeWorld(20260728), seed);
  sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
  sim.applyOrder({ type: 'observe' });
  for (let t = 0; t < 90 * 60; t++) {
    if (t === 15 * 60) sim.applyOrder({ type: 'sound-off' });
    if (t === 25 * 60) sim.applyOrder({ type: 'mag-check' });
    if (t === 40 * 60) sim.applyOrder({ type: 'sound-off' });
    if (t === 50 * 60) sim.applyOrder({ type: 'observe' });
    sim.step();
  }
  return sim;
}

describe('AAR replay (journal derivability)', () => {
  it('replaying the journal reproduces the live Knowledge exactly', () => {
    for (const seed of [0xbeef, 0xcafe, 0x5eed]) {
      const sim = runBusyFirefight(seed);
      expect(sim.journal.length).toBeGreaterThan(0); // the run was eventful
      const replayed = beliefAtTick(sim.journal, section());
      expect(snapshot(replayed)).toEqual(snapshot(sim.knowledge));
    }
  });

  it('beliefAtTick gives the picture as it stood, not as it ended', () => {
    const sim = runBusyFirefight(0xf00d);
    const firstTick = sim.journal[0]!.tick;
    // Before the first entry, the commander believed nothing.
    const blank = beliefAtTick(sim.journal, section(), firstTick - 1);
    expect(blank.enemy.position).toBeNull();
    for (const b of blank.friendlies.values()) {
      expect(b.status).toBe('unknown');
    }
    // Mid-run snapshots are monotone in journal coverage: each later
    // snapshot incorporates at least as many entries.
    const mid = beliefAtTick(sim.journal, section(), Math.floor(45 * 60));
    const end = beliefAtTick(sim.journal, section());
    const known = (k: KnowledgeState) =>
      [...k.friendlies.values()].filter((b) => b.status !== 'unknown').length +
      (k.enemy.position ? 1 : 0);
    expect(known(end)).toBeGreaterThanOrEqual(known(mid));
  });

  it('journal ticks are monotone (append-only, tick-ordered)', () => {
    const sim = runBusyFirefight(0xab1e);
    for (let i = 1; i < sim.journal.length; i++) {
      expect(sim.journal[i]!.tick).toBeGreaterThanOrEqual(sim.journal[i - 1]!.tick);
    }
  });
});
