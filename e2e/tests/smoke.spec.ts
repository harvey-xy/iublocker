/**
 * The extension loads, its worker starts clean, and the basics of the MV3 surface are in
 * place. Run this first when the suite goes red: everything else assumes it passes.
 */
import { expect, test } from '../fixtures/extension';

test('the extension loads and exposes an MV3 manifest', async ({ sw, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const manifest = await sw.evaluate(() => (globalThis as any).chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(String(manifest.version)).toMatch(/^\d+\.\d+/);
  expect(manifest.permissions).toContain('declarativeNetRequest');
});

test('the service worker logs no errors while a page loads', async ({ page, server, swConsole, sw }) => {
  // Touch the worker so it is awake and streaming console output.
  await sw.evaluate(() => (globalThis as any).chrome.runtime.getManifest().version);

  await page.goto(server.url('/network.html'));
  await page.waitForFunction(() => (globalThis as any).__loaded === true);

  const errors = swConsole.filter((entry) => entry.type === 'error');
  expect(errors, `service worker console errors:\n${errors.map((e) => e.text).join('\n')}`).toEqual([]);
});

test('the worker answers a message from an extension page', async ({ sendRequest }) => {
  const settings = await sendRequest<Record<string, unknown>>({ type: 'settings:get' });
  expect(settings).toBeTruthy();
  expect(typeof settings).toBe('object');
});
