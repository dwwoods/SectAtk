# Completed

## Phase 0 — Camera spike (pass)
Third-person camera costs nothing extra over first-person. Findings and the
flagged fps-plateau risk for Phase 2 written up in docs/phase0-notes.md.

## Phase 1 — Foundation (done)
Repo scaffolded, /src architecture skeleton, determinism gate passing
(byte-identical state at 10,000 ticks across 1x/2x/4x/pause), /sim import
boundary lint-enforced.

## Phase 2 (worldgen only) — Deterministic worldgen (done)
Noise toolkit (gradient noise, fbm, ridged, billow) ported from reference.
Heightfield: rolling hills with folds, deterministic from seed. Meadow
raster: grass concealment (0..1) correlated with slope. Canopy raster:
tree density for LOS. Distance field: Jump Flood-based cover proximity
from terrain ridges (Laplacian detection). All rasters bilinearly
interpolated, bounded, NaN-safe. Worldgen is the single source of truth
for looks AND tactics — renderer will sample same data in Phase 2.

**Phase 2 renderer port deferred** — human-gated visual gate. See
docs/iteration-notes.md.

## Phase 4 — Simulation core (done)
- **Config**: all tunables in one module (ammunition, suppression,
  exposure, ballistics, enemy, fire intent, wound, voice, doctrine).
- **Soldier**: stance, fire intent, role, suppression, morale, wound,
  ammo. Helpers: isAlive, canFight, canMove, effectiveRof.
- **Ammunition (both sides)**: magazines, bandolier, expenditure,
  re-bombing (20s per mag refill). Conservation invariant: issued =
  fired + held + stranded.
- **Wounds**: severity + location gating table (§3.2). Fatal CNS/throat
  → silent. Mortal → cries briefly. Serious → screams. Minor → may call
  out. Roll distributions for location and severity.
- **Exposure**: stance + grass concealment + observation multiplier.
  Prone in grass is very hard to hit; standing to observe is expensive.
- **Ballistics**: dispersion-based hit probability, near-miss →
  suppression, wound creation on hit. Rayleigh-distributed miss distance.
- **LOS**: 2.5D ray vs heightfield + meadow + canopy. Steps every 2m,
  terrain blocks, grass/canopy add concealment.
- **Suppression**: accumulate from near-miss, decay over time, logistic
  ROF multiplier curve. Firefight resolution: enemy ROF below threshold
  for 20s → won.
- **Enemy position**: static, finite ammo, suppression-responsive ROF.
  Returns shot results (hits/misses/suppression) per tick.
- **Simulation**: composition root — step runs friendly fire, enemy fire,
  suppression decay, ammo processing, firefight resolution. Emits
  SimEvent truth stream. `applyOrder(order)` surface.
- **Determinism gate extended**: real sim state (soldiers, ammo, wounds,
  knowledge) serialized and hashed. 10,000 ticks, all speeds + pause,
  byte-identical.

## Phase 5 — Knowledge (done)
- **Knowledge**: evidence-required API — every belief update requires
  an Evidence object. Types: FriendBelief (position, status, ammoLow,
  knownDead), EnemyBelief (position, countEstimate, firing, lastFiredTick
  — NO ammo numbers).
- **Journal**: append-only log of belief deltas, each with evidence.
  Query utilities and assertion helpers (assertEveryEntryHasEvidence,
  assertNoEnemyAmmoInJournal, assertNoEntriesForSoldierUnless).
- **Observation (tier 1)**: LOS-driven truth updates. Enemy muzzle flash
  → enemy position + firing. Friendly wounded → observed only if
  commander is observing (risk spent) AND has LOS. Silent wounds produce
  NO observation — the mechanic.
- **Audible (tier 1)**: wound-gated cries, attenuated by distance.
  Cries are push evidence — the commander hears them without spending
  risk. Attributable or directional depending on clarity.
- **Elicited (tier 2)**: sound-off (three-valued: effective/hit/no-answer
  with suppression muting), mag-check (ammo low/normal with casualty
  query). Silence is evidence because a call was made.

### Seven assertions (§9.4)
- #3 (every belief has evidence) — tested ✓
- #4 (silent casualty produces no push evidence) — tested ✓
- #4b (sound-off gives ambiguous "unknown", not proof of death) — tested ✓
- #6 (enemy ammo never in Knowledge) — tested ✓
- #7 (journal evidence kinds are legitimate) — tested ✓
- #1 (markers from Knowledge) — needs render, todo
- #2 (no orders on unknown info) — needs behaviour, todo
- #5 (no notification on fire-control lapse) — needs fireControl, todo

### Gap fixes (iteration pass)
- **Enemy suppression**: friendly near-misses now apply suppression to
  enemy targets (was thrown away — firefight could never be won).
- **Cover factor**: coverDF wired into ballistics on BOTH sides via
  `getCoverFactor()` — proximity to terrain features now reduces hit
  probability (was hardcoded 0.8).
- **Observing decays**: observing is tied to stance (going prone ends it),
  plus a `stop-observe` order. No more permanent risk-free observation.
- **Tier-2 time cost**: sound-off/mag-check now take TIER2_ORDER_DURATION
  seconds, clear observing for the duration, and can't stack. Information
  now costs rounds (the ammunition clock keeps ticking while you listen).
- **Morale**: now does something — casualty proximity drops it, it recovers
  when out of contact, and it scales suppression decay (low morale =
  slower shake-off).
- **Tunables in config**: RELOAD_DURATION, MAG_ROUNDS, MINOR_CRY_DURATION
  no longer hardcoded outside config.ts.
- **Dead code removed**: `fire-heard` evidence kind (violates the three-tier
  model — tier 3 ambient fire is never registered into Knowledge per design
  doc §3.1), unused `enemyCentroid()`.
- **Fps-plateau diagnosed**: confirmed the bottleneck is the composite
  post-processing shader (fixed per-frame cost regardless of QUALITY tier).
  Documented in docs/phase0-fps-plateau.md with specific actions for the
  Phase 2 renderer port.
- **Determinism hash extended**: includes tier2BusyTicks, pendingTier2,
  observing map, and firefight window state.

## Tests
- 74 tests in 10 files, all passing.
- New: firefight resolution (enemy suppression build/decay, firefight won,
  tier-2 time cost, observing gating), exposure/LOS, ballistics.
- Curve data artifact: `npx tsx scripts/curve-data.ts` →
  artifacts/suppression-curve.csv (Phase 9 tuning handle).
- Determinism: Phase 1 (dummy entities) + Phase 4/5 (real sim with
  knowledge).
- Unit: wound gating table, suppression model, worldgen consistency.
- Conservation: ammunition invariant both sides.
- Knowledge: absence assertions (#3, #4, #4b, #6, #7).
- Lint, typecheck, boundary: all clean.

## Perf & correctness pass (post-Phase 5)
- Dead-code sweep (22 unused exports; Phase 7/8 symbols returned with
  their systems below).
- LOS wired into both fire paths — shots no longer resolve through
  terrain; absolute-height bug in observation fixed. EYE_HEIGHT per
  stance.
- SimEvents made serializable (soldier ids, not live references).
- Game loop: rAF with cadence probe + headless fallback; grass uniforms
  per ring.
- Grass porting bug fixed: each chunk issued the ring's FULL instance
  buffer (~300M vert invocations/frame). Per-chunk count*dens via
  onBeforeRender, the reference's exact scheme. 10fps → 74fps at full
  quality on target hardware.
- Adaptive quality: frame-interval-driven controller (EMA, hysteresis,
  oscillation backoff), render scale + post flags + grass rings levers.
  F9 debug HUD.

## Phase 7 — Behaviour & fire control (machine-side done)
- **fireControl**: commander sets intent; 2IC translates to per-man
  rates with ammo discipline (low mags → 'hold'), rotates men out to
  re-bomb (most-depleted first, capped). Lapses silently when he cannot
  fight — §9.4 "no notification on lapse" assert-tested.
- **individual**: fire & movement in bounds. One-foot-on-the-ground
  (≤ MAX_SIMULTANEOUS_MOVERS) and no-move-without-fire
  (≥ COVERING_FIRE_MIN shooters down) gate every bound; property-tested
  every tick across 100 seeds (the Phase 7 machine gate). Pinned men
  stay down; immobile casualties keep their position and orders never
  take.
- **baseline / section**: shake out into an extended line on the
  BELIEVED threat bearing (order no-ops until the enemy is located in
  Knowledge); doctrinal withdrawal to a rally line, immobile casualties
  left where they fell.
- **decisionTree**: data-driven appreciation over KnowledgeState only
  (signature-enforced §9.4). Root: "withdraw if en not located".
  Hold/Withdraw wired; attack branches with the assault phases.
- Orders added: move, halt, form-baseline, withdraw.
- Human movement review pending (§9.5).

## Phase 8 — AAR replay core (done)
- beliefAtTick folds the journal into a belief snapshot; replay of a
  busy 90s firefight must equal the live Knowledge byte-for-byte.
- The derivability test caught and fixed three journal-bypass bugs on
  day one: updateEnemyPosition side-writing firing/lastFiredTick
  unjournaled, ammoLow journaled under the wrong field name, knownDead
  implying a status write.

## Mission — ground must be taken (§13.1 option 1, decided)
- Scenario gains objective + rally. TAKEN = fight through, occupy with
  MISSION_HOLD_MEN, hold MISSION_HOLD_SECONDS with every enemy on the
  position neutralised (drills 5 & 6). Winning the firefight at a
  distance leaves the mission open. FAILED = combat-ineffective
  (< MISSION_MIN_EFFECTIVES able to fight).
- Assault order: section line through the BELIEVED position to
  ASSAULT_THROUGH_DEPTH beyond (fight through, reorg far side), under
  the F&M doctrinal gates. Knowledge-gated: no location, no assault.
- End-to-end scripted attack test takes the ground.

## Phase 8 — Orders UI (done)
- /ui/orders.ts: verbal-idiom panel grouped by the battle drills —
  locate (observe / sound off / mag check), win the firefight (four
  intents), the attack (form baseline / assault / withdraw).
- Readouts draw from Knowledge ONLY: believed per-man statuses, believed
  enemy location, the commander's own acts. Nothing shows ground truth,
  firefight-won state, or fire-control lapse.
- Playwright e2e: panel mounts, mission brief shows, buttons dispatch
  orders into the sim.

## Next
- Phase 2 renderer port (terrain, grass, atmosphere, post) — needs human
  visual gate.
- Phase 3 commander & camera (spring arm, procedural figure, stance
  silhouettes, animation state machine).
- Phase 6 audio (fire density as perceivable texture, visual fallback).
- Phase 7 behaviour (fire & movement, 2IC fire control, intention→rate,
  doctrinal invariant suite, decision tree, Hold/Withdraw wired).
- Phase 8 mission, UI, AAR.
- Phase 9 hardening & tuning pass.