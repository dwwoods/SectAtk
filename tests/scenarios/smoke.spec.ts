import { expect, test } from '@playwright/test';

// Proves the scaffolding boots: the page loads, the canvas element is
// created, and no console errors are reported. The canvas is created
// synchronously by main.ts, but ES module evaluation (especially THREE.js
// in headless Chromium) can take a while, so the wait is generous.
// Grows starting Phase 2/3 as there's an actual scene to assert against.
test('app boots and mounts a canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for the canvas element to appear. In headless Chromium, ES module
  // evaluation (THREE.js, worldgen, renderer construction) can take >10s,
  // so the timeout is generous. The canvas is created synchronously at the
  // top of main.ts, after module imports evaluate.
  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeAttached({ timeout: 30000 });

  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});