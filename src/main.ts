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

// ── scenario (Phase 4+ test scenario; real mission arrives Phase 8) ────────
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
};

const sim = new Simulation(scenario, worldgen, seed);

// ── clock: real-time with pause/speed multipliers ─────────────────────────
const clock = new Clock((dt) => sim.step(dt));

// ── renderer ───────────────────────────────────────────────────────────────
const renderer = new SectAtkRenderer(worldgen);

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

// ── game loop ──────────────────────────────────────────────────────────────
// Use setInterval instead of requestAnimationFrame for headless compatibility.
// Headless Chromium throttles rAF (~1fps), which makes the page unresponsive
// to CDP and stalls the e2e tests. setInterval is not throttled for background
// tabs, and provides enough frame rate for the sim's fixed-timestep logic.
let last = performance.now();
function tick(): void {
  const now = performance.now();
  const frameDelta = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock.advance(frameDelta);
  const commander = sim.friendlies[0];
  if (commander) renderer.render(now / 1000, { pos: commander.pos, heading: commander.heading });
}
setInterval(tick, 1000 / 30); // 30 fps target