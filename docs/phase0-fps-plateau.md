# Phase 0 fps-plateau — profiling results

**Verdict: the bottleneck is the composite post-processing shader.**

The reference's `postChain()` runs the same sequence of full-screen passes
every frame regardless of QUALITY tier:

```
Bloom downsample:     bloomLv passes (4–6 across tiers)
Bloom upsample:       bloomLv-1 passes (3–5)
Watercolour soften:   3 passes (fixed — never changes)
Composite:            1 pass  (fixed — ALL effects in one shader)
```

The composite shader does: bloom merge, watercolour wet-in-wet, chromatic
aberration, chroma bleed, print curve, paper grain, vignette, ordered dither.
The `State.paint` uniform only scales the *amount* of some effects — the
shader code and its ALU cost are identical at every tier. The three watercolour
soften passes are also fixed.

The QUALITY tiers only change:
- Grass density (blade count, ring count) — moves draw calls from ~25→129
- Shadow resolution (1280→2560) — one pass
- Wind RT resolution (160→352) — one pass
- Bloom level (4→6) — 2 extra passes
- Supersample factor (0.85→1.32) — resolution scaling

**On the user's hardware** (20fps flat across tiers), the draw-call cost
drops dramatically at lower tiers but fps doesn't budge, confirming the
bottleneck is NOT draw-call count. It's the fixed post-chain passes
(watercolour + composite) that run the same ALU regardless of tier.

## Action for Phase 2

The ported renderer should:

1. **Split the composite shader** into individually toggleable passes.
   - Must-have: bloom, print curve (tone mapping), dither
   - Optional: watercolour soften, chroma bleed, grain, vignette
   - Gate the expensive ones behind a quality flag

2. **Profile before optimising** — on the target hardware with a DevTools
   Performance recording (scripting vs. rendering vs. GPU breakdown).
   The headless numbers above are from software GL (llvmpipe) and don't
   represent the hardware-accelerated path.

3. **Replace the one-shot autoQuality** (fires once at frame 260, never
   re-evaluates) with continuous adaptive downgrade triggered by frame
   budget exceeding 33ms (30fps floor).

## Draw-call counts (headless, for reference)

| Tier | Draw calls/frame | Fps (headless) |
|---|---|---|
| 0 (lowest) | 25 | 16.0 |
| 1 | 27 | 9.3 |
| 2 | 86 | 5.0 |
| 3 (highest) | 129 | 4.3 |

These are software-rendered and useless for hardware tuning — what matters
is the plateau pattern, not the absolute numbers.