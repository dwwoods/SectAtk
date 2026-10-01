// Bootstrap — mounts the canvas, bakes the world, creates the sim, and
// runs the fixed-timestep game loop: the Clock advances the sim by
// FIXED_DT ticks (speed multipliers change ticks-per-frame, never tick
// size), and the renderer draws whatever the sim state is each frame.
//
// The renderer reads sim state and never writes it (design doc §9.4).
// Worldgen is the single source of truth for both.

import { bakeWorld } from './worldgen';
import { Simulation, type Scenario } from './sim/simulation';
import { Clock } from './sim/clock';
import { SectAtkRenderer } from './render/renderer';
import { OrdersPanel } from './ui/orders';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root element missing');

const canvas = document.createElement('canvas');
canvas.id = 'game-canvas';
function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);
app.appendChild(canvas);

// ── world ──────────────────────────────────────────────────────────────────
const seed = 20260728;
const worldgen = bakeWorld(seed);

// ── scenario — the mission: ground must be taken (design doc §13.1) ─────
const scenario: Scenario = {
  friendlyStart: [
    { name: 'Cpl. Harris', role: 'commander', pos: { x: -40, z: 20 } },
    { name: 'L/Cpl. Doyle', role: 'twoIC', pos: { x: -35, z: 25 } },
    { name: 'Pte. Bell', role: 'rifleman', pos: { x: -45, z: 22 } },
    { name: 'Pte. Okafor', role: 'rifleman', pos: { x: -38, z: 28 } },
    { name: 'Pte. Lindqvist', role: 'rifleman', pos: { x: -42, z: 18 } },
    { name: 'Pte. Marsh', role: 'rifleman', pos: { x: -48, z: 26 } },
    { name: 'Pte. Novak', role: 'rifleman', pos: { x: -36, z: 22 } },
    { name: 'Pte. Whitlock', role: 'rifleman', pos: { x: -44, z: 30 } },
  ],
  enemyPosition: { x: 60, z: -10 },
  enemySpread: 3,
  enemyHeading: Math.PI,
  // The enemy position sits on the ground the section must take.
  objective: { pos: { x: 60, z: -10 } },
  rally: { x: -120, z: 60 },
};

const sim = new Simulation(scenario, worldgen, seed);

// ── clock: real-time with pause/speed multipliers ─────────────────────────
const clock = new Clock((dt) => sim.step(dt));

// ── renderer ───────────────────────────────────────────────────────────────
const renderer = new SectAtkRenderer(worldgen);

// ── orders UI — verbal-idiom orders grouped by the battle drills ────────
new OrdersPanel(app, sim);

// Speed control: 1/2/4 keys cycle speed; space pauses. This is the phase-8
// UI placeholder — the real time controls live in /ui.
let speedIndex = 0;
const speeds = [1, 2, 4] as const;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    clock.togglePause();
  } else if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit4') {
    speedIndex = speeds.indexOf(parseInt(e.code.slice(5)) as 1 | 2 | 4);
    clock.setSpeed(speeds[speedIndex]!);
  }
});

// ── debug overlay (dev only; the real HUD lives in /ui, Phase 8) ─────────
// Shows frame interval, render cost, adaptive quality level, and the worst
// frame gap of the last second — for correlating stutter with level changes
// or GC. Toggle with F9.
const hud = document.createElement('div');
hud.style.cssText =
  'position:fixed;top:8px;left:8px;padding:4px 8px;font:11px monospace;' +
  'color:#cfc;background:rgba(0,0,0,0.55);pointer-events:none;z-index:10;white-space:pre';
app.appendChild(hud);
window.addEventListener('keydown', (e) => {
  if (e.code === 'F9') hud.style.display = hud.style.display === 'none' ? 'block' : 'none';
});
let frameIntervalEma = 16.7;
let worstGapMs = 0;
setInterval(() => {
  const a = renderer.adaptive;
  hud.textContent =
    `frame ${frameIntervalEma.toFixed(1)}ms (${(1000 / frameIntervalEma).toFixed(0)}fps)` +
    `  worst ${worstGapMs.toFixed(0)}ms\n` +
    `ctrl ${a.emaMs.toFixed(1)}ms  quality L${a.level}  upReq ${(a.upgradeReqMs / 1000).toFixed(0)}s`;
  worstGapMs = 0;
}, 500);

// Console handle for profiling sessions.
declare global {
  interface Window { __sectatk?: { sim: Simulation; clock: Clock; renderer: SectAtkRenderer } }
}
window.__sectatk = { sim, clock, renderer };

// ── game loop ──────────────────────────────────────────────────────────────────
// requestAnimationFrame is the preferred driver — vsync-aligned, full native
// refresh rate. But headless Chromium misbehaves in both directions: it can
// throttle rAF (~1fps) or, with vsync disabled, free-run it back-to-back and
// starve the page's main thread (which stalls CDP and the e2e tests). So:
// probe rAF's cadence with ~20 empty frames first. A sane display has a
// median gap ≥ 3ms (≤ ~333Hz); anything faster is a free-running rAF and we
// fall back to a fixed 30fps interval — the pre-rAF behaviour. A watchdog
// interval also covers the throttled case (rAF stalls mid-run).
let last = performance.now();
let lastTickAt = -Infinity;
function tick(now: number, fromRaf = false): void {
  lastTickAt = now;
  const frameDelta = Math.min(0.1, (now - last) / 1000);
  const gapMs = (now - last);
  frameIntervalEma += 0.1 * (gapMs - frameIntervalEma);
  if (gapMs > worstGapMs) worstGapMs = gapMs;
  last = now;
  clock.advance(frameDelta);
  const commander = sim.friendlies[0];
  // The adaptive controller only sees frames from a healthy, visible rAF
  // driver — interval/watchdog cadences (headless, hidden tab) would read
  // as over-budget and wrongly drain the quality level.
  const adaptiveGap = fromRaf && !document.hidden ? gapMs : null;
  if (commander) renderer.render(now / 1000, { pos: commander.pos, heading: commander.heading }, adaptiveGap);
}
function rafLoop(now: number): void {
  tick(now, true);
  requestAnimationFrame(rafLoop);
}
let driverChosen = false;
function startIntervalDriver(): void {
  driverChosen = true;
  setInterval(() => tick(performance.now()), 1000 / 30);
}
const cadence: number[] = [];
let probePrev = 0;
function probe(now: number): void {
  if (driverChosen) return; // probe timeout already picked the interval
  if (probePrev > 0) cadence.push(now - probePrev);
  probePrev = now;
  if (cadence.length < 20) {
    requestAnimationFrame(probe);
    return;
  }
  driverChosen = true;
  const sorted = [...cadence].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (median >= 3) {
    requestAnimationFrame(rafLoop);
    // Watchdog: if rAF later stalls (background tab), keep the sim ticking.
    setInterval(() => {
      const now = performance.now();
      if (now - lastTickAt > 250) tick(now);
    }, 1000 / 30);
  } else {
    startIntervalDriver();
  }
}
requestAnimationFrame(probe);
// If rAF never fires at all, pick the interval driver after half a second.
setTimeout(() => {
  if (!driverChosen) startIntervalDriver();
}, 500);