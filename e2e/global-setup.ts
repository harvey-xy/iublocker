/**
 * Playwright global setup. Builds nothing: it only checks that the unpacked extension is
 * there and prints an actionable message when it is not, so the suite fails with
 * "run pnpm build:e2e" instead of a stack trace from Chromium.
 *
 * It does not throw, so self-contained harness tests (e2e/tests/harness.spec.ts, which
 * generates its own throwaway extension) still run on a clean checkout. Every fixture
 * that needs the real extension fails immediately with the same message.
 */
import { EXTENSION_DIST, MISSING_DIST_MESSAGE, chromeExecutablePath, extensionDistExists } from './fixtures/paths';

export default function globalSetup(): void {
  const executablePath = chromeExecutablePath();
  console.log(`[e2e] chromium: ${executablePath ?? "playwright's own download"}`);

  if (!extensionDistExists()) {
    process.env.IUB_DIST_MISSING = '1';
    console.error(`\n[e2e] ${MISSING_DIST_MESSAGE}\n`);
    return;
  }
  delete process.env.IUB_DIST_MISSING;
  console.log(`[e2e] extension: ${EXTENSION_DIST}`);
}
