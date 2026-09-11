/**
 * Extension build. docs/BUILD-AND-RELEASE.md "Extension build".
 *
 *   pnpm --filter @iublocker/extension build [-- --watch] [--minify] [--strict] [--out <dir>]
 *
 * 1. clean dist/
 * 2. esbuild every entry point that exists (other workstreams may not have landed theirs
 *    yet — a missing entry is a warning, not an error)
 * 3. copy public/** and the compiler output rulesets/**
 * 4. generate manifest.json from src/manifest.ts + rulesets/manifest.json + the root
 *    package.json version
 * 5. write build-info.json
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import type { RulesetManifest } from '@iublocker/shared';
import { baseManifest } from '../src/manifest';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(packageDir, '..', '..');

export interface EntryPoint {
  src: string;
  out: string;
  format: 'esm' | 'iife';
}

export const ENTRY_POINTS: EntryPoint[] = [
  { src: 'src/background/index.ts', out: 'background.js', format: 'esm' },
  { src: 'src/content/cosmetic.ts', out: 'content/cosmetic.js', format: 'iife' },
  { src: 'src/content/picker.ts', out: 'content/picker.js', format: 'iife' },
  { src: 'src/ui/popup/index.tsx', out: 'popup.js', format: 'iife' },
  { src: 'src/ui/dashboard/index.tsx', out: 'dashboard.js', format: 'iife' },
  { src: 'src/ui/logger/index.tsx', out: 'logger.js', format: 'iife' },
];

export interface BuildOptions {
  outDir?: string;
  watch?: boolean;
  minify?: boolean;
  /** Fail instead of warning when the compiler output (rulesets/) is missing. */
  strict?: boolean;
  /** Do not copy rulesets/ at all. */
  skipRulesets?: boolean;
  /** Include the e2e-test ruleset (also set by IUB_E2E=1). */
  e2e?: boolean;
  silent?: boolean;
}

export interface BuildResult {
  outDir: string;
  built: string[];
  skipped: string[];
  rulesetVersion: string | null;
  ruleResources: RuleResource[];
  manifest: ChromeManifest;
  warnings: string[];
}

interface RuleResource {
  id: string;
  enabled: boolean;
  path: string;
}

interface ContentScript {
  matches?: string[];
  js?: string[];
  [key: string]: unknown;
}

export interface ChromeManifest extends Record<string, unknown> {
  version?: string;
  content_scripts?: ContentScript[];
  declarative_net_request?: { rule_resources: RuleResource[] };
}

export function parseArgs(argv: readonly string[]): BuildOptions {
  const options: BuildOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--watch':
        options.watch = true;
        break;
      case '--minify':
        options.minify = true;
        break;
      case '--strict':
        options.strict = true;
        break;
      case '--skip-rulesets':
        options.skipRulesets = true;
        break;
      case '--e2e':
        options.e2e = true;
        break;
      case '--out':
        options.outDir = argv[++i];
        break;
      default:
        if (arg?.startsWith('--out=')) options.outDir = arg.slice('--out='.length);
        else if (arg) console.warn(`[build] ignoring unknown flag ${arg}`);
    }
  }
  return options;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function gitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

function esbuildOptions(entry: EntryPoint, outDir: string, minify: boolean): esbuild.BuildOptions {
  return {
    entryPoints: [path.join(packageDir, entry.src)],
    outfile: path.join(outDir, entry.out),
    bundle: true,
    format: entry.format,
    platform: 'browser',
    target: ['chrome128'],
    minify,
    sourcemap: minify ? false : true,
    legalComments: 'none',
    jsx: 'automatic',
    jsxImportSource: 'preact',
    logLevel: 'silent',
    define: {
      __IUB_DEV__: String(!minify),
      'process.env.NODE_ENV': JSON.stringify(minify ? 'production' : 'development'),
    },
  };
}

/** rule_resources for the manifest, from the compiler's rulesets/manifest.json. */
export function buildRuleResources(
  rulesetManifest: RulesetManifest | null,
  options: { e2e: boolean; exists: (relPath: string) => boolean; warn: (message: string) => void },
): RuleResource[] {
  const resources: RuleResource[] = [];
  for (const entry of rulesetManifest?.lists ?? []) {
    const file = entry.files?.dnr && entry.files.dnr.length > 0 ? entry.files.dnr : `dnr/${entry.id}.json`;
    const rel = file.startsWith('rulesets/') ? file : `rulesets/${file.replace(/^\/+/, '')}`;
    if (!options.exists(rel)) {
      options.warn(`ruleset ${entry.id}: ${rel} is missing, dropping it from the manifest`);
      continue;
    }
    resources.push({ id: entry.id, enabled: entry.defaultEnabled === true, path: rel });
  }
  if (options.e2e) {
    const rel = 'rulesets/dnr/e2e-test.json';
    const existing = resources.find((resource) => resource.id === 'e2e-test');
    if (existing) existing.enabled = true;
    else if (options.exists(rel)) resources.push({ id: 'e2e-test', enabled: true, path: rel });
    else options.warn(`IUB_E2E is set but ${rel} does not exist`);
  }
  return resources;
}

export function buildManifest(
  version: string,
  ruleResources: RuleResource[],
  exists: (relPath: string) => boolean,
  warn: (message: string) => void,
): ChromeManifest {
  const manifest = JSON.parse(JSON.stringify(baseManifest)) as ChromeManifest;
  manifest.version = version;
  manifest.declarative_net_request = { rule_resources: ruleResources };
  if (Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = manifest.content_scripts.filter((script) => {
      const files = script.js ?? [];
      const missing = files.filter((file) => !exists(file));
      if (missing.length === 0) return true;
      warn(`content script ${missing.join(', ')} was not built; dropping the entry from the manifest`);
      return false;
    });
    if (manifest.content_scripts.length === 0) delete manifest.content_scripts;
  }
  return manifest;
}

export async function runBuild(options: BuildOptions = {}): Promise<BuildResult> {
  const outDir = path.resolve(options.outDir ? path.resolve(options.outDir) : path.join(packageDir, 'dist'));
  const minify = options.minify ?? process.env.NODE_ENV === 'production';
  const e2e = options.e2e ?? process.env.IUB_E2E === '1';
  const warnings: string[] = [];
  const log = (message: string) => {
    if (!options.silent) console.info(`[build] ${message}`);
  };
  const warn = (message: string) => {
    warnings.push(message);
    if (!options.silent) console.warn(`[build] ${message}`);
  };

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  /* ------------------------------------------------------------------ bundles -- */
  const built: string[] = [];
  const skipped: string[] = [];
  const present = ENTRY_POINTS.filter((entry) => {
    if (existsSync(path.join(packageDir, entry.src))) return true;
    skipped.push(entry.src);
    warn(`entry point ${entry.src} does not exist yet, skipping ${entry.out}`);
    return false;
  });

  const contexts: esbuild.BuildContext[] = [];
  for (const entry of present) {
    const config = esbuildOptions(entry, outDir, minify);
    if (options.watch) {
      const ctx = await esbuild.context(config);
      await ctx.rebuild();
      await ctx.watch();
      contexts.push(ctx);
    } else {
      await esbuild.build(config);
    }
    built.push(entry.out);
  }

  /* ------------------------------------------------------------------- static -- */
  const publicDir = path.join(packageDir, 'public');
  if (existsSync(publicDir)) await cp(publicDir, outDir, { recursive: true });
  else warn('public/ does not exist');

  let rulesetManifest: RulesetManifest | null = null;
  const rulesetsSrc = path.join(packageDir, 'rulesets');
  if (options.skipRulesets) {
    warn('--skip-rulesets: the build has no static rulesets');
  } else if (existsSync(rulesetsSrc)) {
    await cp(rulesetsSrc, path.join(outDir, 'rulesets'), { recursive: true });
    rulesetManifest = await readJson<RulesetManifest>(path.join(outDir, 'rulesets', 'manifest.json'));
    if (!rulesetManifest) warn('rulesets/manifest.json is missing or malformed');
  } else {
    const message = 'rulesets/ not found — run `pnpm rulesets:build` first';
    if (options.strict) throw new Error(message);
    warn(`${message}; continuing with an empty ruleset list`);
  }

  /* ----------------------------------------------------------------- manifest -- */
  const rootPkg = await readJson<{ version?: string }>(path.join(repoRoot, 'package.json'));
  const version = rootPkg?.version ?? '0.0.0';
  const exists = (rel: string) => existsSync(path.join(outDir, rel));
  const ruleResources = buildRuleResources(rulesetManifest, { e2e, exists, warn });
  const manifest = buildManifest(version, ruleResources, exists, warn);
  await writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  await writeFile(
    path.join(outDir, 'build-info.json'),
    `${JSON.stringify(
      {
        version,
        gitSha: gitSha(),
        builtAt: new Date().toISOString(),
        rulesetVersion: rulesetManifest?.version ?? null,
        rulesets: ruleResources.length,
        minified: minify,
        e2e,
        entries: built,
        skipped,
      },
      null,
      2,
    )}\n`,
  );

  log(`${built.length} bundle(s) → ${outDir}${skipped.length ? ` (${skipped.length} skipped)` : ''}`);
  if (options.watch) {
    log('watching for changes… (static assets are copied once; re-run for public/ changes)');
    // Keep the contexts alive for the lifetime of the process.
    void contexts;
  }

  return {
    outDir,
    built,
    skipped,
    rulesetVersion: rulesetManifest?.version ?? null,
    ruleResources,
    manifest,
    warnings,
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runBuild(parseArgs(process.argv.slice(2))).catch((err: unknown) => {
    console.error('[build] failed:', err);
    process.exitCode = 1;
  });
}
