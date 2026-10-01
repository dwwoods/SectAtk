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
import { createRifleman, isAlive, effectiveRof, canFight, updateMorale } from './soldier';
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
} from './config';
import type { FireIntent } from './config';
import { createEnemySection, processEnemyFire } from './enemy/position';
import { getExposureProfile, getCoverFactor } from './exposure';
import { resolveShot } from './ballistics';
import { soldierLos } from './los';
import type { StanceName } from './types';
import type { WorldGen } from '../worldgen';
import { createKnowledge, type KnowledgeState, type Journal } from './knowledge/knowledge';
import { processObservationEvent } from './knowledge/observation';
import { processCryEvent } from './knowledge/audible';
import { processSoundOff, processMagCheck } from './knowledge/elicited';
import { TIER2_ORDER_DURATION } from './config';

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
  | { type: 'ran-dry'; side: SoldierSide };

// ── orders ─────────────────────────────────────────────────────────────────
// The commander's intent surface. Phase 4 implements stance/fire intent;
// sound-off and mag-check land in Phase 5 (knowledge) but the order shapes
// exist now so the sim interface is stable.

export type Order =
  | { type: 'set-fire-intent'; intent: FireIntent }
  | { type: 'stance'; manId: string; stance: StanceName }
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
  }

  applyOrder(order: Order): void {
    switch (order.type) {
      case 'set-fire-intent':
        for (const f of this.friendlies) {
          if (isAlive(f)) f.fireIntent = order.intent;
        }
        break;
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

    // 1. Friendly fire: each alive friendly fires at the enemy position.
    for (const f of this.friendlies) {
      if (!isAlive(f) || !canFight(f)) continue;
      const rof = effectiveRof(f);
      if (rof <= 0) continue;
      // Probabilistic per-tick firing: P(fire this tick) = rof * dt.
      if (nextFloat(this.rng) >= rof * dt) continue;

      const target = this.nearestEnemy(f);
      if (!target) continue;

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
      this.worldgen, this.tick,
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

    return this.events;
  }

  /** Queue a tier-2 order. No stacking: a second sound-off/mag-check while
      one is in flight is ignored, and observing is cleared for the duration
      (you cannot look and listen at the same time). */
  private queueTier2(type: 'sound-off' | 'mag-check'): void {
    if (this.tier2BusyTicks > 0) return;
    for (const key of this.observing.keys()) this.observing.delete(key);
    this.tier2BusyTicks = Math.round(TIER2_ORDER_DURATION / FIXED_DT);
    this.pendingTier2 = type;
  }

  /** Nearest alive enemy with a clear line of sight — you cannot shoot a
      man you cannot see (terrain blocks the shot entirely). */
  nearestEnemy(from: Soldier): Soldier | null {
    let best: Soldier | null = null;
    let bestD = Infinity;
    for (const e of this.enemySection.soldiers) {
      if (!isAlive(e)) continue;
      const d = Math.hypot(e.pos.x - from.pos.x, e.pos.z - from.pos.z);
      if (d < bestD && soldierLos(from, e, this.worldgen).clear) { bestD = d; best = e; }
    }
    return best;
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