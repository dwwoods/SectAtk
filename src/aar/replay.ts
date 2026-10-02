// AAR replay — the journal folded back into a belief state (design doc
// §3.4). The journal is the append-only log; the Knowledge snapshot is
// DERIVED from it. Replaying must therefore reproduce the live state
// exactly — any belief write that bypassed the journal breaks the
// equality, which is the derivability invariant
// (tests/invariants/aar-replay.test.ts).
//
// beliefAtTick gives the commander's picture as it stood at any moment,
// which is the AAR timeline's truth-vs-belief left column.

import type {
  Journal,
  KnowledgeState,
  FriendStatus,
} from '../sim/knowledge/knowledge';
import { createKnowledge } from '../sim/knowledge/knowledge';
import type { Vec2 } from '../sim/types';

/**
 * Fold journal entries up to and including `tick` into a fresh belief
 * state. Pass Infinity (the default) for the final picture.
 */
export function beliefAtTick(
  journal: Journal,
  section: Array<{ id: string; name: string }>,
  tick = Infinity,
): KnowledgeState {
  const k = createKnowledge(section);
  for (const e of journal) {
    if (e.tick > tick) break; // journal is append-only, tick-ordered
    if (e.subject === 'enemy') {
      applyEnemy(k, e.field, e.after, e.tick);
    } else {
      applyFriend(k, e.subject, e.field, e.after);
    }
  }
  return k;
}

function applyFriend(k: KnowledgeState, id: string, field: string, after: unknown): void {
  const b = k.friendlies.get(id);
  if (!b) return;
  switch (field) {
    case 'position':
      b.position = after === null ? null : { ...(after as Vec2) };
      break;
    case 'status':
      b.status = after as FriendStatus;
      break;
    case 'ammoLow':
      b.ammoLow = after as boolean | null;
      break;
    case 'knownDead':
      // Mirror of updateFriendKnownDead: knowing a man is dead implies
      // his status, in the live write and in the replay alike.
      b.knownDead = after as boolean;
      if (after === true) b.status = 'dead';
      break;
  }
}

function applyEnemy(k: KnowledgeState, field: string, after: unknown, tick: number): void {
  switch (field) {
    case 'position':
      k.enemy.position = after === null ? null : { ...(after as Vec2) };
      break;
    case 'firing':
      k.enemy.firing = after as boolean;
      // lastFiredTick is set on the false→true transition only, with the
      // evidence tick — mirror of updateEnemyFiring.
      if (after === true) k.enemy.lastFiredTick = tick;
      break;
    case 'countEstimate':
      k.enemy.countEstimate = after as number | null;
      break;
    case 'uncertaintyRadius':
      k.enemy.uncertaintyRadius = after as number | null;
      break;
  }
}
