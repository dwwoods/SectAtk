// Mission — ground must be taken (design doc §13.1, battle drills 5 & 6).
// Winning the firefight from a distance is NOT the mission: the ground
// counts only when the section fights through, occupies, and holds it
// with the enemy on it neutralised. Failure is combat-ineffectiveness,
// not death to a man.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import {
  updateEnemyPosition,
  type Journal,
  type Evidence,
} from '../../src/sim/knowledge/knowledge';
import {
  MISSION_HOLD_MEN,
  MISSION_HOLD_SECONDS,
  MISSION_MIN_EFFECTIVES,
  ASSAULT_THROUGH_DEPTH,
} from '../../src/sim/config';

const OBJECTIVE = { x: 60, z: -10 };

function makeScenario(withObjective = true): Scenario {
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
    enemyPosition: OBJECTIVE,
    enemySpread: 3,
    enemyHeading: Math.PI,
    ...(withObjective
      ? { objective: { pos: { ...OBJECTIVE } }, rally: { x: -120, z: 60 } }
      : {}),
  };
}

const world = bakeWorld(20260728);

function evidence(tick = 1): Evidence {
  return { kind: 'observation', tick, sourceId: 'sec-1', note: 'test evidence' };
}

function neutraliseEnemy(sim: Simulation): void {
  for (const e of sim.enemySection.soldiers) {
    e.wound = { severity: 'mortal', location: 'chest', atTick: 0, cryUntil: null };
  }
}

function putSectionOnObjective(sim: Simulation): void {
  sim.friendlies.forEach((f, i) => {
    f.pos = { x: OBJECTIVE.x + (i % 3), z: OBJECTIVE.z + ((i / 3) | 0) };
  });
}

describe('mission: ground must be taken', () => {
  it('is inactive without an objective in the scenario', () => {
    const sim = new Simulation(makeScenario(false), world, 0x1111);
    expect(sim.mission.status).toBe('none');
    sim.step();
    expect(sim.mission.status).toBe('none');
  });

  it('winning the firefight from a distance does NOT take the ground', () => {
    const sim = new Simulation(makeScenario(), world, 0x2222);
    neutraliseEnemy(sim); // enemy wiped out — firefight is over
    for (let t = 0; t < 30 * 60; t++) sim.step();
    // Nobody advanced: the position is unoccupied and the mission open.
    expect(sim.mission.status).toBe('active');
  });

  it('TAKEN when the section occupies and holds with the enemy neutralised', () => {
    const sim = new Simulation(makeScenario(), world, 0x3333);
    neutraliseEnemy(sim);
    putSectionOnObjective(sim);
    let takenEvent = false;
    const need = Math.round(MISSION_HOLD_SECONDS * 60) + 5;
    for (let t = 0; t < need; t++) {
      for (const ev of sim.step()) {
        if (ev.type === 'mission' && ev.status === 'taken') takenEvent = true;
      }
    }
    expect(sim.mission.status).toBe('taken');
    expect(takenEvent).toBe(true);
  });

  it('the hold clock resets if the section is pushed off before the reorg completes', () => {
    const sim = new Simulation(makeScenario(), world, 0x4444);
    neutraliseEnemy(sim);
    putSectionOnObjective(sim);
    for (let t = 0; t < Math.round(MISSION_HOLD_SECONDS * 60) / 2; t++) sim.step();
    expect(sim.mission.holdTicks).toBeGreaterThan(0);
    // Pushed off: too few men left on the position.
    sim.friendlies.forEach((f, i) => {
      if (i < MISSION_HOLD_MEN - 1) return; // keep MISSION_HOLD_MEN-1 on it — one short
      f.pos = { x: -40, z: 20 };
    });
    sim.step();
    expect(sim.mission.holdTicks).toBe(0);
    expect(sim.mission.status).toBe('active');
  });

  it('FAILED when the section goes combat-ineffective', () => {
    const sim = new Simulation(makeScenario(), world, 0x5555);
    let wounded = 0;
    for (const f of sim.friendlies) {
      if (sim.friendlies.length - wounded <= MISSION_MIN_EFFECTIVES - 1) break;
      f.wound = { severity: 'serious', location: 'chest', atTick: 0, cryUntil: null };
      wounded++;
    }
    let failedEvent = false;
    for (const ev of sim.step()) {
      if (ev.type === 'mission' && ev.status === 'failed') failedEvent = true;
    }
    expect(sim.mission.status).toBe('failed');
    expect(failedEvent).toBe(true);
  });

  it('assault no-ops until the enemy is located in Knowledge, then fights THROUGH', () => {
    const sim = new Simulation(makeScenario(), world, 0x6666);
    sim.applyOrder({ type: 'assault' });
    expect(sim.friendlies.every((f) => f.moveTarget === null)).toBe(true);

    const j: Journal = [];
    updateEnemyPosition(sim.knowledge, j, { ...OBJECTIVE }, evidence());
    sim.applyOrder({ type: 'assault' });
    const targets = sim.friendlies.filter((f) => f.moveTarget !== null);
    expect(targets.length).toBe(8);
    // The assault line is centred BEYOND the believed position — fight
    // through to the far side, not onto the lip.
    let cx = 0;
    let cz = 0;
    for (const f of targets) {
      cx += f.moveTarget!.x;
      cz += f.moveTarget!.z;
    }
    cx /= targets.length;
    cz /= targets.length;
    const beyond = Math.hypot(cx - OBJECTIVE.x, cz - OBJECTIVE.z);
    expect(beyond).toBeCloseTo(ASSAULT_THROUGH_DEPTH, 0);
    // And it lies on the far side: further from the section start than
    // the objective itself.
    expect(cx).toBeGreaterThan(OBJECTIVE.x);
  });

  it('a scripted attack takes the ground end-to-end under the doctrinal gates', () => {
    const sim = new Simulation(makeScenario(), world, 0x7777);
    // Fire superiority by fiat (the firefight suite owns winning it):
    // the enemy is neutralised; now the section must still CLOSE.
    neutraliseEnemy(sim);
    const j: Journal = [];
    updateEnemyPosition(sim.knowledge, j, { ...OBJECTIVE }, evidence());
    sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });
    sim.applyOrder({ type: 'assault' });
    let taken = false;
    for (let t = 0; t < 600 * 60 && !taken; t++) {
      sim.step();
      taken = sim.mission.status === 'taken';
    }
    expect(taken).toBe(true);
  });
});
