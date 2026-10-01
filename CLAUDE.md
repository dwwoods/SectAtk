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
      knowledge.ts    belief types (friend: pos/status/ammo, enemy: pos/count/firing NO ammo)
      journal.ts      append-only log + assertion helpers (query utils return with AAR, Phase 8)
      observation.ts  tier 1 — LOS-driven truth updates (muzzle flash, man falls)
      audible.ts      tier 1 — wound-gated cries, attenuated
      elicited.ts     tier 2 — sound off (three-valued), mag check
    /behaviour
      fireControl.ts  2IC: intent → per-man rates, re-bombing rotation (stub — Phase 7)
      individual.ts   (stub — Phase 7)
      pair.ts         (stub — Phase 7)
      fireteam.ts     (stub — Phase 7)
      baseline.ts     (stub — Phase 7)
      section.ts      (stub — Phase 7)
      decisionTree.ts (stub — Phase 7)
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
    fireDensity.ts    (stub — Phase 6)
    cues.ts           (stub — Phase 6)
  /ui
    orders.ts         (stub — Phase 8)
    contact.ts        (stub — Phase 8)
    timeControls.ts   (stub — Phase 8)
  /aar
    replay.ts         (stub — Phase 8)
/tests
  /invariants
    determinism.test.ts           Phase 1 dummy-entity determinism (4 tests)
    simulation-determinism.test.ts Phase 4/5 real-sim determinism (4 tests)
    ammunition-conservation.test.ts friendly + enemy conservation (3 tests)
    wounds.test.ts                gating table coverage (16 tests)
    suppression.test.ts           curve shape, decay, pin (9 tests)
    worldgen.test.ts              determinism, bounds, slope→concealment (7 tests)
    knowledge-absence.test.ts     assertions #3, #4, #6, #7 (5 tests)
  /scenarios
    smoke.spec.ts                 Playwright e2e — app boots
  /visual                         (not yet populated)
```

## Current state (see `completed.md` for full detail)

Phases 0 & 1: done (camera spike pass, repo foundation, determinism gate).
Phase 2 worldgen: done (noise toolkit, heightfield, meadow, canopy, DF).
Phase 4: done (simulation core — soldier, ammo, wounds, exposure, ballistics, LOS, suppression, enemy, simulation orchestration, firefight resolution).
Phase 5: done (knowledge, journal, observation, audible, elicited, seven assertions).
Phase 2 render/Phase 3/Phase 6-9: render, audio, UI, behaviour modules are stubs
  (the architecture skeleton — no later phase needs to restructure).

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
  tiers into two. Assert-tested when `/audio` lands (Phase 6), not lint.
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

- `npm run test` — vitest, 83 tests across 12 files (determinism gates,
  ammo conservation, wound table, suppression model, worldgen consistency,
  knowledge-absence assertions, firefight resolution, exposure/LOS,
  ballistics, LOS-gates-fire, adaptive quality controller).
- `npm run typecheck` — `tsc --noEmit`, strict mode (see `tsconfig.json`;
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on
  deliberately — the determinism gate depends on catching undefined-access
  bugs at compile time, not smoothing them over).
- `npm run lint` — ESLint.
- `npm run lint:boundaries` — the `/sim` import-boundary rule above.
- `npm run test:e2e` — Playwright. Currently one smoke test (app boots,
  canvas mounts, no console errors); gows starting Phase 2/3.

A failure in`npm run test` means either (a) the fixed-timestep/multiplier
invarant broke (check `src/sim/clock.ts` — `FIXED_DT` changd or accumulator
logic corrupted) or (b) a sim core invariant brok (ammo conservation, wound
gating, knowledge evidence requirement). Check which test failed before
touching the clock.