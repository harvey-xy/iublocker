/**
 * Playwright fixtures that load the unpacked extension.
 *
 * MV3 extensions can only be loaded through a persistent context:
 *
 *   chromium.launchPersistentContext(userDataDir, {
 *     headless: true,                     // Chrome's "new" headless supports extensions
 *     args: ['--disable-extensions-except=<dist>', '--load-extension=<dist>', '--no-sandbox'],
 *     executablePath,                     // see fixtures/paths.ts
 *   })
 *
 * The extension id is read from the service worker URL, so every test that needs the
 * worker waits for `context.waitForEvent('serviceworker')` (or picks up an already
 * registered one).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { EXTENSION_DIST, MISSING_DIST_MESSAGE, chromeExecutablePath, extensionDistExists } from './paths';
import { startServer, type FixtureServer } from '../server';

export interface LaunchExtensionOptions {
  /** Extra Chromium flags. */
  args?: string[];
  /** Defaults to a fresh mkdtemp directory. */
  userDataDir?: string;
  slowMo?: number;
}

/** Launch a persistent context with `extensionPath` loaded unpacked. */
export async function launchExtensionContext(
  extensionPath: string,
  options: LaunchExtensionOptions = {},
): Promise<{ context: BrowserContext; userDataDir: string }> {
  const userDataDir = options.userDataDir ?? (await mkdtemp(path.join(os.tmpdir(), 'iub-e2e-profile-')));
  const executablePath = chromeExecutablePath();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: undefined,
    ...(executablePath ? { executablePath } : {}),
    ...(options.slowMo ? { slowMo: options.slowMo } : {}),
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-features=DialMediaRouteProvider',
      ...(options.args ?? []),
    ],
  });
  return { context, userDataDir };
}

/** The extension's service worker, waiting for registration if it has not started yet. */
export async function waitForServiceWorker(context: BrowserContext, timeout = 30_000): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return await context.waitForEvent('serviceworker', { timeout });
}

/**
 * Playwright hands out the worker target before Chrome has installed its `chrome.*`
 * bindings, and the extension registers its scriptlet content scripts asynchronously on
 * install. Wait for both so tests do not race the worker's own start-up.
 */
export async function waitForWorkerReady(sw: Worker, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  const poll = async (probe: () => Promise<boolean>): Promise<boolean> => {
    while (Date.now() < deadline) {
      try {
        if (await probe()) return true;
      } catch {
        /* worker not ready yet */
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const hasRuntime = await poll(() =>
    sw.evaluate(() => typeof (globalThis as any).chrome?.runtime?.getManifest === 'function'),
  );
  if (!hasRuntime) throw new Error('extension service worker never exposed chrome.runtime');
  await poll(() =>
    sw.evaluate(async () => {
      const scripts = await (globalThis as any).chrome.scripting.getRegisteredContentScripts();
      return Array.isArray(scripts) && scripts.length > 0;
    }),
  );
}

/** `chrome-extension://<id>/…` → `<id>` */
export function extensionIdFromUrl(url: string): string {
  const match = /^chrome-extension:\/\/([a-p]{32})\//.exec(url);
  if (!match?.[1]) throw new Error(`not an extension URL: ${url}`);
  return match[1];
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

/** Message shape accepted by the worker's router (docs/MESSAGING.md `Request`). */
export type ExtensionRequest = { type: string } & Record<string, unknown>;

export interface ExtensionFixtures {
  context: BrowserContext;
  extensionId: string;
  sw: Worker;
  page: Page;
  /** Console output of the service worker collected for the whole test. */
  swConsole: ConsoleEntry[];
  /** Open the popup for a tab: navigates `page` to `tabUrl` first when given. */
  popup: (tabUrl?: string) => Promise<Page>;
  /** chrome.runtime.sendMessage from an extension page; unwraps the `Envelope`. */
  sendRequest: <T = unknown>(message: ExtensionRequest) => Promise<T>;
}

export interface ExtensionWorkerFixtures {
  server: FixtureServer;
}

export const test = base.extend<ExtensionFixtures, ExtensionWorkerFixtures>({
  server: [
    // Playwright requires the destructuring pattern even when there are no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startServer();
      await use(server);
      await server.close();
    },
    { scope: 'worker' },
  ],

  context: async ({ server }, use) => {
    if (!extensionDistExists()) throw new Error(MISSING_DIST_MESSAGE);
    server.resetHits();
    const { context, userDataDir } = await launchExtensionContext(EXTENSION_DIST);
    try {
      await use(context);
    } finally {
      await context.close();
      await rm(userDataDir, { recursive: true, force: true });
    }
  },

  sw: async ({ context }, use) => {
    const sw = await waitForServiceWorker(context);
    await waitForWorkerReady(sw);
    await use(sw);
  },

  swConsole: async ({ sw }, use) => {
    const entries: ConsoleEntry[] = [];
    sw.on('console', (msg) => entries.push({ type: msg.type(), text: msg.text() }));
    await use(entries);
  },

  extensionId: async ({ sw }, use) => {
    await use(extensionIdFromUrl(sw.url()));
  },

  page: async ({ context, sw }, use) => {
    void sw; // readiness: the worker fixture waits for chrome.runtime + registered scripts
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },

  sendRequest: async ({ context, extensionId, page }, use) => {
    let helper: Page | undefined;

    const ensureHelper = async (): Promise<Page> => {
      if (helper && !helper.isClosed()) return helper;
      const candidate = await context.newPage();
      let lastError: unknown;
      for (const file of ['popup.html', 'dashboard.html']) {
        try {
          await candidate.goto(`chrome-extension://${extensionId}/${file}`);
          const ok = await candidate.evaluate(
            () => typeof (globalThis as any).chrome?.runtime?.sendMessage === 'function',
          );
          if (ok) {
            helper = candidate;
            // Opening the helper focused it; hand focus back so chrome.tabs.query({active:true})
            // in the worker keeps describing the page under test.
            await page.bringToFront().catch(() => undefined);
            return candidate;
          }
        } catch (err) {
          lastError = err;
        }
      }
      await candidate.close();
      throw new Error(
        `could not open an extension page to send messages from (tried popup.html, dashboard.html): ${String(lastError)}`,
      );
    };

    const send = async <T>(message: ExtensionRequest): Promise<T> => {
      const page = await ensureHelper();
      const raw = await page.evaluate(
        (msg) =>
          new Promise<unknown>((resolve, reject) => {
            (globalThis as any).chrome.runtime.sendMessage(msg, (response: unknown) => {
              const err = (globalThis as any).chrome.runtime.lastError;
              if (err) reject(new Error(String(err.message)));
              else resolve(response);
            });
          }),
        message,
      );
      if (raw && typeof raw === 'object' && 'ok' in (raw as Record<string, unknown>)) {
        const envelope = raw as { ok: boolean; data?: unknown; error?: string };
        if (!envelope.ok) throw new Error(envelope.error ?? 'request failed');
        return envelope.data as T;
      }
      return raw as T;
    };

    await use(send);
    if (helper && !helper.isClosed()) await helper.close();
  },

  popup: async ({ context, extensionId, page, sendRequest }, use) => {
    const opened: Page[] = [];

    const open = async (tabUrl?: string): Promise<Page> => {
      if (tabUrl) await page.goto(tabUrl, { waitUntil: 'load' });

      // A popup opened as a tab would be the active tab itself, so
      // chrome.tabs.query({active:true}) inside it would describe the popup rather than
      // the site. Create the tab first, hand focus back to the page under test, and only
      // then navigate the popup: it loads in the background and sees the right tab.
      const popupPage = await context.newPage();
      opened.push(popupPage);
      await page.bringToFront();

      const state = await sendRequest<{ tabId?: number }>({ type: 'tab:getState' }).catch(
        () => ({}) as { tabId?: number },
      );
      const tabId = state?.tabId;
      const url = `chrome-extension://${extensionId}/popup.html${typeof tabId === 'number' ? `?tabId=${tabId}` : ''}`;
      await popupPage.goto(url);
      return popupPage;
    };

    await use(open);
    for (const p of opened) if (!p.isClosed()) await p.close();
  },
});

export { expect };
export type { FixtureServer };
