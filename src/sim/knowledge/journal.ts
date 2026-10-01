// Journal — the append-only log of belief deltas. The types (Journal,
// JournalEntry) are defined in knowledge.ts alongside the evidence-required
// API. This file provides the assertion helpers backing the invariant tests
// (design doc §9.4).

import type { Journal } from './knowledge';

/** Assert: every journal entry has a non-null evidence object with a note. */
export function assertEveryEntryHasEvidence(journal: Journal): void {
  for (const entry of journal) {
    if (!entry.evidence || !entry.evidence.note) {
      throw new Error(
        `Journal entry at tick ${entry.tick} for ${entry.subject}.${entry.field} has no evidence`,
      );
    }
  }
}

/** Assert: no journal entry contains enemy ammunition information. */
export function assertNoEnemyAmmoInJournal(journal: Journal): void {
  for (const entry of journal) {
    if (entry.subject === 'enemy' && entry.field === 'ammo') {
      throw new Error('Enemy ammunition state was written to the journal — violation of §9.4 assertion #6');
    }
  }
}