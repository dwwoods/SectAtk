# SectAtk — Feasibility Assessment & Delivery Plan

**Date:** 2026-07-28
**Revision 7** — after the enemy-ammunition and casualty decisions. The clock now cuts both ways.

**Verdict:** Feasible. The camera decision rescued the renderer; the information decisions turned a legibility problem into the core loop; ammunition turned deliberation into a cost; mutual ammunition turned the firefight into a race neither side can compute. Scope has grown and §11 carves it honestly.

---

## 1. What is being built

A third-person, section-level (8-man) combat simulator. You *are* the section commander — on the ground, in the grass, with a fragmentary picture assembled from what you can see, what you can hear, and what men choose to tell you. You issue quick battle orders and your section executes them doctrinally, in real time, whether or not your picture was correct.

| Decision | Choice |
|---|---|
| Stack | TypeScript + Vite, Three.js 0.180 / WebGL2 |
| Camera | Third-person over-the-shoulder, 4–6 m. Raising up to observe **exposes you** |
| Information | Believed positions and believed *status* — you see what the commander knows |
| Currencies | **Risk** and **ammunition**. Information is bought with both |
| Enemy | Static concealed position, **finite ammunition**, suppression response, no manoeuvre |
| Time model | Real time, pausable, 1× / 2× / 4× |
| Weapons | Rifles only in MVP — **no LMG** |
| Casualties | Wounded men lie where they fall. No treatment, no recovery, no cross-levelling |
| MVP scope | Contact → individual fire & movement → baseline → win the firefight, under fog |
| Visual target | Stylised 3D per the reference, procedural primitive soldiers |
| Debrief | Full after-action replay of truth against belief |

**Design principle, governing everything below: the game never lies, it withholds.** Ambiguity must be structural — evidence genuinely consistent with several world-states — never a dice roll that deceives the player. That is the line between hard and unfair, and every marker the game draws must be defensible from evidence the commander actually received.

---

## 2. The two currencies

Everything the player wants costs one of two things, and because the currencies are not interchangeable, spending is a judgement rather than an optimisation.

### 2.1 Risk

Raising up to observe increases exposure and the chance of being hit. Pause is therefore not a free God-view — it is a decision with a cost, and must read as a deliberate physical act with a visible tell rather than a UI state. This unifies camera, information and risk into one gesture, and is precisely why real commanders get shot.

**The risk can be transferred.** Ordering a man to stand and observe carries the same chance, applied to him. You may spend your own body for a look, or someone else's.

**And because wounds are sound-gated (§3.2), transferring risk can fail silently.** You order a man up to locate the enemy. He is shot through the throat and drops without a sound. You receive neither the information you paid for nor the knowledge that you killed him — only a man who has stopped answering. This is the darkest expression of the design and it emerges from components already specified rather than being bolted on.

### 2.2 Ammunition

Suppression must be *maintained*. Maintaining it means someone is firing. Therefore **every second of deliberation is paid for in rounds** — and rounds are finite.

This is the clock the design was missing. Real-time-with-pause and free deliberation is soft; you can always think longer. Ammunition makes thinking expensive, and it is the doctrinally correct clock, because winning a firefight is fundamentally an ammunition problem. That is why fire control is a job.

**Scales of ammunition**

| | Magazines | Bandolier | Total |
|---|---|---|---|
| Rifleman | 8 × 30 = 240 | 180 | **420** |
| Section 2IC | 8 × 30 = 240 | 360 (two) | **600** |
| **Section of 8** | | | **3,540** |

**The clock this produces.** Without an LMG, firm suppression of a single position needs something on the order of 3 rounds per second landing close — roughly 180 rds/min across the section, near rapid rate for every effective rifle. Against 3,540 rounds that is about twenty minutes of continuous firm suppression; hold back a quarter to cover a withdrawal, and account for men re-bombing or commanding rather than firing, and the practical figure is **ten to twelve minutes of decision time.** Generous enough not to feel arbitrary, tight enough that dithering is what kills you.

**The compounding spiral.** Casualties do not merely subtract. Take a casualty → fewer rifles → each surviving rifle must fire more to hold the same suppression → you dry out faster → and you still need rounds in hand to cover the withdrawal. **And because casualties lie where they fall (§5), his rounds are stranded with him** — up to 420 of them, next to a man who cannot use them. A casualty is not −1 rifle. It is −1 rifle and −420 rounds from the usable pool. Losses accelerate rather than accumulate.

**Dropping the LMG makes this properly hard, which is correct.** A rifle section without a gun genuinely struggles to win a firefight. The withdraw branch of the excalidraw decision tree stops being the losing option and becomes a real judgement. Adding the LMG later will feel like a genuine capability upgrade rather than a stat change.

### 2.3 Re-bombing

Refilling empty magazines from the bandolier takes time, and a man re-bombing is a man not firing.

**This is the most productive small mechanic in the design.** The section's rate of fire now thins for an entirely innocent reason — which means *suppressed*, *dead*, *reloading* and *re-bombing* all present identically on the ambient channel (§3.1). The false positives are not designed in; they fall out of a mechanic added for realism. That is the best kind of ambiguity, and it satisfies §1 exactly: the game withholds, it does not lie.

### 2.4 The enemy burns rounds too

The enemy has finite ammunition in MVP. The clock cuts both ways, and this changes the firefight from a threshold problem into a race that **neither side can compute.**

**It makes the win condition genuinely hard to read.** Enemy fire slackening now has at least four explanations, indistinguishable from your position:

- You have suppressed them.
- They are reloading.
- They are conserving deliberately.
- They are running dry.

"Have I won the firefight?" stops being a threshold check and becomes a judgement under ambiguity — with no new machinery, purely from making the enemy obey the same rules you do.

**Enemy strength is unknown, so enemy endurance is unknown.** You cannot count their rounds because you cannot count their rifles. The excalidraw's *"too many en"* becomes mechanical rather than a note on a diagram.

**A later opportunity, deliberately not in MVP.** Once enemy behaviour is modelled properly, a deliberately silent enemy inviting you to stand up is the natural predator of this whole design — and it remains fair under §1, because the evidence genuinely was ambiguous. Enemy behaviour is otherwise deferred; MVP keeps them static, honest and dumb.

### 2.5 Running dry

They die or they withdraw. Suppression collapses, the enemy's fire lifts, and getting out becomes the only option — with whatever rounds remain to cover it. If there are not enough, the section is destroyed.

This is played out, not announced. There is no failure screen; there is a fighting withdrawal on empty magazines, which is the most interesting five minutes the game has. It also means the withdrawal doctrine is MVP-relevant rather than deferred.

---

## 3. The information model

### 3.1 Three tiers of channel

The distinction below is the spine of the design and drives the architecture.

**Tier 1 — Push (triggers).** Arrive unbidden and write into the commander's picture automatically.

- *Direct observation.* You or another man has LOS at the moment of impact, or spots a body after. Relayed observations carry latency and can be wrong.
- *Cries of pain — wound-gated.* Positional audio, **but only if the wound permits it.**

That gating is the mechanic. A man shot through the thigh screams the place down; a man shot through the throat or killed outright makes no sound at all. **The information you receive is inversely proportional to how bad the news is.** The worst casualties are the quietest.

**Tier 2 — Pull (elicited).** Does not exist until you ask. Silence is only evidence *because you called for an answer*.

- *Sound off.* Three-valued, not binary: **answers effective / answers hit / no answer.** A seriously wounded man can still shout that he is hit, so the second outcome is real and useful. The third is the ambiguous one — dead, unconscious, pinned and unable to speak, or simply out of earshot.
- *Mag check.* Simultaneously an ammunition query and a casualty query — and with ammunition as a currency, the most valuable order in the game.

Neither is an oracle. Voice comms degrade with distance and with volume of fire, so silence stays *evidence* and never becomes proof. Both cost time — and time is rounds — and both plausibly tell the enemy your strength and position.

**Tier 3 — Ambient (unmediated).** Never surfaced by the UI at all. Exists only in the sensory presentation, and the player must notice.

Without an LMG there is no distinct weapon voice to track, so this tier is **fire density, not weapon identity**:

- *Your section's fire thinning* — men hit, suppressed, reloading or re-bombing, indistinguishably.
- *The enemy's fire slackening* — the win read, and ambiguous for the four reasons in §2.4.

This is better than identifying which rifle stopped: less gamey, more achievable, and more accurate to what a commander actually perceives.

The tier has a genuine architectural consequence: **there is information in the game that the commander's `Knowledge` structure does not contain.** The player's own perception is the channel. `Knowledge` models what was *registered*; the raw sensorium belongs to the player. No marker, no notification, no log entry.

### 3.2 The wound model

Screams cannot be gated without severity and location, so alive/dead is insufficient:

| State | Sound | Sounds off | Can fight | Can move | What you infer |
|---|---|---|---|---|---|
| Killed outright (CNS) | **Silent** | No | No | No | Nothing at all |
| Mortally wounded | Cries, then stops | Briefly | No | No | A cry then silence — dead, or gone tactical? |
| Seriously wounded | Screams | **Yes — "hit"** | No | No | Unambiguous, and the best case for you |
| Wounded | May call out | Yes | Degraded | Degraded | May not report it himself |
| Suppressed, unhurt | Silent | Maybe not | Not firing | Not moving | **Indistinguishable from dead** |
| Re-bombing | Silent | Yes | Not firing | Not moving | **Also indistinguishable from dead** |

The last two rows are the point. A man prone and silent because he is terrified — or because he is stuffing rounds into a magazine — presents exactly as a man prone and silent because he is gone. The remedies are opposite: one needs covering fire and a shout, one needs nothing at all, and one needs you to re-plan the assault two men short.

Note how the "sounds off" column earns its keep: it separates some of these rows and not others, which is exactly why the verb is worth paying for and not a free reveal.

### 3.3 Agency — the loop

Uncertainty without a means to reduce it is not tension, it is arbitrary. Every verb trades something real:

| Verb | Cost |
|---|---|
| Sound off / mag check | Time (= rounds), noise discipline, reveals strength and position |
| Order a man to stand and observe | His life, and possibly silently |
| Expose yourself to observe | Your own life |
| Watch and listen | Rounds, because suppression must be held meanwhile |

**The core loop is: buy certainty, or act without it.** Nothing is free, including waiting.

### 3.4 After-action review

The sim is deterministic and replayable from seed plus order log, so a full truth-against-belief replay costs comparatively little — but imposes one requirement: **`Knowledge` must be journalled, not merely current.** Record belief deltas with timestamps and the evidence supporting each.

That journal pays three ways: it drives the AAR; it powers a UI where the player can interrogate why he believes something (*"last seen 40 s ago moving to the hedgerow; no fire heard since"*); and it makes belief bugs visible in testing rather than mysterious.

It is also, most likely, where the emotional weight of the whole game lands. *You ordered a left flanking with a dead man in the fireteam, and you find out ninety seconds after it failed.*

---

## 4. Fire control and the 2IC

### 4.1 Intent, not rate

**Recommendation: the player sets intent, the 2IC sets rate.**

You order *win the firefight* / *hold them* / *watch and shoot* / *rapid for this bound*. The 2IC translates that into per-man rates, allocates fire across arcs, and rotates men out to re-bomb on his own judgement.

The reasoning: he must stay on top of ammunition, so he is autonomous on the detail — that is his job, and per-man micromanagement would make the player the 2IC rather than the commander. But if he is *fully* autonomous the ammunition clock stops being a decision and becomes something that happens to you, which guts the central trade-off. Intent-level control keeps the burn lever in the commander's hands without the admin. It is also doctrinally correct: commanders give intent, 2ICs execute.

**A secondary benefit:** because he re-bombs men on his own initiative, the section's rate of fire fluctuates for reasons you did not order and cannot see. The 2IC's autonomy is itself a fog source.

### 4.2 If the 2IC is hit

Nobody is managing fire. Rates stop being adjusted, re-bombing stops being rotated, and the section's fire degrades on its own.

Under wound-gating you may receive no report at all. So you do not *learn* your 2IC is down — **you notice the fire has gone ragged, and infer it.** The most consequential casualty in the section announces itself only as a change in texture.

This costs almost nothing to build, because every component already exists: the wound model, the ambient channel, and his fire-control role. It is the strongest emergent moment currently in the design, and it should be protected in implementation — specifically, **nothing may notify the player that fire control has lapsed.**

---

## 5. Casualties in MVP

A man who can neither fight nor move lies where he fell. No treatment, no dragging, no recovery, no ammunition cross-levelling.

This is the right MVP call — it avoids a large design area with real emotional weight — but three consequences are load-bearing and must be implemented rather than ignored:

1. **His rounds are stranded.** Up to 420 of them, removed from the usable pool. See the spiral in §2.2.
2. **He can still answer a sound off** if conscious, which is what makes that verb three-valued (§3.1).
3. **He is still present.** He can be observed, occupies space, and remains a man you might wrongly believe is effective.

The larger question — whether casualties can be treated, dragged, or must be left, and how that interacts with a fog in which you may not know a man needs help — is flagged in §13 and deliberately not scoped.

---

## 6. Why the camera decision matters

**It rescues the renderer.** The reference is engineered around a 1.68 m first-person eye height, and engineered tightly — four grass rings carrying ~12 M vertices per frame, density falling off as `(dn/d)^1.5` on the assumption that distance correlates with grazing angle. A 50–60° top-down oblique breaks that and discards the hazy horizon and ridge silhouettes doing most of the aesthetic work. Over-the-shoulder at 4–6 m is a modest perturbation instead: horizon stays in frame, fog curve stays valid, density law substantially survives.

**It is doctrinally truthful.** The excalidraw's decision tree turns on *"more likely to withdraw if en not located."* From above, that answers itself. From ground level, prone in cover, it is the actual command problem — and with §2 and §3 in place, so is *"do I still have eight men"* and *"can I afford to find out."*

**It makes the grass load-bearing.** Long grass at eye level is the single best claustrophobia generator available, and the reference already renders it beautifully.

**Locomotion already exists.** The `Walker` class carries a gait clock, slope-modulated speed, collision and wind lean. Third person is a follow rig and a visible body over a written system. New work: a spring arm with terrain and foliage occlusion, plus the observation transition and its exposure tell.

---

## 7. The reference implementation

**"Hoshi-no-Tani — The Valley of Stars"** — a first-person walking sim. Single 280 KB HTML file, Three.js 0.180 via importmap, **no external assets**. Terrain, sky, clouds, wind, grass, river, trees, viaduct, railway, village, train, audio and post are all generated in code. Fifteen numbered sections, with comments explaining *why* each parameter holds its value. As a house style for Claude to learn and extend, close to ideal.

**Licence: use confirmed.** Courtesy attribution to Lentils in the repo README regardless.

### 7.1 What transplants directly

**Fully synthesised audio.** Load-bearing rather than decorative: tier 3 makes the mix into gameplay. Synthesis means parametric control, which is what is needed to make friendly and enemy fire density perceivable as texture.

**Wind as a simulated field** — a render target plus `windAtJS(x, z, height)`. The excalidraw specifies smoke *if wind allows*, with fire-and-movement as fallback. Half-built already.

**Terrain query API** — `terrainAt`, `sampleHeight`, `sampleNormal`, `groundHeightAt`. Exactly what a 2.5D sim needs for elevation, slope and LOS.

**A grass density mask** (512²), already baked — the concealment field, free.

**A generic distance-field system** (512² at 4.69 m cells), reusable for cover proximity and route cost.

**The collision registry and its discipline** — every building registers its box *as it is modelled*, so collision can never drift from geometry. That is the single-source-of-truth rule, already conventional here.

**A procedural mesh toolkit** — primitive builders with per-vertex colour, used for the train, viaduct and village. This is why procedural soldiers are the native idiom rather than a compromise.

**Four quality tiers with adaptive downgrade** below 34 fps, and the full post stack: bloom, watercolour softening, chroma bleed, a print curve pulling shadows violet and highlights cream, grain, vignette, ordered dither.

### 7.2 Caveat

A single 6,000-line file with global mutable state. Superb technique reference; not a structure to copy. Systems get lifted into modules behind clean interfaces as adopted.

---

## 8. Source material — what the excalidraw specifies

**Movement techniques:** individual fire & movement → pairs → fireteam → baseline
**Formations:** arrow · extended line · staggered file · file ("Afghan snake")

**Commander's decision tree.** Root: withdraw vs attack.
- *Withdraw* if enemy not located, difficult routes / lack of cover, or too many enemy.
- *Attack* via left / right / rear / middle flank — cover, terrain and distance dictate the route.
- Then: choose an assault team and a fire support team.

**The attack, parts 1–3**
1. Section comes under fire; individual F&M into a baseline. Commander formulates his plan while the 2IC and the remainder win the firefight.
2. Frontal: fireteam bounds to close. *One foot on the ground / no move without fire.* When close enough, one fireteam is launched as the assault team.
3. One pair drops off as intimate fire support, the other assaults. The assault is offset so fire support can engage until the last second. Grenade, then assault on full auto.

**Left flanking variant.** Fireteam patrols silently — explicitly *not* fire & manoeuvre — through woods, unobserved. Assaulting section peels from inside out.

**Withdrawal.** Smoke if wind allows; then rearward by teams, pairs or individuals. If wind is wrong: fire and move, one foot on the ground. Use terrain. Furthest man moves first, remainder cover. Once in cover and out of LOS, the commander re-decides.

**Note how §2 and §3 deepen all of this.** "Too many en" — you do not know how many, so you do not know how long they can last. "En not located" — literally the fog, and locating them costs risk. "Difficult routes / lack of cover" — a judgement from a picture that may be wrong. And *"do I have enough men and enough rounds to assault"* is a question with two uncertain terms.

---

## 9. Feasibility analysis

### 9.1 What makes this tractable

- **Tiny entity count.** ~8 friendlies plus 2–6 enemy. No crowd pathfinding, no economy, no netcode.
- **The spec already exists** in the excalidraw.
- **A working, commented, asset-free reference** for the hardest visual work, at a camera close to ours, cleared for use.
- **The AAR is nearly free** given a deterministic sim and a journalled belief model.
- **Enemy ammunition is nearly free** — the same `ammunition` module applied to enemy entities, and it buys a large amount of ambiguity.
- **Dropping the LMG simplifies MVP** — one weapon profile, no gun-group behaviour, no gun-line doctrine.
- **Casualties lying where they fall** removes a whole design area from MVP.
- **Six art/mechanics synergies from systems that already exist:** grass is concealment *and* claustrophobia; haze is observation range; wind is a tactical input; synthesised audio is an information channel; re-bombing generates ambiguity; enemy ammunition generates more.

### 9.2 Soldiers — resolved

With the camera at 4–6 m the commander is a medium figure, not a close-up, so primitive-assembled soldiers stay viable throughout. Prone, crouch, run, fire, re-bomb and casualty are six distinct silhouettes, and silhouette is what reads at this distance. Animation is programmatic, not skinned. Keep a `SoldierRenderer` interface so rigged glTF remains a later option; do not plan for it.

### 9.3 Remaining risks

**Information tuning** *(medium-high — the dominant risk).* The line between tense and annoying is narrow and can only be found by playing. Several passes with your judgement. The agency verbs in §3.3 are the primary lever: if it feels arbitrary, they are too weak or too expensive.

**Ammunition balance, now on both sides** *(medium-high).* Two clocks that must both bite without either being punitive, and the enemy's endurance is the parameter the player can least perceive. The figures in §2.2 are a starting estimate, not a result. Build telemetry to observe it: rounds expended per engagement, time at each rate, reserve remaining at decision points, and enemy rounds remaining at the moment the player commits.

**Passivity** *(new, medium).* With both sides burning rounds and enemy strength unknown, the mathematically safe play is often not to fight. The excalidraw anticipates this — *"will depend on the mission"* — so **MVP needs a mission that makes pressing necessary**, or withdrawal becomes dominant and the game is passive. See §13.

**Audio is load-bearing** *(medium).* Tier 3 makes the mix into UI. Positional audio, distance attenuation and occlusion must be right, and the game degrades badly without sound. **Accessibility requires a visual fallback** — directional cue indicators and a fire-density readout for players who cannot rely on audio. A requirement, not a nicety.

**Camera re-tune** *(low-medium).* Grass density law and fog curve need adjusting for a slightly higher, steeper camera. Phase 0 resolves it.

**Doctrinal correctness reading as correct** *(medium).* Two mitigations:
- *Make the doctrine assertable.* "One foot on the ground / no move without fire" is an **invariant** — at no tick may more than a defined fraction of the section be moving, and no man may move unless a covering-fire condition holds. Property-tested every tick, every seed.
- *Define "win the firefight" numerically.* Suppression accumulates from near-miss rounds; enemy effective ROF degrades with it. Won when enemy ROF holds below threshold for a sustained period — noting that the *player* can never read this cleanly, by design.

### 9.4 Agentic verification

> **The simulation is a pure, deterministic, headless function: `(state, orders, dt) → state`. Seeded PRNG, fixed timestep, zero Three.js or DOM dependency. The renderer reads state and never writes it.**

The sim is **2.5D**: 2D position, elevation sampled from the heightfield. Seed + order script → 60 s headless in milliseconds → assert invariants and terminal state.

The information model adds unusually strong assertions:

- Markers are drawn only from `Knowledge`, never from ground truth.
- The commander never issues an order predicated on information he does not hold.
- Every belief in the journal traces to a specific piece of evidence — no belief may appear without a cause.
- **A silent-wound casualty produces no push-channel evidence.** (Assert the *absence*. This is the mechanic, and a leak would quietly destroy it while every other test stayed green.)
- **No notification is emitted when fire control lapses.** (Same reasoning, protecting §4.2.)
- **No enemy ammunition state is ever exposed to the player's `Knowledge`.** (Same reasoning, protecting §2.4.)
- Ammunition is conserved on both sides: rounds fired plus rounds held plus rounds stranded equals rounds issued, every tick.

### 9.5 What engineering cannot solve

Claude can verify that code runs, tests pass, invariants hold, evidence traces, ammunition balances and frame budget is met. Claude cannot judge *"does this look like the reference"*, *"does this move like a section"*, *"do the clocks bite correctly"*, or — most importantly — *"is this tense or is it just annoying."* All four need your eye. Each milestone ends with a clip and screenshots.

---

## 10. Architecture

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

**Non-negotiable rules**

- `/sim` imports nothing from `/render`, `/ui` or `/audio`. Lint-enforced.
- **`markers.ts` reads `Knowledge`, never ground truth.** Lint-enforced, assert-tested.
- **`/audio` never writes to `Knowledge`.** Tier 3 is unmediated by definition; a write here would silently collapse three tiers into two.
- **Enemy ammunition never enters `Knowledge`.** Protects the four-way ambiguity in §2.4.
- **Nothing notifies the player that fire control has lapsed.** Protects §4.2.
- **Every belief carries its evidence.** No unattributed writes to `Knowledge`.
- **One worldgen feeds renderer and sim**, adopting the reference's register-as-modelled discipline.
- All tunables are named constants in one config module — `MAGS_PER_MAN`, `BANDOLIER_ROUNDS`, `TWO_IC_EXTRA_BANDOLIER`, `SUPPRESSION_ROUNDS_PER_SEC`, `REBOMB_DURATION`, `ENEMY_INITIAL_ROUNDS`, `FIREFIGHT_WON_ROF_THRESHOLD`, `MAX_SIMULTANEOUS_MOVERS`, `GRASS_CONCEALMENT_HEIGHT`, `KNOWLEDGE_STALENESS_RATE`, `VOICE_RANGE_UNDER_FIRE`, `OBSERVATION_EXPOSURE_MULTIPLIER`.
- Fixed timestep. Speed multipliers change ticks-per-frame, never tick size, so 4× is bit-identical to 1×.

---

## 11. Scope — what is core and what defers

**In MVP (these *are* the mechanic)**
Wound model with scream gating · tier 1 push channels · tier 2 sound off (three-valued) and mag check · ambient fire density, friendly and enemy · exposure risk on observation, own and transferred · ammunition, bandoliers and re-bombing · **enemy finite ammunition** · intent-level fire control with an autonomous 2IC · casualties lying where they fall, with stranded ammunition · belief journalling · timeline AAR · doctrinal withdrawal (required by §2.5) · a mission that makes pressing necessary (§13).

**Deferred**
LMG and gun-group doctrine · **enemy behaviour beyond a static position** — manoeuvre, deliberate silence, baiting · send a man to look (needs detached-man behaviour) · casualty treatment, dragging and recovery · ammunition cross-levelling · 2IC succession on commander casualty · 3D cinematic AAR replay · the assault and flanking phases of the excalidraw.

---

## 12. Delivery phases

**Phase 0 — Camera spike.** *(~1 day, blocking)* Run the reference unmodified; move to a third-person rig at 4–6 m. Measure cost, check the grass reads at the new angle, check the horizon still carries the image. *Gate: **your** verdict that the look survives.*

**Phase 1 — Foundation.** Repo, Vite + TS strict, vitest, Playwright, CI, `CLAUDE.md`. Seeded PRNG, fixed-timestep clock, entity store, time controls. *Gate: determinism — byte-identical state after 10,000 ticks at all four speeds.*

**Phase 2 — World & look.** Port terrain, grass, foliage, wind, atmosphere, post into modules, tuned for the new camera. Worldgen emits tactical rasters. *Gate: 60 fps; raster/visual correspondence; **your** side-by-side.*

**Phase 3 — Commander & camera.** Procedural figure, six stance silhouettes, animation state machine. Spring arm with occlusion, observation transition with exposure tell. *Gate: it feels good to move and look; **your** review.*

**Phase 4 — Simulation core.** Soldier model, stances, ballistics, suppression, morale, wound model, ammunition model (both sides), exposure, enemy position, 2.5D LOS and cover. *Gate: unit tests per system; two-sided ammunition conservation; suppression and ROF curves plotted.*

**Phase 5 — Knowledge.** Tier 1 push channels, tier 2 sound off and mag check, journalling with evidence, markers from `Knowledge`, observation view. *Gate: the seven assertions in §9.4, including all three absence tests.*

**Phase 6 — Audio.** Friendly and enemy fire density as perceivable texture, positional and occluded, visual accessibility fallback. *Gate: can **you** tell the enemy's fire is slackening — and can you resist assuming you know why?*

**Phase 7 — Behaviour & fire control.** Individual fire & movement, baseline formation, section command layer, 2IC intent-to-rate translation and re-bombing rotation, firefight resolution. Decision tree as data, Hold and Withdraw wired. *Gate: doctrinal invariant suite across 100 seeds; **your** movement review.*

**Phase 8 — Mission, orders, AAR & UI.** Mission framing, orders panel, contact report, truth-vs-belief replay over the journal, tuning telemetry. *Gate: scenario replay tests through the real order pipeline.*

**Phase 9 — Hardening & the tuning pass.** Full invariant sweep, golden frames, perf budget, and the information and ammunition tuning that decides whether this works. *Gate: MVP acceptance — §14.*

---

## 13. Open items

1. **The mission — now the most urgent open item.** With both sides burning rounds and enemy strength unknown, the safe play is often not to fight, and withdrawal would become dominant. MVP needs a reason to press: ground that must be taken, a route that must be opened, a flank that must be protected, or a time limit imposed from above. Without it the game is passive. Worth deciding before Phase 7, not Phase 8.
2. **World size.** Suggest 400–600 m rather than the reference's 2,400 m, reclaiming budget for density.
3. **Order input method.** Third person suits verbal-style orders ("2 Section, left flanking, go"), and sound off / mag check / rate changes fit that idiom naturally. Worth confirming — it shapes the UI.
4. **Enemy behaviour, post-MVP.** Deliberate silence to bait an observer is the natural predator of this design and remains fair under §1. Flagged for the enemy-behaviour pass.
5. **Casualty care, post-MVP.** Whether wounded men can be treated, dragged, or must be left — and how that interacts with a fog in which you may not know a man needs help. Large, with real emotional weight.

---

## 14. MVP definition of done

You are lying in long grass on a rolling hillside, wind moving across the meadow, horizon dissolving into haze. Effective fire comes from a position you have not located, held by you-do-not-know-how-many men with you-do-not-know-how-many rounds.

Your men go down and extract themselves by individual fire and movement into a baseline, never violating one-foot-on-the-ground. Somewhere to your left a man is hit and screams. Somewhere to your right another is hit and does not. You call a sound off: five answer effective, one answers hit, two do not answer at all. You call a mag check and learn the section has burned more than you thought while you were deciding.

You weigh whether to raise up and look — or to order someone else to — knowing what raising up costs and that the answer may never come back. The fire goes ragged and you cannot tell why.

You pause; your mental map resolves from evidence, not from truth. You order the rate up, hear the enemy slacken, and have to decide whether that means you have won, or that they are reloading, or that they are waiting. You commit, or you withdraw — with smoke if the wind allows and fire and movement if it does not.

Then the after-action replay shows you what was actually happening, and when.

*Machine-verifiable:* determinism across speeds, doctrinal invariants across 100 seeds, markers-never-read-truth, every-belief-has-evidence, silent-casualty-produces-no-evidence, no-notification-on-fire-control-lapse, enemy-ammunition-never-exposed, two-sided ammunition conservation, frame budget, golden frames.
*Human-verifiable:* it looks right, it moves like a section, both clocks bite, and the uncertainty is tense rather than annoying.

---

## 15. Effort

Roughly **eleven to fifteen focused sessions** for a strong vertical slice. Enemy ammunition cost almost nothing to add and bought a great deal; casualties-lie-there removed work; the mission framing added a little.

The long pole is no longer art direction — that has a reference to converge on. It is **information and ammunition tuning**, which have nothing to converge on except your judgement of whether the fog is tense and the clocks bite. That can only be found by playing it, and it is what decides whether the game works.
