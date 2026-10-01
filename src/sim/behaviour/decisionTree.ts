// The commander's appreciation — DATA-DRIVEN (design doc §8, §10).
// Root: withdraw vs attack. MVP wires Hold and Withdraw (Phase 7 spec);
// the attack branches arrive with the assault phases.
//
// The input type is the load-bearing rule: the tree reads the
// commander's KNOWLEDGE and nothing else. "The commander never issues
// an order predicated on information he does not hold" (§9.4) is
// enforced here by signature — there is no Simulation, no Soldier, no
// ground truth in scope. The excalidraw's root turns on "more likely to
// withdraw if en not located", which from prone in cover is the actual
// command problem.

import type { KnowledgeState } from '../knowledge/knowledge';
import { WITHDRAW_STRENGTH_ESTIMATE, WITHDRAW_EFFECTIVES_MIN } from '../config';

export type Appreciation = 'hold' | 'withdraw';

export interface DecisionNode {
  id: string;
  /** Name of the predicate in PREDICATES evaluated over Knowledge. */
  predicate: string;
  yes: string | Appreciation;
  no: string | Appreciation;
}

/** The predicates the tree may reference. All read Knowledge only. */
export const PREDICATES: Record<string, (k: KnowledgeState) => boolean> = {
  'enemy-not-located': (k) => k.enemy.position === null,
  'enemy-too-strong': (k) =>
    (k.enemy.countEstimate ?? 0) >= WITHDRAW_STRENGTH_ESTIMATE,
  'section-too-weak': (k) => {
    // A man is believed effective until evidence says otherwise —
    // 'unknown' is the commander's working assumption, not a loss.
    // That asymmetry is §3's fog: he may be counting dead men.
    let believedEffective = 0;
    for (const b of k.friendlies.values()) {
      if (b.knownDead) continue;
      if (b.status === 'effective' || b.status === 'unknown') believedEffective++;
    }
    return believedEffective < WITHDRAW_EFFECTIVES_MIN;
  },
};

/** The tree as data. Edit the shape here, not the evaluator. */
export const APPRECIATION_TREE: DecisionNode[] = [
  { id: 'root', predicate: 'enemy-not-located', yes: 'withdraw', no: 'strength' },
  { id: 'strength', predicate: 'enemy-too-strong', yes: 'withdraw', no: 'own-state' },
  { id: 'own-state', predicate: 'section-too-weak', yes: 'withdraw', no: 'hold' },
];

export interface AppreciationResult {
  decision: Appreciation;
  /** The node ids visited, in order — the commander's reasoning trail,
      journal-ready for the AAR. */
  trail: string[];
}

export function appreciate(knowledge: KnowledgeState): AppreciationResult {
  const byId = new Map(APPRECIATION_TREE.map((n) => [n.id, n]));
  const trail: string[] = [];
  let cursor: string | Appreciation = 'root';
  while (cursor !== 'hold' && cursor !== 'withdraw') {
    const node = byId.get(cursor);
    if (!node) throw new Error(`decision tree: unknown node '${cursor}'`);
    trail.push(node.id);
    const pred = PREDICATES[node.predicate];
    if (!pred) throw new Error(`decision tree: unknown predicate '${node.predicate}'`);
    cursor = pred(knowledge) ? node.yes : node.no;
  }
  return { decision: cursor, trail };
}
