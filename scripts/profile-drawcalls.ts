// Deep profile of the reference: count WebGL draw calls per frame and time
// the render loop, across quality tiers. This distinguishes the hypotheses:
//   A) bottleneck = draw call COUNT (fps moves with tier)
//   B) bottleneck = per-draw cost / shader cost (count moves, fps doesn't)
//   C) bottleneck = post chain or fixed per-frame cost (neither moves)

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(dir, '..', 'artifacts');
mkdirSync(outDir, { recursive: true });

const URL = 'http://localhost:4175/index.html';

// Inject a WebGL draw-call counter and per-frame timing BEFORE the page's
// module scripts run (addInitScript runs before page scripts).
const counterScript = `
(() => {
  // Wrap draw calls on both WebGL contexts.
  const counters = { draws: 0, frames: 0, lastFrameMs: 0 };
  const hook = (proto, names) => {
    for (const n of names) {
      const orig = proto[n];
      if (!orig) continue;
      proto[n] = function(...args) {
        if (n === 'drawArrays' || n === 'drawElements') counters.draws++;
        return orig.apply(this, args);
      };
    }
  };
  hook(WebGL2RenderingContext.prototype, ['drawArrays', 'drawElements']);
  hook(WebGLRenderingContext.prototype, ['drawArrays', 'drawElements']);

  // Measure frame deltas.
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    counters.lastFrameMs = now - last;
    last = now;
    counters.frames++;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  (window).__perf = {
    reset() { counters.draws = 0; counters.frames = 0; },
    sample(ms) {
      const start = performance.now();
      const d0 = counters.draws, f0 = counters.frames;
      return new Promise((resolve) => {
        const check = () => {
          if (performance.now() - start >= ms) {
            resolve({
              draws: counters.draws - d0,
              frames: counters.frames - f0,
              avgFrameMs: (counters.lastFrameMs),
            });
          } else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    },
  };
})();
`;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.addInitScript(counterScript);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 20000 });

  // Warm up past the auto-quality frame (frame 260).
  await page.waitForTimeout(15000);

  const results: Array<{ tier: number; fps: number; draws: number; frames: number; drawsPerFrame: number }> = [];

  for (let tier = 0; tier < 4; tier++) {
    await page.keyboard.press(`${tier + 1}`);
    await page.waitForTimeout(3000); // let grass rebuild settle

    await page.evaluate(() => (window as any).__perf.reset());
    const sample = await page.evaluate(async (ms) => {
      return await (window as any).__perf.sample(ms);
    }, 3000);

    const fps = sample.frames / 3.0;
    results.push({
      tier,
      fps,
      draws: sample.draws,
      frames: sample.frames,
      drawsPerFrame: sample.frames > 0 ? sample.draws / sample.frames : 0,
    });
    console.log(
      `tier ${tier}: fps=${fps.toFixed(1)} draws/frame=${(sample.draws / sample.frames).toFixed(0)} frameMs=${sample.avgFrameMs.toFixed(1)}`,
    );
  }

  let csv = 'tier,fps,drawsPerFrame,avgFrameMs\n';
  for (const r of results) {
    csv += `${r.tier},${r.fps.toFixed(2)},${r.drawsPerFrame.toFixed(0)},${(1000 / r.fps).toFixed(2)}\n`;
  }
  csv += '\n# page errors: ' + (errors.length ? errors.join('; ') : 'none') + '\n';
  writeFileSync(resolve(outDir, 'reference-drawcalls.csv'), csv);
  console.log('\nwrote artifacts/reference-drawcalls.csv');

} finally {
  await browser.close();
}