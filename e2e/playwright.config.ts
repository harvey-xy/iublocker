// Playwright config — workstream T7 fills this in (docs/TESTING.md). Uses the pre-installed Chromium.
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests', timeout: 60_000, workers: 1, use: { headless: true } });
