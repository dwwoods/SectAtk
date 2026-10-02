// Orders panel — Phase 8. The commander's verbal idiom (design doc
// §13.3: third person suits spoken-style orders), grouped by the
// section battle drills:
//
//   Drill 3 — locating the enemy:   OBSERVE / SOUND OFF / MAG CHECK
//   Drill 4 — winning the firefight: the four fire intents
//   Drill 5 — the attack:            FORM BASELINE / ASSAULT
//   (and the doctrinal withdrawal — §2.5)
//
// Drill 2 (reaction to effective fire) is the men's own drill, not an
// order; drill 6 (reorg) is the mission's hold clock, not a button.
//
// READOUTS DRAW FROM KNOWLEDGE ONLY. The panel may show the commander's
// picture (believed statuses, believed enemy location), his own acts
// (intent ordered, tier-2 call in flight), and the mission brief. It
// must never show ground truth: no true enemy strength or ammo, no
// firefight-won state (§2.4 — he can never read that cleanly), and
// NOTHING about fire-control lapse (§4.2 — he notices the fire go
// ragged, or he doesn't).

import type { Simulation } from '../sim/simulation';
import type { FireIntent } from '../sim/config';

const INTENTS: Array<{ intent: FireIntent; label: string }> = [
  { intent: 'watch-and-shoot', label: 'WATCH AND SHOOT' },
  { intent: 'hold', label: 'HOLD THEM' },
  { intent: 'win-the-firefight', label: 'WIN THE FIREFIGHT' },
  { intent: 'rapid', label: 'RAPID FIRE!' },
];

// Target indication (design doc §3.4): range banded to the nearest 50m,
// direction as a clock/half-left idiom relative to the section's current
// facing (the commander's heading) — never raw coordinates, and never
// anything but the believed position. ±N is the belief's own uncertainty
// radius, so the readout never claims more precision than Knowledge has.
function directionIdiom(relativeDeg: number): string {
  const d = ((relativeDeg % 360) + 360) % 360;
  if (d < 22.5 || d >= 337.5) return 'AHEAD';
  if (d < 67.5) return 'HALF RIGHT';
  if (d < 112.5) return 'RIGHT';
  if (d < 157.5) return 'BEHIND RIGHT';
  if (d < 202.5) return 'BEHIND';
  if (d < 247.5) return 'BEHIND LEFT';
  if (d < 292.5) return 'LEFT';
  return 'HALF LEFT';
}

function targetIndication(sim: Simulation): string {
  const commander = sim.friendlies[0];
  const belief = sim.knowledge.enemy;
  if (!commander || !belief.position) return 'EN: NOT LOCATED';

  const dx = belief.position.x - commander.pos.x;
  const dz = belief.position.z - commander.pos.z;
  const range = Math.hypot(dx, dz);
  const rangeBand = Math.round(range / 50) * 50;

  const bearingToTarget = Math.atan2(dz, dx);
  const relativeDeg = ((bearingToTarget - commander.heading) * 180) / Math.PI;
  const direction = directionIdiom(relativeDeg);

  const radius = Math.round(belief.uncertaintyRadius ?? 0);
  return `EN: ~${rangeBand}m, ${direction} (±${radius}m)`;
}

export class OrdersPanel {
  readonly root: HTMLDivElement;
  private sim: Simulation;
  private readout: HTMLDivElement;
  private intentButtons = new Map<FireIntent, HTMLButtonElement>();
  private observing = false;
  private timer: ReturnType<typeof setInterval>;
  private smokeButton!: HTMLButtonElement;

  constructor(container: HTMLElement, sim: Simulation) {
    this.sim = sim;
    this.root = document.createElement('div');
    this.root.id = 'orders-panel';
    this.root.style.cssText =
      'position:fixed;top:8px;right:8px;width:230px;padding:8px;z-index:10;' +
      'font:12px/1.5 monospace;color:#dfd;background:rgba(10,14,10,0.8);' +
      'border:1px solid #352;user-select:none';

    this.readout = document.createElement('div');
    this.readout.id = 'orders-readout';
    this.readout.style.cssText = 'white-space:pre-wrap;margin-bottom:6px;color:#aca';
    this.root.appendChild(this.readout);

    this.group('WIN THE FIREFIGHT', INTENTS.map(({ intent, label }) => {
      const b = this.button(label, () => {
        sim.applyOrder({ type: 'set-fire-intent', intent });
        this.update();
      });
      this.intentButtons.set(intent, b);
      return b;
    }));

    this.group('LOCATE THE ENEMY', [
      this.button('OBSERVE', () => {
        this.observing = !this.observing;
        sim.applyOrder({ type: this.observing ? 'observe' : 'stop-observe' });
        this.update();
      }, 'btn-observe'),
      this.button('SECTION — SOUND OFF!', () => sim.applyOrder({ type: 'sound-off' })),
      this.button('MAG CHECK!', () => sim.applyOrder({ type: 'mag-check' })),
    ]);

    this.group('THE ATTACK', [
      this.button('FORM BASELINE!', () => sim.applyOrder({ type: 'form-baseline' })),
      this.button('SECTION — ASSAULT!', () => sim.applyOrder({ type: 'assault' }), 'btn-assault'),
      this.button('WITHDRAW!', () => {
        sim.applyOrder({ type: 'withdraw', rally: this.rallyPoint() });
      }),
      this.smokeButton = this.button('SMOKE!', () => {
        sim.applyOrder({ type: 'smoke' });
        this.update();
      }, 'btn-smoke'),
    ]);

    container.appendChild(this.root);
    this.update();
    this.timer = setInterval(() => this.update(), 500);
  }

  /** The rally: the scenario's if briefed, else straight back from the
      believed threat — or back the way the section faces if the enemy
      has never been located. */
  private rallyPoint(): { x: number; z: number } {
    if (this.sim.rally) return this.sim.rally;
    const able = this.sim.friendlies.filter((f) => f.wound === null);
    let cx = 0;
    let cz = 0;
    for (const f of able) {
      cx += f.pos.x;
      cz += f.pos.z;
    }
    cx /= able.length || 1;
    cz /= able.length || 1;
    const believed = this.sim.knowledge.enemy.position;
    let ux = -1;
    let uz = 0;
    if (believed) {
      const d = Math.hypot(believed.x - cx, believed.z - cz) || 1;
      ux = (cx - believed.x) / d;
      uz = (cz - believed.z) / d;
    }
    return { x: cx + ux * 100, z: cz + uz * 100 };
  }

  update(): void {
    const k = this.sim.knowledge;
    const lines: string[] = [];

    if (this.sim.objective) {
      const o = this.sim.objective.pos;
      const label =
        this.sim.mission.status === 'taken' ? 'OBJECTIVE TAKEN'
        : this.sim.mission.status === 'failed' ? 'COMBAT INEFFECTIVE — MISSION FAILED'
        : `TAKE THE GROUND AT (${o.x.toFixed(0)}, ${o.z.toFixed(0)})`;
      lines.push(`MISSION: ${label}`);
    }

    lines.push(targetIndication(this.sim));

    // The commander's picture of his own men — believed, not true.
    const statuses = [...k.friendlies.values()]
      .map((b) => {
        if (b.knownDead || b.status === 'dead') return 'K';
        if (b.status === 'down') return 'D';
        if (b.status === 'hit') return 'W';
        if (b.status === 'effective') return 'E';
        return '?';
      })
      .join(' ');
    lines.push(`SECTION: ${statuses}`);

    if (this.sim.tier2BusyTicks > 0) {
      lines.push(this.sim.pendingTier2 === 'mag-check' ? 'calling mag check…' : 'calling sound off…');
    }

    this.readout.textContent = lines.join('\n');

    for (const [intent, b] of this.intentButtons) {
      b.style.background = intent === this.sim.sectionIntent ? '#241' : 'transparent';
    }
    const ob = this.root.querySelector<HTMLButtonElement>('#btn-observe');
    if (ob) ob.textContent = this.observing ? 'DOWN (stop observing)' : 'OBSERVE';

    // His own kit, not a Knowledge belief — read straight from the sim.
    const smoke = this.sim.smokeInventory;
    this.smokeButton.textContent = `SMOKE! (${smoke})`;
    this.smokeButton.style.opacity = smoke > 0 ? '1' : '0.4';
    this.smokeButton.style.cursor = smoke > 0 ? 'pointer' : 'default';
  }

  dispose(): void {
    clearInterval(this.timer);
    this.root.remove();
  }

  private group(title: string, buttons: HTMLButtonElement[]): void {
    const h = document.createElement('div');
    h.textContent = `— ${title} —`;
    h.style.cssText = 'margin:6px 0 2px;color:#796;font-size:10px;letter-spacing:1px';
    this.root.appendChild(h);
    for (const b of buttons) this.root.appendChild(b);
  }

  private button(label: string, onClick: () => void, id?: string): HTMLButtonElement {
    const b = document.createElement('button');
    if (id) b.id = id;
    b.textContent = label;
    b.style.cssText =
      'display:block;width:100%;margin:2px 0;padding:3px 6px;text-align:left;' +
      'font:12px monospace;color:#dfd;background:transparent;border:1px solid #352;cursor:pointer';
    b.addEventListener('click', onClick);
    return b;
  }
}
