// Belief uncertainty radius + relayed-observation latency (design doc
// §3.1). The commander never reads ground truth coordinates — only a
// bearing/range idiom bounded by an honest uncertainty radius, and a
// sighting made by anyone other than the commander himself carries
// latency and can be wrong before it reaches him.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { Clock, type SpeedMultiplier } from '../../src/sim/clock';
import {
  createKnowledge,
  updateEnemyPosition,
  type Journal,
  type Evidence,
} from '../../src/sim/knowledge/knowledge';
import {
  FIXED_DT,
  BELIEF_RADIUS_FLASH,
  BELIEF_RADIUS_AUDIBLE,
  BELIEF_RADIUS_MIN,
  RELAY_BEARING_ERROR_DEG,
} from '../../src/sim/config';
import type { Vec2 } from '../../src/sim/types';

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

/** Put a man other than the commander on watch. There is no 'observe this
    man' order in the MVP order surface, so the test drives the observing
    map (and the stance the act implies) directly. */
function putOnWatch(sim: Simulation, manId: string): void {
  sim.observing.set(manId, true);
  const man = sim.world.getEntity(manId)!;
  man.stance = 'stand';
}

describe('belief uncertainty radius (knowledge.ts unit level)', () => {
  it('a flash (observation kind) sets the tight radius; any other kind sets the coarse one', () => {
    const flash = createKnowledge([]);
    const flashJournal: Journal = [];
    const flashEvidence: Evidence = { kind: 'observation', tick: 1, sourceId: 'x', note: 'flash' };
    updateEnemyPosition(flash, flashJournal, { x: 10, z: 10 }, flashEvidence);
    expect(flash.enemy.uncertaintyRadius).toBe(BELIEF_RADIUS_FLASH);

    // No audible-enemy call site exists yet (deliberately — see
    // BELIEF_RADIUS_AUDIBLE in config.ts). This exercises the generic
    // kind-based radius selection directly, ahead of that channel landing.
    const audible = createKnowledge([]);
    const audibleJournal: Journal = [];
    const audibleEvidence: Evidence = { kind: 'cry', tick: 1, sourceId: 'x', note: 'a sound, not a sighting' };
    updateEnemyPosition(audible, audibleJournal, { x: 10, z: 10 }, audibleEvidence);
    expect(audible.enemy.uncertaintyRadius).toBe(BELIEF_RADIUS_AUDIBLE);
  });

  it('repeated consistent sightings tighten the radius multiplicatively down to the floor', () => {
    const k = createKnowledge([]);
    const journal: Journal = [];
    const evidenceAt = (tick: number): Evidence => ({ kind: 'observation', tick, sourceId: 'x', note: 'flash' });

    updateEnemyPosition(k, journal, { x: 100, z: 0 }, evidenceAt(1));
    expect(k.enemy.uncertaintyRadius).toBe(BELIEF_RADIUS_FLASH);

    let prev = BELIEF_RADIUS_FLASH;
    for (let tick = 2; tick < 20; tick++) {
      updateEnemyPosition(k, journal, { x: 100, z: 0 }, evidenceAt(tick));
      const r = k.enemy.uncertaintyRadius!;
      expect(r).toBeLessThanOrEqual(prev);
      expect(r).toBeGreaterThanOrEqual(BELIEF_RADIUS_MIN);
      prev = r;
    }
    expect(k.enemy.uncertaintyRadius).toBe(BELIEF_RADIUS_MIN);

    // Every radius change is its own journal entry (one-field-per-entry).
    const radiusEntries = journal.filter((e) => e.subject === 'enemy' && e.field === 'uncertaintyRadius');
    expect(radiusEntries.length).toBeGreaterThan(1);
  });

  it('a fix outside the standing radius resets to the base radius rather than tightening', () => {
    const k = createKnowledge([]);
    const journal: Journal = [];
    updateEnemyPosition(k, journal, { x: 0, z: 0 }, { kind: 'observation', tick: 1, sourceId: 'x', note: 'a' });
    updateEnemyPosition(k, journal, { x: 0, z: 0 }, { kind: 'observation', tick: 2, sourceId: 'x', note: 'a' });
    expect(k.enemy.uncertaintyRadius).toBeLessThan(BELIEF_RADIUS_FLASH);

    // Far outside the tightened radius — a fresh, uncorroborated read.
    updateEnemyPosition(k, journal, { x: 1000, z: 1000 }, { kind: 'observation', tick: 3, sourceId: 'x', note: 'a' });
    expect(k.enemy.uncertaintyRadius).toBe(BELIEF_RADIUS_FLASH);
  });
});

describe('relayed-observation latency (design doc §3.1)', () => {
  it("the commander's own sighting writes Knowledge instantly — no relay queue involved", () => {
    const sim = new Simulation(makeScenario(), bakeWorld(20260728), 0xc0de);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    sim.applyOrder({ type: 'observe' }); // the commander himself

    let sawInstantSighting = false;
    for (let t = 0; t < 90 * 60; t++) {
      sim.step();
      if (sim.knowledge.enemy.position) {
        sawInstantSighting = true;
        break;
      }
    }
    expect(sawInstantSighting).toBe(true);
    expect(sim.relayQueue.length).toBe(0);
  });

  it('a relayed sighting (not the commander) is queued, lands RELAY_DELAY_TICKS later, and the belief is unchanged until it does', () => {
    const sim = new Simulation(makeScenario(), bakeWorld(20260728), 0xfeed);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    putOnWatch(sim, 'sec-3'); // Pte. Bell — NOT the commander

    let queuedTick: number | null = null;
    let landTick: number | null = null;
    let reportedPos: Vec2 | null = null;
    let observerPosAtQueue: Vec2 | null = null;

    for (let t = 0; t < 90 * 60 && queuedTick === null; t++) {
      sim.step();
      if (sim.relayQueue.length > 0) {
        const relay = sim.relayQueue[0]!;
        queuedTick = sim.tick;
        landTick = relay.landTick;
        reportedPos = { ...relay.position };
        const observer = sim.world.getEntity('sec-3')!;
        observerPosAtQueue = { x: observer.pos.x, z: observer.pos.z };
      }
    }

    expect(queuedTick).not.toBeNull();
    expect(landTick).not.toBeNull();
    expect(landTick! - queuedTick!).toBeGreaterThan(0);

    // The commander himself is not observing in this run — the relay is
    // the only path to a sighting. Belief must stay null right up to (but
    // not including) landTick.
    while (sim.tick < landTick! - 1) {
      expect(sim.knowledge.enemy.position).toBeNull();
      sim.step();
    }
    expect(sim.knowledge.enemy.position).toBeNull();

    sim.step(); // this tick === landTick: the relay drains into Knowledge
    expect(sim.tick).toBe(landTick);
    expect(sim.knowledge.enemy.position).not.toBeNull();
    // The due relay drained. Bell is still on watch, so NEWER relays may
    // already be queued behind it — but none of them is due yet.
    expect(sim.relayQueue.every((r) => r.landTick > sim.tick)).toBe(true);

    // Bounded error: the reported bearing (from the observer's position at
    // the moment he reported it) is within RELAY_BEARING_ERROR_DEG of the
    // true bearing to the enemy's (static) centroid, plus a small
    // allowance for the enemy section's own spread around that centroid.
    const centroid = { x: 60, z: -10 };
    const trueBearingDeg =
      (Math.atan2(centroid.z - observerPosAtQueue!.z, centroid.x - observerPosAtQueue!.x) * 180) / Math.PI;
    const reportedBearingDeg =
      (Math.atan2(reportedPos!.z - observerPosAtQueue!.z, reportedPos!.x - observerPosAtQueue!.x) * 180) / Math.PI;
    let diff = Math.abs(reportedBearingDeg - trueBearingDeg) % 360;
    if (diff > 180) diff = 360 - diff;
    expect(diff).toBeLessThanOrEqual(RELAY_BEARING_ERROR_DEG + 5); // +5: enemy-spread allowance
  });
});

describe('relay queue determinism', () => {
  function serialize(sim: Simulation): string {
    const values: number[] = [
      sim.tick,
      sim.knowledge.enemy.position?.x ?? -9999,
      sim.knowledge.enemy.position?.z ?? -9999,
      sim.knowledge.enemy.uncertaintyRadius ?? -1,
      sim.knowledge.enemy.firing ? 1 : 0,
      sim.knowledge.enemy.lastFiredTick ?? -1,
      sim.relayQueue.length,
    ];
    for (const r of sim.relayQueue) {
      const observerIndex = sim.friendlies.findIndex((f) => f.id === r.observerId);
      values.push(r.landTick, observerIndex, r.position.x, r.position.z);
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

  function runSim(ticks: number, speed: SpeedMultiplier): string {
    const sim = new Simulation(makeScenario(), bakeWorld(20260728), 0x5eed4321);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    putOnWatch(sim, 'sec-3'); // relay path, not the commander
    const clock = new Clock((dt) => sim.step(dt));
    clock.setSpeed(speed);
    while (clock.tickCount < ticks) {
      clock.advance(FIXED_DT * 2); // a couple of ticks' worth per frame at 1x
    }
    return serialize(sim);
  }

  it('a run with a populated relay queue is bit-identical at 1x and 2x', () => {
    const TICKS = 3000;
    expect(runSim(TICKS, 2)).toBe(runSim(TICKS, 1));
  });
});
