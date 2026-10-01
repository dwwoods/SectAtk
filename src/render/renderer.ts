// Main renderer — owns the THREE.WebGLRenderer, scene, camera, and all
// render modules (terrain, grass, atmosphere, post). Reads the WorldGen
// (single source of truth for looks AND tactics) and follows the
// Simulation's commander position.

import * as THREE from 'three';
import { type SharedUniforms } from './glsl';
import { buildTerrainMesh } from './terrain';
import { GrassField } from './grassInstanced';
import { Atmosphere } from './atmosphere';
import { PostPipeline } from './post';
import { SpringArm } from './camera/springArm';
import type { WorldGen } from '../worldgen';
import {
  createAdaptiveState,
  stepAdaptive,
  MAX_QUALITY_LEVEL,
  type AdaptiveState,
} from './adaptiveQuality';

export class SectAtkRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly springArm: SpringArm;
  readonly post: PostPipeline;
  private shared: SharedUniforms;
  private grass: GrassField;
  private atmosphere: Atmosphere;
  private sceneRT: THREE.WebGLRenderTarget;
  private worldgen: WorldGen;
  /** Adaptive-quality controller state (readable for debug overlays). */
  readonly adaptive: AdaptiveState = createAdaptiveState();
  /** Scene/post render scale for the current quality level (1 = native). */
  private renderScale = 1;

  constructor(worldgen: WorldGen) {
    this.worldgen = worldgen;
    // WebGL renderer.
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.querySelector<HTMLCanvasElement>('#game-canvas') ?? undefined,
      antialias: false,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x000000, 0);

    // Scene.
    this.scene = new THREE.Scene();

    // Shared uniforms (one set for all shaders).
    this.shared = {
      uTime: { value: 0 },
      uCamPos: { value: { x: 0, y: 0, z: 0 } },
      uSunDir: { value: { x: -0.45, y: 0.3, z: -0.84 } },
      uMeanWind: { value: { x: 3.0, y: 0.5 } },
      uFogMul: { value: 0.8 },
    };

    // Camera: spring arm follows the commander.
    this.springArm = new SpringArm();
    this.scene.add(this.springArm.camera);

    // Terrain.
    const terrain = buildTerrainMesh(worldgen.heightfield, this.shared);
    this.scene.add(terrain);

    // Grass.
    this.grass = new GrassField(this.scene, worldgen.heightfield, worldgen.meadow, this.shared);

    // Atmosphere.
    this.atmosphere = new Atmosphere(this.scene, this.shared);

    // Render target for scene → post chain. UnsignedByteType: SwiftShader's
    // WebGL2 doesn't reliably support rendering to half-float, and the tone
    // mapping in post handles the range anyway.
    this.sceneRT = new THREE.WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      { type: THREE.UnsignedByteType },
    );

    // Post.
    this.post = new PostPipeline(this.renderer, window.innerWidth, window.innerHeight);
    this.post.flags.bloom = false; // bloom off by default — toggleable

    // Resize handler.
    window.addEventListener('resize', () => this.applySizes());
  }

  /** (Re)apply canvas, scene-RT, and post sizes at the current render
      scale. The canvas stays native; the scene and post chain render at
      renderScale and the composite upscales — the supersample lever from
      the reference, run backwards. */
  private applySizes(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    const sw = Math.max(4, Math.round(w * this.renderScale));
    const sh = Math.max(4, Math.round(h * this.renderScale));
    this.sceneRT.setSize(sw, sh);
    this.post.resize(sw, sh);
    this.springArm.resize();
  }

  /** Map a quality level onto the render levers. Tier values are
      provisional until the real-hardware profiling pass (Phase 9). */
  private applyQuality(level: number): void {
    const tiers: Array<{ scale: number; cosmetics: boolean; grassRings: number }> = [
      { scale: 0.5, cosmetics: false, grassRings: 1 }, // 0 — floor
      { scale: 0.7, cosmetics: false, grassRings: 1 },
      { scale: 0.85, cosmetics: true, grassRings: 2 },
      { scale: 1.0, cosmetics: true, grassRings: 2 }, // MAX — full
    ];
    const t = tiers[Math.max(0, Math.min(MAX_QUALITY_LEVEL, level))]!;
    this.renderScale = t.scale;
    this.post.flags.grain = t.cosmetics;
    this.post.flags.vignette = t.cosmetics;
    this.grass.setMaxRings(t.grassRings);
    this.applySizes();
  }

  /** Render one frame. `frameGapMs` is the time since the previous frame
      — the adaptive controller's signal. It must be the real frame
      interval, not CPU time spent inside this method: GPU work is async,
      so a GPU-bound machine shows a tiny CPU cost while frames crawl.
      Pass null to leave the controller idle (non-vsync drivers). */
  render(
    time: number,
    commander: { pos: { x: number; z: number }; heading: number },
    frameGapMs: number | null = null,
  ): void {

    // Update shared uniforms.
    this.shared.uTime.value = time;
    this.shared.uCamPos.value = { x: commander.pos.x, y: 0, z: commander.pos.z };

    // Sync grass uniforms per-frame.
    this.grass.update(this.springArm.camera);

    // Camera follows the commander.
    this.springArm.update(commander.pos.x, 0, commander.pos.z, commander.heading, this.worldgen.heightfield);

    // Update sky position.
    this.atmosphere.update(this.springArm.camera);

    // Render scene to RT.
    this.renderer.setRenderTarget(this.sceneRT);
    this.renderer.render(this.scene, this.springArm.camera);

    // Post process.
    this.post.process(this.sceneRT);

    // Adaptive quality: feed the frame interval; step the level when the
    // controller says so (sustained over-budget or headroom).
    if (frameGapMs !== null) {
      const newLevel = stepAdaptive(this.adaptive, frameGapMs);
      if (newLevel !== null) {
        // Level changes reallocate render targets — a deliberate, visible
        // hitch. Logged so stutter reports can be correlated with them.
        console.info(`[adaptive] quality level → ${newLevel} (ema ${this.adaptive.emaMs.toFixed(1)}ms)`);
        this.applyQuality(newLevel);
      }
    }
  }
}