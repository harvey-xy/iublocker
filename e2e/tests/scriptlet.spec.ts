/**
 * MAIN-world scriptlet injection at document_start:
 *   127.0.0.1##+js(set-constant, adConfig, false)
 */
import { expect, test } from '../fixtures/extension';

test('set-constant runs before the page scripts', async ({ page, server }) => {
  await page.goto(server.url('/scriptlet.html'));

  // The inline script read window.adConfig synchronously during parsing.
  await expect(page.locator('#result')).toHaveText('false');
  await expect(page.locator('#type')).toHaveText('boolean');
  expect(await page.evaluate(() => (globalThis as any).__adConfigAtLoad)).toBe(false);
});

test('the constant is still false after a reload', async ({ page, server }) => {
  await page.goto(server.url('/scriptlet.html'));
  await page.reload();
  await expect(page.locator('#result')).toHaveText('false');
});

test('scriptlets do not run when the site is off', async ({ page, server, sendRequest }) => {
  await sendRequest({ type: 'site:setMode', hostname: '127.0.0.1', mode: 'off' });
  try {
    await page.goto(server.url('/scriptlet.html'));
    await expect(page.locator('#result')).toHaveText('undefined');
  } finally {
    await sendRequest({ type: 'site:setMode', hostname: '127.0.0.1', mode: null });
  }
});
