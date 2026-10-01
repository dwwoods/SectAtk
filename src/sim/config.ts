import type { StanceName } from './types';

// All sim tunables live here — see design doc §10: "All tunables are named
// constants in one config module." Every constant arrives with the system
// that uses it; nothing here is speculative. Values marked "provisional"
// are starting estimates flagged for the Phase 9 tuning pass — the design
// doc §9.3 identifies information and ammunition tuning as the dominant
// risk, so these numbers exist to be argued with, not worshipped.

// ── clock (Phase 1, immutable) ─────────────────────────────────────────────
// Simulation tick size, in seconds. NEVER varies with speed — speed
// multipliers (see clock.ts) change how many ticks run per real frame, not
// the size of a tick. See the fixed-timestep invariant in CLAUDE.md.
export const FIXED_DT = 1 / 60;

// ── ammunition (design doc §2.2) ───────────────────────────────────────────
/** Magazines each rifleman carries, 30 rounds each. */
export const MAGS_PER_MAN = 8;
/** Rounds per magazine. */
export const MAG_ROUNDS = 30;
/** Loose rounds in a rifleman's bandolier. */
export const BANDOLIER_ROUNDS = 180;
/** Extra bandolier for the 2IC (two bandoliers total). */
export const TWO_IC_EXTRA_BANDOLIER = 180;
/** Seconds to swap a spent magazine for a loaded one (a tactical reload).
    A man reloading is not firing — one of the four identical "quiet" states
    on the ambient channel (design doc §3.1). */
export const RELOAD_DURATION = 2.5;
/** Seconds to refill ONE empty magazine from the bandolier. A man
    re-bombing is not firing and not moving (design doc §2.3). Provisional. */
export const REBOMB_DURATION = 20;

// ── suppression (design doc §9.3, "Define win the firefight numerically") ──
/** Suppression added by one near-miss round at 1 m miss distance. */
export const SUPPRESSION_PER_ROUND = 0.14;
/** Seconds for a suppressed man to recover fully if morale is high. */
export const SUPPRESSION_DECAY = 0.04;
/** Morale recovers toward 1.0 at this rate per second. */
export const MORALE_RECOVERY = 0.05;
/** Morale drops by this much per nearby casualty. */
export const MORALE_CASUALTY_PENALTY = 0.15;
/** Distance in metres within which a casualty affects morale. */
export const MORALE_CASUALTY_RANGE = 30;
/** Suppression level at which a man's fire rate is halved. */
export const SUPPRESSION_HALF_LEVEL = 0.5;
/** Suppression level at which a man cannot fire at all. */
export const SUPPRESSION_MAX_LEVEL = 0.85;
/** Chance per second that a suppressed-but-unhurt man does not answer a
    sound-off call. Provisional. */
export const SUPPRESSION_MUTE_CHANCE = 0.25;

// ── firefight resolution (design doc §9.3) ─────────────────────────────────
/** Enemy effective ROF (rds/s) below which counts as "won" — but only if
    held for FIREFIGHT_WON_SUSTAINED seconds. The player can never read this
    cleanly (design doc §2.4); it exists for the sim and the AAR. */
export const FIREFIGHT_WON_ROF_THRESHOLD = 0.15;
/** Seconds enemy ROF must stay below threshold to declare the firefight
    won. */
export const FIREFIGHT_WON_SUSTAINED = 20;

// ── exposure (design doc §2.1) ─────────────────────────────────────────────
/** Base hit probability multiplier for each stance. Prone is cheap; a man
    standing to observe pays for it with his body (or his life). */
export const STANCE_HIT_MULT: Record<StanceName, number> = {
  prone: 0.25,
  crouch: 0.55,
  stand: 1.0,
};
/** Eye/muzzle height above the ground for each stance, metres. Used for
    the 2.5D LOS ray — a prone man sees (and is seen) over far less terrain
    than a standing one. */
export const EYE_HEIGHT: Record<StanceName, number> = {
  prone: 0.4,
  crouch: 1.0,
  stand: 1.6,
};
/** A man raising up to observe exposes himself — the "visible tell" of
    spending the risk currency (design doc §2.1). */
export const OBSERVATION_EXPOSURE_MULTIPLIER = 1.6;

// ── ballistics ─────────────────────────────────────────────────────────────
/** A rifleman's dispersion, metres of miss at 100 m (small-arms-like). */
export const DISPERSION_100M = 0.8;
/** Distance at which a hit is still a "near miss" for suppression, m. */
export const NEAR_MISS_RADIUS = 2.0;

// ── enemy (design doc §2.4) ────────────────────────────────────────────────
/** Rounds each enemy rifleman starts with (provisional — the player can
    never count them, so this is a tuning handle, not a fact). */
export const ENEMY_INITIAL_ROUNDS = 120;
/** Enemy riflemen in the position (2–6 per design doc §9.1). */
export const ENEMY_COUNT = 4;
/** Enemy effective rate of fire, rounds/second, unsuppressed. */
export const ENEMY_ROF = 1.2;

// ── friendly fire rates (design doc §4.1, intent → per-man rate) ──────────
/** Fire intent set by the commander; the 2IC translates to per-man rates. */
export type FireIntent = 'watch-and-shoot' | 'hold' | 'win-the-firefight' | 'rapid';
export const INTENT_ROF: Record<FireIntent, number> = {
  'watch-and-shoot': 0.25, // aimed, deliberate
  hold: 1.0, // steady suppression
  'win-the-firefight': 2.5, // near rapid
  rapid: 4.0, // full auto — burns rounds
};

// ── fire control — the 2IC's judgement (design doc §4.1, Phase 7) ────────
/** A man with this many spare magazines or fewer is throttled back to
    'hold' regardless of section intent — the 2IC keeps the burn
    sustainable. Provisional. */
export const FIRE_DISCIPLINE_LOW_MAGS = 1;
/** The 2IC rotates a man out to re-bomb when he is down to this many
    spare magazines (and still has bandolier rounds). Provisional. */
export const REBOMB_TRIGGER_MAGS = 2;
/** Never more than this many men re-bombing at once — fire dips, never
    collapses. Provisional. */
export const REBOMB_MAX_CONCURRENT = 2;

// ── movement — individual fire & movement (design doc §8, §9.3, Phase 7) ─
/** "One foot on the ground": at no tick may more than this many men of
    the section be moving. Enforced by behaviour/individual.ts and
    property-tested every tick (tests/invariants/movement.test.ts). */
export const MAX_SIMULTANEOUS_MOVERS = 3;
/** "No move without fire": nobody bounds unless at least this many
    non-moving men are currently able to fire. */
export const COVERING_FIRE_MIN = 2;
/** A man is pinned (cannot start a bound) above this suppression. */
export const PINNED_SUPPRESSION = 0.8;
/** Movement speed by stance, m/s: leopard crawl / crouched run / sprint.
    Provisional. */
export const MOVE_SPEED: Record<StanceName, number> = {
  prone: 0.5,
  crouch: 2.0,
  stand: 3.6,
};
/** Maximum metres covered in one bound before going back down. */
export const BOUND_LENGTH = 8;
/** Seconds a man stays down between his own bounds (others bound while
    he covers). */
export const BOUND_PAUSE = 2;
/** Metres between men on a baseline / withdrawal line. */
export const BASELINE_SPACING = 5;

// ── contact reaction — Battle Drill 2, "reaction to effective fire" ────────
// Dash – Down – Crawl – Observe – Sights – Fire. Triggered off a near-miss
// or a nearby casualty (design doc §8, Phase 7 ext.). Involuntary — every
// man reacts, so this is exempt from MAX_SIMULTANEOUS_MOVERS, but it must
// stay short: dash + crawl, never a sustained manoeuvre.
/** Metres covered in the initial dash, away/perpendicular from the
    incoming fire. Provisional. */
export const CONTACT_DASH_DIST = 4;
/** Further metres crawled after going prone, so the man is not on the
    spot he was seen going down on. Provisional. */
export const CONTACT_CRAWL_DIST = 2.5;
/** Leopard-crawl speed, m/s — slower than the standing bound speed above.
    Provisional. */
export const CRAWL_SPEED = 0.6;
/** Metres within which a casualty's cry/fall also triggers a contact
    reaction in a nearby, uninjured man ("within earshot"). Provisional. */
export const CONTACT_EARSHOT_RANGE = 50;
/** Seconds before a man who has just finished a contact reaction may
    react again — the drill is for FIRST contact, not every subsequent
    near miss of an ongoing firefight. Provisional. */
export const CONTACT_REACT_COOLDOWN = 20;
// ── speculative area fire — Battle Drill 2 (design doc §8, Phase 7 ext.) ──
// A man with no LOS'd target, in contact, who believes he knows the
// enemy's position fires at the believed area. Suppression only — no
// hits are rolled in MVP — scaled by how close the belief is to the
// truth, falling off to zero at AREA_FIRE_RADIUS.
/** Metres from the believed point within which area fire still
    suppresses an enemy soldier. Provisional. */
export const AREA_FIRE_RADIUS = 15;
/** Area fire's suppression relative to a direct-fire near miss — well
    under 1: suppressing a guess is much less effective than suppressing
    a located man. Provisional. */
export const AREA_FIRE_SUPPRESS_FACTOR = 0.3;
// ── commander's appreciation (design doc §8, decision tree) ────────────
/** Withdraw when the BELIEVED enemy count reaches this. Provisional. */
export const WITHDRAW_STRENGTH_ESTIMATE = 8;
/** Withdraw when the commander believes he has fewer effectives than
    this. Provisional. */
export const WITHDRAW_EFFECTIVES_MIN = 5;

// ── mission — ground must be taken (design doc §13.1, option 1) ────────
// The reason to press: the enemy position sits on ground the section has
// been ordered to take. Battle drills 5 & 6 — the attack and the reorg:
// taken means fought through, occupied, and HELD with the enemy on it
// neutralised. Withdrawing keeps the section alive and loses the mission.
/** Metres around the objective point that count as "on the position". */
export const MISSION_OBJECTIVE_RADIUS = 15;
/** Men who must be on the objective for it to count as held (reorg). */
export const MISSION_HOLD_MEN = 4;
/** Seconds the objective must be continuously held to be TAKEN. */
export const MISSION_HOLD_SECONDS = 10;
/** Below this many men able to fight, the section is combat-ineffective
    and the mission has FAILED. */
export const MISSION_MIN_EFFECTIVES = 3;
/** Metres past the believed position an assault fights through to — the
    drill is through the objective to the far side, not onto the lip. */
export const ASSAULT_THROUGH_DEPTH = 10;

// ── voice (design doc §3.1, tier 2) ────────────────────────────────────────
/** Max range for a sound-off / mag-check answer to be heard, metres. */
export const VOICE_RANGE = 300;
/** Distance at which voice clarity halves (attenuation model). */
export const VOICE_HALF_DISTANCE = 100;

// ── wound / casualty (design doc §3.2) ─────────────────────────────────────
/** Probability a minor wound still produces a cry (a "wounded" man may or
    may not call out). */
export const MINOR_WOUND_CRY_CHANCE = 0.6;
/** Seconds a mortally-wounded man keeps crying before going silent. */
export const MORTAL_CRY_DURATION = 8;
/** Seconds a minor-wounded man keeps crying if he calls out. Provisional. */
export const MINOR_CRY_DURATION = 60;

// ── tier-2 order time cost (design doc §3.3) ───────────────────────────────
/** Seconds a sound-off or mag-check takes to execute. During this time the
    commander is not observing, and ammunition keeps burning. Provisional. */
export const TIER2_ORDER_DURATION = 5;