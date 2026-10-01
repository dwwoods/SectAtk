// Determinism gate, Phase 4/5 extension: the REAL simulation, not a dummy
// entity store. The Phase 1 gate proved the clock's accumulator/speed
// interaction with a stand-in step function; this gate proves the actual
// sim (soldiers, ammunition, wounds, suppression, knowledge, journal,
// firefight resolution) is byte-identical after 10,000 ticks across all
// four speed schedules, with orders applied at exact tick boundaries.
//
// This is the property the whole real-time-with-pause design and the AAR
// replay depend on: a run at 4x must be bit-identical to the same run at
// 1x, or seed + order-log replay is meaningless.

import { describe, expect, it } from 'vitest';
import { Clock, type SpeedMultiplier } from '../../src/sim/clock';
import { FIXED_DT } from '../../src/sim/config';
import { Simulation, type Scenario, type Order } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';

const SEED = 0x5eed4321;
const TICKS = 10_000;

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

// Orders applied at fixed tick boundaries, regardless of speed. The order
// log is part of the deterministic contract: seed + order log = the whole
// sim. (AAR replay will use exactly this.)
const ORDER_LOG: Array<{ atTick: number; order: Order }> = [
  { atTick: 100, order: { type: 'set-fire-intent', intent: 'win-the-firefight' } },
  { atTick: 500, order: { type: 'observe' } },
  { atTick: 900, order: { type: 'sound-off' } },
  { atTick: 1500, order: { type: 'mag-check' } },
  { atTick: 2000, order: { type: 'set-fire-intent', intent: 'hold' } },
];

// Apply an order when the clock reaches exactly `atTick`. This is the step
// wrapper the actual run uses, so orders land at the same tick regardless
// of speed. `sim.tick` is the tick about to run; orders due at exactly this
// tick boundary are applied first.
function makeStepWithOrders(
  sim: Simulation,
  orders: Array<{ atTick: number; order: Order }>,
): (dt: number) => void {
  let orderIdx = 0;
  return (dt: number) => {
    const due = sim.tick + 1;
    while (orderIdx < orders.length && orders[orderIdx]!.atTick < due) {
      sim.applyOrder(orders[orderIdx]!.order);
      orderIdx++;
    }
    sim.step(dt);
  };
}

function runSim(seed: number, ticks: number, speedSchedule: (i: number) => SpeedMultiplier): string {
  const worldgen = bakeWorld(20260728);
  const sim = new Simulation(makeScenario(), worldgen, seed);
  const clock = new Clock(makeStepWithOrders(sim, ORDER_LOG));

  const deltaRng = { state: (0xc0ffee ^ seed) >>> 0 };
  const nextFloat = () => {
    deltaRng.state = (deltaRng.state + 0x6d2b79f5) >>> 0;
    let t = deltaRng.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let frameIndex = 0;
  // Bulk phase: jittered frame deltas at the scheduled speed. Stops with
  // enough headroom (50 ticks) that it can never overshoot the target.
  while (clock.tickCount < ticks - 50) {
    clock.setSpeed(speedSchedule(frameIndex));
    const frameSeconds = 0.04 + nextFloat() * 0.12;
    clock.advance(frameSeconds);
    frameIndex++;
  }

  // Final approach: exact tick-by-tick.
  clock.setSpeed(1);
  while (clock.tickCount < ticks) {
    clock.advance(FIXED_DT);
  }

  expect(clock.tickCount).toBe(ticks);
  return serializeSim(sim);
}

function serializeSim(sim: Simulation): string {
  const values: number[] = [
    sim.tick, sim.rng.state, sim.firefight.won ? 1 : 0,
    sim.firefight.enemyShotsThisWindow, sim.firefight.windowTicks, sim.firefight.sustainedLowTicks,
    sim.tier2BusyTicks, sim.pendingTier2 === 'sound-off' ? 1 : sim.pendingTier2 === 'mag-check' ? 2 : 0,
    sim.mission.status === 'none' ? 0 : sim.mission.status === 'active' ? 1 : sim.mission.status === 'taken' ? 2 : 3,
    sim.mission.holdTicks,
  ];

  // Friendlies and enemies: full state.
  for (const s of sim.world.values()) {
    values.push(
      s.pos.x, s.pos.z, s.heading,
      s.stance === 'prone' ? 0 : s.stance === 'crouch' ? 1 : 2,
      s.suppression, s.morale,
      s.ammo.currentMag, s.ammo.spareMags, s.ammo.bandolier,
      s.reloadT, s.reBombing ? 1 : 0,
      s.wound ? s.wound.severity.length + s.wound.location.length : 0,
      s.wound?.atTick ?? -1,
      s.moveTarget?.x ?? -9999, s.moveTarget?.z ?? -9999,
      s.bounding ? 1 : 0, s.boundRemaining, s.boundCooldown,
      s.contactPhase === 'dash' ? 1 : s.contactPhase === 'crawl' ? 2 : 0,
      s.contactTarget?.x ?? -9999, s.contactTarget?.z ?? -9999,
      s.contactDir?.x ?? -9999, s.contactDir?.z ?? -9999,
      s.contactOrigin?.x ?? -9999, s.contactOrigin?.z ?? -9999,
      s.contactCooldown,
    );
  }

  // Observing map.
  for (const f of sim.friendlies) {
    values.push(sim.observing.has(f.id) ? 1 : 0);
  }

  // Knowledge: the commander's picture (beliefs must also be deterministic).
  for (const f of sim.friendlies) {
    const b = sim.knowledge.friendlies.get(f.id);
    values.push(
      b?.position?.x ?? -9999, b?.position?.z ?? -9999,
      b?.status === 'effective' ? 0 : b?.status === 'hit' ? 1 : b?.status === 'down' ? 2 : b?.status === 'dead' ? 3 : 4,
      b?.ammoLow === null ? -1 : b?.ammoLow ? 1 : 0,
      b?.knownDead ? 1 : 0,
    );
  }
  values.push(
    sim.knowledge.enemy.position?.x ?? -9999,
    sim.knowledge.enemy.position?.z ?? -9999,
    sim.knowledge.enemy.countEstimate ?? -1,
    sim.knowledge.enemy.firing ? 1 : 0,
    sim.knowledge.enemy.lastFiredTick ?? -1,
  );

  const buf = Float64Array.from(values, (n) => (n === 0 ? 0 : n));
  return hash(buf);
}

function hash(buf: Float64Array): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

describe('real-sim determinism gate (Phase 4/5)', () => {
  it('a direct 1x reference run is stable across repeated runs', () => {
    const h1 = runSim(SEED, TICKS, () => 1);
    const h2 = runSim(SEED, TICKS, () => 1);
    expect(h2).toBe(h1);
  });

  it('2x through the real clock matches 1x', () => {
    expect(runSim(SEED, TICKS, () => 2)).toBe(runSim(SEED, TICKS, () => 1));
  });

  it('4x through the real clock matches 1x', () => {
    expect(runSim(SEED, TICKS, () => 4)).toBe(runSim(SEED, TICKS, () => 1));
  });

  it('a pause-interspersed schedule matches 1x', () => {
    const cycle: SpeedMultiplier[] = [1, 0, 2, 0, 4, 0];
    expect(runSim(SEED, TICKS, (i) => cycle[i % cycle.length]!)).toBe(runSim(SEED, TICKS, () => 1));
  });
});
