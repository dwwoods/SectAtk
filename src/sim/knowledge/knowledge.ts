// Knowledge — what the commander believes, as opposed to what is true.
// The core rule (design doc §1, §3.1, §10): the game never lies, it
// withholds. Every marker the game draws must be defensible from evidence
// the commander actually received, and every belief in `knowledge` MUST
// trace to a journal entry with evidence. This file makes that a type
// requirement: `updateBelief` refuses to run without an `Evidence`.
//
// Knowledge is friendly-only for ammo state (§10: "believed position,
// status AND ammo state — friendly only"). Enemy ammunition NEVER enters
// Knowledge (§9.4, absence assertion #6).

import type { Vec2 } from '../types';
import {
  BELIEF_RADIUS_FLASH,
  BELIEF_RADIUS_AUDIBLE,
  BELIEF_TIGHTEN_FACTOR,
  BELIEF_RADIUS_MIN,
} from '../config';

// ── evidence ───────────────────────────────────────────────────────────────

export type EvidenceKind =
  | 'observation' // tier 1 — I/another man saw it (risk spent)
  | 'cry' // tier 1 — a man cried out
  | 'sound-off' // tier 2 — elicited answer
  | 'mag-check' // tier 2 — elicited ammo report
  | 'silence' // tier 2 — called and got nothing

// NOTE: there is deliberately NO 'fire-heard' kind here. Enemy fire is
// tier 3 — ambient, unmediated, never registered into Knowledge (design
// doc §3.1: "there is information in the game that the commander's
// Knowledge structure does not contain"). The sound of enemy fire belongs
// to the audio system's fire-density channel (Phase 6), and to the player's
// own ear, not to the belief model. A 'fire-heard' entry here would
// silently collapse tiers 3+1 into one — the exact leak the three-tier
// model exists to prevent.

export interface Evidence {
  kind: EvidenceKind;
  tick: number;
  /** Who the evidence came from (observer/man) — null for ambient sources
      the commander noticed himself. */
  sourceId: string | null;
  /** Direction in radians from the commander, if locatable. */
  bearing?: number;
  /** Human-readable detail for the AAR and the "why do I believe this?"
      UI (design doc §3.4). */
  note: string;
}

// ── beliefs ────────────────────────────────────────────────────────────────

/** Believed status of a friendly soldier. */
export type FriendStatus = 'effective' | 'hit' | 'down' | 'dead' | 'unknown';

export interface FriendBelief {
  id: string;
  name: string;
  /** Last believed position (from observation), or null if never seen. */
  position: Vec2 | null;
  status: FriendStatus;
  /** Believed ammo: low or not. Set by mag-check. */
  ammoLow: boolean | null;
  /** Believed dead: only set by unambiguous evidence (observed corpse). */
  knownDead: boolean;
}

/** Believed picture of the enemy position. */
export interface EnemyBelief {
  /** Believed position (from muzzle flashes / observed fire). */
  position: Vec2 | null;
  /** Uncertainty radius (m) around `position` — never pinpoint. Tightens
      with corroborating evidence, floors at BELIEF_RADIUS_MIN (design doc
      §3.1). null only when position is null. */
  uncertaintyRadius: number | null;
  /** Believed number of rifles (from fire density, never exact). */
  countEstimate: number | null;
  /** Believed firing state — has the enemy been heard firing recently? */
  firing: boolean;
  /** Last tick the enemy was observed/heard firing. */
  lastFiredTick: number | null;
  // Deliberately NOTHING about enemy ammunition. Absence assertion #6.
}

export interface KnowledgeState {
  friendlies: Map<string, FriendBelief>;
  enemy: EnemyBelief;
}

export function createKnowledge(friendlies: Array<{ id: string; name: string }>): KnowledgeState {
  return {
    friendlies: new Map(
      friendlies.map((f) => [f.id, { id: f.id, name: f.name, position: null, status: 'unknown', ammoLow: null, knownDead: false }]),
    ),
    enemy: { position: null, uncertaintyRadius: null, countEstimate: null, firing: false, lastFiredTick: null },
  };
}

// ── journal ────────────────────────────────────────────────────────────────
// The append-only log of belief deltas. Every entry carries its evidence;
// the Knowledge snapshot is derived from this log. The AAR replays it
// (design doc §3.4).

export interface JournalEntry {
  tick: number;
  /** Subject: soldier id, 'enemy', or 'section'. */
  subject: string;
  /** Field that changed. */
  field: string;
  before: unknown;
  after: unknown;
  evidence: Evidence;
}

export type Journal = JournalEntry[];

export function appendJournalEntry(journal: Journal, entry: JournalEntry): void {
  journal.push(entry);
}

// ── the evidence-required update surface ───────────────────────────────────
// The ONLY way to write Knowledge is through these functions, all of which
// take Evidence. There is no `writeBelief(state, subject, field, value)`
// without evidence — the type system makes an unattributed belief
// inexpressible, not merely discouraged.

export function updateFriendStatus(
  state: KnowledgeState,
  journal: Journal,
  soldierId: string,
  status: FriendStatus,
  evidence: Evidence,
): void {
  const b = state.friendlies.get(soldierId);
  if (!b) return;
  const before = b.status;
  if (before === status) return;
  b.status = status;
  appendJournalEntry(journal, {
    tick: evidence.tick, subject: soldierId, field: 'status',
    before, after: status, evidence,
  });
}

export function updateFriendAmmo(
  state: KnowledgeState,
  journal: Journal,
  soldierId: string,
  ammoLow: boolean,
  evidence: Evidence,
): void {
  const b = state.friendlies.get(soldierId);
  if (!b) return;
  if (b.ammoLow === ammoLow) return;
  const before = b.ammoLow;
  b.ammoLow = ammoLow;
  appendJournalEntry(journal, {
    tick: evidence.tick, subject: soldierId, field: 'ammoLow',
    before, after: ammoLow, evidence,
  });
}

export function updateFriendKnownDead(
  state: KnowledgeState,
  journal: Journal,
  soldierId: string,
  evidence: Evidence,
): void {
  const b = state.friendlies.get(soldierId);
  if (!b) return;
  if (b.knownDead) return;
  b.knownDead = true;
  b.status = 'dead';
  appendJournalEntry(journal, {
    tick: evidence.tick, subject: soldierId, field: 'knownDead',
    before: false, after: true, evidence,
  });
}

export function updateEnemyPosition(
  state: KnowledgeState,
  journal: Journal,
  position: Vec2,
  evidence: Evidence,
): void {
  // Position AND its uncertainty radius are written here, each with its
  // own journal entry (one-field-per-entry convention, as updateEnemyFiring
  // already does for `firing`). The firing state itself stays a separate
  // belief with its own entry (updateEnemyFiring) — folding it in here as a
  // side effect would bypass the journal and break AAR derivability
  // (tests/invariants/aar-replay.test.ts caught exactly that).
  const before = state.enemy.position;
  const beforeRadius = state.enemy.uncertaintyRadius;
  const positionChanged = !sameVec(before, position);

  // Evidence kind sets the base radius: a direct sighting (muzzle flash,
  // commander's own or relayed) is tight; audible-only evidence (no
  // current call site — see BELIEF_RADIUS_AUDIBLE in config.ts) is coarse.
  const baseRadius = evidence.kind === 'observation' ? BELIEF_RADIUS_FLASH : BELIEF_RADIUS_AUDIBLE;

  // A new fix inside the standing belief's own uncertainty corroborates it
  // — tighten multiplicatively rather than resetting. A fix outside that
  // radius is a fresh, uncorroborated read: reset to the base radius.
  const consistent =
    before !== null &&
    beforeRadius !== null &&
    Math.hypot(position.x - before.x, position.z - before.z) <= beforeRadius;

  const radius = consistent && beforeRadius !== null
    ? Math.max(BELIEF_RADIUS_MIN, Math.min(beforeRadius, baseRadius) * BELIEF_TIGHTEN_FACTOR)
    : baseRadius;

  if (positionChanged) {
    state.enemy.position = { ...position };
    appendJournalEntry(journal, {
      tick: evidence.tick, subject: 'enemy', field: 'position',
      before: before ? { ...before } : null, after: { ...position }, evidence,
    });
  }

  if (beforeRadius !== radius) {
    state.enemy.uncertaintyRadius = radius;
    appendJournalEntry(journal, {
      tick: evidence.tick, subject: 'enemy', field: 'uncertaintyRadius',
      before: beforeRadius, after: radius, evidence,
    });
  }
}

export function updateEnemyFiring(
  state: KnowledgeState,
  journal: Journal,
  firing: boolean,
  evidence: Evidence,
): void {
  const before = state.enemy.firing;
  if (before === firing) return;
  state.enemy.firing = firing;
  state.enemy.lastFiredTick = firing ? evidence.tick : state.enemy.lastFiredTick;
  appendJournalEntry(journal, {
    tick: evidence.tick, subject: 'enemy', field: 'firing',
    before, after: firing, evidence,
  });
}

function sameVec(a: Vec2 | null, b: Vec2 | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.z === b.z;
}