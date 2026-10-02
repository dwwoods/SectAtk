// Tier-3 ambient fire-density presentation -- procedural WebAudio "cracks"
// (design doc section 3.1 tier 3, section 4.2, Phase 6).
//
// Presentation only: this module holds no sim-affecting state and is
// driven from sim state (via fireDensity.computeDensity) every render
// frame. It never writes Knowledge and never reads a "fire control
// active" flag -- it only sees the FireDensity numbers handed to it.
//
// No samples: each "crack" is a short synthesized noise burst, band-passed
// and stereo-panned by bearing relative to the camera. Burst timing is a
// Poisson-ish process seeded by Math.random() -- jitter here is fine; this
// is presentation, not the deterministic sim.
//
// Browsers require a user gesture before an AudioContext may produce
// sound, so the AudioContext itself is lazily created on the first
// enable() call (wired to a keypress in main.ts), not at construction.

import type { FireDensity, SideDensity } from './fireDensity';
import {
  CRACK_BASE_GAIN,
  CRACK_DURATION_MS,
  CRACK_FILTER_Q,
  CRACK_GAIN_SATURATION_RATE,
  ENEMY_CRACK_FREQ_HZ,
  FRIENDLY_CRACK_FREQ_HZ,
  MIN_PERCEPTIBLE_RATE,
  SCHEDULER_MAX_INTERVAL_S,
  SCHEDULER_MIN_INTERVAL_S,
} from './config';

interface SideScheduler {
  /** Seconds until the next crack for this side, redrawn each time one
      fires (Poisson inter-arrival: -ln(U) / rate). */
  nextInSeconds: number;
  freqHz: number;
}

function freshScheduler(freqHz: number): SideScheduler {
  return { nextInSeconds: SCHEDULER_MAX_INTERVAL_S, freqHz };
}

/** Map a perceived rate (rounds/sec, already distance-attenuated by
    fireDensity) to a crack gain, saturating gently rather than clipping. */
function gainForRate(rate: number): number {
  const norm = Math.min(1, rate / CRACK_GAIN_SATURATION_RATE);
  return CRACK_BASE_GAIN * norm;
}

/** Poisson inter-arrival time for a given rate (events/sec), clamped to a
    sane scheduling window. rate <= 0 means "wait the max interval and
    re-check" rather than never firing again. */
function nextArrival(rate: number): number {
  if (rate < MIN_PERCEPTIBLE_RATE) return SCHEDULER_MAX_INTERVAL_S;
  const u = Math.max(1e-6, Math.random());
  const interval = -Math.log(u) / rate;
  return Math.min(SCHEDULER_MAX_INTERVAL_S, Math.max(SCHEDULER_MIN_INTERVAL_S, interval));
}

/**
 * Procedural ambient-fire audio cues. Call update() once per render frame
 * with the latest FireDensity and the camera heading; call enable() from a
 * user-gesture handler (e.g. a keypress) before anything will be audible --
 * browsers refuse to start an AudioContext otherwise.
 */
export class FireCues {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = false;
  private friendly: SideScheduler = freshScheduler(FRIENDLY_CRACK_FREQ_HZ);
  private enemy: SideScheduler = freshScheduler(ENEMY_CRACK_FREQ_HZ);

  /** True once enable() has successfully created (or resumed) the
      AudioContext. Presentation-only state -- never read by /sim. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Lazily create the AudioContext on first call. Must be invoked from
      inside a user-gesture handler (click/keydown) per browser autoplay
      policy. Safe to call repeatedly (idempotent toggle-on). */
  enable(): void {
    if (!this.ctx) {
      const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return; // no WebAudio available (e.g. headless test runner)
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.enabled = true;
  }

  /** Mute. Does not tear down the AudioContext -- enable() again just
      resumes it. */
  disable(): void {
    this.enabled = false;
  }

  /** Drive the scheduler one render frame forward. `density` is the latest
      output of fireDensity.computeDensity(); `cameraHeading` is radians,
      0 = facing +z, matching the world convention used for bearing. */
  update(density: FireDensity, cameraHeading: number, dtSeconds: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;

    this.advanceSide(density.friendly, cameraHeading, dtSeconds, this.friendly);
    this.advanceSide(density.enemy, cameraHeading, dtSeconds, this.enemy);
  }

  private advanceSide(
    side: SideDensity,
    cameraHeading: number,
    dtSeconds: number,
    scheduler: SideScheduler,
  ): void {
    scheduler.nextInSeconds -= dtSeconds;
    if (scheduler.nextInSeconds > 0) return;

    if (side.rate >= MIN_PERCEPTIBLE_RATE) {
      const relativeBearing = side.bearing - cameraHeading;
      // A little bearing jitter proportional to spread -- presentation
      // texture, not sim truth.
      const jitter = (Math.random() - 0.5) * side.spread;
      this.playCrack(scheduler.freqHz, relativeBearing + jitter, gainForRate(side.rate));
    }
    scheduler.nextInSeconds = nextArrival(side.rate);
  }

  private playCrack(freqHz: number, relativeBearing: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || gain <= 0) return;

    const durationS = CRACK_DURATION_MS / 1000;
    const sampleCount = Math.max(1, Math.round(ctx.sampleRate * durationS));
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      // White noise, enveloped with a fast decay so it reads as a crack
      // rather than a hiss.
      const envelope = 1 - i / sampleCount;
      data[i] = (Math.random() * 2 - 1) * envelope;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freqHz;
    filter.Q.value = CRACK_FILTER_Q;

    const envelopeGain = ctx.createGain();
    envelopeGain.gain.value = gain;

    let outputNode: AudioNode = envelopeGain;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      // Pan by sin of bearing relative to camera: dead ahead/behind = centre,
      // left/right of the camera's facing = hard left/right.
      panner.pan.value = Math.max(-1, Math.min(1, Math.sin(relativeBearing)));
      outputNode.connect(panner);
      outputNode = panner;
    }

    source.connect(filter);
    filter.connect(envelopeGain);
    outputNode.connect(master);

    source.start();
    source.stop(ctx.currentTime + durationS);
  }
}
