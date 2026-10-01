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