// Profile the reference's performance bottleneck. Tries to load the
// reference in headless browser and measure fps at each quality tier.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(dir, '..', 'artifacts');
mkdirSync(outDir, { recursive: true });

const URL = 'http://localhost:4175/index.html';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[ERROR] ${String(err)}`));

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  console.log('page loaded');

  // Wait for a canvas to appear (means WebGL/Three.js initialised).
  try {
    await page.waitForSelector('canvas', { timeout: 20000 });
    console.log('canvas found');
  } catch {
    console.log('no canvas after 20s — page may be broken');
  }

  // Wait for the scene to warm up (the reference's auto-quality fires at
  // frame 260, which at ~20fps is ~13 seconds).
  await page.waitForTimeout(15000);

  // Read telemetry from the reference's HUD.
  const teleText = await page.evaluate(() => {
    const tele = document.querySelector('#tele');
    return tele ? tele.textContent ?? '(empty)' : '(no-tele)';
  });
  console.log('telemetry:', teleText.slice(0, 100));

  // Check if the canvas has content.
  const canvasInfo = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    if (!cv) return 'no-canvas';
    return { w: cv.width, h: cv.height, ctx: cv.getContext?.('webgl2') ? 'webgl2' : 'no-webgl2' };
  });
  console.log('canvas:', JSON.stringify(canvasInfo));

  // Try to read fps from the telemetry text.
  const fpsMatch = teleText.match(/fps\s+([\d.]+)/);
  if (fpsMatch) {
    console.log(`fps: ${fpsMatch[1]}`);
  }

  // Try pressing a quality key.
  await page.keyboard.press('4');
  await page.waitForTimeout(2000);
  const teleAfter = await page.evaluate(() => {
    const tele = document.querySelector('#tele');
    return tele ? tele.textContent ?? '(empty)' : '(no-tele)';
  });
  console.log('after tier-4 key:', teleAfter.slice(0, 100));

  // Take a screenshot.
  const png = resolve(outDir, 'reference-profile.png');
  await page.screenshot({ path: png });
  console.log(`screenshot: ${png}`);

  // Write the log.
  const log = logs.join('\n');
  writeFileSync(resolve(outDir, 'reference-profile-log.txt'), log);
  console.log(`\nconsole log (${logs.length} lines):`);
  // Show only the last 20 lines to avoid noise.
  const recent = logs.slice(-20);
  for (const l of recent) console.log(`  ${l}`);

} finally {
  await browser.close();
}