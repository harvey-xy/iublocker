/**
 * Playwright global setup. Builds nothing: it only checks that the unpacked extension is
 * there and prints an actionable message when it is not, so the suite fails with
 * "run pnpm build:e2e" instead of a stack trace from Chromium.
 *
 * It does not throw, so self-contained harness tests (e2e/tests/harness.spec.ts, which
 * generates its own throwaway extension) still run on a clean checkout. Every fixture
 * that needs the real extension fails immediately with the same message.
 *
 * A run driven by IUB_REAL_RULESETS_DIST (e2e/tests/real-rulesets.spec.ts) loads that
 * directory instead and does not need `packages/extension/dist` at all.
 */
import {
  EXTENSION_DIST,
  MISSING_DIST_MESSAGE,
  chromeExecutablePath,
  extensionDistExists,
} from './fixtures/paths';

export default function globalSetup(): void {
  const executablePath = chromeExecutablePath();
  console.log(`[e2e] chromium: ${executablePath ?? "playwright's own download"}`);

  // A real-list verification run (pnpm verify:real) brings its own build and never looks
  // at packages/extension/dist, so do not tell it to run `pnpm build:e2e`.
  if (process.env.IUB_REAL_RULESETS_DIST) {
    console.log(`[e2e] real-list build: ${process.env.IUB_REAL_RULESETS_DIST}`);
    return;
  }

  if (!extensionDistExists()) {
    process.env.IUB_DIST_MISSING = '1';
    console.error(`\n[e2e] ${MISSING_DIST_MESSAGE}\n`);
    return;
  }
  delete process.env.IUB_DIST_MISSING;
  console.log(`[e2e] extension: ${EXTENSION_DIST}`);
}
