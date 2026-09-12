/**
 * Per-name group computation and MAIN-world bundle emission (docs/SCRIPTLETS.md §3).
 *
 * One group per scriptlet **name**, not per distinct call list. `chrome.scripting`'s
 * registered-script table gets slower the more entries it holds — thousands of registrations
 * take minutes to install — so a build must register a few dozen scripts, not a few thousand.
 *
 * Two kinds of file are emitted:
 *
 * - `scriptlet-lib/<name>.js` — one per scriptlet *name* actually used anywhere, defining
 *   `self.__iub_lib["<name>"] = <fn>`. Function bodies are large (several kB each) and must
 *   never be duplicated.
 * - `scriptlet-groups/<name>.js` — one per scriptlet *name*: a hostname → arguments table
 *   plus the generic (`##+js(...)`) arguments and the hostnames an `#@#+js(...)` exception
 *   cancels the scriptlet on. It holds no function body at all.
 *
 * A group is registered as `js: [...group.libs, group.file]` with `matches` built from
 * `group.hosts`; at `document_start` the group file walks `location.hostname`'s suffixes and
 * runs the scriptlet once per distinct argument vector it finds.
 */
import type { ScriptletCall, ScriptletDB, ScriptletGroup } from '@iublocker/shared';
import { hostnameWalk } from '@iublocker/shared';
import { registry, serializeScriptletFn } from '@iublocker/scriptlets';
import { isEntity } from '../psl';
import { getEntry, setEntry } from '../record';
import { ALL_SCRIPTLETS, SCRIPTLET_GENERIC_HOST_KEY, lookupScriptletsDetailed } from './compile';
import { shortHash } from './hash';
import { stripJsSuffix } from './parse';

export const SCRIPTLET_GROUP_DIR = 'scriptlet-groups';
export const SCRIPTLET_LIB_DIR = 'scriptlet-lib';

/**
 * Scriptlet names come from the registry (validated at compile time) and are plain
 * `[a-z0-9._-]` identifiers, but path separators are still rejected so a hostile registry
 * entry can never escape the directory.
 */
function fileSafeName(name: string): string {
  if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`scriptlets: unusable scriptlet name "${name}"`);
  }
  return name;
}

/** Group file for one scriptlet name. */
export function scriptletGroupFile(name: string): string {
  return `${SCRIPTLET_GROUP_DIR}/${fileSafeName(name)}.js`;
}

/** Library file for one scriptlet name. */
export function scriptletLibFile(name: string): string {
  return `${SCRIPTLET_LIB_DIR}/${fileSafeName(name)}.js`;
}

/**
 * A group plus the tables `emitScriptletGroupBundle` writes into its file. Only the
 * {@link ScriptletGroup} half reaches `manifest.json`; the runtime reads the rest from the
 * emitted JS.
 */
export interface ScriptletGroupBuild extends ScriptletGroup {
  /** Distinct argument vectors, addressed by index from `hostArgs` and `genericArgs`. */
  argsList: string[][];
  /**
   * Hostname → indices into `argsList`. A host only lists what it *adds* to what its parent
   * domains (and `genericArgs`) already contribute, because the runtime unions every
   * matching suffix.
   */
  hostArgs: Record<string, number[]>;
  /** Indices that run on every page (`##+js(...)` with no domain list). */
  genericArgs: number[];
  /** Hostnames where `#@#+js(<name>)` or `#@#+js()` cancels this scriptlet, subdomains included. */
  exclude: string[];
}

/** Order-independent JSON identity of a call list. */
export function canonicalCalls(calls: ScriptletCall[]): string {
  const sorted = calls
    .map((c) => ({ name: c.name, args: [...c.args] }))
    .sort((a, b) => {
      if (a.name !== b.name) return a.name < b.name ? -1 : 1;
      const ja = JSON.stringify(a.args);
      const jb = JSON.stringify(b.args);
      return ja === jb ? 0 : ja < jb ? -1 : 1;
    });
  return JSON.stringify(sorted);
}

/** Shallowest first, then alphabetical: a parent domain is always processed before a child. */
function byDepthThenName(a: string, b: string): number {
  const da = a.split('.').length;
  const db = b.split('.').length;
  if (da !== db) return da - db;
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Draft {
  name: string;
  argsList: string[][];
  argIndex: Map<string, number>;
  hostArgs: Map<string, number[]>;
  genericArgs: number[];
  listIds: string[];
  /** Hostname → bit set of the DBs that name this scriptlet under that exact key. */
  exactMask: Map<string, number>;
  /** Bit set of the DBs with a generic (`##+js(...)`) call of this scriptlet. */
  genericMask: number;
}

function internArgs(draft: Draft, args: readonly string[]): number {
  const key = JSON.stringify(args);
  const known = draft.argIndex.get(key);
  if (known !== undefined) return known;
  const index = draft.argsList.length;
  draft.argsList.push([...args]);
  draft.argIndex.set(key, index);
  return index;
}

/**
 * Group every scriptlet call that a concrete hostname can reach, by scriptlet **name**.
 *
 * For each name, `hostArgs` records which hostnames call it with which arguments — the
 * effective call list after `#@#+js(...)` exceptions, taken from `lookupScriptletsDetailed`
 * so that parent-domain and generic calls are already folded in. A hostname that adds
 * nothing to what its parent domain already contributes is left out entirely: the parent's
 * `*://*.parent/*` match pattern covers it and the runtime suffix walk finds the parent's
 * row.
 *
 * Entity keys (`example.*`) have no literal match pattern, so they are skipped here and
 * served by the worker's dynamic path (`ScriptletIndex.lookupDynamic`).
 *
 * Groups are returned sorted by name so the build is reproducible.
 */
export function computeScriptletGroups(
  dbs: { listId: string; db: ScriptletDB }[],
  resolve: ScriptletSourceResolver = defaultSourceResolver,
): ScriptletGroupBuild[] {
  const all = dbs.map((d) => d.db);

  const hostKeys = new Set<string>();
  for (const { db } of dbs) {
    for (const host of Object.keys(db.byHost)) {
      if (!isEntity(host)) hostKeys.add(host);
    }
  }
  const hasGeneric = hostKeys.delete(SCRIPTLET_GENERIC_HOST_KEY);
  // The generic bucket first, then parents before children: both are prerequisites for the
  // "only record what this host adds" pruning below.
  const hosts = [...hostKeys].sort(byDepthThenName);
  if (hasGeneric) hosts.unshift(SCRIPTLET_GENERIC_HOST_KEY);

  // One bit per DB, so a host can say which lists put it in the table. 32-bit maths keeps
  // this cheap; a build with more lists than that simply ships no per-host attribution.
  const useMasks = dbs.length <= 31;
  const canonical = memoise(resolve);

  const drafts = new Map<string, Draft>();
  for (const host of hosts) {
    const calls = lookupScriptletsDetailed(all, host).concrete;
    if (calls.length === 0) continue;
    const generic = host === SCRIPTLET_GENERIC_HOST_KEY;
    const keys = generic ? [SCRIPTLET_GENERIC_HOST_KEY] : [...hostnameWalk(host), SCRIPTLET_GENERIC_HOST_KEY];
    for (const call of calls) {
      const def = canonical(call.name);
      // A name with no bundled body has no lib to call — the runtime could never run it.
      if (def === undefined) continue;
      let draft = drafts.get(def.name);
      if (draft === undefined) {
        draft = {
          name: def.name,
          argsList: [],
          argIndex: new Map(),
          hostArgs: new Map(),
          genericArgs: [],
          listIds: [],
          exactMask: new Map(),
          genericMask: 0,
        };
        drafts.set(def.name, draft);
      }
      const index = internArgs(draft, call.args);
      if (generic) {
        if (!draft.genericArgs.includes(index)) draft.genericArgs.push(index);
        if (useMasks && draft.genericMask === 0) {
          draft.genericMask = maskAt(dbs, SCRIPTLET_GENERIC_HOST_KEY, draft.name, canonical);
        }
      } else {
        const row = draft.hostArgs.get(host);
        if (row === undefined) draft.hostArgs.set(host, [index]);
        else if (!row.includes(index)) row.push(index);
        if (useMasks && !draft.exactMask.has(host)) {
          draft.exactMask.set(host, maskAt(dbs, host, draft.name, canonical));
        }
      }
      noteLists(draft, dbs, keys);
    }
  }

  const excludes = collectExclusions(dbs, resolve);
  const listOrder = new Map(dbs.map(({ listId }, index) => [listId, index]));
  const groups: ScriptletGroupBuild[] = [];
  for (const draft of [...drafts.values()].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    draft.listIds.sort((a, b) => (listOrder.get(a) ?? 0) - (listOrder.get(b) ?? 0));
    const group = finishDraft(draft, excludes, useMasks ? dbs.map((d) => d.listId) : null);
    if (group !== null) groups.push(group);
  }
  return groups;
}

/** Cache the resolver: it is asked about the same handful of names tens of thousands of times. */
function memoise(resolve: ScriptletSourceResolver): ScriptletSourceResolver {
  const cache = new Map<string, ScriptletSource | undefined>();
  return (name: string) => {
    if (cache.has(name)) return cache.get(name);
    const def = resolve(name);
    cache.set(name, def);
    return def;
  };
}

/** Bit set of the DBs that call `name` under the exact key `host`. */
function maskAt(
  dbs: { listId: string; db: ScriptletDB }[],
  host: string,
  name: string,
  canonical: ScriptletSourceResolver,
): number {
  let mask = 0;
  for (let i = 0; i < dbs.length; i++) {
    const calls = getEntry((dbs[i] as { db: ScriptletDB }).db.byHost, host);
    if (calls === undefined) continue;
    if (calls.some((call) => canonical(call.name)?.name === name)) mask |= 1 << i;
  }
  return mask;
}

/** Record every list that contributes a call of `draft.name` under one of `keys`. */
function noteLists(draft: Draft, dbs: { listId: string; db: ScriptletDB }[], keys: readonly string[]): void {
  if (draft.listIds.length === dbs.length) return;
  for (const { listId, db } of dbs) {
    if (draft.listIds.includes(listId)) continue;
    for (const key of keys) {
      const calls = getEntry(db.byHost, key);
      if (calls !== undefined && calls.some((call) => call.name === draft.name)) {
        draft.listIds.push(listId);
        break;
      }
    }
  }
}

/** Canonical scriptlet name → hostnames whose `#@#+js(...)` cancels it. */
interface Exclusions {
  byName: Map<string, Set<string>>;
  all: Set<string>;
}

function collectExclusions(
  dbs: { listId: string; db: ScriptletDB }[],
  resolve: ScriptletSourceResolver,
): Exclusions {
  const byName = new Map<string, Set<string>>();
  const all = new Set<string>();
  for (const { db } of dbs) {
    for (const key of Object.keys(db.exceptions)) {
      // Entity keys have no literal match pattern (the group never registers on them alone)
      // and the generic key is already applied when the DBs are compiled.
      if (key === SCRIPTLET_GENERIC_HOST_KEY || isEntity(key)) continue;
      for (const raw of getEntry(db.exceptions, key) ?? []) {
        if (raw === ALL_SCRIPTLETS) {
          all.add(key);
          continue;
        }
        const name = resolve(raw)?.name ?? raw;
        let set = byName.get(name);
        if (set === undefined) {
          set = new Set<string>();
          byName.set(name, set);
        }
        set.add(key);
      }
    }
  }
  return { byName, all };
}

/** Prune inherited rows, compact the argument table and build the shipped group record. */
function finishDraft(
  draft: Draft,
  excludes: Exclusions,
  dbListIds: string[] | null,
): ScriptletGroupBuild | null {
  const genericArgs = [...draft.genericArgs].sort((a, b) => a - b);
  const inheritedRoot = new Set(genericArgs);

  // Hosts were inserted parents-first, so a row's ancestors are already settled here.
  const deltas = new Map<string, number[]>();
  const keptMask = new Map<string, number>();
  for (const [host, indices] of draft.hostArgs) {
    const walk = hostnameWalk(host);
    const inherited = new Set(inheritedRoot);
    let ancestorMask = 0;
    for (const ancestor of walk.slice(1)) {
      for (const index of deltas.get(ancestor) ?? []) inherited.add(index);
      ancestorMask |= keptMask.get(ancestor) ?? 0;
    }
    const delta = indices.filter((index) => !inherited.has(index)).sort((a, b) => a - b);
    // What this host and its parents together owe to which lists. A host that adds no
    // arguments still earns a match pattern when a list of its own is the only reason the
    // scriptlet reaches it — otherwise disabling that list would be the parent's job.
    let mask = draft.genericMask;
    for (const key of walk) mask |= draft.exactMask.get(key) ?? 0;
    if (delta.length === 0 && (mask & ~ancestorMask) === 0) continue;
    if (delta.length > 0) deltas.set(host, delta);
    keptMask.set(host, mask);
  }

  const generic = genericArgs.length > 0;
  if (!generic && keptMask.size === 0) return null;

  // Only the pruned rows are shipped, so renumber the argument table around them.
  const used = new Set<number>(genericArgs);
  for (const row of deltas.values()) for (const index of row) used.add(index);
  const remap = new Map<number, number>();
  const argsList: string[][] = [];
  for (const index of [...used].sort((a, b) => a - b)) {
    remap.set(index, argsList.length);
    argsList.push(draft.argsList[index] as string[]);
  }
  const renumber = (row: readonly number[]): number[] => row.map((index) => remap.get(index) as number);

  const hostArgs: Record<string, number[]> = {};
  for (const host of [...deltas.keys()].sort())
    setEntry(hostArgs, host, renumber(deltas.get(host) as number[]));

  // A generic call runs everywhere, so the concrete hosts need no match pattern of their own
  // (their rows stay in the table) and the one `"*"` entry answers for every list.
  let hosts: string[];
  let hostLists: number[] | undefined;
  if (generic) {
    hosts = [SCRIPTLET_GENERIC_HOST_KEY];
    let mask = draft.genericMask;
    for (const value of keptMask.values()) mask |= value;
    hostLists = dbListIds === null ? undefined : [mask];
  } else {
    hosts = [...keptMask.keys()].sort();
    hostLists = dbListIds === null ? undefined : hosts.map((host) => keptMask.get(host) as number);
  }
  // Bits are indexed by DB; the manifest only carries `listIds`, so renumber them.
  if (hostLists !== undefined && dbListIds !== null) {
    const bitOf = new Map<number, number>();
    dbListIds.forEach((listId, index) => {
      const position = draft.listIds.indexOf(listId);
      if (position !== -1) bitOf.set(index, position);
    });
    hostLists = hostLists.map((mask) => {
      let out = 0;
      for (const [from, to] of bitOf) if ((mask & (1 << from)) !== 0) out |= 1 << to;
      return out;
    });
  }

  // An exception only matters where this group actually registers.
  const covered = new Set(hosts);
  const reachable = (key: string): boolean =>
    generic || hostnameWalk(key).some((suffix) => covered.has(suffix));
  const exclude = [
    ...new Set([...(excludes.byName.get(draft.name) ?? []), ...excludes.all].filter(reachable)),
  ].sort();

  const body = {
    name: draft.name,
    argsList,
    hostArgs,
    genericArgs: renumber(genericArgs),
    exclude,
  };
  return {
    ...body,
    hash: shortHash(JSON.stringify(body)),
    file: scriptletGroupFile(draft.name),
    libs: [scriptletLibFile(draft.name)],
    hosts,
    listIds: draft.listIds,
    ...(hostLists === undefined ? {} : { hostLists }),
    calls: argsList.map((args) => ({ name: draft.name, args })),
  };
}

/**
 * Lib files a call list needs, in first-use order. Names are canonicalised through the
 * resolver (so an alias and its canonical name share one lib) and calls whose scriptlet
 * does not resolve contribute nothing — the group file skips them too.
 */
export function libsFor(
  calls: readonly ScriptletCall[],
  resolve: ScriptletSourceResolver = defaultSourceResolver,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const call of calls) {
    const def = resolve(call.name);
    if (def === undefined || seen.has(def.name)) continue;
    seen.add(def.name);
    out.push(scriptletLibFile(def.name));
  }
  return out;
}

/** Every lib file the given groups need, deduped and sorted. */
export function collectScriptletLibs(groups: readonly ScriptletGroup[]): string[] {
  const out = new Set<string>();
  for (const group of groups) for (const lib of group.libs) out.add(lib);
  return [...out].sort();
}

export interface ScriptletSource {
  name: string;
  fn: (...args: string[]) => void;
}

export type ScriptletSourceResolver = (nameOrAlias: string) => ScriptletSource | undefined;

function defaultSourceResolver(nameOrAlias: string): ScriptletSource | undefined {
  const name = stripJsSuffix(nameOrAlias);
  // `getEntry`: the name comes from a filter, and `registry['constructor']` would otherwise
  // hand back `Object.prototype.constructor` as if it were a scriptlet.
  const direct = getEntry(registry, name);
  if (direct !== undefined) return direct;
  for (const def of Object.values(registry)) if (def.aliases.includes(name)) return def;
  return undefined;
}

/** JSON literal that is safe to embed in a JS source file. */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/<\//g, '<\\/');
}

function jsComment(value: string): string {
  return value.replace(/\*\//g, '*_/').replace(/[\r\n]+/g, ' ');
}

/** `scriptlet-lib/<name>.js` for one scriptlet name, or `null` when it is unknown. */
export function emitScriptletLib(
  name: string,
  resolve: ScriptletSourceResolver = defaultSourceResolver,
): string | null {
  const def = resolve(name);
  if (def === undefined) return null;
  // `serializeScriptletFn` (never a raw `toString()`) — it splices in the `__name` shim a
  // transpiler may have left behind and refuses bodies that need any other helper.
  const source = serializeScriptletFn(def.fn, def.name);
  return (
    `/* iuBlocker scriptlet lib ${jsComment(def.name)} */\n` +
    '(function () {\n' +
    '  "use strict";\n' +
    '  try {\n' +
    '    var lib = self.__iub_lib = self.__iub_lib || {};\n' +
    `    lib[${jsLiteral(def.name)}] = (${source});\n` +
    '  } catch (e) {}\n' +
    '})();\n'
  );
}

/**
 * JS source for one pre-registered MAIN-world group file.
 *
 * The file holds no function body at all: it looks its scriptlet up in `self.__iub_lib`,
 * which the group's lib (registered ahead of it in the same `js` array) filled in. It then
 * walks `location.hostname`'s suffixes (`a.b.c` → `a.b.c`, `b.c`, `c`), bails out if any of
 * them carries an `#@#+js(...)` exception, and runs the scriptlet once for every argument
 * vector the generic row and the matching host rows name. Arguments go through
 * `JSON.stringify`, so list data can never break out of a string literal.
 *
 * `window.__iub_sl` records the calls that already ran (`"<name>#<argsJSON>"`), which keeps
 * a re-injection after a soft navigation — and two rows that name the same arguments — from
 * running anything twice.
 */
export function emitScriptletGroupBundle(group: ScriptletGroupBuild): string {
  const name = jsLiteral(group.name);
  const exclude: Record<string, 1> = {};
  for (const host of group.exclude) setEntry(exclude, host, 1);
  // One index is by far the common case; an array is only spent where a host really calls
  // the same scriptlet more than once.
  const rows: Record<string, number | number[]> = {};
  for (const host of Object.keys(group.hostArgs)) {
    const row = getEntry(group.hostArgs, host) as number[];
    setEntry(rows, host, row.length === 1 ? (row[0] as number) : row);
  }

  return (
    `/* iuBlocker scriptlet group ${jsComment(group.name)} */\n` +
    '(function () {\n' +
    '  "use strict";\n' +
    '  try {\n' +
    `    var fn = (self.__iub_lib || {})[${name}];\n` +
    '    if (typeof fn !== "function") { return; }\n' +
    `    var A = ${jsLiteral(group.argsList)};\n` +
    `    var H = ${jsLiteral(rows)};\n` +
    `    var X = ${jsLiteral(exclude)};\n` +
    `    var idx = ${jsLiteral(group.genericArgs)};\n` +
    '    var own = Object.prototype.hasOwnProperty;\n' +
    '    var h = String(location.hostname || "").toLowerCase();\n' +
    '    for (;;) {\n' +
    '      if (own.call(X, h)) { return; }\n' +
    '      if (own.call(H, h)) {\n' +
    '        var row = H[h];\n' +
    '        if (typeof row === "number") { idx.push(row); } else { idx = idx.concat(row); }\n' +
    '      }\n' +
    '      var dot = h.indexOf(".");\n' +
    '      if (dot === -1) { break; }\n' +
    '      h = h.slice(dot + 1);\n' +
    '    }\n' +
    '    if (idx.length === 0) { return; }\n' +
    '    var g = window.__iub_sl;\n' +
    '    if (!g) { g = window.__iub_sl = {}; }\n' +
    '    for (var i = 0; i < idx.length; i++) {\n' +
    '      var args = A[idx[i]];\n' +
    '      if (!args) { continue; }\n' +
    `      var key = ${name} + "#" + JSON.stringify(args);\n` +
    '      if (g[key] === 1) { continue; }\n' +
    '      g[key] = 1;\n' +
    '      try { fn.apply(null, args); } catch (e) {}\n' +
    '    }\n' +
    '  } catch (e) {}\n' +
    '})();\n'
  );
}
