import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(20000);
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 10000 });
console.log('goto done');
const t0 = Date.now();
try {
  await page.locator('#game-canvas').waitFor({ state: 'attached', timeout: 20000 });
  console.log(`canvas found in ${Date.now()-t0}ms`);
} catch (e) {
  console.log('canvas NOT found:', String(e).substring(0, 150));
}
console.log('pageerrors:', JSON.stringify(errors));
await page.waitForTimeout(2000);
await page.screenshot({ path: 'artifacts/screenshot2.png' });
console.log('screenshot saved');
await browser.close();
console.log('DONE');
