/**
 * verify-real-rulesets — build the real filter lists and let Chrome judge the result.
 *
 *   pnpm verify:real [-- --cache .cache/lists] [--keep] [--work <dir>]
 *
 * Chrome validates every declared static ruleset when an extension loads — disabled ones
 * included — so one rule it refuses stops the extension from loading at all, and one rule
 * it silently *skips* (an over-budget `regexFilter`, say) quietly shrinks the build. No
 * unit test can see either. This script therefore:
 *
 *   1. compiles the cached lists into <work>/rulesets (the compiler CLI),
 *   2. builds the extension into <work>/dist against them (`--rulesets`, `--strict`),
 *   3. runs e2e/tests/real-rulesets.spec.ts against <work>/dist in real Chromium,
 *   4. prints what Chrome reported: rules per list, bytes, registered scripts, probes.
 *
 * Everything happens in a temp directory: `packages/extension/rulesets` and
 * `packages/extension/dist` are never touched. docs/TESTING.md "Real-list load
 * verification".
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boolFlag, parseArgs, stringFlag } from './lib/args';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage: tsx tools/verify-real-rulesets.ts [options]

  --cache <dir>    cached lists to compile (default .cache/lists)
  --lists <file>   list catalogue (default tools/filterlists.json)
  --work <dir>     working directory (default: a fresh mkdtemp)
  --keep           do not delete the working directory
  --help
`;

function bin(name: string, dir = REPO_ROOT): string {
  return path.join(dir, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 0)));
  });
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirBytes(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

function human(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

interface Summary {
  build?: {
    extensionVersion: string;
    rulesetVersion: string;
    declaredRulesets: number;
    lists: { id: string; defaultEnabled: boolean; rules: number; regex: number }[];
    budget: { staticRulesTotal: number; staticRulesDefaultEnabled: number; regexTotal: number };
  };
  defaultProfile?: {
    enabled: string[];
    languages: string[];
    availableStaticRuleCount: number;
    declaredRules: number;
  };
  rulesPerList?: Record<string, number>;
  probes?: {
    enabledRulesets: string[];
    blocked: {
      url: string;
      blocked: boolean;
      matched: { rulesetId: string; ruleId: number; action: string }[];
    }[];
    clean: { url: string; blocked: boolean }[];
  };
  scriptlets?: { groups: number; dynamicHosts: number; registeredScripts: number; files: number };
}

async function printSummary(summary: Summary, work: string): Promise<void> {
  const rulesetDir = path.join(work, 'rulesets');
  const distDir = path.join(work, 'dist');
  const counted = summary.rulesPerList ?? {};

  console.info('\n──────────────────────────────── real-list verification ────────────────────────────────');
  if (summary.build) {
    console.info(
      `extension ${summary.build.extensionVersion} · rulesets ${summary.build.rulesetVersion} · ` +
        `${summary.build.declaredRulesets} declared rulesets`,
    );
    console.info('');
    console.info('list                default   rules  chrome   regex       dnr bytes');
    console.info('---------------------------------------------------------------------');
    for (const entry of summary.build.lists) {
      const file = path.join(rulesetDir, 'dnr', `${entry.id}.json`);
      const bytes = existsSync(file) ? (await stat(file)).size : 0;
      const chrome = counted[entry.id];
      console.info(
        entry.id.padEnd(20) +
          (entry.defaultEnabled ? 'yes' : 'no').padEnd(8) +
          String(entry.rules).padStart(7) +
          String(chrome ?? '—').padStart(8) +
          String(entry.regex).padStart(8) +
          human(bytes).padStart(16),
      );
    }
    console.info('---------------------------------------------------------------------');
    console.info(
      `budget: ${summary.build.budget.staticRulesTotal} rules total, ` +
        `${summary.build.budget.staticRulesDefaultEnabled} default-enabled, ` +
        `${summary.build.budget.regexTotal} regex`,
    );
  }

  if (summary.defaultProfile) {
    const profile = summary.defaultProfile;
    console.info('');
    console.info(`first run (UI language ${profile.languages.join(', ') || 'unknown'}):`);
    console.info(`  enabled rulesets   ${profile.enabled.join(', ')}`);
    console.info(
      `  static rule budget ${profile.availableStaticRuleCount} available, ${profile.declaredRules} loaded`,
    );
  }

  if (summary.scriptlets) {
    console.info('');
    console.info(
      `scriptlets: ${summary.scriptlets.registeredScripts} registered content scripts ` +
        `(${summary.scriptlets.groups} groups in the manifest, ` +
        `${summary.scriptlets.dynamicHosts} hosts demoted to the dynamic path, ` +
        `${summary.scriptlets.files} bundle files)`,
    );
  }

  if (summary.probes) {
    console.info('');
    console.info(`probes (${summary.probes.enabledRulesets.length} rulesets enabled):`);
    for (const probe of summary.probes.blocked) {
      const hit = probe.matched[0];
      console.info(
        `  ${probe.blocked ? 'blocked    ' : 'NOT blocked'} ${probe.url}` +
          (hit ? `  ← ${hit.rulesetId}#${hit.ruleId} (${hit.action})` : ''),
      );
    }
    for (const probe of summary.probes.clean) {
      console.info(`  ${probe.blocked ? 'BLOCKED    ' : 'allowed    '} ${probe.url}`);
    }
  }

  console.info('');
  console.info(
    `rulesets ${human(await dirBytes(rulesetDir))} · unpacked build ${human(await dirBytes(distDir))}`,
  );
  console.info('────────────────────────────────────────────────────────────────────────────────────────\n');
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { boolean: ['keep', 'help'] });
  if (boolFlag(args, 'help')) {
    console.info(USAGE);
    return 0;
  }

  const cache = path.resolve(REPO_ROOT, stringFlag(args, 'cache') ?? '.cache/lists');
  const lists = path.resolve(REPO_ROOT, stringFlag(args, 'lists') ?? 'tools/filterlists.json');
  if (!existsSync(cache)) {
    console.error(`[verify:real] no cached lists at ${cache} — run \`pnpm rulesets:fetch\` first.`);
    return 1;
  }
  if (!existsSync(bin('tsx'))) {
    console.error('[verify:real] tsx is not installed — run `pnpm install` first.');
    return 1;
  }
  if (!existsSync(bin('playwright', path.join(REPO_ROOT, 'e2e')))) {
    console.error('[verify:real] Playwright is not installed in e2e/ — run `pnpm install` first.');
    return 1;
  }

  const workFlag = stringFlag(args, 'work');
  const work = workFlag
    ? path.resolve(REPO_ROOT, workFlag)
    : await mkdtemp(path.join(os.tmpdir(), 'iub-verify-real-'));
  const keep = boolFlag(args, 'keep') || workFlag !== undefined;
  const rulesetDir = path.join(work, 'rulesets');
  const distDir = path.join(work, 'dist');
  const summaryFile = path.join(work, 'summary.json');
  console.info(`[verify:real] working directory ${work}`);

  let code = 0;
  try {
    console.info(`[verify:real] compiling ${cache} → ${rulesetDir}`);
    code = await run(bin('tsx'), [
      path.join('packages', 'compiler', 'src', 'cli', 'index.ts'),
      '--lists',
      lists,
      '--cache',
      cache,
      '--out',
      rulesetDir,
    ]);
    if (code !== 0) {
      console.error('[verify:real] the compiler failed.');
      return code;
    }

    console.info(`[verify:real] building the extension → ${distDir}`);
    code = await run(bin('tsx'), [
      path.join('packages', 'extension', 'scripts', 'build.ts'),
      '--out',
      distDir,
      '--rulesets',
      rulesetDir,
      '--strict',
    ]);
    if (code !== 0) {
      console.error('[verify:real] the extension build failed.');
      return code;
    }

    console.info('[verify:real] handing the build to Chromium…');
    code = await run(bin('playwright', path.join(REPO_ROOT, 'e2e')), ['test', 'real-rulesets.spec.ts'], {
      cwd: path.join(REPO_ROOT, 'e2e'),
      env: { IUB_REAL_RULESETS_DIST: distDir, IUB_REAL_RULESETS_SUMMARY: summaryFile },
    });

    if (existsSync(summaryFile)) {
      const summary = JSON.parse(await readFile(summaryFile, 'utf8')) as Summary;
      await printSummary(summary, work);
    }
    if (code !== 0) {
      console.error('[verify:real] Chrome did not accept the real-list build (see the failures above).');
      console.error(`[verify:real] the build is kept at ${work} for inspection.`);
      return code;
    }
    console.info('[verify:real] Chrome loaded the real-list build and every check passed.');
    return 0;
  } finally {
    if (!keep && code === 0) await rm(work, { recursive: true, force: true });
    else if (!keep) console.info(`[verify:real] keeping ${work}`);
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error('[verify:real] failed:', err);
    process.exitCode = 1;
  });
