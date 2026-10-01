// Screenshot harness — captures the running app and saves a PNG. Works in
// headless Chromium (uses setInterval-based loop, not throttled rAF).
//
//   npx tsx scripts/screenshot.ts [url] [outfile]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(dir, '..', 'artifacts');
mkdirSync(outDir, { recursive: true });

const url = process.argv[2] ?? 'http://localhost:4173';
const out = resolve(process.argv[3] ?? resolve(outDir, 'screenshot.png'));

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Wait for the canvas to appear and a few frames to render.
  await page.waitForSelector('#game-canvas', { timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out });

  console.log(`saved ${out}`);
  if (errors.length) console.log('console errors:', errors);
  else console.log('no console errors');
} finally {
  await browser.close();
}