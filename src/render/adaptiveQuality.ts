// Adaptive quality — the continuous downgrade loop prescribed by the
// Phase 0 profiling notes (docs/phase0-fps-plateau.md): the reference's
// one-shot autoQuality fired once at frame 260 and never re-evaluated;
// this controller watches the real frame interval every frame (NOT the
// CPU time spent in render() — GPU work is async, so a GPU-bound machine
// shows a tiny CPU cost while frames crawl) and steps a quality
// level down when the budget is blown for a sustained period, and back up
// when there is sustained headroom.
//
// Pure data + a step function, no THREE — unit-testable headlessly. The
// renderer owns what each level MEANS (render scale, post flags, grass
// rings); this module only decides WHICH level.
//
// The thresholds are provisional until the real-hardware profiling pass
// (Phase 9 tuning); the controller shape is what's load-bearing.

/** Highest (full) quality level. Levels run 0..MAX. */
export const MAX_QUALITY_LEVEL = 3;

/** Per-frame render budget, ms. 33ms = the 30fps floor from the Phase 0
    notes. The controller reacts to a smoothed cost, not single spikes. */
export const FRAME_BUDGET_MS = 33;

/** EMA smoothing factor for the frame interval. */
const EMA_ALPHA = 0.1;
/** Sustained time over budget before downgrading, ms. */
const DOWNGRADE_AFTER_MS = 1000;
/** Sustained time with headroom before upgrading, ms. */
const UPGRADE_AFTER_MS = 5000;
/** Upgrade only when smoothed cost is under this fraction of the budget —
    hysteresis so a marginal machine doesn't oscillate between levels. */
const UPGRADE_HEADROOM = 0.6;
/** Minimum time between level changes, ms. */
const COOLDOWN_MS = 2000;
/** A downgrade this soon after an upgrade means the upgrade was wrong —
    the machine can't hold the higher level. Each such round trip doubles
    the headroom time required before the next upgrade attempt (capped),
    so oscillation decays instead of hitching every few seconds: every
    level change reallocates render targets, which is a visible stutter. */
const OSCILLATION_WINDOW_MS = 15000;
const UPGRADE_REQ_MAX_MS = 80000;

export interface AdaptiveState {
  level: number;
  emaMs: number;
  overBudgetMs: number;
  underBudgetMs: number;
  cooldownMs: number;
  /** Headroom time currently required to upgrade (grows on oscillation). */
  upgradeReqMs: number;
  /** Time since the last upgrade, ms. */
  sinceUpgradeMs: number;
}

export function createAdaptiveState(): AdaptiveState {
  return {
    level: MAX_QUALITY_LEVEL,
    emaMs: 0,
    overBudgetMs: 0,
    underBudgetMs: 0,
    cooldownMs: 0,
    upgradeReqMs: UPGRADE_AFTER_MS,
    sinceUpgradeMs: Number.MAX_SAFE_INTEGER,
  };
}

/**
 * Feed one frame's interval (ms since the previous frame). Returns the
 * new level when the controller decides to change it, null otherwise.
 */
export function stepAdaptive(s: AdaptiveState, frameCostMs: number): number | null {
  s.emaMs = s.emaMs === 0 ? frameCostMs : s.emaMs + EMA_ALPHA * (frameCostMs - s.emaMs);
  if (s.cooldownMs > 0) s.cooldownMs = Math.max(0, s.cooldownMs - frameCostMs);
  if (s.sinceUpgradeMs < Number.MAX_SAFE_INTEGER) s.sinceUpgradeMs += frameCostMs;

  if (s.emaMs > FRAME_BUDGET_MS) {
    s.overBudgetMs += frameCostMs;
    s.underBudgetMs = 0;
  } else if (s.emaMs < FRAME_BUDGET_MS * UPGRADE_HEADROOM) {
    s.underBudgetMs += frameCostMs;
    s.overBudgetMs = 0;
  } else {
    // In the hysteresis band: comfortable, but no headroom to upgrade.
    s.overBudgetMs = 0;
    s.underBudgetMs = 0;
  }

  if (s.cooldownMs > 0) return null;

  if (s.overBudgetMs >= DOWNGRADE_AFTER_MS && s.level > 0) {
    s.level--;
    s.overBudgetMs = 0;
    s.cooldownMs = COOLDOWN_MS;
    if (s.sinceUpgradeMs < OSCILLATION_WINDOW_MS) {
      s.upgradeReqMs = Math.min(s.upgradeReqMs * 2, UPGRADE_REQ_MAX_MS);
    } else {
      s.upgradeReqMs = UPGRADE_AFTER_MS; // fresh regression, not oscillation
    }
    return s.level;
  }
  if (s.underBudgetMs >= s.upgradeReqMs && s.level < MAX_QUALITY_LEVEL) {
    s.level++;
    s.underBudgetMs = 0;
    s.cooldownMs = COOLDOWN_MS;
    s.sinceUpgradeMs = 0;
    return s.level;
  }
  return null;
}
