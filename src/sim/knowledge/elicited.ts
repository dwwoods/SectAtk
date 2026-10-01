// Tier 2 — pull (elicited). Sound off (three-valued) and mag check. These
// don't exist until the commander calls for them, and silence is only
// evidence because a call was made and no answer came back.
//
// Three-valued sound off (design doc §3.1): effective / hit / no answer.
// A seriously wounded man can still shout that he is hit; a dead man
// answers nothing; a suppressed-but-unhurt man may not answer either.
//
// Mag check: simultaneously an ammunition query and a casualty query — with
// ammunition as a currency, the most valuable order in the game.

import type { Simulation } from '../simulation';
import type { KnowledgeState, Journal, Evidence } from './knowledge';
import { updateFriendStatus, updateFriendAmmo } from './knowledge';
import { canSoundOff } from '../wounds';
import { VOICE_RANGE, SUPPRESSION_MUTE_CHANCE, MAG_ROUNDS } from '../config';
import type { RngState } from '../rng';
import { nextFloat } from '../rng';

export interface SoundOffResult {
  /** Soldiers who answered "effective". */
  effective: string[];
  /** Soldiers who answered "hit". */
  hit: string[];
  /** Soldiers who gave no answer. */
  noAnswer: string[];
}

export interface MagCheckResult {
  /** Soldiers who answered and are low on ammo. */
  low: string[];
  /** Soldiers who answered and have ammo to spare. */
  normal: string[];
  /** Soldiers who gave no answer. */
  noAnswer: string[];
}

/**
 * Process a sound-off order. Three-valued:
 * - answers effective: unhurt, heard and answered clearly.
 * - answers hit: wounded but able to shout back.
 * - no answer: dead, unconscious, mortally-wounded-and-now-silent, pinned
 *   and too suppressed to speak, or out of range.
 *
 * Silence stays *evidence* and never becomes proof — the commander records
 * "no answer" but cannot distinguish dead from pinned from re-bombing.
 */
export function processSoundOff(
  sim: Simulation,
  knowledge: KnowledgeState,
  journal: Journal,
  rng: RngState,
): SoundOffResult {
  const result: SoundOffResult = { effective: [], hit: [], noAnswer: [] };
  const commander = sim.friendlies[0];
  if (!commander) return result;

  for (const f of sim.friendlies) {
    const dist = Math.hypot(f.pos.x - commander.pos.x, f.pos.z - commander.pos.z);
    if (dist > VOICE_RANGE) {
      result.noAnswer.push(f.id);
      continue;
    }

    if (!f.wound) {
      // Unhurt: answers effective unless suppressed enough to be mute.
      if (f.suppression > 0.4 && nextFloat(rng) < SUPPRESSION_MUTE_CHANCE) {
        result.noAnswer.push(f.id);
        const evidence: Evidence = {
          kind: 'silence', tick: sim.tick, sourceId: f.id,
          note: `${f.name} did not answer — possibly pinned or out of earshot`,
        };
        updateFriendStatus(knowledge, journal, f.id, 'unknown', evidence);
      } else {
        result.effective.push(f.id);
        const evidence: Evidence = {
          kind: 'sound-off', tick: sim.tick, sourceId: f.id,
          note: `${f.name} answered effective`,
        };
        updateFriendStatus(knowledge, journal, f.id, 'effective', evidence);
      }
    } else {
      // Wounded: can they answer at all? (throat/CNS wounds silence a man;
      // mortal wounds let him answer once before going quiet)
      if (canSoundOff(f.wound)) {
        result.hit.push(f.id);
        const evidence: Evidence = {
          kind: 'sound-off', tick: sim.tick, sourceId: f.id,
          note: `${f.name} answered "hit"`,
        };
        updateFriendStatus(knowledge, journal, f.id, 'hit', evidence);
      } else {
        result.noAnswer.push(f.id);
        const evidence: Evidence = {
          kind: 'silence', tick: sim.tick, sourceId: f.id,
          note: `${f.name} did not answer`,
        };
        updateFriendStatus(knowledge, journal, f.id, 'unknown', evidence);
      }
    }
  }

  return result;
}

/**
 * Process a mag check. Each alive, answering man reports his ammo state
 * (low if below a reserve threshold — the commander hears "low", not exact
 * numbers; exact counts are for the mag-check UI, Phase 8). No-answer is
 * the casualty query: the same ambiguity as sound-off.
 */
export function processMagCheck(
  sim: Simulation,
  knowledge: KnowledgeState,
  journal: Journal,
  rng: RngState,
): MagCheckResult {
  const result: MagCheckResult = { low: [], normal: [], noAnswer: [] };
  const commander = sim.friendlies[0];
  if (!commander) return result;

  for (const f of sim.friendlies) {
    const dist = Math.hypot(f.pos.x - commander.pos.x, f.pos.z - commander.pos.z);
    if (dist > VOICE_RANGE) {
      result.noAnswer.push(f.id);
      continue;
    }

    if (f.wound && !canSoundOff(f.wound)) {
      result.noAnswer.push(f.id);
      const evidence: Evidence = {
        kind: 'silence', tick: sim.tick, sourceId: f.id,
        note: `${f.name} did not answer the mag check`,
      };
      updateFriendStatus(knowledge, journal, f.id, 'unknown', evidence);
      continue;
    }

    if (f.suppression > 0.4 && nextFloat(rng) < SUPPRESSION_MUTE_CHANCE) {
      result.noAnswer.push(f.id);
      const evidence: Evidence = {
        kind: 'silence', tick: sim.tick, sourceId: f.id,
        note: `${f.name} did not answer the mag check — possibly pinned`,
      };
      updateFriendStatus(knowledge, journal, f.id, 'unknown', evidence);
      continue;
    }

    const totalRounds = f.ammo.currentMag + f.ammo.spareMags * MAG_ROUNDS + f.ammo.bandolier;
    const isLow = totalRounds < 60; // less than two mags' worth
    if (isLow) result.low.push(f.id);
    else result.normal.push(f.id);

    const evidence: Evidence = {
      kind: 'mag-check', tick: sim.tick, sourceId: f.id,
      note: `${f.name} reports ${isLow ? 'LOW' : 'adequate'} ammunition`,
    };
    updateFriendAmmo(knowledge, journal, f.id, isLow, evidence);
  }

  return result;
}