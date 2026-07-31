import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, type RngState } from '../../src/sim/rng';
import { World } from '../../src/sim/world';
import { Clock, type SpeedMultiplier } from '../../src/sim/clock';
import { FIXED_DT } from '../../src/sim/config';

// Determinism gate (design doc §12, Phase 1): byte-identical sim state
// after 10,000 ticks at all four speeds (1x/2x/4x/pause). This is the
// property the whole real-time-with-pause design depends on — see the
// fixed-timestep invariant in CLAUDE.md.
//
// "Pause" can't literally mean "10,000 ticks while paused" (paused
// advances zero ticks) — read here as a pause-INTERSPERSED schedule: the
// stronger version of the test, since it also proves pausing doesn't
// corrupt the accumulator.

interface DummyEntity {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SimState {
  rng: RngState;
  world: World<DummyEntity>;
}

const SEED = 0x5eed1234;
const TICKS = 10_000;
const ENTITY_COUNT = 8; // section-sized

function createState(seed: number): SimState {
  const rng = createRng(seed);
  const world = new World<DummyEntity>();
  for (let i = 0; i < ENTITY_COUNT; i++) {
    world.addEntity(`e${i}`, { x: 0, y: 0, vx: 0, vy: 0 });
  }
  return { rng, world };
}

// Stand-in for real sim logic (soldiers etc. arrive Phase 4+): touches the
// RNG and integrates position every tick, so both RNG state and world
// state are exercised by the gate.
function step(state: SimState, dt: number): void {
  for (const e of state.world.values()) {
    const jx = (nextFloat(state.rng) - 0.5) * 2;
    const jy = (nextFloat(state.rng) - 0.5) * 2;
    e.vx += jx * dt;
    e.vy += jy * dt;
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }
}

function normalizeZero(n: number): number {
  return n === 0 ? 0 : n; // collapse -0 to 0
}

function serialize(state: SimState, tickCount: number): Float64Array {
  const values: number[] = [tickCount, state.rng.state];
  for (const e of state.world.values()) {
    values.push(e.x, e.y, e.vx, e.vy);
  }
  return Float64Array.from(values, normalizeZero);
}

function assertNoNaN(buf: Float64Array): void {
  for (const v of buf) {
    if (Number.isNaN(v)) throw new Error('NaN in serialized sim state');
  }
}

function fnv1aHash(buf: Float64Array): string {
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function runReference(seed: number, ticks: number): string {
  const state = createState(seed);
  for (let i = 0; i < ticks; i++) step(state, FIXED_DT);
  const buf = serialize(state, ticks);
  assertNoNaN(buf);
  return fnv1aHash(buf);
}

// Drives the sim through the REAL clock with a jittered, non-uniform
// sequence of real-time frame deltas — not a loop of identical direct
// step() calls, which would pass trivially and prove nothing about the
// accumulator/multiplier interaction.
function runViaClock(
  seed: number,
  ticks: number,
  speedSchedule: (frameIndex: number) => SpeedMultiplier,
): string {
  const state = createState(seed);
  const clock = new Clock((dt) => step(state, dt));
  const deltaRng = createRng(0xc0ffee ^ seed);
  let frameIndex = 0;

  // Bulk phase: jittered frame deltas at the scheduled speed. Stops with
  // enough headroom (50 ticks, comfortably above the ~38-tick max a single
  // frame can produce at 4x with the jitter range below) that it can never
  // overshoot the target.
  while (clock.tickCount < ticks - 50) {
    clock.setSpeed(speedSchedule(frameIndex));
    const frameSeconds = 0.04 + nextFloat(deltaRng) * 0.12; // ~40-160ms of real time
    clock.advance(frameSeconds);
    frameIndex++;
  }

  // Final approach: close the remaining gap exactly, one fixed tick at a
  // time, so the run lands on precisely `ticks` for a byte-exact compare.
  clock.setSpeed(1);
  while (clock.tickCount < ticks) {
    clock.advance(FIXED_DT);
  }

  expect(clock.tickCount).toBe(ticks);
  const buf = serialize(state, clock.tickCount);
  assertNoNaN(buf);
  return fnv1aHash(buf);
}

describe('sim determinism gate', () => {
  const hRef = runReference(SEED, TICKS);

  it('reference run is stable across repeated direct step() calls', () => {
    expect(runReference(SEED, TICKS)).toBe(hRef);
  });

  it('1x through the real clock matches the reference hash', () => {
    expect(runViaClock(SEED, TICKS, () => 1)).toBe(hRef);
  });

  it('2x through the real clock matches the reference hash', () => {
    expect(runViaClock(SEED, TICKS, () => 2)).toBe(hRef);
  });

  it('4x through the real clock matches the reference hash', () => {
    expect(runViaClock(SEED, TICKS, () => 4)).toBe(hRef);
  });

  it('a pause-interspersed schedule matches the reference hash (pauses do not corrupt the accumulator)', () => {
    const cycle: SpeedMultiplier[] = [1, 0, 2, 0, 4, 0];
    expect(runViaClock(SEED, TICKS, (i) => cycle[i % cycle.length]!)).toBe(hRef);
  });
});
