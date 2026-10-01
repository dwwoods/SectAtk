// Orders panel e2e — the panel mounts, shows the mission brief and the
// Knowledge-only readout, and its buttons actually dispatch orders into
// the sim (checked through the window.__sectatk debug handle).

import { expect, test } from '@playwright/test';

// NOTE: window.__sectatk is declared globally (loosely typed) in
// src/main.ts; this file reads it through a local cast rather than a
// second `declare global`, which TS refuses to merge with a narrower shape.

test('orders panel mounts and dispatches orders', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const panel = page.locator('#orders-panel');
  await expect(panel).toBeAttached({ timeout: 30000 });

  // Mission brief and fog-honest enemy readout.
  const readout = page.locator('#orders-readout');
  await expect(readout).toContainText('MISSION: TAKE THE GROUND');
  await expect(readout).toContainText('EN: NOT LOCATED');

  // The commander has not yet learned anything about his men.
  await expect(readout).toContainText('SECTION: ? ? ? ? ? ? ? ?');

  // Ordering RAPID FIRE reaches the sim as section intent.
  await page.getByRole('button', { name: 'RAPID FIRE!' }).click();
  await expect
    .poll(async () => page.evaluate(
      () => (window as unknown as { __sectatk?: { sim: { sectionIntent: string } } }).__sectatk?.sim.sectionIntent,
    ))
    .toBe('rapid');

  // The mission is live.
  const status = await page.evaluate(
    () => (window as unknown as { __sectatk?: { sim: { mission: { status: string } } } }).__sectatk?.sim.mission.status,
  );
  expect(status).toBe('active');
});
