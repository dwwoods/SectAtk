# SectAtk

Third-person, section-level (8-man) combat simulator. Full design doc:
`SectAtk-Feasibility.md` at repo root — read it before making architectural
decisions. This file covers conventions and non-negotiable rules only.

Reference implementation: `/reference/index.html` (the "Hoshi-no-Tani"
walking sim this project's rendering techniques are lifted from) plus
screenshots and the excalidraw tactics diagram. It's a superb technique
reference and NOT a structure to copy — a single 6000-line file with global
mutable state. Systems get lifted into modules behind clean interfaces as
they're adopted, phase by phase (design doc §7.2).

## Architecture

```
/src
  /sim          # pure, headless, deterministic. imports nothing from /render, /ui, /audio
    types.ts          shared types (StanceName, Vec2)
    config.ts         all tunables (named constants)
    rng.ts            seeded PRNG, plain-object state
    clock.ts          fixed-timestep accumulator, speed multipliers
    world.ts          deterministic Map<id, entity> store
    simulation.ts     composition root — world, rng, step pipeline, orders, tier-2 queue
    soldier.ts        Soldier type, helpers (isAlive, canFight, effectiveRof, updateMorale)
    ammunition.ts     AmmoState: mags, bandolier, expenditure, re-bomb (both sides)
    wounds.ts         severity+location → gating table (§3.2)
    los.ts            2.5D LOS vs heightfield + meadow + canopy rasters
    exposure.ts       stance/posture/grass/coverDF → hit probability (risk currency)
    ballistics.ts     hit resolution, dispersion, wound creation, near-miss → suppression
    suppression.ts    accumulate, decay, logistic ROF curve, firefight threshold
    types.ts          StanceName, Vec2 (shared, dependency-free)
    /enemy
      position.ts     static concealed position, finite ammo, suppression response
    /knowledge
      knowledge.ts    belief types (friend: pos/status/ammo, enemy: pos+uncertainty/count/firing NO ammo)
      journal.ts      append-only log + assertion helpers (query utils return with AAR, Phase 8)
      observation.ts  tier 1 — LOS-driven truth updates; relayed sightings queue with latency + bearing error
      audible.ts      tier 1 — wound-gated cries, attenuated
      elicited.ts     tier 2 — sound off (three-valued), mag check
    /behaviour
      fireControl.ts  2IC: intent → per-man rates with ammo discipline, re-bomb rotation, silent lapse
      individual.ts   fire & movement bounds — one-foot-on-ground + no-move-without-fire gates; Battle Drill 2 dash-down-crawl
      areaFire.ts     speculative area fire at the believed position — ammo real, suppression only
      pair.ts         (stub — assault phases, post-MVP)
      fireteam.ts     Charlie/Delta split, offset assault axis, shared line-up geometry
      baseline.ts     shake out into an extended line on the believed threat bearing
      section.ts      section verbs — sequenced doctrinal withdrawal, fire-support + assault split
      decisionTree.ts commander's appreciation — data-driven, Knowledge-only, Hold/Withdraw wired
  /worldgen     # single source of truth for looks AND tactics
    noise.ts          gradient noise, fbm, ridged (ported from reference)
    config.ts         world size (600m), resolutions
    heightfield.ts    terrain → heightAt, normalAt, bake from noise seed
    meadow.ts         grass concealment raster (0..1) correlated with slope
    foliage.ts        canopy density raster (0..1) for LOS
    distanceField.ts  Jump Flood DF → cover proximity query
    index.ts          bakeWorld: orchestrates all rasters + cover DF
  /render
    terrain.ts        (stub — Phase 2)
    grassInstanced.ts (stub — Phase 2)
    foliage.ts        (stub — Phase 2)
    atmosphere.ts     (stub — Phase 2)
    post.ts           (stub — Phase 2)
    adaptiveQuality.ts frame-budget → quality level (pure controller; renderer maps the levers)
    camera/
      springArm.ts    (stub — Phase 3)
    soldier/
      SoldierRenderer.ts (stub — Phase 3)
    markers.ts        (stub — Phase 5, draws from Knowledge ONLY)
  /audio
    config.ts         audio-only tunables (attenuation, crack synthesis, fallback)
    fireDensity.ts    tier 3 — pure density model from truth rates (never writes Knowledge)
    cues.ts           WebAudio procedural cracks, positional, Poisson-scheduled
    screenEdge.ts     visual accessibility fallback — directional edge intensity
  /ui
    orders.ts         battle-drill-grouped verbal orders; readouts from Knowledge ONLY
    contact.ts        (stub — Phase 8)
    timeControls.ts   (stub — Phase 8)
  /aar
    replay.ts         beliefAtTick: journal → belief snapshot (derivability invariant)
/tests
  /invariants
    determinism.test.ts           Phase 1 dummy-entity determinism (4 tests)
    simulation-determinism.test.ts Phase 4/5 real-sim determinism (4 tests)
    ammunition-conservation.test.ts friendly + enemy conservation (3 tests)
    wounds.test.ts                gating table coverage (16 tests)
    suppression.test.ts           curve shape, decay, pin (9 tests)
    worldgen.test.ts              determinism, bounds, slope→concealment (7 tests)
    knowledge-absence.test.ts     assertions #3, #4, #6, #7 (5 tests)
    los-fire.test.ts              LOS gates fire — ridge stops everything (2 tests)
    adaptive-quality.test.ts      quality controller behaviour (8 tests)
    fire-control.test.ts          2IC layer incl. silent-lapse assert (6 tests)
    movement.test.ts              doctrinal invariants, 100-seed sweep (6 tests)
    section-behaviour.test.ts     appreciation + section verbs (7 tests)
    aar-replay.test.ts            journal derivability incl. uncertaintyRadius (4 tests)
    contact-reaction.test.ts      Battle Drill 2 dash-down-crawl + area fire (6 tests)
    fireteam-assault.test.ts      Charlie/Delta split, mask check, reorg (7 tests)
    withdrawal.test.ts            sequenced release, smoke/wind, out-of-contact (10 tests)
    fire-density.test.ts          tier-3 density model + both absence asserts (4 tests)
    knowledge-uncertainty.test.ts belief radius, relay latency, determinism (6 tests)
  /scenarios
    smoke.spec.ts                 Playwright e2e — app boots
    orders-ui.spec.ts             Playwright e2e — panel mounts, orders dispatch
    (mission.test.ts lives in /invariants — ground must be taken, 7 tests)
  /visual                         (not yet populated)
```

## Current state (see `completed.md` for full detail)

Phases 0 & 1: done (camera spike pass, repo foundation, determinism gate).
Phase 2 worldgen: done (noise toolkit, heightfield, meadow, canopy, DF).
Phase 4: done (simulation core — soldier, ammo, wounds, exposure, ballistics, LOS, suppression, enemy, simulation orchestration, firefight resolution).
Phase 5: done (knowledge, journal, observation, audible, elicited, seven assertions).
Phase 7: done machine-side (2IC fire control, individual F&M + doctrinal
  invariants across 100 seeds, baseline, withdrawal, decision tree over
  Knowledge only). Human movement review pending. Battle Drill 2 contact
  reaction (dash-down-crawl) + speculative area fire done. fireteam.ts
  implemented (Charlie/Delta, offset assault, mask check, reorg mag
  check); pair.ts remains a post-MVP stub. Withdrawal is sequenced
  (furthest first), with smoke/wind and out-of-contact re-decision.
Phase 8: AAR replay core done (journal derivability); mission "ground must
  be taken" (§13.1 option 1) + assault order done; orders UI panel done
  (target-indication idiom — range band + direction, never coordinates).
  Enemy belief carries an uncertainty radius; relayed sightings land with
  latency and bearing error. Markers, contact report, time controls pending.
Phase 6: done — tier-3 ambient fire density (pure model + WebAudio cues +
  visual fallback), both absence asserts in place. Human listening gate
  pending.
Phase 2 render: terrain/grass/atmosphere/post ported + adaptive quality;
  visual gate (human) pending. Phase 3: camera spring arm ported;
  soldier renderer still a stub.

## Non-negotiable rules

- **`/sim` imports nothing from `/render`, `/ui`, or `/audio`.**
  Lint-enforced via `.dependency-cruiser.cjs` — run `npm run lint:boundaries`.
- **Fixed timestep.** `FIXED_DT` (`src/sim/config.ts`) never changes. Speed
  multipliers (0/1/2/4, see `src/sim/clock.ts`) change how many
  `step(FIXED_DT)` calls happen per real frame — never the size of a tick.
  This is what the determinism gates verify
  (`tests/invariants/determinism.test.ts` + `simulation-determinism.test.ts`):
  byte-identical state after 10,000 ticks at 1x/2x/4x and a pause-interspersed
  schedule, including the real sim with full soldier/ammo/knowledge state.
- **All tunables live in `src/sim/config.ts`** — one module, named
  constants (MAGS_PER_MAN, SUPPRESSION_ROUNDS_PER_SEC, etc. — arrive
  with the systems that use them).
- **`markers.ts` reads `Knowledge`, never ground truth.** Not
  import-graph-expressible (it legitimately imports `Knowledge`'stypes),
  so this needs an assert-based test once it's implemented (Phase 5, pending
  render) —don't assume the linter catches it.
- **`/audio` never writes to `Knowledge`.** Same reasoning as above — tier 3
  is unmediated by definiton; a write here would silently collapse three
  tiers into two. Assert-tested in tests/invariants/fire-density.test.ts:
  the density computation runs against a deep-frozen KnowledgeState, and
  the file's own source is grepped for lapse-flag reads (there are none).
- **PRNG state is serializable, not a closure.** `src/sim/rng.ts`'s
  `RngState` is a plain object read/written alongside entity state — needed
  for the determinism gate and, later, AAR journal replay.
- **Every belief carries its evidence.** `KnowledgeState` has an evidence-
  required API: `updateBelif(state, evidence, ...)` — there is no way to
  write a belief without an evidence object. The journal is the append-only
  log; the belief is the current snapshot derived from it. Tested by assertion
  #3 in `tests/invarants/knowledge-absence.test.ts`.
- **Enemy ammunition NEVER enters Knowledge.** Tested by assertion #6 in
  `knowledge-absence.test.ts`.

## Running the gates

- `npm run test` — vitest, 147 tests across 22 files (determinism gates,
  ammo conservation, wound table, suppression model, worldgen consistency,
  knowledge-absence assertions, firefight resolution, exposure/LOS,
  ballistics, LOS-gates-fire, adaptive quality, fire control, movement
  doctrine, section behaviour, AAR derivability).
- `npm run typecheck` — `tsc --noEmit`, strict mode (see `tsconfig.json`;
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on
  deliberately — the determinism gate depends on catching undefined-access
  bugs at compile time, not smoothing them over).
- `npm run lint` — ESLint.
- `npm run lint:boundaries` — the `/sim` import-boundary rule above.
- `npm run test:e2e` — Playwright: smoke (app boots, canvas mounts, no
  console errors) and orders-ui (panel mounts, orders dispatch).

A failure in`npm run test` means either (a) the fixed-timestep/multiplier
invarant broke (check `src/sim/clock.ts` — `FIXED_DT` changd or accumulator
logic corrupted) or (b) a sim core invariant brok (ammo conservation, wound
gating, knowledge evidence requirement). Check which test failed before
touching the clock.