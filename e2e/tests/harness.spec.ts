/**
 * Harness self-test: proves that this machine can load an unpacked MV3 extension in
 * headless Chromium and that its service worker starts. It generates its own throwaway
 * extension, so it passes on a clean checkout with no `packages/extension/dist`.
 *
 * If this fails, nothing else in e2e/ can work — fix the browser launch first
 * (see e2e/fixtures/paths.ts: IUB_CHROME_PATH).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { extensionIdFromUrl, launchExtensionContext, waitForServiceWorker } from '../fixtures/extension';
import { chromeExecutablePath } from '../fixtures/paths';
import { startServer } from '../server';

const MANIFEST = {
  manifest_version: 3,
  name: 'iuBlocker e2e harness probe',
  version: '0.0.1',
  background: { service_worker: 'sw.js', type: 'module' },
  permissions: ['storage'],
};

async function makeProbeExtension(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'iub-e2e-probe-'));
  await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(MANIFEST, null, 2));
  await writeFile(path.join(dir, 'sw.js'), 'self.addEventListener("install", () => {});\nglobalThis.__probe = true;\n');
  return dir;
}

test('headless Chromium loads an unpacked MV3 extension and starts its service worker', async () => {
  const extensionPath = await makeProbeExtension();
  const { context, userDataDir } = await launchExtensionContext(extensionPath);
  try {
    const sw = await waitForServiceWorker(context);
    expect(sw.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/sw\.js$/);

    const extensionId = extensionIdFromUrl(sw.url());
    expect(extensionId).toHaveLength(32);

    // The worker really is running our code.
    await expect.poll(() => sw.evaluate(() => (globalThis as any).__probe === true)).toBe(true);

    // …and chrome.* APIs are available inside it.
    const manifestName = await sw.evaluate(() => (globalThis as any).chrome.runtime.getManifest().name);
    expect(manifestName).toBe(MANIFEST.name);
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(extensionPath, { recursive: true, force: true });
  }
});

test('the fixture server serves pages, ad assets and hit counters', async () => {
  const server = await startServer();
  const extensionPath = await makeProbeExtension();
  const { context, userDataDir } = await launchExtensionContext(extensionPath);
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(server.url('/network.html'));
    await page.waitForFunction(() => (globalThis as any).__loaded === true);

    // With only the probe extension loaded, nothing is blocked.
    expect(await page.evaluate(() => (globalThis as any).__ad)).toBe(true);
    expect(await page.locator('#pixel').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    expect(server.hitsFor('/ads/banner.js')).toBe(1);
    expect(server.hitsFor('/track/pixel.gif')).toBe(1);
    expect(server.hitsFor('/api/data.json')).toBe(1);

    const hits = await (await page.request.get(server.url('/__hits'))).json();
    expect(hits['/network.html']).toBe(1);

    server.resetHits();
    expect(server.hits()).toEqual({});
  } finally {
    await context.close();
    await rm(userDataDir, { recursive: true, force: true });
    await rm(extensionPath, { recursive: true, force: true });
    await server.close();
  }
});

test('the chromium binary under test is resolvable', () => {
  const executablePath = chromeExecutablePath();
  // Undefined means "use Playwright's own download", which is what CI does.
  expect(executablePath === undefined || executablePath.length > 0).toBe(true);
});
