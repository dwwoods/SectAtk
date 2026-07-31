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
    rng, clock, world, ballistics
    soldier.ts          stance, weapon, suppression, morale
    ammunition.ts       mags, bandolier, expenditure, re-bombing — used by BOTH sides
    wounds.ts           severity + location -> can he shout, sound off, fight, move
    los.ts              2.5D LOS vs heightfield + meadow + canopy rasters
    exposure.ts         stance/posture -> hit probability. drives the risk currency
    /enemy
      position.ts       static concealed position, finite ammo, suppression response
    /knowledge
      knowledge.ts      believed position, status AND ammo state — friendly only
      journal.ts        timestamped belief deltas + evidence (drives AAR)
      observation.ts    tier 1 — LOS-driven truth updates
      audible.ts        tier 1 — wound-gated cries, attenuated by distance and fire
      elicited.ts       tier 2 — sound off (three-valued) / mag check
    /behaviour
      individual, pair, fireteam, baseline
      fireControl.ts    2IC: intent -> per-man rates, re-bombing rotation
      section.ts        section command layer
      decisionTree.ts   commander's appreciation — DATA-DRIVEN
  /worldgen     # single source of truth for looks AND tactics
    heightfield, meadow, foliage, distanceField
  /render
    terrain, grassInstanced, foliage, atmosphere, post
    camera/       spring arm, occlusion, observation transition + exposure tell
    soldier/      SoldierRenderer + procedural figure + animation
    markers.ts    draws from Knowledge ONLY
  /audio          # tier 3 lives here and NOWHERE else — no Knowledge writes
    fireDensity.ts  friendly and enemy rate as perceivable texture
    cues.ts         visual fallback for accessibility
  /ui             orders panel, contact report, time controls
  /aar            truth-vs-belief replay over the journal
/tests
  /invariants   /scenarios   /visual
```

Most files under `/src` are currently stubs (`export {}` with a phase-number
comment) — the folder shape is established up front so the lint boundary
below has real targets, and no later phase needs to restructure.

## Non-negotiable rules

- **`/sim` imports nothing from `/render`, `/ui`, or `/audio`.**
  Lint-enforced via `.dependency-cruiser.cjs` — run `npm run lint:boundaries`.
- **Fixed timestep.** `FIXED_DT` (`src/sim/config.ts`) never changes. Speed
  multipliers (0/1/2/4, see `src/sim/clock.ts`) change how many
  `step(FIXED_DT)` calls happen per real frame — never the size of a tick.
  This is what the Phase 1 determinism gate verifies
  (`tests/invariants/determinism.test.ts`): byte-identical state after
  10,000 ticks at 1x/2x/4x and a pause-interspersed schedule.
- **All tunables live in `src/sim/config.ts`** — one module, named
  constants (`MAGS_PER_MAN`, `SUPPRESSION_ROUNDS_PER_SEC`, etc. — arrive
  with the systems that use them).
- **`markers.ts` reads `Knowledge`, never ground truth.** Not
  import-graph-expressible (it legitimately imports `Knowledge`'s types),
  so this needs an assert-based test once it's implemented (Phase 5) —
  don't assume the linter catches it.
- **`/audio` never writes to `Knowledge`.** Same reasoning as above — tier 3
  is unmediated by definition; a write here would silently collapse three
  tiers into two. Assert-tested when `/audio` lands (Phase 6), not lint.
- **PRNG state is serializable, not a closure.** `src/sim/rng.ts`'s
  `RngState` is a plain object read/written alongside entity state — needed
  for the determinism gate and, later, AAR journal replay.

## Running the gates

- `npm run test` — vitest, currently just the Phase 1 determinism gate.
- `npm run typecheck` — `tsc --noEmit`, strict mode (see `tsconfig.json`;
  `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on
  deliberately — the determinism gate depends on catching undefined-access
  bugs at compile time, not smoothing them over).
- `npm run lint` — ESLint.
- `npm run lint:boundaries` — the `/sim` import-boundary rule above.
- `npm run test:e2e` — Playwright. Currently one smoke test (app boots,
  canvas mounts, no console errors); grows starting Phase 2/3.

A failure in `npm run test` means the fixed-timestep/multiplier invariant
broke — check `src/sim/clock.ts` first, specifically whether something
changed `FIXED_DT` or the accumulator logic rather than the tick count.
