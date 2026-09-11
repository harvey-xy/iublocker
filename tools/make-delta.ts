/**
 * make-delta — build a differential list update (docs/RULESETS.md §6) by diffing two
 * compiler outputs (`rulesets/` directories).
 *
 *   pnpm delta -- <oldRulesetsDir> <newRulesetsDir> --out delta/1.2.3.json [--extension-version 1.2.3]
 *
 * `old` is the ruleset bundle shipped inside a released extension, `new` is a fresh
 * nightly build. The result is a DeltaFile the extension's Updater can apply:
 *   dnr.add      rules in new but not old (structural equality ignoring `id`),
 *                ranked and capped at BUILD_BUDGET.DELTA_DYNAMIC_RULES, ids from ID_RANGE.DELTA
 *   dnr.disable  per static ruleset, ids of old rules no longer in new (≤ 5,000 per ruleset)
 *   cosmetic/scriptlets  add + remove sets keyed by hostname, merged across all lists
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boolFlag, parseArgs, stringFlag } from './lib/args';
import { BUILD_BUDGET, DNR_LIMITS, ID_RANGE } from '../packages/shared/src/dnr';
import { emptyCosmeticDB } from '../packages/shared/src/cosmetic';
import { emptyScriptletDB } from '../packages/shared/src/scriptlets';
import type { DNRRule } from '../packages/shared/src/dnr';
import type { CosmeticDB, ProceduralFilter } from '../packages/shared/src/cosmetic';
import type { ScriptletCall, ScriptletDB } from '../packages/shared/src/scriptlets';
import type { DeltaFile, RulesetManifest } from '../packages/shared/src/rulesets';
import type { FilterListsConfig } from '../packages/shared/src/filterlists';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DELTA_LIST_ID = 'delta';
const MAX_DISABLE_PER_RULESET = DNR_LIMITS.MAX_DISABLED_STATIC_RULES_PER_RULESET;
const MAX_ADD = Math.min(BUILD_BUDGET.DELTA_DYNAMIC_RULES, ID_RANGE.DELTA.end - ID_RANGE.DELTA.start + 1);

/* ------------------------------------------------------------------- bundles */

export interface RulesetBundle {
  /** RulesetManifest.version */
  version: string;
  /** List ids in manifest order. */
  listIds: string[];
  dnr: Record<string, DNRRule[]>;
  cosmetic: Record<string, CosmeticDB>;
  scriptlets: Record<string, ScriptletDB>;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Load `manifest.json` + `dnr/*.json` + `cosmetic/*.json` + `scriptlets/*.json` from a rulesets dir. */
export async function loadBundle(dir: string): Promise<RulesetBundle> {
  const manifest = await readJson<RulesetManifest>(path.join(dir, 'manifest.json'));
  if (!manifest) throw new Error(`no readable manifest.json in ${dir}`);

  const bundle: RulesetBundle = {
    version: manifest.version,
    listIds: [],
    dnr: {},
    cosmetic: {},
    scriptlets: {},
  };
  for (const entry of manifest.lists ?? []) {
    bundle.listIds.push(entry.id);
    const files = entry.files ?? {
      dnr: `dnr/${entry.id}.json`,
      cosmetic: `cosmetic/${entry.id}.json`,
      scriptlets: `scriptlets/${entry.id}.json`,
    };
    bundle.dnr[entry.id] = (await readJson<DNRRule[]>(path.join(dir, files.dnr))) ?? [];
    bundle.cosmetic[entry.id] =
      (await readJson<CosmeticDB>(path.join(dir, files.cosmetic))) ?? emptyCosmeticDB(entry.id);
    bundle.scriptlets[entry.id] =
      (await readJson<ScriptletDB>(path.join(dir, files.scriptlets))) ?? emptyScriptletDB(entry.id);
  }
  return bundle;
}

/* --------------------------------------------------------- structural equality */

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(canonicalValue);
    // Domain / resource-type / param lists are unordered sets in DNR.
    if (items.every((item) => typeof item === 'string')) return [...(items as string[])].sort();
    return items;
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v === undefined) continue;
      out[key] = canonicalValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Canonical form of a DNR rule ignoring its `id`: sorted object keys, sorted string
 * arrays, and the implicit `priority: 1` made explicit. Two rules with the same key
 * behave identically in Chrome.
 */
export function ruleKey(rule: DNRRule): string {
  const { id: _id, priority, ...rest } = rule;
  return JSON.stringify(canonicalValue({ ...rest, priority: priority ?? 1 }));
}

function isHighRank(rule: DNRRule): boolean {
  const type = rule.action?.type;
  if (type === 'allow' || type === 'allowAllRequests') return true;
  return (rule.priority ?? 1) >= 3;
}

/* ------------------------------------------------------------------- dnr diff */

export interface DnrDelta {
  add: DNRRule[];
  disable: Record<string, number[]>;
  stats: {
    candidates: number;
    added: number;
    droppedOverBudget: number;
    disabled: number;
    disabledRulesets: number;
    missingInNew: string[];
  };
}

export function computeDnrDelta(
  oldBundle: RulesetBundle,
  newBundle: RulesetBundle,
  listOrder: readonly string[],
): DnrDelta {
  const rank = (listId: string): number => {
    const index = listOrder.indexOf(listId);
    return index === -1 ? listOrder.length : index;
  };

  interface Candidate {
    rule: DNRRule;
    key: string;
    high: boolean;
    listRank: number;
    ruleIndex: number;
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const listId of newBundle.listIds) {
    const oldRules = oldBundle.dnr[listId] ?? [];
    const oldKeys = new Set(oldRules.map(ruleKey));
    const newRules = newBundle.dnr[listId] ?? [];
    newRules.forEach((rule, ruleIndex) => {
      const key = ruleKey(rule);
      if (oldKeys.has(key) || seen.has(key)) return;
      seen.add(key);
      candidates.push({ rule, key, high: isHighRank(rule), listRank: rank(listId), ruleIndex });
    });
  }

  candidates.sort((a, b) => {
    if (a.high !== b.high) return a.high ? -1 : 1;
    if (a.listRank !== b.listRank) return a.listRank - b.listRank;
    return a.ruleIndex - b.ruleIndex;
  });

  const kept = candidates.slice(0, MAX_ADD);
  const add = kept.map((candidate, index) => ({ ...candidate.rule, id: ID_RANGE.DELTA.start + index }));

  const disable: Record<string, number[]> = {};
  const missingInNew: string[] = [];
  let disabled = 0;
  for (const listId of oldBundle.listIds) {
    const newRules = newBundle.dnr[listId];
    if (newRules === undefined) {
      // The list is gone from the build; the worker disables the whole ruleset instead.
      missingInNew.push(listId);
      continue;
    }
    const newKeys = new Set(newRules.map(ruleKey));
    const ids = (oldBundle.dnr[listId] ?? [])
      .filter((rule) => !newKeys.has(ruleKey(rule)))
      .map((rule) => rule.id)
      .sort((a, b) => a - b)
      .slice(0, MAX_DISABLE_PER_RULESET);
    if (ids.length > 0) {
      disable[listId] = ids;
      disabled += ids.length;
    }
  }

  return {
    add,
    disable,
    stats: {
      candidates: candidates.length,
      added: add.length,
      droppedOverBudget: candidates.length - add.length,
      disabled,
      disabledRulesets: Object.keys(disable).length,
      missingInNew,
    },
  };
}

/* ------------------------------------------------------------- cosmetic diff */

function unionInto(target: Record<string, string[]>, source: Record<string, string[]> | undefined): void {
  for (const [key, values] of Object.entries(source ?? {})) {
    const bucket = (target[key] ??= []);
    for (const value of values) if (!bucket.includes(value)) bucket.push(value);
  }
}

function unionArray(target: string[], source: string[] | undefined): void {
  for (const value of source ?? []) if (!target.includes(value)) target.push(value);
}

/** Merge every list's CosmeticDB into one, as the delta is applied as a single extra DB. */
export function mergeCosmeticDBs(dbs: readonly CosmeticDB[], listId = DELTA_LIST_ID): CosmeticDB {
  const out = emptyCosmeticDB(listId);
  for (const db of dbs) {
    if (!db) continue;
    unionInto(out.generic.byId, db.generic?.byId);
    unionInto(out.generic.byClass, db.generic?.byClass);
    unionArray(out.generic.complex, db.generic?.complex);
    unionInto(out.specific, db.specific);
    for (const [host, pairs] of Object.entries(db.styles ?? {})) {
      const bucket = (out.styles[host] ??= []);
      for (const pair of pairs)
        if (!bucket.some((p) => p[0] === pair[0] && p[1] === pair[1])) bucket.push(pair);
    }
    for (const [host, filters] of Object.entries(db.procedural ?? {})) {
      const bucket = (out.procedural[host] ??= []);
      for (const filter of filters) if (!bucket.some((f) => f.raw === filter.raw)) bucket.push(filter);
    }
    unionInto(out.exceptions.selectors, db.exceptions?.selectors);
    unionArray(out.exceptions.elemhide, db.exceptions?.elemhide);
    unionArray(out.exceptions.generichide, db.exceptions?.generichide);
    unionArray(out.exceptions.specifichide, db.exceptions?.specifichide);
  }
  return out;
}

function diffMap(next: Record<string, string[]>, prev: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(next)) {
    const before = new Set(prev[key] ?? []);
    const added = values.filter((v) => !before.has(v));
    if (added.length > 0) out[key] = added;
  }
  return out;
}

function diffArray(next: string[], prev: string[]): string[] {
  const before = new Set(prev);
  return next.filter((v) => !before.has(v));
}

export interface CosmeticDelta {
  add: CosmeticDB;
  removeSpecific: Record<string, string[]>;
  stats: { addedSelectors: number; addedProcedural: number; removedSelectors: number; hosts: number };
}

export function computeCosmeticDelta(oldDb: CosmeticDB, newDb: CosmeticDB): CosmeticDelta {
  const add = emptyCosmeticDB(DELTA_LIST_ID);
  add.generic.byId = diffMap(newDb.generic.byId, oldDb.generic.byId);
  add.generic.byClass = diffMap(newDb.generic.byClass, oldDb.generic.byClass);
  add.generic.complex = diffArray(newDb.generic.complex, oldDb.generic.complex);
  add.specific = diffMap(newDb.specific, oldDb.specific);

  for (const [host, pairs] of Object.entries(newDb.styles)) {
    const before = new Set((oldDb.styles[host] ?? []).map((p) => JSON.stringify(p)));
    const added = pairs.filter((p) => !before.has(JSON.stringify(p)));
    if (added.length > 0) add.styles[host] = added;
  }

  let addedProcedural = 0;
  for (const [host, filters] of Object.entries(newDb.procedural)) {
    const before = new Set((oldDb.procedural[host] ?? []).map((f: ProceduralFilter) => f.raw));
    const added = filters.filter((f) => !before.has(f.raw));
    if (added.length > 0) {
      add.procedural[host] = added;
      addedProcedural += added.length;
    }
  }

  add.exceptions.selectors = diffMap(newDb.exceptions.selectors, oldDb.exceptions.selectors);
  add.exceptions.elemhide = diffArray(newDb.exceptions.elemhide, oldDb.exceptions.elemhide);
  add.exceptions.generichide = diffArray(newDb.exceptions.generichide, oldDb.exceptions.generichide);
  add.exceptions.specifichide = diffArray(newDb.exceptions.specifichide, oldDb.exceptions.specifichide);

  const removeSpecific = diffMap(oldDb.specific, newDb.specific);

  const addedSelectors = Object.values(add.specific).reduce((n, v) => n + v.length, 0);
  const removedSelectors = Object.values(removeSpecific).reduce((n, v) => n + v.length, 0);
  return {
    add,
    removeSpecific,
    stats: {
      addedSelectors,
      addedProcedural,
      removedSelectors,
      hosts: new Set([...Object.keys(add.specific), ...Object.keys(removeSpecific)]).size,
    },
  };
}

/* ------------------------------------------------------------ scriptlet diff */

const callKey = (call: ScriptletCall): string => JSON.stringify([call.name, call.args ?? []]);

export function mergeScriptletDBs(dbs: readonly ScriptletDB[], listId = DELTA_LIST_ID): ScriptletDB {
  const out = emptyScriptletDB(listId);
  for (const db of dbs) {
    if (!db) continue;
    for (const [host, calls] of Object.entries(db.byHost ?? {})) {
      const bucket = (out.byHost[host] ??= []);
      const seen = new Set(bucket.map(callKey));
      for (const call of calls) {
        if (seen.has(callKey(call))) continue;
        seen.add(callKey(call));
        bucket.push(call);
      }
    }
    unionInto(out.exceptions, db.exceptions);
  }
  return out;
}

export interface ScriptletDelta {
  add: ScriptletDB;
  remove: Record<string, ScriptletCall[]>;
  stats: { added: number; removed: number };
}

function diffCalls(
  next: Record<string, ScriptletCall[]>,
  prev: Record<string, ScriptletCall[]>,
): Record<string, ScriptletCall[]> {
  const out: Record<string, ScriptletCall[]> = {};
  for (const [host, calls] of Object.entries(next)) {
    const before = new Set((prev[host] ?? []).map(callKey));
    const added = calls.filter((call) => !before.has(callKey(call)));
    if (added.length > 0) out[host] = added;
  }
  return out;
}

export function computeScriptletDelta(oldDb: ScriptletDB, newDb: ScriptletDB): ScriptletDelta {
  const add = emptyScriptletDB(DELTA_LIST_ID);
  add.byHost = diffCalls(newDb.byHost, oldDb.byHost);
  add.exceptions = diffMap(newDb.exceptions, oldDb.exceptions);
  const remove = diffCalls(oldDb.byHost, newDb.byHost);
  return {
    add,
    remove,
    stats: {
      added: Object.values(add.byHost).reduce((n, v) => n + v.length, 0),
      removed: Object.values(remove).reduce((n, v) => n + v.length, 0),
    },
  };
}

/* ------------------------------------------------------------------- delta */

export interface DeltaResult {
  delta: DeltaFile;
  summary: {
    base: string;
    version: string;
    extensionVersion?: string;
    dnr: DnrDelta['stats'];
    cosmetic: CosmeticDelta['stats'];
    scriptlets: ScriptletDelta['stats'];
  };
}

export function computeDelta(
  oldBundle: RulesetBundle,
  newBundle: RulesetBundle,
  options: { listOrder?: readonly string[]; builtAt?: string; extensionVersion?: string } = {},
): DeltaResult {
  const listOrder = options.listOrder ?? newBundle.listIds;
  const dnr = computeDnrDelta(oldBundle, newBundle, listOrder);
  const cosmetic = computeCosmeticDelta(
    mergeCosmeticDBs(
      oldBundle.listIds.map((id) => oldBundle.cosmetic[id]).filter((db): db is CosmeticDB => !!db),
    ),
    mergeCosmeticDBs(
      newBundle.listIds.map((id) => newBundle.cosmetic[id]).filter((db): db is CosmeticDB => !!db),
    ),
  );
  const scriptlets = computeScriptletDelta(
    mergeScriptletDBs(
      oldBundle.listIds.map((id) => oldBundle.scriptlets[id]).filter((db): db is ScriptletDB => !!db),
    ),
    mergeScriptletDBs(
      newBundle.listIds.map((id) => newBundle.scriptlets[id]).filter((db): db is ScriptletDB => !!db),
    ),
  );

  const delta: DeltaFile = {
    base: oldBundle.version,
    version: newBundle.version,
    builtAt: options.builtAt ?? new Date().toISOString(),
    dnr: { add: dnr.add, disable: dnr.disable },
    cosmetic: { add: cosmetic.add, removeSpecific: cosmetic.removeSpecific },
    scriptlets: { add: scriptlets.add, remove: scriptlets.remove },
  };

  const summary: DeltaResult['summary'] = {
    base: delta.base,
    version: delta.version,
    dnr: dnr.stats,
    cosmetic: cosmetic.stats,
    scriptlets: scriptlets.stats,
  };
  if (options.extensionVersion) summary.extensionVersion = options.extensionVersion;
  return { delta, summary };
}

export function formatSummary(summary: DeltaResult['summary']): string {
  const lines = [
    `make-delta: base ${summary.base} → ${summary.version}${summary.extensionVersion ? ` (extension ${summary.extensionVersion})` : ''}`,
    `  dnr.add        ${summary.dnr.added} of ${summary.dnr.candidates} candidate(s)` +
      (summary.dnr.droppedOverBudget > 0
        ? ` (${summary.dnr.droppedOverBudget} dropped over the ${MAX_ADD} budget)`
        : ''),
    `  dnr.disable    ${summary.dnr.disabled} rule id(s) across ${summary.dnr.disabledRulesets} ruleset(s)`,
    `  cosmetic       +${summary.cosmetic.addedSelectors} selector(s), +${summary.cosmetic.addedProcedural} procedural, -${summary.cosmetic.removedSelectors} selector(s) on ${summary.cosmetic.hosts} host(s)`,
    `  scriptlets     +${summary.scriptlets.added}, -${summary.scriptlets.removed}`,
  ];
  if (summary.dnr.missingInNew.length > 0) {
    lines.push(
      `  note           ${summary.dnr.missingInNew.length} ruleset(s) in the old build are gone from the new one: ${summary.dnr.missingInNew.join(', ')}`,
    );
  }
  return lines.join('\n');
}

/* --------------------------------------------------------------------- main */

const USAGE = `Usage: tsx tools/make-delta.ts <oldRulesetsDir> <newRulesetsDir> --out <file> [options]

  --out <file>                output DeltaFile JSON (required; a directory or trailing
                              slash writes <dir>/<extension-version>.json)
  --extension-version <x>     extension version this delta targets (used for naming/summary)
  --lists <file>              filter list config for the ranking order (default tools/filterlists.json)
  --summary                   print a per-section summary
  --help
`;

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, { boolean: ['summary', 'help'] });
  if (boolFlag(args, 'help')) {
    console.log(USAGE);
    return 0;
  }
  const [oldDir, newDir] = args.positionals;
  const out = stringFlag(args, 'out');
  if (!oldDir || !newDir || !out) {
    console.error(USAGE);
    return 1;
  }
  const extensionVersion = stringFlag(args, 'extension-version');

  let listOrder: string[] | undefined;
  const listsFile = path.resolve(REPO_ROOT, stringFlag(args, 'lists') ?? 'tools/filterlists.json');
  const config = await readJson<FilterListsConfig>(listsFile);
  if (config?.lists) listOrder = config.lists.map((l) => l.id);
  else console.warn(`make-delta: no list config at ${listsFile}, ranking by manifest order`);

  const oldBundle = await loadBundle(path.resolve(oldDir));
  const newBundle = await loadBundle(path.resolve(newDir));
  const options: { listOrder?: readonly string[]; extensionVersion?: string } = {};
  if (listOrder) options.listOrder = listOrder;
  if (extensionVersion) options.extensionVersion = extensionVersion;
  const { delta, summary } = computeDelta(oldBundle, newBundle, options);

  const outPath =
    out.endsWith('/') || out.endsWith(path.sep) || path.extname(out) === ''
      ? path.join(path.resolve(out), `${extensionVersion ?? delta.version}.json`)
      : path.resolve(out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(delta, null, 2)}\n`, 'utf8');

  if (boolFlag(args, 'summary')) console.info(formatSummary(summary));
  console.info(
    `make-delta: wrote ${path.relative(process.cwd(), outPath)} (${delta.dnr.add.length} add, ${Object.keys(delta.dnr.disable).length} ruleset(s) with disables)`,
  );
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`make-delta: ${err instanceof Error ? err.stack : String(err)}`);
      process.exitCode = 1;
    },
  );
}
