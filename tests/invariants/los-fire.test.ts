// LOS gates fire — a shot cannot be taken through terrain. With a ridge
// between the section and the enemy position, nobody fires: no hits, no
// suppression, no ammunition expended on either side. Remove the ridge
// (same stub, flat) and fire resumes — proving the ridge is what gates it.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import type { WorldGen } from '../../src/worldgen';

function stubWorld(ridgeHeight: number): WorldGen {
  return {
    heightfield: {
      heightAt: (x: number) => (Math.abs(x) < 10 ? ridgeHeight : 0),
      normalAt: () => ({ x: 0, y: 1, z: 0 }),
      maxHeight: () => ridgeHeight,
      minHeight: () => 0,
    },
    meadow: { concealmentAt: () => 0, heightAt: () => 0.3 },
    canopy: { densityAt: () => 0 },
    coverDF: { query: () => ({ d: 999, t: 0 }) },
    windAngle: 0,
  };
}

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

function totalRounds(sim: Simulation): { friendly: number; enemy: number } {
  const held = (s: { ammo: { currentMag: number; spareMags: number; bandolier: number } }) =>
    s.ammo.currentMag + s.ammo.spareMags * 30 + s.ammo.bandolier;
  return {
    friendly: sim.friendlies.reduce((t, f) => t + held(f), 0),
    enemy: sim.enemySection.soldiers.reduce((t, e) => t + held(e), 0),
  };
}

describe('LOS gates fire', () => {
  it('a ridge between the sides stops all fire, suppression, and expenditure', () => {
    const sim = new Simulation(makeScenario(), stubWorld(60), 0xbeef);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    const before = totalRounds(sim);

    for (let t = 0; t < 30 * 60; t++) {
      const events = sim.step();
      for (const ev of events) {
        expect(ev.type).not.toBe('friendly-fired');
        expect(ev.type).not.toBe('enemy-fired');
        expect(ev.type).not.toBe('suppressed');
      }
    }

    const after = totalRounds(sim);
    expect(after.friendly).toBe(before.friendly);
    expect(after.enemy).toBe(before.enemy);
    for (const s of [...sim.friendlies, ...sim.enemySection.soldiers]) {
      expect(s.suppression).toBe(0);
      expect(s.wound).toBeNull();
    }
  });

  it('the same flat world (no ridge) lets fire resume', () => {
    const sim = new Simulation(makeScenario(), stubWorld(0), 0xbeef);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });
    const before = totalRounds(sim);

    let fired = 0;
    for (let t = 0; t < 30 * 60; t++) {
      for (const ev of sim.step()) {
        if (ev.type === 'friendly-fired' || ev.type === 'enemy-fired') fired++;
      }
    }
    expect(fired).toBeGreaterThan(0);
    const after = totalRounds(sim);
    expect(after.friendly + after.enemy).toBeLessThan(before.friendly + before.enemy);
  });
});
