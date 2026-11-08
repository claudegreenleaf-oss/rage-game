// Browser smoke test: boot the build, start L01, walk into the spikes, and see the death counter go up.
import { expect, test } from '@playwright/test';

test('boots, plays L01 and counts a death', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => window.__dt?.game.scene.isActive('Title'), null, { timeout: 30_000 });
  await expect(page.locator('canvas')).toBeVisible();

  await page.evaluate(() => window.__dt!.startLevel('L01'));
  await page.waitForFunction(() => window.__dt?.getWorld() !== null, null, { timeout: 30_000 });
  const before = await page.evaluate(() => window.__dt!.getWorld()!.deathCount);
  expect(before).toBe(0);

  // Real key presses: hold → until Pip walks into the floor spikes.
  await page.locator('canvas').click({ position: { x: 640, y: 360 } });
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => (window.__dt?.getWorld()?.deathCount ?? 0) > 0, null, { timeout: 30_000 });
  await page.keyboard.up('ArrowRight');
  expect(await page.evaluate(() => window.__dt!.getWorld()!.deathCount)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('runs without localStorage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage disabled'); } });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await page.waitForFunction(() => window.__dt?.game.scene.isActive('Title'), null, { timeout: 30_000 });
  await page.evaluate(() => window.__dt!.startLevel('L02'));
  await page.waitForFunction(() => window.__dt?.getWorld() !== null, null, { timeout: 30_000 });
  expect(errors).toEqual([]);
});
