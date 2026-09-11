/** Shared paths and browser resolution for the e2e suite. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const E2E_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(E2E_ROOT, '..');

/** Unpacked extension to load. Override with IUB_EXTENSION_DIST. */
export const EXTENSION_DIST = process.env.IUB_EXTENSION_DIST
  ? path.resolve(process.env.IUB_EXTENSION_DIST)
  : path.join(REPO_ROOT, 'packages', 'extension', 'dist');

export const EXTENSION_MANIFEST = path.join(EXTENSION_DIST, 'manifest.json');

export const MISSING_DIST_MESSAGE = [
  `The unpacked extension is missing: ${EXTENSION_MANIFEST}`,
  '',
  'Build it first:',
  '',
  '    pnpm build:e2e',
  '',
  '(that is `IUB_E2E=1 pnpm build`, which also compiles e2e/fixtures/test-list.txt into the',
  '`e2e-test` ruleset). Set IUB_EXTENSION_DIST to point somewhere else.',
].join('\n');

export function extensionDistExists(): boolean {
  return existsSync(EXTENSION_MANIFEST);
}

/**
 * Chromium to launch.
 *
 * Locally the sandbox ships a Chromium that does not match the revision this Playwright
 * version would download, so we point at it explicitly (IUB_CHROME_PATH, or the known
 * location). In CI `playwright install chromium` provides a matching build and we return
 * undefined so Playwright picks its own.
 */
export const DEFAULT_CHROME_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export function chromeExecutablePath(): string | undefined {
  const fromEnv = process.env.IUB_CHROME_PATH;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`IUB_CHROME_PATH does not exist: ${fromEnv}`);
    return fromEnv;
  }
  return existsSync(DEFAULT_CHROME_PATH) ? DEFAULT_CHROME_PATH : undefined;
}
