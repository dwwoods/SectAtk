// Journal — the append-only log of belief deltas. The types (Journal,
// JournalEntry) are defined in knowledge.ts alongside the evidence-required
// API. This file provides query utilities for the AAR and for testing the
// seven assertions (design doc §9.4).

import type { Journal, JournalEntry, Evidence } from './knowledge';

/** Query: all journal entries for a given subject (soldier id, 'enemy', etc.). */
export function entriesForSubject(journal: Journal, subject: string): JournalEntry[] {
  return journal.filter((e) => e.subject === subject);
}

/** Query: all journal entries matching an evidence kind. */
export function entriesByEvidenceKind(journal: Journal, kind: Evidence['kind']): JournalEntry[] {
  return journal.filter((e) => e.evidence.kind === kind);
}

/** Query: the last entry for a given subject + field, or null. */
export function lastEntry(
  journal: Journal,
  subject: string,
  field: string,
): JournalEntry | null {
  for (let i = journal.length - 1; i >= 0; i--) {
    const e = journal[i]!;
    if (e.subject === subject && e.field === field) return e;
  }
  return null;
}

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

/** Assert: no journal entry for a given soldier appears unless they produced
    evidence. Used to verify silent-casualty absence (assertion #4). */
export function assertNoEntriesForSoldierUnless(
  journal: Journal,
  soldierId: string,
  allowedEvidenceKinds: Evidence['kind'][],
): void {
  for (const entry of journal) {
    if (entry.subject === soldierId && !allowedEvidenceKinds.includes(entry.evidence.kind)) {
      throw new Error(
        'Journal entry for ' + soldierId + ' at tick ' + entry.tick + ' has evidence kind ' + entry.evidence.kind + ' ' +
        'which is not allowed — silent casualty produced evidence (violation of §9.4 assertion #4)',
      );
    }
  }
}

/** Human-readable summary of the journal for the AAR timeline. */
export function summarizeJournal(journal: Journal): string[] {
  return journal.map((e) => {
    const ago = `${e.tick} ticks`;
    return `[${ago}] ${e.evidence.note} (${e.subject}.${e.field}: ${e.before} → ${e.after})`;
  });
}