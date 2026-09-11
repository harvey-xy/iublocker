/** TEMPORARY: does `*://*.host/*` match the bare host in Chrome? */
import { test, expect } from '@playwright/test';
import { launchExtensionContext, waitForServiceWorker, waitForWorkerReady } from '../fixtures/extension';
import { EXTENSION_DIST } from '../fixtures/paths';
import { startServer } from '../server';

test('*://*.host/* matches the bare host', async () => {
  const server = await startServer();
  const { context } = await launchExtensionContext(EXTENSION_DIST, {
    args: ['--host-resolver-rules=MAP iub.test 127.0.0.1,MAP sub.iub.test 127.0.0.1'],
  });
  try {
    const sw = await waitForServiceWorker(context);
    await waitForWorkerReady(sw);
    await sw.evaluate(async () => {
      await (globalThis as any).chrome.scripting.registerContentScripts([
        {
          id: 'probe',
          matches: ['*://*.iub.test/*'],
          js: ['rulesets/scriptlet-lib/../../probe.js'],
          world: 'MAIN',
          runAt: 'document_start',
        },
      ]);
    });
    const page = await context.newPage();
    for (const host of ['iub.test', 'sub.iub.test']) {
      const res = await page.goto(`http://${host}:${server.port}/scriptlet.html`);
      expect(res?.ok(), `${host} loaded`).toBe(true);
    }
    const registered = await sw.evaluate(async () =>
      ((await (globalThis as any).chrome.scripting.getRegisteredContentScripts()) as any[]).map(
        (s) => s.id,
      ),
    );
    expect(registered).toContain('probe');
  } finally {
    await context.close();
    await server.close();
  }
});
