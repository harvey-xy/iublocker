#!/usr/bin/env tsx
/**
 * iub-compile — build static rulesets from cached filter lists.
 * docs/RULESETS.md §2 (output layout), §3 (budgets).
 *
 * This is the only part of the compiler allowed to use Node built-ins.
 *
 *   iub-compile --lists tools/filterlists.json --cache .cache/lists --out <dir>
 *               [--extra <listId>=<path>]... [--only id1,id2]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CosmeticDB,
  DroppedFilter,
  FilterListSource,
  FilterListsConfig,
  RulesetListEntry,
  RulesetManifest,
  RulesetReport,
  ScriptletDB,
  ScriptletGroup,
} from '@iublocker/shared';
import { BUILD_BUDGET, DNR_LIMITS, ID_RANGE, emptyCosmeticDB, emptyScriptletDB } from '@iublocker/shared';
import type { ClassifiedList, CompileOptions } from '../types';
import { classifyLines } from '../parser/classify';
import { collectBadfilterKeys, compileNetwork } from '../network';
import { cosmeticApi, scriptletApi } from '../user';
import * as scriptletModule from '../scriptlet';

interface ScriptletGroupApi {
  computeScriptletGroups?: (dbs: { listId: string; db: ScriptletDB }[]) => ScriptletGroup[];
  emitScriptletGroupBundle?: (group: ScriptletGroup) => string;
}

function scriptletGroupApi(): ScriptletGroupApi {
  return scriptletModule as unknown as ScriptletGroupApi;
}

export interface CliOptions {
  lists: string;
  cache: string;
  out: string;
  extra: { id: string; path: string }[];
  only: string[] | null;
  e2e: boolean;
}

export interface SourceMeta {
  url: string;
  sha256: string;
  fetchedAt: string;
}

const USAGE = `iub-compile — compile filter lists into DNR rulesets

  --lists <file>        tools/filterlists.json (required)
  --cache <dir>         directory with <id>.txt / <id>.meta.json (required)
  --out <dir>           output directory (required)
  --extra <id>=<path>   compile an ad-hoc list (repeatable)
  --only <id,id,...>    only compile these list ids
  --help                this message

Set IUB_E2E=1 to additionally compile e2e/fixtures/test-list.txt as "e2e-test".`;

export function parseArgs(argv: readonly string[]): { options: CliOptions } | { error: string } {
  const options: CliOptions = {
    lists: '',
    cache: '',
    out: '',
    extra: [],
    only: null,
    e2e: process.env.IUB_E2E === '1',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    const next = (): string => {
      const v = argv[i + 1];
      i += 1;
      return v ?? '';
    };
    switch (arg) {
      case '--lists':
        options.lists = next();
        break;
      case '--cache':
        options.cache = next();
        break;
      case '--out':
        options.out = next();
        break;
      case '--only':
        options.only = next()
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '');
        break;
      case '--extra': {
        const spec = next();
        const eq = spec.indexOf('=');
        if (eq <= 0) return { error: `--extra expects <listId>=<path>, got "${spec}"` };
        options.extra.push({ id: spec.slice(0, eq), path: spec.slice(eq + 1) });
        break;
      }
      case '--help':
      case '-h':
        return { error: USAGE };
      default:
        return { error: `unknown argument "${arg}"` };
    }
  }
  if (options.lists === '') return { error: 'missing --lists' };
  if (options.cache === '') return { error: 'missing --cache' };
  if (options.out === '') return { error: 'missing --out' };
  return { options };
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function readMeta(cacheDir: string, source: FilterListSource, text: string): SourceMeta[] {
  const metaPath = join(cacheDir, `${source.id}.meta.json`);
  if (existsSync(metaPath)) {
    try {
      const parsed = JSON.parse(readFileSync(metaPath, 'utf8')) as { sources?: SourceMeta[] };
      if (Array.isArray(parsed.sources) && parsed.sources.length > 0) return parsed.sources;
    } catch {
      // fall through to the computed meta below
    }
  }
  return [{ url: source.urls[0] ?? '', sha256: sha256(text), fetchedAt: new Date().toISOString() }];
}

/** `YYYY.MM.DD.N` from the newest source timestamp. docs/BUILD-AND-RELEASE.md. */
export function rulesetVersion(sources: readonly SourceMeta[], build = 1): string {
  let newest = 0;
  for (const s of sources) {
    const t = Date.parse(s.fetchedAt);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  const d = newest > 0 ? new Date(newest) : new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}.${build}`;
}

function countCosmetic(db: CosmeticDB): { generic: number; specific: number; procedural: number } {
  let generic = db.generic.complex.length;
  for (const list of Object.values(db.generic.byId)) generic += list.length;
  for (const list of Object.values(db.generic.byClass)) generic += list.length;
  let specific = 0;
  for (const list of Object.values(db.specific)) specific += list.length;
  for (const list of Object.values(db.styles)) specific += list.length;
  let procedural = 0;
  for (const list of Object.values(db.procedural)) procedural += list.length;
  return { generic, specific, procedural };
}

function countScriptlets(db: ScriptletDB): number {
  let n = 0;
  for (const calls of Object.values(db.byHost)) n += calls.length;
  return n;
}

interface Job {
  source: FilterListSource;
  text: string;
  classified: ClassifiedList;
  sources: SourceMeta[];
}

function writeJson(file: string, value: unknown): number {
  mkdirSync(dirname(file), { recursive: true });
  const json = JSON.stringify(value);
  writeFileSync(file, json);
  return Buffer.byteLength(json);
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : ' '.repeat(width - s.length) + s;
}

/**
 * Check the build budgets from docs/RULESETS.md §3.
 * Returns one message per violated budget; an empty array means the build passes.
 */
export function checkBudgets(entries: readonly RulesetListEntry[], scriptletBytes: number): string[] {
  const failures: string[] = [];
  const staticRulesDefaultEnabled = entries.reduce((n, e) => n + (e.defaultEnabled ? e.counts.dnr : 0), 0);
  if (staticRulesDefaultEnabled > BUILD_BUDGET.STATIC_RULES_DEFAULT_ENABLED) {
    failures.push(
      `default-enabled lists produce ${staticRulesDefaultEnabled} rules, budget is ${BUILD_BUDGET.STATIC_RULES_DEFAULT_ENABLED}`,
    );
  }
  for (const e of entries) {
    if (e.counts.dnr > BUILD_BUDGET.STATIC_RULES_PER_LIST) {
      failures.push(
        `list "${e.id}" has ${e.counts.dnr} rules, per-list budget is ${BUILD_BUDGET.STATIC_RULES_PER_LIST}`,
      );
    }
    if (e.counts.regex > DNR_LIMITS.MAX_REGEX_RULES_PER_RULESET) {
      failures.push(
        `list "${e.id}" has ${e.counts.regex} regex rules, Chrome allows ${DNR_LIMITS.MAX_REGEX_RULES_PER_RULESET}`,
      );
    }
  }
  if (entries.length > DNR_LIMITS.MAX_STATIC_RULESETS) {
    failures.push(`${entries.length} rulesets declared, Chrome allows ${DNR_LIMITS.MAX_STATIC_RULESETS}`);
  }
  if (scriptletBytes > BUILD_BUDGET.SCRIPTLET_GROUP_BYTES) {
    failures.push(
      `scriptlet bundles total ${scriptletBytes} bytes, budget is ${BUILD_BUDGET.SCRIPTLET_GROUP_BYTES}`,
    );
  }
  return failures;
}

/** Run the compiler. Returns the process exit code. */
export function runCli(argv: readonly string[]): number {
  const parsedArgs = parseArgs(argv);
  if ('error' in parsedArgs) {
    console.error(parsedArgs.error);
    return parsedArgs.error === USAGE ? 0 : 2;
  }
  const options = parsedArgs.options;
  const cwd = process.cwd();
  const listsPath = resolve(cwd, options.lists);
  const cacheDir = resolve(cwd, options.cache);
  const outDir = resolve(cwd, options.out);

  if (!existsSync(listsPath)) {
    console.error(`iub-compile: --lists file not found: ${listsPath}`);
    return 2;
  }

  const config = JSON.parse(readFileSync(listsPath, 'utf8')) as FilterListsConfig;
  const sources: FilterListSource[] = [...config.lists];

  for (const extra of options.extra) {
    sources.push({
      id: extra.id,
      title: extra.id,
      urls: [],
      group: 'custom',
      defaultEnabled: false,
      trusted: false,
    });
  }
  if (options.e2e) {
    sources.push({
      id: 'e2e-test',
      title: 'iuBlocker e2e test list',
      urls: [],
      group: 'test',
      defaultEnabled: true,
      trusted: true,
    });
  }

  const extraPaths = new Map(options.extra.map((e) => [e.id, resolve(cwd, e.path)]));
  if (options.e2e) extraPaths.set('e2e-test', resolve(cwd, 'e2e/fixtures/test-list.txt'));

  const only = options.only === null ? null : new Set(options.only);

  // ---- pass 1: read + classify --------------------------------------------
  const jobs: Job[] = [];
  const warningsGlobal: string[] = [];
  for (const source of sources) {
    if (only !== null && !only.has(source.id)) continue;
    const explicit = extraPaths.get(source.id);
    const textPath = explicit ?? join(cacheDir, `${source.id}.txt`);
    if (!existsSync(textPath)) {
      if (explicit !== undefined) {
        console.error(`iub-compile: list file not found: ${textPath}`);
        return 2;
      }
      warningsGlobal.push(`${source.id}: no cached list at ${textPath} — skipped`);
      continue;
    }
    const text = readFileSync(textPath, 'utf8');
    const classified = classifyLines(text, { format: source.format ?? undefined });
    jobs.push({ source, text, classified, sources: readMeta(cacheDir, source, text) });
  }

  if (jobs.length === 0) {
    console.error('iub-compile: nothing to compile (no cached lists found)');
    return 2;
  }

  // `$badfilter` applies across every list in the build (docs/FILTER-SYNTAX.md §5.1).
  const badfilterLines: string[] = [];
  for (const job of jobs) {
    for (const line of job.classified.network) {
      if (line.raw.indexOf('badfilter') !== -1) badfilterLines.push(line.raw);
    }
  }
  const extraBadfilters = collectBadfilterKeys(badfilterLines);

  // ---- pass 2: compile -----------------------------------------------------
  rmSync(join(outDir, 'dnr'), { recursive: true, force: true });
  rmSync(join(outDir, 'cosmetic'), { recursive: true, force: true });
  rmSync(join(outDir, 'scriptlets'), { recursive: true, force: true });
  rmSync(join(outDir, 'scriptlet-groups'), { recursive: true, force: true });

  const { compileCosmetic, addCosmeticNetworkExceptions } = cosmeticApi();
  const { compileScriptlets } = scriptletApi();
  if (compileCosmetic === undefined)
    warningsGlobal.push('cosmetic compiler (T2) unavailable — empty cosmetic DBs');
  if (compileScriptlets === undefined)
    warningsGlobal.push('scriptlet compiler (T2) unavailable — empty scriptlet DBs');

  const entries: RulesetListEntry[] = [];
  const reportLists: RulesetReport['lists'] = {};
  const allDropped: DroppedFilter[] = [];
  const scriptletDbs: { listId: string; db: ScriptletDB }[] = [];
  const allSourceMeta: SourceMeta[] = [];

  for (const job of jobs) {
    const listId = job.source.id;
    const compileOptions: CompileOptions = { listId, trusted: job.source.trusted === true };
    const warnings: string[] = [];
    const droppedBefore = allDropped.length;

    // Rule IDs are unique *per ruleset*, not per build: every list numbers from 1
    // (docs/FILTER-SYNTAX.md §6). The logger identifies a rule by the
    // `(rulesetId, ruleId)` pair `getMatchedRules` returns.
    const network = compileNetwork(job.classified.network, {
      ...compileOptions,
      firstRuleId: ID_RANGE.STATIC.start,
      maxRuleId: ID_RANGE.STATIC.end,
      hostsFormat: job.source.format === 'hosts',
      extraBadfilters,
    });
    warnings.push(...network.warnings);
    allDropped.push(...network.dropped);

    let cosmetic: CosmeticDB = emptyCosmeticDB(listId);
    if (compileCosmetic !== undefined) {
      const result = compileCosmetic(job.classified.cosmetic, compileOptions);
      cosmetic = result.db;
      warnings.push(...result.warnings);
      allDropped.push(...result.dropped);
    }
    if (addCosmeticNetworkExceptions !== undefined) {
      addCosmeticNetworkExceptions(cosmetic, network.cosmeticExceptions);
    } else {
      cosmetic.exceptions.elemhide = network.cosmeticExceptions.elemhide;
      cosmetic.exceptions.generichide = network.cosmeticExceptions.generichide;
      cosmetic.exceptions.specifichide = network.cosmeticExceptions.specifichide;
    }

    let scriptlets: ScriptletDB = emptyScriptletDB(listId);
    if (compileScriptlets !== undefined) {
      const result = compileScriptlets(job.classified.scriptlet, compileOptions);
      scriptlets = result.db;
      warnings.push(...result.warnings);
      allDropped.push(...result.dropped);
    }
    scriptletDbs.push({ listId, db: scriptlets });

    for (const line of job.classified.html) {
      allDropped.push({
        listId,
        line: line.line,
        raw: line.raw,
        reason: 'HTML filtering is unsupported on MV3',
      });
    }

    const files = {
      dnr: `dnr/${listId}.json`,
      cosmetic: `cosmetic/${listId}.json`,
      scriptlets: `scriptlets/${listId}.json`,
    };
    writeJson(join(outDir, files.dnr), network.rules);
    writeJson(join(outDir, files.cosmetic), cosmetic);
    writeJson(join(outDir, files.scriptlets), scriptlets);

    const cosmeticCounts = countCosmetic(cosmetic);
    const droppedForList = allDropped.length - droppedBefore;
    const counts: RulesetListEntry['counts'] = {
      dnr: network.rules.length,
      regex: network.counts.regex,
      cosmeticGeneric: cosmeticCounts.generic,
      cosmeticSpecific: cosmeticCounts.specific,
      procedural: cosmeticCounts.procedural,
      scriptlets: countScriptlets(scriptlets),
      dropped: droppedForList,
    };

    const entry: RulesetListEntry = {
      id: listId,
      title: job.classified.meta.title ?? job.source.title,
      group: job.source.group,
      defaultEnabled: job.source.defaultEnabled,
      trusted: job.source.trusted === true,
      sources: job.sources,
      counts,
      files,
    };
    if (job.source.lang !== undefined) entry.lang = job.source.lang;
    const homepage = job.source.homepage ?? job.classified.meta.homepage;
    if (homepage !== undefined) entry.homepage = homepage;
    const license = job.source.license ?? job.classified.meta.license;
    if (license !== undefined) entry.license = license;
    entries.push(entry);

    reportLists[listId] = { ...counts, warnings };
    allSourceMeta.push(...job.sources);
  }

  // ---- scriptlet groups ----------------------------------------------------
  const groupApi = scriptletGroupApi();
  const groups: ScriptletGroup[] = groupApi.computeScriptletGroups?.(scriptletDbs) ?? [];
  let scriptletBytes = 0;
  for (const group of groups) {
    const source = groupApi.emitScriptletGroupBundle?.(group) ?? '';
    const file = join(outDir, 'scriptlet-groups', `${group.hash}.js`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    scriptletBytes += Buffer.byteLength(source);
  }

  // ---- manifest + report ---------------------------------------------------
  const version = rulesetVersion(allSourceMeta);
  const staticRulesTotal = entries.reduce((n, e) => n + e.counts.dnr, 0);
  const staticRulesDefaultEnabled = entries.reduce((n, e) => n + (e.defaultEnabled ? e.counts.dnr : 0), 0);
  const regexTotal = entries.reduce((n, e) => n + e.counts.regex, 0);

  const manifest: RulesetManifest = {
    version,
    builtAt: new Date().toISOString(),
    lists: entries,
    budget: { staticRulesTotal, staticRulesDefaultEnabled, regexTotal },
    scriptletGroups: groups.map(({ calls: _calls, ...rest }) => rest),
  };
  writeJson(join(outDir, 'manifest.json'), manifest);

  const report: RulesetReport = { version, lists: reportLists, dropped: allDropped };
  writeJson(join(outDir, 'report.json'), report);

  // ---- summary -------------------------------------------------------------
  const idWidth = Math.max(4, ...entries.map((e) => e.id.length));
  console.info('');
  console.info(
    `${pad('list', idWidth)}  ${padLeft('dnr', 8)} ${padLeft('regex', 6)} ${padLeft('generic', 8)} ` +
      `${padLeft('specific', 9)} ${padLeft('proc', 6)} ${padLeft('js', 6)} ${padLeft('dropped', 8)}`,
  );
  console.info('-'.repeat(idWidth + 58));
  for (const e of entries) {
    console.info(
      `${pad(e.id, idWidth)}  ${padLeft(String(e.counts.dnr), 8)} ${padLeft(String(e.counts.regex), 6)} ` +
        `${padLeft(String(e.counts.cosmeticGeneric), 8)} ${padLeft(String(e.counts.cosmeticSpecific), 9)} ` +
        `${padLeft(String(e.counts.procedural), 6)} ${padLeft(String(e.counts.scriptlets), 6)} ` +
        `${padLeft(String(e.counts.dropped), 8)}`,
    );
  }
  console.info('-'.repeat(idWidth + 58));
  console.info(
    `${pad('total', idWidth)}  ${padLeft(String(staticRulesTotal), 8)} ${padLeft(String(regexTotal), 6)}`,
  );
  console.info('');
  console.info(
    `version ${version} · ${entries.length} lists · default-enabled rules ${staticRulesDefaultEnabled}`,
  );
  for (const w of warningsGlobal) console.warn(`warning: ${w}`);

  // ---- budgets (docs/RULESETS.md §3) --------------------------------------
  const failures = checkBudgets(entries, scriptletBytes);

  if (failures.length > 0) {
    console.error('');
    console.error('iub-compile: build budget exceeded');
    for (const f of failures) console.error(`  - ${f}`);
    return 1;
  }
  return 0;
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  process.exit(runCli(process.argv.slice(2)));
}
