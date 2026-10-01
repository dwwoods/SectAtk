// Fire control — the 2IC's layer (design doc §4). Intent propagates
// through him with ammunition discipline, re-bombing is rotated and
// capped, and when he goes down ALL of it stops — silently. The silence
// assert is the load-bearing one: §9.4 "No notification is emitted when
// fire control lapses." A leak would quietly destroy §4.2 while every
// other test stayed green.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import {
  REBOMB_MAX_CONCURRENT,
  FIRE_DISCIPLINE_LOW_MAGS,
  REBOMB_TRIGGER_MAGS,
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

function makeSim(seed = 0xf1fe): Simulation {
  return new Simulation(makeScenario(), bakeWorld(20260728), seed);
}

function twoIC(sim: Simulation) {
  return sim.friendlies.find((f) => f.role === 'twoIC')!;
}

describe('fire control (2IC)', () => {
  it('propagates the commander intent to every able man', () => {
    const sim = makeSim();
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    sim.step();
    for (const f of sim.friendlies) {
      expect(f.fireIntent).toBe('rapid');
    }
  });

  it('throttles a man low on magazines back to hold', () => {
    const sim = makeSim();
    const bell = sim.friendlies[2]!;
    bell.ammo.spareMags = FIRE_DISCIPLINE_LOW_MAGS;
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    sim.step();
    expect(bell.fireIntent).toBe('hold');
    expect(sim.friendlies[3]!.fireIntent).toBe('rapid');
  });

  it('rotates depleted men out to re-bomb, never more than the cap at once', () => {
    const sim = makeSim();
    // Deplete everyone to the trigger so all are candidates.
    for (const f of sim.friendlies) {
      f.ammo.spareMags = REBOMB_TRIGGER_MAGS;
    }
    // Low burn rate so the refill rotation outpaces expenditure.
    sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });
    let everRebombed = 0;
    let maxConcurrent = 0;
    for (let t = 0; t < 120 * 60; t++) {
      sim.step();
      const rebombing = sim.friendlies.filter((f) => f.reBombing).length;
      maxConcurrent = Math.max(maxConcurrent, rebombing);
      everRebombed += rebombing > 0 ? 1 : 0;
      expect(rebombing).toBeLessThanOrEqual(REBOMB_MAX_CONCURRENT);
    }
    // The rotation actually ran, used the cap, and refilled men past the
    // trigger.
    expect(everRebombed).toBeGreaterThan(0);
    expect(maxConcurrent).toBe(REBOMB_MAX_CONCURRENT);
    expect(sim.friendlies.some((f) => f.ammo.spareMags > REBOMB_TRIGGER_MAGS)).toBe(true);
  });

  it('stops adjusting rates when the 2IC is down', () => {
    const sim = makeSim();
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    sim.step();
    // 2IC takes a serious wound — alive, cannot fight, cannot manage fire.
    twoIC(sim).wound = {
      severity: 'serious', location: 'chest', atTick: sim.tick, cryUntil: null,
    };
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    for (let t = 0; t < 60; t++) sim.step();
    // Nobody translated the new intent: rates stayed where they were.
    for (const f of sim.friendlies) {
      if (f.role === 'twoIC') continue;
      expect(f.fireIntent).toBe('hold');
    }
  });

  it('stops proactive re-bombing rotation when the 2IC is down', () => {
    const sim = makeSim();
    twoIC(sim).wound = {
      severity: 'serious', location: 'chest', atTick: 0, cryUntil: null,
    };
    for (const f of sim.friendlies) {
      f.ammo.spareMags = REBOMB_TRIGGER_MAGS;
    }
    sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });
    for (let t = 0; t < 30 * 60; t++) sim.step();
    // No one was rotated out proactively: a man only re-bombs when his
    // mag runs completely dry with no spares (none will at this rate).
    expect(sim.friendlies.every((f) => !f.reBombing || f.ammo.spareMags === 0)).toBe(true);
  });

  it('emits NO notification of any kind when fire control lapses', () => {
    const sim = makeSim();
    sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
    for (let t = 0; t < 60; t++) sim.step();

    const journalLenBefore = sim.journal.length;
    // The lapse: 2IC seriously wounded by fiat (no shot event — isolate
    // the lapse itself from the wound's own legitimate evidence trail).
    twoIC(sim).wound = {
      severity: 'serious', location: 'chest', atTick: sim.tick, cryUntil: null,
    };

    const eventTypes = new Set<string>();
    for (let t = 0; t < 60 * 60; t++) {
      for (const ev of sim.step()) eventTypes.add(ev.type);
    }

    // The truth stream may carry combat events, but nothing that names or
    // signals fire control. The event vocabulary simply has no such type —
    // assert it stays that way.
    for (const type of eventTypes) {
      expect(type).not.toMatch(/fire.?control|2ic|lapse/i);
    }
    // And the journal gained no belief about it either: every new entry's
    // evidence note must be free of fire-control language.
    for (let i = journalLenBefore; i < sim.journal.length; i++) {
      expect(sim.journal[i]!.evidence.note).not.toMatch(/fire.?control|2ic|lapse/i);
      expect(sim.journal[i]!.field).not.toMatch(/fire.?control|lapse/i);
    }
  });
});
