// Tier 1 — push (triggers). Observation-driven truth updates: the
// commander or a man with LOS to the enemy sees muzzle flashes, sees a
// man fall, sees a body. This is the "triggers" channel from §3.1: events
// arrive unbidden and write into the commander's picture automatically.
//
// The key mechanic: silent-wound casualties produce NO observation event
// (the design doc §3.2's darkest expression of the fog of war — a man shot
// through the throat or CNS drops without a sound, and if nobody saw it
// happen, the commander never learns).

import type { Simulation, SimEvent } from '../simulation';
import type { KnowledgeState, Journal, Evidence } from './knowledge';
import {
  updateEnemyPosition,
  updateEnemyFiring,
  updateFriendStatus,
  updateFriendKnownDead,
} from './knowledge';
import { soldierLos } from '../los';
import type { Soldier } from '../soldier';

/**
 * Process a SimEvent for observation. Called for each event the sim emits
 * in a tick. Returns true if the event was consumed (produced a knowledge
 * update), false if it was not observable.
 */
export function processObservationEvent(
  event: SimEvent,
  sim: Simulation,
  knowledge: KnowledgeState,
  journal: Journal,
): boolean {
  switch (event.type) {
    case 'enemy-fired': {
      return handleEnemyFired(event, sim, knowledge, journal);
    }
    case 'friendly-wounded': {
      return handleFriendlyWounded(event, sim, knowledge, journal);
    }
    case 'cry': {
      // Cries are handled by audible.ts, not observation.
      return false;
    }
    default:
      return false;
  }
}

/** An observer (the commander or a designated man) has LOS to the enemy
    position. Returns true if the observer can see the position. */
function observerHasLos(
  sim: Simulation,
  observer: Soldier,
  target: Soldier,
): boolean {
  // Eye heights are stance- and terrain-aware — the ray starts at the
  // observer's eyes and ends at the target's body, both above the ground
  // they actually stand on.
  return soldierLos(observer, target, sim.worldgen).clear;
}

function handleEnemyFired(
  event: SimEvent & { type: 'enemy-fired' },
  sim: Simulation,
  knowledge: KnowledgeState,
  journal: Journal,
): boolean {
  const commander = sim.friendlies[0];
  if (!commander) return false;

  const shooter = sim.world.getEntity(event.soldierId);
  if (!shooter) return false;
  const enemyPos = { x: shooter.pos.x, z: shooter.pos.z };

  // Observation is an ACT (design doc §2.1: raising up to observe is a
  // deliberate physical act with a visible tell). The commander sees muzzle
  // flashes only while observing and with a clean sightline.
  if (!sim.observing.has(commander.id)) return false;
  if (!observerHasLos(sim, commander, shooter)) return false;

  const evidence: Evidence = {
    kind: 'observation',
    tick: sim.tick,
    sourceId: commander.id,
    bearing: Math.atan2(enemyPos.z - commander.pos.z, enemyPos.x - commander.pos.x),
    note: `Muzzle flash sighted at approximately (${enemyPos.x.toFixed(0)}, ${enemyPos.z.toFixed(0)})`,
  };

  updateEnemyPosition(knowledge, journal, enemyPos, evidence);
  updateEnemyFiring(knowledge, journal, true, evidence);
  return true;
}

function handleFriendlyWounded(
  event: SimEvent & { type: 'friendly-wounded' },
  sim: Simulation,
  knowledge: KnowledgeState,
  journal: Journal,
): boolean {
  const soldier = sim.world.getEntity(event.soldierId);
  if (!soldier) return false;
  const wound = event.wound;

  // A wound is OBSERVED only if the commander is looking at the man when it
  // happens (or spots the body after). Silent wounds are the mechanic: no
  // sound AND no sight = the commander never learns. Even a non-silent wound
  // produces no OBSERVATION evidence unless the commander is observing with
  // LOS — the cry itself is the audible evidence (audible.ts), which arrives
  // without the commander paying the risk cost.
  const commander = sim.friendlies[0];
  if (!commander) return false;
  if (!sim.observing.has(commander.id)) return false;

  const hasLos = observerHasLos(sim, commander, soldier);
  if (!hasLos) return false;

  const evidence: Evidence = {
    kind: 'observation',
    tick: sim.tick,
    sourceId: commander.id,
    note: `${soldier.name} was hit and fell — observed directly`,
  };

  if (wound.severity === 'fatal-cns' || wound.severity === 'mortal') {
    updateFriendKnownDead(knowledge, journal, soldier.id, evidence);
  } else if (wound.severity === 'serious') {
    updateFriendStatus(knowledge, journal, soldier.id, 'down', evidence);
  } else {
    updateFriendStatus(knowledge, journal, soldier.id, 'hit', evidence);
  }
  return true;
}