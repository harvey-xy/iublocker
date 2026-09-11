// Playwright config for the iuBlocker e2e suite (docs/TESTING.md).
//
// The extension is loaded unpacked through chromium.launchPersistentContext (see
// fixtures/extension.ts), which is why there is no `projects` browser entry here: every
// test brings up its own persistent context. Workers stay at 1 — each test drives a real
// browser profile with a service worker, and the fixture server counts requests globally.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: './test-results',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 15_000,
  },
});
