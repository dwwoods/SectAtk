// Directional screen-edge intensity — the visual accessibility fallback
// for the tier-3 ambient fire-density channel (design doc §10). Texture
// only: no numbers, no meter, no labels. Left/right intensity tracks
// incoming-fire direction relative to the camera; a fixed-position DOM
// overlay with CSS gradients, not a canvas/WebGL render-pass element, so
// it deliberately does NOT live in /render.
//
// Presentation only, like cues.ts: driven from sim state each render
// frame, holds no sim-affecting state, never touches Knowledge.

import {
  VISUAL_FALLBACK_MAX_OPACITY,
  VISUAL_FALLBACK_SATURATION_RATE,
  VISUAL_FALLBACK_SMOOTHING_S,
} from './config';
import type { FireDensity } from './fireDensity';

/** Smooth a value toward a target with a simple exponential filter so the
    overlay breathes with the fight rather than flickering per-crack. */
function approach(current: number, target: number, dtSeconds: number, tauSeconds: number): number {
  if (tauSeconds <= 0) return target;
  const alpha = 1 - Math.exp(-dtSeconds / tauSeconds);
  return current + (target - current) * alpha;
}

export class ScreenEdgeOverlay {
  private readonly el: HTMLDivElement;
  private enabled = false;
  private leftIntensity = 0;
  private rightIntensity = 0;
  private mounted = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'fire-density-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.style.position = 'fixed';
    this.el.style.inset = '0';
    this.el.style.pointerEvents = 'none';
    this.el.style.zIndex = '9999';
    this.el.style.opacity = '0';
    this.el.style.transition = 'opacity 150ms linear';
    this.el.style.background = 'transparent';
  }

  /** Attach the overlay to the document. Safe to call once; subsequent
      calls are no-ops. */
  mount(parent: HTMLElement = document.body): void {
    if (this.mounted) return;
    parent.appendChild(this.el);
    this.mounted = true;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
    this.el.style.opacity = '0';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Advance the overlay one render frame. `density` is the latest output
      of fireDensity.computeDensity(); `cameraHeading` is radians, matching
      the world convention used for bearing (0 = facing +z). */
  update(density: FireDensity, cameraHeading: number, dtSeconds: number): void {
    if (!this.enabled) return;

    let targetLeft = 0;
    let targetRight = 0;
    for (const side of [density.friendly, density.enemy]) {
      if (side.rate <= 0) continue;
      const relativeBearing = side.bearing - cameraHeading;
      // sin > 0 => source is to the camera's right; sin < 0 => left.
      const lateral = Math.sin(relativeBearing);
      const strength = Math.min(1, side.rate / VISUAL_FALLBACK_SATURATION_RATE);
      if (lateral >= 0) targetRight = Math.max(targetRight, strength * lateral);
      else targetLeft = Math.max(targetLeft, strength * -lateral);
    }

    this.leftIntensity = approach(this.leftIntensity, targetLeft, dtSeconds, VISUAL_FALLBACK_SMOOTHING_S);
    this.rightIntensity = approach(this.rightIntensity, targetRight, dtSeconds, VISUAL_FALLBACK_SMOOTHING_S);

    const leftAlpha = this.leftIntensity * VISUAL_FALLBACK_MAX_OPACITY;
    const rightAlpha = this.rightIntensity * VISUAL_FALLBACK_MAX_OPACITY;
    this.el.style.opacity = '1';
    this.el.style.background =
      `linear-gradient(to right, rgba(180,20,10,${leftAlpha}) 0%, rgba(180,20,10,0) 18%), ` +
      `linear-gradient(to left, rgba(180,20,10,${rightAlpha}) 0%, rgba(180,20,10,0) 18%)`;
  }
}
