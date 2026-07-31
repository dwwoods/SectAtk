# Phase 0 notes — camera spike

**Verdict: pass.** Third-person over-the-shoulder costs nothing extra over
the first-person baseline on the hardware tested. The 4–6 m distance
choice from the design doc stands; no retune of `RINGS`/`DENS_POW` was
needed or attempted.

## What was tested

A spring-arm rig was added to `Walker` in a throwaway copy of the reference
(`reference-camera-spike.html`, not committed — see design doc §7.2, this
was never meant to be ported verbatim). It:

- Positions the camera behind-and-above the existing eye/shoulder pivot,
  along the same yaw/pitch look basis already used for first-person —
  keeping the look direction identical is what makes this "a modest
  perturbation" rather than a rewrite (design doc §6).
- Adds a cheap raymarch-against-terrain-height occlusion: pulls the camera
  toward the pivot if the desired position would end up underground.
  Foliage occlusion was NOT attempted — deferred to Phase 3 per the plan,
  and wasn't needed for this verdict.
- Toggles at runtime with **V**, defaulting to third-person, so
  first-person could be A/B'd directly in the same session/route.

Tuned constants (`CFG.thirdPerson` in the spike):
```
distance: 5.0   // metres behind the pivot
height:   1.15  // metres above eye height
side:     0.5   // metres lateral offset (over-the-shoulder)
```
These are starting values, not the product of a tuning pass — they read
fine at a glance but deserve another look once Phase 3 formalizes the rig
into `/src/render/camera/springArm.ts` with real gameplay to look at.

## Measurement

fps was read from the reference's existing telemetry (`#tele`, updated
every ~12 frames). On the tester's machine (WebGL confirmed
hardware-accelerated via `chrome://gpu` — Canvas/Rasterization/WebGL all
"Hardware accelerated"):

| Mode | fps |
|---|---|
| First-person (baseline) | ~20–21 |
| Third-person (spike) | ~20–21 |

No measurable difference between the two. The camera change is free.

## Flagged risk for Phase 2 (not a Phase 0 blocker)

The ~20fps figure itself is well under the reference's own 34fps
adaptive-quality floor — but forcing every quality tier (`1`–`4` keys,
scaling grass density, shadow resolution, wind resolution, and supersample
factor) produced **no change in fps at any tier**, including the lowest.
`setQuality()` was confirmed to actually rebuild grass and resize render
targets on tier change (`rebuildGrass()` + `buildTargets()`), so this isn't
a no-op bug — the bottleneck genuinely isn't in the vertex/resolution
budget the QUALITY tiers control.

This means the cost is likely in the post-processing chain (bloom,
watercolour, chroma bleed, print curve, grain, vignette, dither — §7.1) or
a fixed per-frame CPU cost, not in grass/shadow/wind density. It was NOT
investigated further here — that needs a DevTools Performance recording
(scripting vs. rendering vs. GPU breakdown), which is real profiling work
against a real module, not something to chase inside a one-file spike.

**Action for Phase 2:** when terrain/grass/post get ported into
`/src/render/*` modules and the 60fps gate is being worked toward, profile
early rather than assuming the QUALITY-tier system will save you — on at
least this one machine, it doesn't. Also worth re-checking whether
`autoQuality()`'s single one-shot downgrade (fires once at frame 260, never
re-evaluates) is adequate, or whether the ported version needs continuous
adaptive downgrade.
