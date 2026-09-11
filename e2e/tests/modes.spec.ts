/**
 * Per-site modes (docs/ARCHITECTURE.md §5), driven through the worker's message router:
 *
 *   off      → nothing blocked, no cosmetics, no scriptlets
 *   basic    → network blocked, no cosmetics/scriptlets
 *   optimal  → network + specific cosmetics + scriptlets (default)
 *   complete → additionally generic and procedural cosmetics
 */
import { expect, test } from '../fixtures/extension';

const HOST = '127.0.0.1';

async function setMode(
  sendRequest: <T>(msg: { type: string } & Record<string, unknown>) => Promise<T>,
  mode: 'off' | 'basic' | 'optimal' | 'complete' | null,
): Promise<void> {
  await sendRequest({ type: 'site:setMode', hostname: HOST, mode });
}

test.afterEach(async ({ sendRequest }) => {
  await setMode(sendRequest, null).catch(() => undefined);
});

test('off: ads load again', async ({ page, server, sendRequest }) => {
  await page.goto(server.url('/modes.html'));
  await expect(page.locator('#ad-flag')).toHaveText('false');

  await setMode(sendRequest, 'off');
  await page.reload();

  await expect(page.locator('#ad-flag')).toHaveText('true');
  expect(server.hitsFor('/ads/banner.js')).toBeGreaterThan(0);
  await expect(page.locator('#ad-banner-1')).toBeVisible();
  await expect(page.locator('#sponsored')).toBeVisible();
});

test('basic: network is blocked but cosmetic filters are not applied', async ({
  page,
  server,
  sendRequest,
}) => {
  await setMode(sendRequest, 'basic');
  await page.goto(server.url('/modes.html'));

  await expect(page.locator('#ad-flag')).toHaveText('false');
  expect(server.hitsFor('/ads/banner.js')).toBe(0);

  await expect(page.locator('#ad-banner-1')).toBeVisible();
  await expect(page.locator('#sponsored')).toBeVisible();
});

test('optimal: network plus specific cosmetics, procedural still off', async ({
  page,
  server,
  sendRequest,
}) => {
  await setMode(sendRequest, 'optimal');
  await page.goto(server.url('/modes.html'));

  await expect(page.locator('#ad-flag')).toHaveText('false');
  await expect(page.locator('#ad-banner-1')).toBeHidden();
  await expect(page.locator('#sponsored')).toBeHidden();
  await expect(page.locator('#card-sponsored')).toBeVisible();
  expect(server.hitsFor('/ads/banner.js')).toBe(0);
});

test('complete: procedural filters apply too', async ({ page, server, sendRequest }) => {
  await setMode(sendRequest, 'complete');
  await page.goto(server.url('/modes.html'));

  await expect(page.locator('#ad-banner-1')).toBeHidden();
  await expect(page.locator('#card-sponsored')).toBeHidden();
  await expect(page.locator('#card-regular')).toBeVisible();
  await expect(page.locator('#content')).toBeVisible();
});

test('the mode round-trips through tab:getState', async ({ page, server, sendRequest }) => {
  await page.goto(server.url('/modes.html'));
  await page.bringToFront();

  await setMode(sendRequest, 'basic');
  await expect
    .poll(
      async () =>
        (await sendRequest<{ effectiveMode: string; hostname: string }>({ type: 'tab:getState' }))
          .effectiveMode,
    )
    .toBe('basic');

  await setMode(sendRequest, null);
  await expect
    .poll(async () => (await sendRequest<{ mode: string | null }>({ type: 'tab:getState' })).mode)
    .toBeNull();
});
