// Fireteams & the offset assault, per the excalidraw tactics diagram
// (design doc §8, §10): Charlie (fire support) holds and shoots; Delta
// (the assault group) bounds in on an axis offset from the direct
// fire-support→enemy line, to the through-line beyond the believed
// position. Mask check (switch/lift fire), final-bound rapid, and the
// one-shot reorg mag check (battle drill 6) are covered here too.

import { describe, expect, it } from 'vitest';
import { Simulation, type Scenario } from '../../src/sim/simulation';
import { bakeWorld } from '../../src/worldgen';
import { Clock, type SpeedMultiplier } from '../../src/sim/clock';
import {
  updateEnemyPosition,
  type Journal,
} from '../../src/sim/knowledge/knowledge';
import {
  MAX_SIMULTANEOUS_MOVERS,
  COVERING_FIRE_MIN,
  ASSAULT_OFFSET_ANGLE_DEG,
  ASSAULT_MIN_TEAM,
  ASSAULT_RAPID_DIST,
  FIXED_DT,
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
    ...(withObjective ? { objective: { pos: { ...OBJECTIVE } } } : {}),
  };
}

const world = bakeWorld(20260728);

function evidence(tick = 1) {
  return { kind: 'observation' as const, tick, sourceId: 'sec-1', note: 'test evidence' };
}

function locateEnemy(sim: Simulation): void {
  const j: Journal = [];
  updateEnemyPosition(sim.knowledge, j, { ...OBJECTIVE }, evidence());
}

function neutraliseEnemy(sim: Simulation): void {
  for (const e of sim.enemySection.soldiers) {
    e.wound = { severity: 'mortal', location: 'chest', atTick: 0, cryUntil: null };
  }
}

describe('fireteams & the offset assault', () => {
  it('(a) Charlie holds (no move target), Delta assaults on an axis offset from the direct line', () => {
    const sim = new Simulation(makeScenario(), world, 0xa001);
    locateEnemy(sim);
    sim.applyOrder({ type: 'assault' });

    const charlie = sim.friendlies.filter((f) => f.fireteam === 'C');
    const delta = sim.friendlies.filter((f) => f.fireteam === 'D');
    expect(charlie.length).toBeGreaterThan(0);
    expect(delta.length).toBeGreaterThan(0);
    expect(charlie.every((f) => f.moveTarget === null)).toBe(true);
    expect(delta.every((f) => f.moveTarget !== null)).toBe(true);

    let scx = 0;
    let scz = 0;
    for (const f of charlie) {
      scx += f.pos.x;
      scz += f.pos.z;
    }
    scx /= charlie.length;
    scz /= charlie.length;

    let cx = 0;
    let cz = 0;
    for (const f of delta) {
      cx += f.moveTarget!.x;
      cz += f.moveTarget!.z;
    }
    cx /= delta.length;
    cz /= delta.length;

    const direct = { x: OBJECTIVE.x - scx, z: OBJECTIVE.z - scz };
    const directLen = Math.hypot(direct.x, direct.z);
    const toCentre = { x: cx - OBJECTIVE.x, z: cz - OBJECTIVE.z };
    const toCentreLen = Math.hypot(toCentre.x, toCentre.z);
    const cosAngle = (direct.x * toCentre.x + direct.z * toCentre.z) / (directLen * toCentreLen);
    const angleDeg = (Math.acos(Math.min(1, Math.max(-1, cosAngle))) * 180) / Math.PI;
    expect(angleDeg).toBeCloseTo(ASSAULT_OFFSET_ANGLE_DEG, 0);
  });

  it('(b) mask check: a nearer friendly in the cone zeroes fire-support fire that tick; removing him resumes it', () => {
    const sim = new Simulation(makeScenario(), world, 0xb002);
    locateEnemy(sim);
    sim.applyOrder({ type: 'assault' });
    sim.applyOrder({ type: 'set-fire-intent', intent: 'rapid' });

    const charlie = sim.friendlies.find((f) => f.fireteam === 'C')!;
    const other = sim.friendlies.find((f) => f.fireteam === 'D')!;

    const target = sim.nearestEnemy(charlie);
    expect(target).not.toBeNull();

    // Place the other man directly on the shooter→target line, nearer
    // than the target — squarely inside the mask cone.
    const dx = target!.pos.x - charlie.pos.x;
    const dz = target!.pos.z - charlie.pos.z;
    const dist = Math.hypot(dx, dz);
    other.pos = {
      x: charlie.pos.x + (dx / dist) * (dist * 0.5),
      z: charlie.pos.z + (dz / dist) * (dist * 0.5),
    };
    other.wound = null;
    other.moveTarget = null;

    let fired = false;
    for (let t = 0; t < 120; t++) {
      const events = sim.step();
      if (events.some((e) => e.type === 'friendly-fired' && e.soldierId === charlie.id)) fired = true;
    }
    expect(fired).toBe(false);

    // Move him out of the cone (well off to the side) — fire resumes.
    other.pos = { x: charlie.pos.x - 50, z: charlie.pos.z + 50 };
    let resumed = false;
    for (let t = 0; t < 120; t++) {
      const events = sim.step();
      if (events.some((e) => e.type === 'friendly-fired' && e.soldierId === charlie.id)) resumed = true;
    }
    expect(resumed).toBe(true);
  });

  it('(c) final-bound rapid: an assaulting man inside ASSAULT_RAPID_DIST of the believed position goes to rapid', () => {
    const sim = new Simulation(makeScenario(), world, 0xc003);
    locateEnemy(sim);
    sim.applyOrder({ type: 'assault' });
    sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });

    const delta = sim.friendlies.find((f) => f.fireteam === 'D')!;
    // Starting well outside ASSAULT_RAPID_DIST — one step must NOT flip it.
    sim.step();
    expect(delta.assaultRapid).toBe(false);

    // Disarm the enemy so return fire cannot wound/suppress him and skew
    // the measurement — he stays alive and targetable, just can't shoot
    // back.
    for (const e of sim.enemySection.soldiers) {
      e.ammo.currentMag = 0;
      e.ammo.spareMags = 0;
      e.ammo.bandolier = 0;
    }

    // Bring him inside the rapid distance and stop him bounding so he's
    // prone and firing, not up and running.
    delta.pos = { x: OBJECTIVE.x + ASSAULT_RAPID_DIST * 0.5, z: OBJECTIVE.z };
    delta.moveTarget = null;
    delta.suppression = 0;

    sim.step();
    expect(delta.assaultRapid).toBe(true);
    expect(delta.fireIntent).toBe('rapid');

    // Sticky and effective: even with section intent held at
    // watch-and-shoot (0.25 rds/s), his actual fire rate is rapid's
    // (4.0 rds/s) — the override reaches the fire step, not just the
    // field. At rapid, ~20 shots are expected over 300 ticks (5 s);
    // at watch-and-shoot, ~1.25. A generous floor distinguishes them.
    let shots = 0;
    for (let t = 0; t < 300; t++) {
      delta.suppression = 0; // keep him from being incidentally pinned
      const events = sim.step();
      shots += events.filter((e) => e.type === 'friendly-fired' && e.soldierId === delta.id).length;
      expect(delta.fireIntent).toBe('rapid'); // never fought back to watch-and-shoot
    }
    expect(shots).toBeGreaterThanOrEqual(6);
  });

  it('(d) fallback to the single whole-section line when Delta has fewer than ASSAULT_MIN_TEAM effectives', () => {
    const sim = new Simulation(makeScenario(), world, 0xd004);
    locateEnemy(sim);

    const delta = sim.friendlies.filter((f) => f.fireteam === 'D');
    // Maul Delta down to below ASSAULT_MIN_TEAM effectives.
    let wounded = 0;
    for (const f of delta) {
      if (delta.length - wounded <= ASSAULT_MIN_TEAM - 1) break;
      f.wound = { severity: 'serious', location: 'chest', atTick: 0, cryUntil: null };
      wounded++;
    }

    sim.applyOrder({ type: 'assault' });
    const targets = sim.friendlies.filter((f) => f.moveTarget !== null);
    const movableAble = sim.friendlies.filter((f) => f.wound === null || f.wound.severity === 'minor');
    expect(targets.length).toBe(movableAble.length);
    // Charlie men now have move targets too — it's one group, not two.
    expect(sim.friendlies.some((f) => f.fireteam === 'C' && f.moveTarget !== null)).toBe(true);
  });

  it('(e) reorg issues exactly one mag check through the tier-2 pipeline', () => {
    const sim = new Simulation(makeScenario(), world, 0xe005);
    neutraliseEnemy(sim);
    locateEnemy(sim);
    sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });
    sim.applyOrder({ type: 'assault' });

    let magCheckStarts = 0;
    let taken = false;
    for (let t = 0; t < 600 * 60 && !taken; t++) {
      const before = sim.pendingTier2;
      sim.step();
      if (before !== 'mag-check' && sim.pendingTier2 === 'mag-check') magCheckStarts++;
      taken = sim.mission.status === 'taken';
    }
    expect(taken).toBe(true);
    expect(magCheckStarts).toBe(1);

    // Keep running — the latch must hold even as the hold clock could, in
    // principle, re-trigger (it won't reset once taken, but the latch is
    // what actually guarantees "exactly one" regardless).
    for (let t = 0; t < 5 * 60; t++) sim.step();
    expect(magCheckStarts).toBe(1);
  });

  it('(f) movement invariants hold within the assault team across 20 seeds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = new Simulation(makeScenario(), world, seed * 9173);
      locateEnemy(sim);
      sim.applyOrder({ type: 'set-fire-intent', intent: 'hold' });
      sim.applyOrder({ type: 'assault' });

      for (let t = 0; t < 20 * 60; t++) {
        sim.step();
        const movers = sim.friendlies.filter((f) => f.bounding).length;
        expect(movers).toBeLessThanOrEqual(MAX_SIMULTANEOUS_MOVERS);
        // Only Delta (or, in a fallback, anyone) ever has a move target,
        // so only they ever bound — the assault team's own invariant.
        const boundingNonDelta = sim.friendlies.some(
          (f) => f.bounding && sim.assaultState.split && f.fireteam !== 'D',
        );
        expect(boundingNonDelta).toBe(false);
        // No move without fire: if anyone is moving, the section retains
        // at least COVERING_FIRE_MIN non-bounding, unwounded men.
        if (movers > 0) {
          const covering = sim.friendlies.filter((f) => !f.bounding && f.wound === null).length;
          expect(covering).toBeGreaterThanOrEqual(COVERING_FIRE_MIN);
        }
      }
    }
  }, 60000);

  it('(g) determinism: the serializer, extended for fireteams/assault state, is byte-identical 1x vs 2x over 2000 ticks', () => {
    // Starting close enough that the assault actually reaches rapid and
    // reorg inside the tick budget — a quiet run (nobody ever goes
    // rapid, reorg never fires) would pass trivially without exercising
    // any of the new paths.
    function makeCloseScenario(): Scenario {
      const base = makeScenario();
      return {
        ...base,
        friendlyStart: base.friendlyStart.map((f) => ({
          ...f,
          pos: { x: f.pos.x + 91, z: f.pos.z - 9 },
        })),
      };
    }

    function serialize(sim: Simulation): string {
      const values: number[] = [
        sim.tick,
        sim.rng.state,
        sim.assaultState.active ? 1 : 0,
        sim.assaultState.split ? 1 : 0,
        sim.assaultState.reorgDone ? 1 : 0,
        sim.assaultState.magCheckIssued ? 1 : 0,
        sim.mission.holdTicks,
        sim.mission.status === 'none' ? 0 : sim.mission.status === 'active' ? 1 : sim.mission.status === 'taken' ? 2 : 3,
        sim.tier2BusyTicks,
        sim.pendingTier2 === 'sound-off' ? 1 : sim.pendingTier2 === 'mag-check' ? 2 : 0,
      ];
      for (const f of sim.friendlies) {
        values.push(
          f.pos.x, f.pos.z, f.heading,
          f.fireteam === 'C' ? 1 : f.fireteam === 'D' ? 2 : 0,
          f.assaultRapid ? 1 : 0,
          f.fireIntent === 'rapid' ? 1 : 0,
          f.moveTarget?.x ?? -9999, f.moveTarget?.z ?? -9999,
          f.bounding ? 1 : 0,
          f.ammo.currentMag, f.ammo.spareMags, f.ammo.bandolier,
        );
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

    function run(speed: SpeedMultiplier): Simulation {
      const sim = new Simulation(makeCloseScenario(), world, 0x60d1);
      neutraliseEnemy(sim);
      locateEnemy(sim);
      sim.applyOrder({ type: 'set-fire-intent', intent: 'watch-and-shoot' });
      sim.applyOrder({ type: 'assault' });
      const clock = new Clock((dt) => sim.step(dt));
      clock.setSpeed(speed);
      const ticks = 2000;
      while (clock.tickCount < ticks - 50) clock.advance(0.05);
      clock.setSpeed(1);
      while (clock.tickCount < ticks) clock.advance(FIXED_DT);
      return sim;
    }

    const sim2x = run(2);
    const sim1x = run(1);
    expect(serialize(sim2x)).toBe(serialize(sim1x));

    // The run must actually exercise the new paths, not pass quietly.
    expect(sim1x.assaultState.reorgDone).toBe(true);
    expect(sim1x.assaultState.magCheckIssued).toBe(true);
  });
});
