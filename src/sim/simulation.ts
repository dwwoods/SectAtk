// Simulation — the composition root. The design doc describes the sim as a
// pure, deterministic, headless function `(state, orders, dt) → state`
// (§9.4); this is the file that hosts it. Owns the World store, the RNG,
// the clock, the friendly section, the enemy position, and the firefight
// resolution state.
//
// Per tick, it runs the systems in a fixed order: friendly fire, enemy
// fire, suppression decay, ammo processing, firefight resolution. Each
// tick emits SimEvents — the truth stream that the knowledge system
// (Phase 5) consumes. Nothing here imports from /render, /ui, or /audio.

import type { RngState } from './rng';
import { createRng, nextFloat } from './rng';
import { World } from './world';
import type { Soldier, SoldierSide } from './soldier';
import { createRifleman, isAlive, effectiveRof, canFight, canMove, updateMorale } from './soldier';
import type { AmmoState } from './ammunition';
import { createAmmo, expend, processAmmoTick, type AmmoEvent } from './ammunition';
import type { Wound } from './wounds';
import {
  FIXED_DT,
  FIREFIGHT_WON_ROF_THRESHOLD,
  FIREFIGHT_WON_SUSTAINED,
  SUPPRESSION_DECAY,
  MORALE_CASUALTY_RANGE,
  MAGS_PER_MAN,
  BANDOLIER_ROUNDS,
  TWO_IC_EXTRA_BANDOLIER,
  MISSION_OBJECTIVE_RADIUS,
  MISSION_HOLD_MEN,
  MISSION_HOLD_SECONDS,
  MISSION_MIN_EFFECTIVES,
  PINNED_SUPPRESSION,
  SMOKE_GRENADES_PER_SECTION,
  SMOKE_DURATION_SECONDS,
  SMOKE_RADIUS,
  SMOKE_THROW_DIST,
  SMOKE_DRIFT_SPEED,
  OUT_OF_CONTACT_SECONDS,
  MASK_CONE_DEG,
  ASSAULT_RAPID_DIST,
  BOUND_LENGTH,
  BASELINE_SPACING,
  CONTACT_EARSHOT_RANGE,
} from './config';
import type { FireIntent } from './config';
import { createEnemySection, processEnemyFire } from './enemy/position';
import { getExposureProfile, getCoverFactor } from './exposure';
import { resolveShot } from './ballistics';
import { soldierLos } from './los';
import type { StanceName, Vec2, SmokeCloud } from './types';
import type { WorldGen } from '../worldgen';
import {
  createKnowledge,
  updateEnemyPosition,
  updateEnemyFiring,
  type KnowledgeState,
  type Journal,
  type Evidence,
} from './knowledge/knowledge';
import { processObservationEvent } from './knowledge/observation';
import { processCryEvent } from './knowledge/audible';
import { processSoundOff, processMagCheck } from './knowledge/elicited';
import { TIER2_ORDER_DURATION } from './config';
import { processFireControl } from './behaviour/fireControl';
import { processMovement, processContactReactions, triggerContactReaction } from './behaviour/individual';
import { formBaseline } from './behaviour/baseline';
import {
  sectionWithdraw,
  sectionAssault,
  processWithdrawal,
  isWithdrawalFinished,
  type WithdrawalPlan,
} from './behaviour/section';
import { assignFireteams, offsetAxis, centroidOf, lineUp } from './behaviour/fireteam';
import { applyAreaFire } from './behaviour/areaFire';

// ── events ─────────────────────────────────────────────────────────────────
// The truth stream emitted per tick. Knowledge (Phase 5) consumes these to
// update the commander's picture. Tests assert on them directly.
//
// Events are plain serializable data — soldier IDS, never live Soldier
// references — so the stream can be journaled and replayed (AAR, Phase 8)
// and no consumer can reach through an event to mutate ground truth.
// Consumers resolve ids via sim.world.getEntity().

export type SimEvent =
  | { type: 'friendly-fired'; soldierId: string; targetId: string }
  | { type: 'enemy-fired'; soldierId: string; targetId: string }
  | { type: 'friendly-wounded'; soldierId: string; wound: Wound; silent: boolean }
  | { type: 'enemy-wounded'; soldierId: string; wound: Wound }
  | { type: 'enemy-killed'; soldierId: string; silent: boolean }
  | { type: 'friendly-killed'; soldierId: string; silent: boolean }
  | { type: 'cry'; soldierId: string; wound: Wound }
  | { type: 'suppressed'; soldierId: string; amount: number }
  | { type: 'ammo'; soldierId: string; event: AmmoEvent }
  | { type: 'ran-dry'; side: SoldierSide }
  | { type: 'mission'; status: 'taken' | 'failed' }
  | { type: 'out-of-contact' };

// ── orders ─────────────────────────────────────────────────────────────────
// The commander's intent surface. Phase 4 implements stance/fire intent;
// sound-off and mag-check land in Phase 5 (knowledge) but the order shapes
// exist now so the sim interface is stable.

export type Order =
  | { type: 'set-fire-intent'; intent: FireIntent }
  | { type: 'stance'; manId: string; stance: StanceName }
  | { type: 'move'; manId: string; target: Vec2 }
  | { type: 'halt'; manId: string }
  | { type: 'form-baseline' }
  | { type: 'withdraw'; rally: Vec2 }
  | { type: 'smoke' }
  | { type: 'assault' }
  | { type: 'observe'; manId?: string }
  | { type: 'stop-observe'; manId?: string }
  | { type: 'sound-off' }
  | { type: 'mag-check' };

// ── firefight resolution ───────────────────────────────────────────────────
const WINDOW_TICKS = Math.round(10 / FIXED_DT); // 10-second sliding window

export interface FirefightState {
  enemyShotsThisWindow: number;
  windowTicks: number;
  /** Ticks the enemy ROF has held below threshold (cumulative, reset when
      it rises again). */
  sustainedLowTicks: number;
  won: boolean;
}

export function createFirefightState(): FirefightState {
  return { enemyShotsThisWindow: 0, windowTicks: 0, sustainedLowTicks: 0, won: false };
}

// ── the sim ────────────────────────────────────────────────────────────────

export interface Scenario {
  /** Friendly section start positions, 8 men in a baseline. */
  friendlyStart: Array<{ name: string; role: Soldier['role']; pos: { x: number; z: number } }>;
  /** Enemy position centroid. */
  enemyPosition: { x: number; z: number };
  enemySpread: number;
  enemyHeading: number;
  /** The ground that must be taken (design doc §13.1). Omitted = free
      play, no mission state. */
  objective?: { pos: Vec2; radius?: number };
  /** Rally point for a doctrinal withdrawal. Omitted = the UI computes
      one to the section's rear. */
  rally?: Vec2;
}

export type MissionStatus = 'none' | 'active' | 'taken' | 'failed';

export interface MissionState {
  status: MissionStatus;
  /** Consecutive ticks the objective has been held (reorg clock). */
  holdTicks: number;
}

export class Simulation {
  readonly rng: RngState;
  readonly world: World<Soldier>;
  readonly friendlies: Soldier[];
  readonly enemySection: ReturnType<typeof createEnemySection>;
  readonly worldgen: WorldGen;
  readonly knowledge: KnowledgeState;
  readonly journal: Journal = [];
  tick = 0;
  readonly firefight: FirefightState = createFirefightState();
  /** Events emitted this tick (cleared each tick). */
  events: SimEvent[] = [];
  /** A soldier currently observing (exposure tell). */
  observing: Map<string, boolean> = new Map();
  /** Ticks remaining before a pending tier-2 order (sound-off/mag-check)
      completes. While >0, the commander is busy and cannot observe or issue
      another tier-2 order. This is the time cost of information (§3.3). */
  tier2BusyTicks = 0;
  /** The pending tier-2 order type, set when queued. */
  pendingTier2: 'sound-off' | 'mag-check' | null = null;
  /** Relayed observations in flight — sighted by a man other than the
      commander, landing RELAY_DELAY_TICKS later with a bearing error
      already baked in (design doc §3.1). Plain serializable data, drained
      in step(); included in the determinism gate. */
  readonly relayQueue: Array<{ landTick: number; observerId: string; position: Vec2 }> = [];
  /** Mission — ground must be taken. Truth lives here; what the
      commander can READ of it is his own men's reports and his eyes. */
  readonly mission: MissionState = { status: 'none', holdTicks: 0 };
  readonly objective: { pos: Vec2; radius: number } | null = null;
  readonly rally: Vec2 | null = null;
  /** The commander's standing fire intent for the section. The 2IC
      translates it to per-man rates each tick — while he can (§4.2). */
  sectionIntent: FireIntent = 'hold';
  /** Sequenced withdrawal plan, or null when no withdrawal is in progress
      (design doc §2.5). */
  withdrawalPlan: WithdrawalPlan | null = null;
  /** Consecutive ticks with no enemy LOS to any friendly — the out-of-
      contact clock, only meaningful while a withdrawal is in progress. */
  noContactTicks = 0;
  /** Smoke grenades left in the section's inventory — his own kit, read
      directly by the UI (not a Knowledge belief). */
  smokeInventory = SMOKE_GRENADES_PER_SECTION;
  /** Active smoke clouds, drifting with the wind each tick. */
  smokeClouds: SmokeCloud[] = [];
  private nextSmokeId = 0;
  /** Fireteams & the offset assault (design doc §8, the excalidraw).
      `active` while an 'assault' order is in effect; `split` records
      whether the two-team technique ran or the section fell back to one
      line (too few able Delta men); `reorgDone` latches the one automatic
      mag check battle drill 6 fires — never more than once per assault. */
  assaultState: { active: boolean; split: boolean; reorgDone: boolean; magCheckIssued: boolean } = {
    active: false,
    split: false,
    reorgDone: false,
    magCheckIssued: false,
  };

  constructor(scenario: Scenario, worldgen: WorldGen, seed = 20260728) {
    this.rng = createRng(seed);
    this.worldgen = worldgen;
    this.world = new World<Soldier>();

    // Friendly section: 8 men, commander + 2IC + 6 riflemen.
    this.friendlies = scenario.friendlyStart.map((f, i) => {
      const ammo: AmmoState = f.role === 'twoIC'
        ? createAmmo(MAGS_PER_MAN, BANDOLIER_ROUNDS + TWO_IC_EXTRA_BANDOLIER)
        : createAmmo(MAGS_PER_MAN, BANDOLIER_ROUNDS);
      const s = createRifleman(`sec-${i + 1}`, f.role, f.name, f.pos, 0, ammo);
      this.world.addEntity(s.id, s);
      return s;
    });

    // Fireteams: Charlie (fire support) / Delta (the assault group), a
    // fixed split by roster order (behaviour/fireteam.ts). The 2IC's
    // section-wide fire-control duties are unaffected.
    assignFireteams(this.friendlies);
    this.enemySection = createEnemySection(
      scenario.enemyPosition,
      scenario.enemySpread,
      scenario.enemyHeading,
    );
    for (const e of this.enemySection.soldiers) {
      this.world.addEntity(e.id, e);
    }

    this.knowledge = createKnowledge(
      this.friendlies.map((f) => ({ id: f.id, name: f.name })),
    );

    if (scenario.objective) {
      this.objective = {
        pos: { ...scenario.objective.pos },
        radius: scenario.objective.radius ?? MISSION_OBJECTIVE_RADIUS,
      };
      this.mission.status = 'active';
    }
    if (scenario.rally) this.rally = { ...scenario.rally };
  }

  applyOrder(order: Order): void {
    switch (order.type) {
      case 'set-fire-intent':
        // The commander sets INTENT only. The 2IC translates it into
        // per-man rates each tick (behaviour/fireControl.ts) — and if
        // the 2IC is down, nobody is managing fire: rates stop being
        // adjusted and the order changes nothing (design doc §4.2).
        this.sectionIntent = order.intent;
        break;
      case 'form-baseline': {
        // The commander forms a baseline on the threat AS HE BELIEVES IT
        // — the order is predicated on Knowledge, never ground truth
        // (§9.4). No located enemy, no bearing, no baseline. Supersedes any
        // assault in progress — the section is reforming, not advancing.
        this.deactivateAssault();
        const believed = this.knowledge.enemy.position;
        if (believed) formBaseline(this.friendlies, believed);
        break;
      }
      case 'withdraw': {
        // Doctrinal withdrawal: sequenced release, furthest-from-the-
        // threat first (§2.5). The commander re-issuing 'withdraw' mid-
        // withdrawal replans from current positions — this is how a
        // halted (out-of-contact) plan resumes once he re-decides. A
        // withdrawal supersedes any assault in progress.
        this.deactivateAssault();
        const believed = this.knowledge.enemy.position;
        const plan = sectionWithdraw(this.friendlies, order.rally, believed);
        this.withdrawalPlan = plan.entries.length > 0 ? plan : null;
        this.noContactTicks = 0;
        break;
      }
      case 'assault': {
        // Battle drill 5 — the attack. The section fights THROUGH the
        // position as the commander BELIEVES it to be (§9.4: no order on
        // information he does not hold). Enemy not located → no assault.
        const believed = this.knowledge.enemy.position;
        if (believed) {
          const result = sectionAssault(this.friendlies, believed);
          this.assaultState = { active: true, split: result.split, reorgDone: false, magCheckIssued: false };
          for (const f of this.friendlies) f.assaultRapid = false;
        }
        break;
      }
      case 'smoke': {
        // The commander throws smoke toward the believed threat (§2.5).
        // Predicated on Knowledge like form-baseline/assault — and on
        // actually having one left; the order no-ops at zero, inventory
        // never goes negative.
        if (this.smokeInventory <= 0) break;
        const believed = this.knowledge.enemy.position;
        if (!believed) break;
        let cx = 0;
        let cz = 0;
        let n = 0;
        for (const f of this.friendlies) {
          if (!isAlive(f)) continue;
          cx += f.pos.x;
          cz += f.pos.z;
          n++;
        }
        if (n === 0) break;
        cx /= n;
        cz /= n;
        const dx = believed.x - cx;
        const dz = believed.z - cz;
        const d = Math.hypot(dx, dz) || 1;
        this.smokeInventory--;
        this.smokeClouds.push({
          id: `smoke-${this.nextSmokeId++}`,
          pos: { x: cx + (dx / d) * SMOKE_THROW_DIST, z: cz + (dz / d) * SMOKE_THROW_DIST },
          radius: SMOKE_RADIUS,
          remaining: SMOKE_DURATION_SECONDS,
        });
        break;
      }
      case 'move': {
        const man = this.world.getEntity(order.manId);
        if (man && man.side === 'friendly' && isAlive(man) && canMove(man)) {
          man.moveTarget = { x: order.target.x, z: order.target.z };
        }
        break;
      }
      case 'halt': {
        const man = this.world.getEntity(order.manId);
        if (man) man.moveTarget = null; // finishes the current bound, then stays down
        break;
      }
      case 'stance': {
        const man = this.world.getEntity(order.manId);
        if (man) {
          man.stance = order.stance;
          // Going prone or crouch ends observation.
          if (order.stance !== 'stand') this.observing.delete(order.manId);
        }
        break;
      }
      case 'observe': {
        // The commander (or a named man) stands up to look. This is the
        // risk currency in action (design doc §2.1). Observing raises
        // exposure until told otherwise.
        const manId = order.manId ?? this.friendlies[0]?.id;
        if (manId) {
          const man = this.world.getEntity(manId);
          if (man) {
            man.stance = 'stand';
            this.observing.set(manId, true);
          }
        }
        break;
      }
      case 'sound-off':
        this.queueTier2('sound-off');
        break;
      case 'mag-check':
        this.queueTier2('mag-check');
        break;
      case 'stop-observe': {
        const manId = order.manId ?? this.friendlies[0]?.id;
        if (manId) {
          this.observing.delete(manId);
          const man = this.world.getEntity(manId);
          if (man) man.stance = 'prone';
        }
        break;
      }
    }
  }

  step(dt: number = FIXED_DT): SimEvent[] {
    if (dt !== FIXED_DT) {
      // The clock MUST only ever call with FIXED_DT (see CLAUDE.md). This
      // guard is a belt-and-braces assertion of the fixed-timestep rule.
      throw new Error(`step() called with dt=${dt}; only FIXED_DT is legal`);
    }
    this.events = [];
    this.tick++;

    // 0. Fire control — the 2IC translates section intent to per-man
    //    rates and rotates men out to re-bomb. Lapses silently with him.
    processFireControl(this.friendlies, this.sectionIntent);

    // 0.4. Withdrawal — sequenced release, furthest-from-the-threat first
    //      (§2.5). Released men get a moveTarget; processMovement below
    //      still arbitrates every actual bound.
    processWithdrawal(this.withdrawalPlan, this.friendlies);

    // 0.5. Individual fire & movement — bounds gated by the two doctrinal
    //      conditions (one foot on the ground / no move without fire).
    processMovement(this.friendlies, dt);

    // 0.6. Final-bound rapid (fireteams & the offset assault, design doc
    //      §8): must land AFTER fire control and BEFORE the fire step below,
    //      so the override is what this tick's fire roll actually reads —
    //      not next tick's, after fire control has already overwritten it.
    this.applyAssaultRapid();

    // 0.7. Contact reaction — Battle Drill 2 (dash-down-crawl). Independent
    //      of the bound machinery above and its mover cap; triggered below
    //      off this tick's enemy fire results (step 2).
    processContactReactions(this.friendlies, dt);
    // 1. Friendly fire: each alive friendly fires at the enemy position.
    for (const f of this.friendlies) {
      if (!isAlive(f) || !canFight(f)) continue;
      const rof = effectiveRof(f);
      if (rof <= 0) continue;
      // Probabilistic per-tick firing: P(fire this tick) = rof * dt.
      if (nextFloat(this.rng) >= rof * dt) continue;

      const target = this.nearestEnemy(f);
      if (!target) {
        // Speculative area fire — Battle Drill 2. No LOS'd target, but if
        // the section is in contact and the commander believes he knows
        // where the enemy is, fire at that believed area (design doc §8
        // ext.). Suppression only; rounds still come off real ammo.
        const believed = this.knowledge.enemy.position;
        if (believed && this.knowledge.enemy.firing) {
          applyAreaFire(f, believed, this.enemySection.soldiers);
        }
        continue;
      }

      // Mask check (switch/lift fire): a fire-support man must not fire
      // when a live friendly is nearer than the target and within
      // MASK_CONE_DEG of his line to it. Scoped to fire support during a
      // split assault — that's the only configuration where one team is
      // meant to shoot past another closing on the same ground. No flag,
      // no notification — pure geometry, recomputed fresh every tick, so
      // support fire lifts naturally as the assault masks it.
      const isFireSupport = this.assaultState.active && this.assaultState.split && f.fireteam === 'C';
      if (isFireSupport) {
        const tdx = target.pos.x - f.pos.x;
        const tdz = target.pos.z - f.pos.z;
        const tdist = Math.hypot(tdx, tdz) || 1;
        const tux = tdx / tdist;
        const tuz = tdz / tdist;
        let masked = false;
        for (const g of this.friendlies) {
          if (g === f || !isAlive(g)) continue;
          const gdx = g.pos.x - f.pos.x;
          const gdz = g.pos.z - f.pos.z;
          const gdist = Math.hypot(gdx, gdz);
          if (gdist <= 0.01 || gdist >= tdist) continue; // not nearer than the target
          const cosA = Math.min(1, Math.max(-1, (gdx * tux + gdz * tuz) / gdist));
          const angleDeg = (Math.acos(cosA) * 180) / Math.PI;
          if (angleDeg <= MASK_CONE_DEG) { masked = true; break; }
        }
        if (masked) continue;
      }

      const fired = expend(f.ammo, 1);
      if (fired === 0) continue; // mag empty — step 4 starts the reload

      const profile = getExposureProfile(
        target.stance, target.pos, false, this.worldgen.meadow,
      );
      const dist = Math.hypot(target.pos.x - f.pos.x, target.pos.z - f.pos.z);
      const result = resolveShot(this.rng, {
        sx: f.pos.x, sz: f.pos.z,
        tx: target.pos.x, tz: target.pos.z,
        targetProfile: profile,
        range: dist,
        coverFactor: getCoverFactor(this.worldgen.coverDF, target.pos.x, target.pos.z),
        shooterSuppression: f.suppression,
      }, this.tick);

      if (result.hit && result.wound) {
        target.wound = result.wound;
        const silent = result.wound.severity === 'fatal-cns' || result.wound.location === 'throat';
        this.events.push({ type: 'enemy-wounded', soldierId: target.id, wound: result.wound });
        if (target.wound.severity === 'fatal-cns' || target.wound.severity === 'mortal') {
          this.events.push({ type: 'enemy-killed', soldierId: target.id, silent });
        }
      } else if (result.suppressionAdded > 0) {
        target.suppression = Math.min(1, target.suppression + result.suppressionAdded);
        this.events.push({ type: 'suppressed', soldierId: target.id, amount: result.suppressionAdded });
      }
      this.events.push({ type: 'friendly-fired', soldierId: f.id, targetId: target.id });
    }

    // 2. Enemy fire.
    const enemyShots = processEnemyFire(
      this.enemySection, this.friendlies, this.rng,
      this.worldgen, this.tick, this.smokeClouds,
    );
    for (const shot of enemyShots) {
      this.events.push({ type: 'enemy-fired', soldierId: shot.source.id, targetId: shot.target.id });
      const r = shot.result;
      if (r.hit && r.wound) {
        const silent = r.wound.severity === 'fatal-cns' || r.wound.location === 'throat';
        this.events.push({ type: 'friendly-wounded', soldierId: shot.target.id, wound: r.wound, silent });
        // A wounded man who can shout cries — the audible channel (Phase 5)
        // consumes this. The silent flag is the mechanic: no event = no
        // sound = the commander never learns.
        if (!silent) {
          this.events.push({ type: 'cry', soldierId: shot.target.id, wound: r.wound });
        }
        if (!isAlive(shot.target)) {
          this.events.push({ type: 'friendly-killed', soldierId: shot.target.id, silent });
        }
      } else if (r.suppressionAdded > 0) {
        shot.target.suppression = Math.min(1, shot.target.suppression + r.suppressionAdded);
        this.events.push({ type: 'suppressed', soldierId: shot.target.id, amount: r.suppressionAdded });
      }

      // Contact reaction — Battle Drill 2: a near-miss or a casualty
      // triggers dash-down-crawl in the man hit, and in any uninjured,
      // able friendly within earshot of a casualty.
      if (r.suppressionAdded > 0) {
        triggerContactReaction(shot.target, shot.source.pos);
      }
      if (r.hit && r.wound) {
        triggerContactReaction(shot.target, shot.source.pos);
        for (const other of this.friendlies) {
          if (other.id === shot.target.id) continue;
          const d = Math.hypot(other.pos.x - shot.target.pos.x, other.pos.z - shot.target.pos.z);
          if (d <= CONTACT_EARSHOT_RANGE) {
            triggerContactReaction(other, shot.source.pos);
          }
        }
      }
    }

    // 3. Suppression decay (both sides) — rate scaled by morale.
    const moraleScaledDecay = (s: Soldier) => SUPPRESSION_DECAY * (0.5 + 0.5 * s.morale);
    for (const f of this.friendlies) {
      // Did a friendly get wounded/killed this tick within morale range?
      const nearbyCasualty = this.events.some((ev) => {
        if (ev.type !== 'friendly-wounded' && ev.type !== 'friendly-killed') return false;
        if (ev.soldierId === f.id) return false;
        const cas = this.world.getEntity(ev.soldierId);
        return !!cas && Math.hypot(cas.pos.x - f.pos.x, cas.pos.z - f.pos.z) < MORALE_CASUALTY_RANGE;
      });
      updateMorale(f, nearbyCasualty, dt);
      f.suppression = Math.max(0, f.suppression - moraleScaledDecay(f) * dt);
    }
    for (const e of this.enemySection.soldiers) {
      updateMorale(e, false, dt);
      e.suppression = Math.max(0, e.suppression - moraleScaledDecay(e) * dt);
    }

    // 4. Ammo processing (reloads, re-bombing).
    for (const f of this.friendlies) {
      const ammoEvents = processAmmoTick(f, dt);
      for (const ev of ammoEvents) this.events.push({ type: 'ammo', soldierId: f.id, event: ev });
    }
    for (const e of this.enemySection.soldiers) {
      processAmmoTick(e, dt);
    }

    // 5. Firefight resolution.
    this.stepFirefight(enemyShots.length);

    // 5.5. Mission — ground must be taken (battle drills 5 & 6).
    this.stepMission();

    // 5.6. Smoke clouds — drift with the wind, expire (§2.5). If the wind
    //      carries one off the line between the section and the threat,
    //      it was wasted — that is the design, not a bug.
    {
      const windAngle = this.worldgen.windAngle;
      const driftX = Math.cos(windAngle) * SMOKE_DRIFT_SPEED * dt;
      const driftZ = Math.sin(windAngle) * SMOKE_DRIFT_SPEED * dt;
      this.smokeClouds = this.smokeClouds.filter((cloud) => {
        cloud.remaining -= dt;
        if (cloud.remaining <= 0) return false;
        cloud.pos.x += driftX;
        cloud.pos.z += driftZ;
        return true;
      });
    }

    // 5.7. Out-of-contact — a withdrawal in progress halts here if no enemy
    //      has had LOS to any friendly for OUT_OF_CONTACT_SECONDS. Men
    //      mid-bound finish it, then hold; the plan does NOT auto-continue
    //      to the rally — the commander re-decides (a fresh 'withdraw'
    //      order replans whoever has not yet arrived).
    if (this.withdrawalPlan && !this.withdrawalPlan.halted) {
      if (isWithdrawalFinished(this.withdrawalPlan, this.friendlies)) {
        this.withdrawalPlan = null;
      } else {
        let contact = false;
        for (const e of this.enemySection.soldiers) {
          if (!isAlive(e)) continue;
          for (const f of this.friendlies) {
            if (!isAlive(f)) continue;
            if (soldierLos(e, f, this.worldgen, this.smokeClouds).clear) { contact = true; break; }
          }
          if (contact) break;
        }
        if (contact) {
          this.noContactTicks = 0;
        } else {
          this.noContactTicks++;
          if (this.noContactTicks >= Math.round(OUT_OF_CONTACT_SECONDS / FIXED_DT)) {
            this.withdrawalPlan.halted = true;
            this.events.push({ type: 'out-of-contact' });
          }
        }
      }
    }

    // 5.8. Fireteams & the offset assault — final-bound rapid and the
    //      one-shot reorg (battle drill 6).
    this.stepAssault();

    // 6. Process pending tier-2 orders (the time cost of information, §3.3).
    //    While a sound-off/mag-check is in flight the commander is busy and
    //    cannot observe or issue another one.
    if (this.tier2BusyTicks > 0) {
      this.tier2BusyTicks--;
      if (this.tier2BusyTicks === 0 && this.pendingTier2) {
        const orderType = this.pendingTier2;
        this.pendingTier2 = null;
        if (orderType === 'sound-off') {
          processSoundOff(this, this.knowledge, this.journal, this.rng);
        } else {
          processMagCheck(this, this.knowledge, this.journal, this.rng);
        }
      }
    }

    // 7. Consume events into knowledge.
    for (const ev of this.events) {
      processObservationEvent(ev, this, this.knowledge, this.journal);
      if (ev.type === 'cry') {
        processCryEvent(ev, this, this.knowledge, this.journal);
      }
    }

    // 7.5. Land relayed observations whose delay has elapsed. Kind stays
    //      'observation' (not a new evidence kind) — only the sourceId (not
    //      the commander) and the bearing-corrupted position mark it as a
    //      relayed report rather than a direct sighting.
    while (this.relayQueue.length > 0 && this.relayQueue[0]!.landTick <= this.tick) {
      const relay = this.relayQueue.shift()!;
      const evidence: Evidence = {
        kind: 'observation',
        tick: this.tick,
        sourceId: relay.observerId,
        note: `Relayed sighting from ${relay.observerId}`,
      };
      updateEnemyPosition(this.knowledge, this.journal, relay.position, evidence);
      updateEnemyFiring(this.knowledge, this.journal, true, evidence);
    }
    return this.events;
  }

  /** Queue a tier-2 order. No stacking: a second sound-off/mag-check while
      one is in flight is ignored, and observing is cleared for the duration
      (you cannot look and listen at the same time). */
  /** Queue a tier-2 order. No stacking: a second sound-off/mag-check while
      one is in flight is ignored (returns false), and observing is cleared
      for the duration (you cannot look and listen at the same time). */
  private queueTier2(type: 'sound-off' | 'mag-check'): boolean {
    if (this.tier2BusyTicks > 0) return false;
    for (const key of this.observing.keys()) this.observing.delete(key);
    this.tier2BusyTicks = Math.round(TIER2_ORDER_DURATION / FIXED_DT);
    this.pendingTier2 = type;
    return true;
  }

  /** Supersede any in-progress assault: clear the state and release the
      sticky rapid flag (it does not outlive the order it was for). */
  private deactivateAssault(): void {
    this.assaultState = { active: false, split: false, reorgDone: false, magCheckIssued: false };
    for (const f of this.friendlies) f.assaultRapid = false;
  }

  /** Nearest alive enemy with a clear line of sight — you cannot shoot a
      man you cannot see (terrain blocks the shot entirely). */
  nearestEnemy(from: Soldier): Soldier | null {
    let best: Soldier | null = null;
    let bestD = Infinity;
    for (const e of this.enemySection.soldiers) {
      if (!isAlive(e)) continue;
      const d = Math.hypot(e.pos.x - from.pos.x, e.pos.z - from.pos.z);
      if (d < bestD && soldierLos(from, e, this.worldgen, this.smokeClouds).clear) { bestD = d; best = e; }
    }
    return best;
  }

  /** Mission — ground must be taken (design doc §13.1; battle drills
      5 & 6). TAKEN when MISSION_HOLD_MEN are on the objective and every
      enemy on it can no longer resist (dead, out of the fight, or
      pinned), held continuously for MISSION_HOLD_SECONDS — the reorg.
      FAILED when the section drops below MISSION_MIN_EFFECTIVES able to
      fight: combat-ineffective, the attack cannot be pressed. */
  private stepMission(): void {
    if (this.mission.status !== 'active' || !this.objective) return;

    let effectives = 0;
    for (const f of this.friendlies) {
      if (isAlive(f) && canFight(f)) effectives++;
    }
    if (effectives < MISSION_MIN_EFFECTIVES) {
      this.mission.status = 'failed';
      this.events.push({ type: 'mission', status: 'failed' });
      return;
    }

    const { pos, radius } = this.objective;
    let holding = 0;
    for (const f of this.friendlies) {
      if (!isAlive(f)) continue;
      if (Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z) <= radius) holding++;
    }
    let resistance = 0;
    for (const e of this.enemySection.soldiers) {
      if (isAlive(e) && canFight(e) && e.suppression < PINNED_SUPPRESSION) resistance++;
    }

    if (holding >= MISSION_HOLD_MEN && resistance === 0) {
      this.mission.holdTicks++;
      if (this.mission.holdTicks >= Math.round(MISSION_HOLD_SECONDS / FIXED_DT)) {
        this.mission.status = 'taken';
        this.events.push({ type: 'mission', status: 'taken' });
      }
    } else {
      this.mission.holdTicks = 0;
    }
  }

  /** Fireteams & the offset assault (design doc §8, the excalidraw).
      Final-bound rapid: once an assaulting man's next bound could put him
      inside ASSAULT_RAPID_DIST of the believed position, his rate goes to
      rapid for the rest of the assault — sticky, and re-asserted onto the
      fireIntent field the 2IC writes every tick, so it never has to fight
      his rotation (fireControl.ts is untouched).
      Reorg (battle drill 6): triggers exactly once, the moment the
      objective hold clock starts ticking over. */
  /** Final-bound rapid (fireteams & the offset assault, design doc §8).
      Once an assaulting man's next bound could put him inside
      ASSAULT_RAPID_DIST of the believed position, his rate goes to rapid
      for the rest of the assault — sticky, and re-asserted onto the
      fireIntent field the 2IC writes every tick, so it never has to fight
      his rotation (fireControl.ts is untouched). Must run AFTER
      processFireControl and BEFORE the fire step in the same tick, so the
      override is live for this tick's fire roll. Stops once reorg has
      fired — a man standing on the objective must not re-trip it forever. */
  private applyAssaultRapid(): void {
    if (!this.assaultState.active || this.assaultState.reorgDone) return;
    const believed = this.knowledge.enemy.position;

    if (believed) {
      for (const f of this.friendlies) {
        if (!isAlive(f)) continue;
        const assaulting = this.assaultState.split ? f.fireteam === 'D' : true;
        if (!assaulting) continue;
        if (!f.assaultRapid) {
          const dist = Math.hypot(f.pos.x - believed.x, f.pos.z - believed.z);
          if (dist - BOUND_LENGTH <= ASSAULT_RAPID_DIST) f.assaultRapid = true;
        }
      }
    }
    for (const f of this.friendlies) {
      if (f.assaultRapid) f.fireIntent = 'rapid';
    }
  }

  /** Reorg (battle drill 6): triggers exactly once, the moment the
      objective hold clock starts ticking over. Runs after stepMission, so
      it sees this tick's holdTicks. */
  private stepAssault(): void {
    if (!this.assaultState.active) return;

    if (!this.assaultState.reorgDone && this.mission.holdTicks === 1) {
      this.triggerReorg();
      this.assaultState.reorgDone = true;
    }
    // The mag check may have been refused (a sound-off already in flight
    // when the reorg fired) — keep asking until the tier-2 pipeline
    // actually accepts it, so "exactly one" still means exactly one, not
    // zero.
    if (this.assaultState.reorgDone && !this.assaultState.magCheckIssued) {
      if (this.queueTier2('mag-check')) this.assaultState.magCheckIssued = true;
    }

    // Fire support settling onto the objective line overwrites its own
    // heading while bounding (individual.ts faces a man toward his
    // target while he moves). Re-face everyone who has arrived and
    // stopped — "all-round defence" has to hold once men are down, not
    // just at the instant reorg fired.
    if (this.assaultState.reorgDone && this.objective) {
      const centre = this.objective.pos;
      for (const f of this.friendlies) {
        if (!isAlive(f) || f.bounding || f.moveTarget !== null) continue;
        const dx = f.pos.x - centre.x;
        const dz = f.pos.z - centre.z;
        if (dx !== 0 || dz !== 0) f.heading = Math.atan2(dz, dx);
      }
    }
  }

  /** Battle drill 6 — reorganisation. All men face outward (reuses
      heading; no new field), final-bound rapid is cancelled (it does not
      outlive the assault it was for), and fire support is released to
      move up onto the objective line. The automatic mag check itself is
      queued by stepAssault above, through the existing tier-2 pipeline —
      same latency, same ambiguity, as if the commander had ordered it. No
      free information. */
  private triggerReorg(): void {
    const centre = this.objective ? this.objective.pos : null;
    if (centre) {
      for (const f of this.friendlies) {
        if (!isAlive(f)) continue;
        const dx = f.pos.x - centre.x;
        const dz = f.pos.z - centre.z;
        if (dx !== 0 || dz !== 0) f.heading = Math.atan2(dz, dx);
      }
    }

    for (const f of this.friendlies) f.assaultRapid = false;

    if (this.assaultState.split && this.objective) {
      const charlie = this.friendlies.filter((f) => f.fireteam === 'C');
      const charlieAble = charlie.filter((f) => isAlive(f));
      const axis = charlieAble.length > 0
        ? offsetAxis(centroidOf(charlieAble), this.objective.pos, 0)
        : { x: 1, z: 0 };
      lineUp(charlie, this.objective.pos, axis, BASELINE_SPACING);
    }
  }
  private stepFirefight(enemyShotsThisTick: number): void {
    const ff = this.firefight;
    ff.enemyShotsThisWindow += enemyShotsThisTick;
    ff.windowTicks++;
    if (ff.windowTicks >= WINDOW_TICKS) {
      const rof = ff.enemyShotsThisWindow / (WINDOW_TICKS * FIXED_DT);
      if (rof < FIREFIGHT_WON_ROF_THRESHOLD) {
        ff.sustainedLowTicks += ff.windowTicks;
      } else {
        ff.sustainedLowTicks = 0;
      }
      ff.enemyShotsThisWindow = 0;
      ff.windowTicks = 0;
      if (ff.sustainedLowTicks >= Math.round(FIREFIGHT_WON_SUSTAINED / FIXED_DT)) {
        ff.won = true;
      }
    }
  }
}