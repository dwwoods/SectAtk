# Iteration Notes — Critical Assessment Pass

This session: iterate through the delivery phases with a critical eye on
each, making improvements where the plan can be strengthened.

---

## Phase 2 assessment (World & look)

**What the plan says:** Port terrain, grass, foliage, wind, atmosphere, post
into modules, tuned for the new camera. 60fps gate.

**What it actually bundles (two things with different verification
properties):**

1. **Worldgen** — deterministic, testable, shared with sim. Heightfield,
   meadow rasters, distance field, foliage distribution. The "single source
   of truth for looks AND tactics" from §10. This is the foundation both
   sim (LOS, concealment, cover) and render (terrain, grass, foliage) need.

2. **Renderer port** — human-gated. The reference's terrain mesh, grass
   instancing, atmosphere, bloom, post stack. A blind port produces code
   no agent can verify looks right. The Phase 2 gate ("your side-by-side")
   is explicitly human.

**Improvement:** Split the phase. Do worldgen now (deterministic, testable,
unblocks LOS). Defer the renderer port until a human is in the loop to
judge the visual gate. The profiling risk flagged in Phase 0 notes (QUALITY
tiers don't move fps, bottleneck is likely post or CPU cost) should be
investigated during the render port, not during worldgen — it's a human
profiling task.

Concrete outcome: `src/worldgen/` with noise toolkit, heightfield, meadow
raster, distance field. All deterministic. Unit tests for raster
consistency and heightfield normal correctness.

---

## Phase 4 assessment (Simulation core)

**What the plan says:** Soldier model, stances, ballistics, suppression,
morale, wound model, ammunition model (both sides), exposure, enemy
position, 2.5D LOS and cover. Gate: unit tests per system; two-sided
ammunition conservation; suppression and ROF curves plotted.

**Strengths:** Strongly scoped, machine-verifiable gate, no human
dependency. The "both sides" ammunition choice is the most productive
single decision in the design — it makes the firefight a race neither side
can compute.

**Weaknesses in the plan's approach:**

1. **No explicit composition root.** The file tree lists systems (soldier,
   ammunition, wounds, etc.) but no `simulation.ts` that owns the World,
   the RNG, the clock, and the per-tick system pipeline. The design doc
   describes the sim as a pure function `(state, orders, dt) → state` but
   doesn't name the file that hosts it. Added: `src/sim/simulation.ts`.

2. **"Morale" is underspecified.** The doc lists it under soldier.ts but
   doesn't define it. In MVP, morale doesn't need to be a full model —
   suppression already drives the key decisions. Solution: fold morale into
   suppression as a secondary effect (suppression decay rate affected by
   morale, morale drops on casualties/suppression, affects sound-off
   willingness). Minimal scope, sufficient for Phase 4.

3. **"Suppression and ROF curves plotted" is a design-debt gate.** The
   gate's intent is "tune the suppression→ROF curve so the firefight
   resolves in a tense timeframe." The plan knows this is a human-tuning
   problem. Improvement: implement the curve as a named function with a
   test that asserts monotonicity, endpoints, and outputs a CSV for
   plotting. That way the human has a handle to tune.

4. **Firefight resolution** — "Won when enemy ROF holds below threshold for
   a sustained period." The plan doesn't specify the rolling window
   mechanics. Added: a windowed counter with exact tick semantics, so it's
   deterministic and doesn't flicker.

5. **Re-bombing model** — the plan leaves `REBOMB_DURATION` as `...`.
   Implemented with 20s per mag refill (provisional, noted for tuning).
   The key architectural choice: re-bombing refills ONE empty magazine per
   action, creating a texture of intermittent downtime rather than a big
   single pause.

---

## Phase 5 assessment (Knowledge)

**What the plan says:** Tier 1 push channels, tier 2 sound off and mag
check, journalling with evidence, markers from Knowledge, observation
view. Gate: the seven assertions in §9.4.

**Strengths:** The seven-assertion gate is the most rigorously specified
gate in the whole plan. The journalling requirement ("every belief carries
its evidence") is correctly identified as the architecture's spine.

**Weaknesses:**

1. **Enforcement is by convention, not type.** The plan says "every belief
   traces to a specific piece of evidence" but doesn't give the Knowledge
   API a shape that makes it *hard* to write evidence-free beliefs.
   Improvement: `Knowledge` is a class (or a module with a strict API)
   whose `updateBelief` method accepts `evidence` as a required parameter
   typed as `JournalEntry["evidence"]`. The journal is the append-only
   log; Knowledge is the current snapshot. They're linked at the type
   level: you can't write Knowledge without logging to the journal.

2. **The seven assertions have different dependency schedules.** Three are
   testable in Phase 4/5 (every belief traces to evidence, silent casualty
   produces no push, enemy ammo never exposed in Knowledge). Two need
   render (markers draw from Knowledge, no notification on fire-control
   lapse) and two need behaviour (commander doesn't act on unknown info,
   fire-control lapse). The plan lists them as a monolithic gate.
   Improvement: implement the testable subset now, write the rest as
   pending tests with clear dependency notes.

3. **Tier 1 observation is underspecified.** "Tier 1 — Push (triggers)."
   Observation triggers: enemy fires (muzzle flash) if LOS, man falls if
   observed, cry of pain. But the plan doesn't say how the sim *detects*
   these events. Improvement: the simulation step returns a list of
   `SimEvent` objects (fired, wounded, cried, suppressed, etc.) that
   knowledge systems consume. The event bus is a simple array, not a pub/sub
   system — YAGNI.

---

## Phase 7 assessment (Behaviour & fire control)

**What the plan says:** Individual fire & movement, baseline formation,
section command layer, 2IC intent-to-rate translation and re-bombing
rotation, firefight resolution. Decision tree as data, Hold and Withdraw
wired.

**Touched in this session:** Only the intent→rate *mapping* exists — as the
`INTENT_ROF` config table and `Soldier.effectiveRof()` (which applies the
suppression/wound multipliers on top of the mapped base rate). The 2IC
`fireControl.ts` module itself (per-man rate allocation, re-bombing
rotation, the firefight-lapse detection that assertion #5 protects) is
still a stub. Full individual F&M, the decision tree, and the doctrinal
invariant suite defer to Phase 7 per the plan.

**Correction to an earlier draft:** an early version of these notes said
"fire control intent→rate mapping is implemented here" — it is NOT. Only
the config mapping and the ROF function that consumes it are.

---

## Summary of changes from the plan's order

| Phase | Planned | Actual in this session |
|---|---|---|
| 2 | Port renderer | Worldgen only (deterministic, testable) |
| 3 | Commander & camera | Unchanged (deferred — human gate) |
| 4 | Simulation core | Full implementation + tests |
| 5 | Knowledge | Full implementation + testable assertions |
| 6 | Audio | Unchanged (deferred — human gate) |
| 7 | Behaviour | Fire control intent→rate only |
| 8 | Mission, orders, AAR, UI | Unchanged (deferred) |
| 9 | Hardening & tuning | Unchanged (deferred) |

The render phases (2, 3, 6) are gated by human visual judgement and cannot
be done without a human in the loop. The sim/knowledge phases (4, 5, 7
partial) are machine-verifiable and are the risk-dominant work the design
doc identifies (§9.3: "Information tuning — medium-high, the dominant
risk"). Building them first means the next human session can connect the
renderer to a real, playable sim rather than stubs.