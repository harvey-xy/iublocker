/**
 * $redirect to a bundled surrogate:
 *   ||127.0.0.1/ads/gpt.js$script,redirect=googletagservices_gpt.js
 */
import { expect, test } from '../fixtures/extension';

test('the ad script is replaced by the bundled surrogate', async ({ page, server }) => {
  await page.goto(server.url('/redirect.html'));

  await expect(page.locator('#result')).toHaveText('surrogate');
  await expect(page.locator('#googletag')).toHaveText('true');
  // The real script (which would set window.__gptLoaded) never ran…
  await expect(page.locator('#original')).toHaveText('false');
  // …and never reached the server.
  expect(server.hitsFor('/ads/gpt.js')).toBe(0);

  // The surrogate exposes the API pages expect, so page code keeps working.
  expect(await page.evaluate(() => typeof (globalThis as any).googletag.cmd.push)).toBe('function');
});
