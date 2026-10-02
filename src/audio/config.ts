// Audio tunables — presentation only. These are NOT sim tunables: nothing
// here affects simulation state or outcomes (design doc §10 — /audio never
// writes Knowledge, and never feeds back into /sim). They exist purely to
// shape how the tier-3 ambient fire-density channel is perceived.
//
// Sim tunables live in src/sim/config.ts. This module is the audio
// equivalent — one place, named constants.

// ── distance attenuation (design doc §3.1 tier 3) ──────────────────────────
/** Reference distance, metres. A shooter at or inside this range
    contributes at full (unattenuated) weight to the perceived density;
    beyond it, perceived intensity falls off ~1/d. */
export const ATTENUATION_REF_DIST = 40;
/** Perceived rate below which a side is treated as silent — avoids
    scheduling imperceptibly sparse cracks. Rounds/sec. */
export const MIN_PERCEPTIBLE_RATE = 0.02;

// ── procedural "crack" synthesis ────────────────────────────────────────────
/** Noise-burst duration, milliseconds. Short and dry — a crack, not a bang. */
export const CRACK_DURATION_MS = 60;
/** Band-pass center frequency for a friendly crack, Hz. Friendly fire reads
    slightly brighter/closer than enemy fire — a deliberate presentation
    cue, not a sim fact. */
export const FRIENDLY_CRACK_FREQ_HZ = 2200;
/** Band-pass center frequency for an enemy crack, Hz. */
export const ENEMY_CRACK_FREQ_HZ = 1500;
/** Band-pass Q (resonance/narrowness) shared by both sides. */
export const CRACK_FILTER_Q = 1.1;
/** Base gain for a single crack at reference distance. */
export const CRACK_BASE_GAIN = 0.5;
/** Rate (rounds/sec, post-attenuation) at which crack gain saturates. */
export const CRACK_GAIN_SATURATION_RATE = 6;
/** Minimum and maximum seconds between scheduler ticks (keeps the Poisson
    scheduler responsive without busy-waiting). */
export const SCHEDULER_MIN_INTERVAL_S = 0.05;
export const SCHEDULER_MAX_INTERVAL_S = 2.0;

// ── visual accessibility fallback (design doc §10) ──────────────────────────
/** Maximum opacity of the directional screen-edge overlay — texture only,
    never a legible meter. */
export const VISUAL_FALLBACK_MAX_OPACITY = 0.22;
/** Rate (rounds/sec, combined both sides, post-attenuation) at which the
    overlay reaches max opacity. */
export const VISUAL_FALLBACK_SATURATION_RATE = 8;
/** Smoothing time constant (seconds) for the overlay's intensity, so it
    breathes rather than flickers per-crack. */
export const VISUAL_FALLBACK_SMOOTHING_S = 0.4;
