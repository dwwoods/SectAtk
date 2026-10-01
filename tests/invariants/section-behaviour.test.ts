// Section layer + the commander's appreciation (Phase 7). The decision
// tree reads Knowledge ONLY — enforced by signature and exercised here —
// and the section verbs (form-baseline, withdraw) translate into move
// targets executed under the same doctrinal invariants as any bound.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { appreciate } from '../../src/sim/behaviour/decisionTree';
import {
  createKnowledge,
  updateEnemyPosition,
  type Journal,
  type Evidence,
} from '../../src/sim/knowledge/knowledge';
import {
  WITHDRAW_STRENGTH_ESTIMATE,
  BASELINE_SPACING,
  MAX_SIMULTANEOUS_MOVERS,
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

function section(): Array<{ id: string; name: string }> {
  return makeScenario().friendlyStart.map((f, i) => ({ id: `sec-${i + 1}`, name: f.name }));
}

function evidence(tick = 1): Evidence {
  return { kind: 'observation', tick, sourceId: 'sec-1', note: 'test evidence' };
}

describe('commander appreciation (decision tree over Knowledge only)', () => {
  it('withdraws when the enemy is not located', () => {
    const k = createKnowledge(section());
    const r = appreciate(k);
    expect(r.decision).toBe('withdraw');
    expect(r.trail).toEqual(['root']);
  });

  it('holds when the enemy is located, believed weak, and the section believed strong', () => {
    const k = createKnowledge(section());
    const j: Journal = [];
    updateEnemyPosition(k, j, { x: 60, z: -10 }, evidence());
    const r = appreciate(k);
    expect(r.decision).toBe('hold');
    expect(r.trail).toEqual(['root', 'strength', 'own-state']);
  });

  it('withdraws when the BELIEVED enemy strength is too high — truth is irrelevant', () => {
    const k = createKnowledge(section());
    const j: Journal = [];
    updateEnemyPosition(k, j, { x: 60, z: -10 }, evidence());
    k.enemy.countEstimate = WITHDRAW_STRENGTH_ESTIMATE; // believed, not true
    expect(appreciate(k).decision).toBe('withdraw');
  });

  it('withdraws when the commander believes too few effectives remain', () => {
    const k = createKnowledge(section());
    const j: Journal = [];
    updateEnemyPosition(k, j, { x: 60, z: -10 }, evidence());
    let downed = 0;
    for (const b of k.friendlies.values()) {
      if (downed >= 4) break;
      b.status = 'down';
      downed++;
    }
    expect(appreciate(k).decision).toBe('withdraw');
  });
});

describe('section verbs', () => {
  it('form-baseline is a no-op until the enemy is located in Knowledge', () => {
    const sim = new Simulation(makeScenario(), world, 0xaaaa);
    sim.applyOrder({ type: 'form-baseline' });
    expect(sim.friendlies.every((f) => f.moveTarget === null)).toBe(true);
  });

  it('form-baseline shakes the section out into a spaced line on the believed bearing', () => {
    const sim = new Simulation(makeScenario(), world, 0xbbbb);
    const j: Journal = [];
    updateEnemyPosition(sim.knowledge, j, { x: 60, z: -10 }, evidence());
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    sim.applyOrder({ type: 'form-baseline' });
    expect(sim.friendlies.some((f) => f.moveTarget !== null)).toBe(true);

    for (let t = 0; t < 180 * 60; t++) {
      sim.step();
      expect(sim.friendlies.filter((f) => f.bounding).length)
        .toBeLessThanOrEqual(MAX_SIMULTANEOUS_MOVERS);
      if (sim.friendlies.every((f) => f.moveTarget === null)) break;
    }

    // The able men who completed the shake-out sit on a line perpendicular
    // to the (believed) threat bearing, roughly BASELINE_SPACING apart:
    // project onto the bearing axis — spread along it should be tiny
    // compared to the spread across it.
    const arrived = sim.friendlies.filter((f) => f.moveTarget === null && !f.wound);
    expect(arrived.length).toBeGreaterThanOrEqual(6);
    const bearing = Math.atan2(-10 - 22, 60 - -42); // threat from centroid-ish
    const along: number[] = [];
    const across: number[] = [];
    for (const f of arrived) {
      along.push(f.pos.x * Math.cos(bearing) + f.pos.z * Math.sin(bearing));
      across.push(-f.pos.x * Math.sin(bearing) + f.pos.z * Math.cos(bearing));
    }
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(along)).toBeLessThan(BASELINE_SPACING * 2);
    expect(spread(across)).toBeGreaterThan(BASELINE_SPACING * (arrived.length - 2));
  });

  it('withdraw moves the section away and leaves immobile casualties where they fell', () => {
    const sim = new Simulation(makeScenario(), world, 0xcccc);
    const novak = sim.friendlies[6]!;
    novak.wound = { severity: 'serious', location: 'thigh', atTick: 0, cryUntil: null };
    const novakPos = { ...novak.pos };
    const enemy = { x: 60, z: -10 };
    const distBefore = sim.friendlies
      .filter((f) => f !== novak)
      .map((f) => Math.hypot(f.pos.x - enemy.x, f.pos.z - enemy.z));

    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    sim.applyOrder({ type: 'withdraw', rally: { x: -120, z: 60 } });
    expect(novak.moveTarget).toBeNull(); // he is not on the move order

    for (let t = 0; t < 240 * 60; t++) {
      sim.step();
      if (sim.friendlies.every((f) => f.moveTarget === null)) break;
    }

    expect(novak.pos).toEqual(novakPos);
    const distAfter = sim.friendlies
      .filter((f) => f !== novak)
      .map((f) => Math.hypot(f.pos.x - enemy.x, f.pos.z - enemy.z));
    for (let i = 0; i < distAfter.length; i++) {
      expect(distAfter[i]!).toBeGreaterThan(distBefore[i]!);
    }
  });
});
