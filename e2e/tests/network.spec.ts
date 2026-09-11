/**
 * Network blocking through DNR, driven by e2e/fixtures/test-list.txt:
 *   ||127.0.0.1/ads/^
 *   ||127.0.0.1/track/^$image,ping,xmlhttprequest
 */
import { expect, test } from '../fixtures/extension';

test('scripts, images and frames under /ads/ and /track/ never reach the network', async ({
  page,
  server,
}) => {
  await page.goto(server.url('/network.html'));
  await page.waitForFunction(() => (globalThis as any).__loaded === true);

  // The blocked script never ran.
  expect(await page.evaluate(() => (globalThis as any).__ad)).toBeUndefined();
  await expect(page.locator('#ad-flag')).toHaveText('false');

  // The blocked image has no intrinsic size.
  expect(await page.locator('#pixel').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(0);

  // The blocked iframe never loaded its document.
  const frame = page.frames().find((f) => f.url().includes('/ads/frame.html'));
  expect(
    frame === undefined ||
      (await frame.evaluate(() => (globalThis as any).__adFrame).catch(() => undefined)) !== true,
  ).toBe(true);

  // Nothing hit the server: DNR blocks before the request leaves the browser.
  expect(server.hitsFor('/ads/banner.js')).toBe(0);
  expect(server.hitsFor('/ads/frame.html')).toBe(0);
  expect(server.hitsFor('/track/pixel.gif')).toBe(0);
  expect(server.hitsFor('/track/ping')).toBe(0);
});

test('unrelated requests are untouched', async ({ page, server }) => {
  await page.goto(server.url('/network.html'));
  await page.waitForFunction(() => (globalThis as any).__loaded === true);

  await expect(page.locator('#xhr-allowed')).toHaveText('ok');
  expect(server.hitsFor('/api/data.json')).toBe(1);
  expect(server.hitsFor('/network.html')).toBe(1);
});
