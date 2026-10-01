// Tier 1 — push (triggers). Audible channel: wound-gated cries, attenuated
// by distance and masked by fire. This is the "Cries of pain — wound-gated"
// channel from §3.1: positional audio that only exists if the wound permits
// it. A man shot through the throat makes no sound at all.
//
// The information you receive is inversely proportional to how bad the
// news is. The worst casualties are the quietest.

import type { Simulation, SimEvent } from '../simulation';
import type { KnowledgeState, Journal, Evidence } from './knowledge';
import { updateFriendStatus } from './knowledge';
import { VOICE_RANGE, VOICE_HALF_DISTANCE } from '../config';

/**
 * Process a cry event. A cry is a push-channel piece of evidence: the
 * commander hears a man cry out in pain. Distance attenuation: a cry from
 * far away may not be distinguishable enough to attribute to a specific
 * man (it gives a direction, not an identity). Under heavy fire, cries are
 * harder to localize.
 */
export function processCryEvent(
  event: SimEvent & { type: 'cry' },
  sim: Simulation,
  knowledge: KnowledgeState,
  journal: Journal,
): boolean {
  const soldier = event.soldier;
  const commander = sim.friendlies[0];
  if (!commander) return false;

  const dist = Math.hypot(soldier.pos.x - commander.pos.x, soldier.pos.z - commander.pos.z);
  if (dist > VOICE_RANGE) return false;

  // Attenuation: beyond VOICE_HALF_DISTANCE the cry is a direction, not an
  // identity.
  const clarity = 1 / (1 + dist / VOICE_HALF_DISTANCE);
  const attributable = clarity > 0.35;

  const evidence: Evidence = {
    kind: 'cry',
    tick: sim.tick,
    sourceId: soldier.id,
    bearing: Math.atan2(soldier.pos.z - commander.pos.z, soldier.pos.x - commander.pos.x),
    note: attributable
      ? `${soldier.name} cried out in pain`
      : `A cry of pain from roughly ${(sim.tick % 360).toFixed(0)}° bearing`,
  };

  // The cry tells the commander the man is hit.
  updateFriendStatus(knowledge, journal, soldier.id, 'hit', evidence);

  // If the wound is mortal, the man will go silent — the commander hears
  // the cry, then nothing. That's a belief in itself, but it needs the
  // passage of time (the "then stops" half), which is the silence channel's
  // job. For MVP: the cry itself is the evidence; mortally wounded men are
  // marked 'hit' and only become 'dead' via observation or a sound-off.
  return true;
}

/**
 * The ambient fire-density channel (tier 3) is NOT knowledge — the design
 * doc is explicit that knowledge models what was REGISTERED, and the raw
 * sensorium belongs to the player. However, a sustained change in enemy
 * fire (slackening) is what the firefight resolution watches. That stays in
 * the sim, not here. This file is deliberately small.
 */