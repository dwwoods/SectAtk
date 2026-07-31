import { FIXED_DT } from './config';

export type SpeedMultiplier = 0 | 1 | 2 | 4;

// Fixed-timestep accumulator clock. This is the piece the determinism gate
// verifies (design doc §12 Phase 1 gate): speed multipliers and pause
// change how many `step(FIXED_DT)` calls happen per real frame — they must
// NEVER change the dt value passed into `step`. 4x is bit-identical to 1x
// at equal tick count, by construction, not by luck.
export class Clock {
  tickCount = 0;
  private accumulator = 0;
  private multiplier: SpeedMultiplier = 1;
  private readonly step: (dt: number) => void;

  constructor(step: (dt: number) => void) {
    this.step = step;
  }

  setSpeed(multiplier: SpeedMultiplier): void {
    this.multiplier = multiplier;
  }

  togglePause(): void {
    this.multiplier = this.multiplier === 0 ? 1 : 0;
  }

  get speed(): SpeedMultiplier {
    return this.multiplier;
  }

  // Advances by `frameDeltaSeconds` of real time, scaled by the speed
  // multiplier, then runs however many FIXED_DT sim steps that produces.
  advance(frameDeltaSeconds: number): void {
    this.accumulator += frameDeltaSeconds * this.multiplier;
    while (this.accumulator >= FIXED_DT) {
      this.step(FIXED_DT);
      this.accumulator -= FIXED_DT;
      this.tickCount++;
    }
  }
}
