// All sim tunables live here — see design doc §10: "All tunables are named
// constants in one config module." Most of the list below (ammunition,
// suppression, wound thresholds, knowledge staleness, ...) arrives with the
// systems that use it in Phase 4+; only the clock constant is real yet.

// Simulation tick size, in seconds. NEVER varies with speed — speed
// multipliers (see clock.ts) change how many ticks run per real frame, not
// the size of a tick. See the fixed-timestep invariant in CLAUDE.md.
export const FIXED_DT = 1 / 60;

// Phase 4+ placeholders (not yet implemented):
// export const MAGS_PER_MAN = 8;
// export const BANDOLIER_ROUNDS = 180;
// export const TWO_IC_EXTRA_BANDOLIER = 180;
// export const SUPPRESSION_ROUNDS_PER_SEC = 3;
// export const REBOMB_DURATION = ...;
// export const ENEMY_INITIAL_ROUNDS = ...;
// export const FIREFIGHT_WON_ROF_THRESHOLD = ...;
// export const MAX_SIMULTANEOUS_MOVERS = ...;
// export const GRASS_CONCEALMENT_HEIGHT = ...;
// export const KNOWLEDGE_STALENESS_RATE = ...;
// export const VOICE_RANGE_UNDER_FIRE = ...;
// export const OBSERVATION_EXPOSURE_MULTIPLIER = ...;
