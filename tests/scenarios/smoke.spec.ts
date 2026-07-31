import { expect, test } from '@playwright/test';

// Deliberately minimal at this stage (Phase 1, no gameplay yet): proves the
// scaffolding boots. Grows starting Phase 2/3 as there's an actual
// scene/UI to assert against.
test('app boots and mounts a canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/');

  const canvas = page.locator('#game-canvas');
  await expect(canvas).toBeAttached();

  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});
