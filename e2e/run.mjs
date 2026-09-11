#!/usr/bin/env node
/**
 * `pnpm e2e` entry point.
 *
 * Runs the Playwright version installed in e2e/ (not whatever `playwright` happens to be
 * on PATH) with e2e/ as the cwd, and drops the bare `--` that pnpm forwards, so all of
 * these work:
 *
 *     pnpm e2e
 *     pnpm e2e harness
 *     pnpm e2e -- harness --headed
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const E2E_ROOT = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(E2E_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');

if (!existsSync(bin)) {
  console.error(`[e2e] Playwright is not installed in ${E2E_ROOT} — run \`pnpm install\` first.`);
  process.exit(1);
}

const args = process.argv.slice(2).filter((arg) => arg !== '--');
const child = spawn(bin, ['test', ...args], { cwd: E2E_ROOT, stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`[e2e] could not start Playwright: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
