/**
 * Host-group computation and MAIN-world bundle emission (docs/SCRIPTLETS.md §3).
 *
 * Hostnames whose *effective* call list is identical share one generated file, which the
 * `ScriptletRegistrar` registers with `matches: ['*://*.host/*', …]`. Subdomain
 * inheritance therefore happens through the match patterns, so only the exact hostnames
 * present in a `ScriptletDB.byHost` are listed.
 *
 * Two kinds of file are emitted:
 *
 * - `scriptlet-lib/<name>.js` — one per scriptlet *name* actually used anywhere, defining
 *   `self.__iub_lib["<name>"] = <fn>`. Function bodies are large (several kB each) and
 *   used by thousands of groups, so they must never be duplicated per group.
 * - `scriptlet-groups/<hash>.js` — one per group, holding nothing but
 *   `run(key, "<name>", [args])` calls that look the function up in `self.__iub_lib`.
 *
 * A group is registered as `js: [...group.libs, group.file]`.
 */
import type { ScriptletCall, ScriptletDB, ScriptletGroup } from '@iublocker/shared';
import { hostnameWalk } from '@iublocker/shared';
import { registry, serializeScriptletFn } from '@iublocker/scriptlets';
import { isEntity } from '../psl';
import { SCRIPTLET_GENERIC_HOST_KEY, lookupScriptletsDetailed } from './compile';
import { shortHash } from './hash';
import { stripJsSuffix } from './parse';

export const SCRIPTLET_GROUP_DIR = 'scriptlet-groups';
export const SCRIPTLET_LIB_DIR = 'scriptlet-lib';

export function scriptletGroupFile(hash: string): string {
  return `${SCRIPTLET_GROUP_DIR}/${hash}.js`;
}

/**
 * Library file for one scriptlet name. Names come from the registry (validated at compile
 * time) and are plain `[a-z0-9._-]` identifiers, but path separators are still rejected so
 * a hostile registry entry can never escape the directory.
 */
export function scriptletLibFile(name: string): string {
  if (name === '' || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new Error(`scriptlets: unusable scriptlet name "${name}"`);
  }
  return `${SCRIPTLET_LIB_DIR}/${name}.js`;
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

/**
 * Group every hostname that carries scriptlets by its effective call list.
 *
 * Only **concrete** hostname keys become groups. An entity key (`example.*`) has no
 * literal match pattern, so its calls are left to the worker's dynamic path
 * (`ScriptletIndex.lookupDynamic`); a concrete host that *also* matches an entity still
 * gets a group for the calls it owns concretely, and the entity ones are added at
 * `onCommitted`.
 *
 * Groups are returned sorted by hash so the build is reproducible.
 */
export function computeScriptletGroups(
  dbs: { listId: string; db: ScriptletDB }[],
  resolve: ScriptletSourceResolver = defaultSourceResolver,
): ScriptletGroup[] {
  const all = dbs.map((d) => d.db);
  const hosts = new Set<string>();
  for (const { db } of dbs) {
    for (const host of Object.keys(db.byHost)) {
      if (!isEntity(host)) hosts.add(host);
    }
  }

  const groups = new Map<string, ScriptletGroup>();
  for (const host of [...hosts].sort()) {
    const calls = lookupScriptletsDetailed(all, host).concrete;
    if (calls.length === 0) continue;
    const canonical = canonicalCalls(calls);
    const hash = shortHash(canonical);
    let group = groups.get(canonical);
    if (group === undefined) {
      const groupCalls = JSON.parse(canonical) as ScriptletCall[];
      group = {
        hash,
        file: scriptletGroupFile(hash),
        libs: libsFor(groupCalls, resolve),
        hosts: [],
        listIds: [],
        calls: groupCalls,
      };
      groups.set(canonical, group);
    }
    group.hosts.push(host);
    const keys =
      host === SCRIPTLET_GENERIC_HOST_KEY
        ? [SCRIPTLET_GENERIC_HOST_KEY]
        : [...hostnameWalk(host), SCRIPTLET_GENERIC_HOST_KEY];
    for (const { listId, db } of dbs) {
      if (group.listIds.includes(listId)) continue;
      if (keys.some((key) => db.byHost[key] !== undefined)) group.listIds.push(listId);
    }
  }

  return [...groups.values()].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
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

/**
 * Most groups one list may pre-register. docs/SCRIPTLETS.md §3.
 *
 * `registerContentScripts` cost grows with the number of registered scripts, and uBlock
 * filters alone produce well over four thousand distinct call lists. Past the cap the
 * smallest groups (fewest hosts) are demoted to the worker's dynamic path, which costs one
 * `executeScript` at `onCommitted` for the handful of sites involved.
 */
export const SCRIPTLET_GROUPS_PER_LIST = 3000;

export interface CappedScriptletGroups {
  /** Groups that stay pre-registered. */
  groups: ScriptletGroup[];
  /**
   * Hostnames whose group was demoted. The worker injects their calls with
   * `executeScript` instead (`ScriptletIndex.lookupDynamic`).
   */
  dynamicHosts: string[];
}

/**
 * Enforce {@link SCRIPTLET_GROUPS_PER_LIST} by demoting the smallest groups of any list
 * that exceeds it.
 *
 * "Smallest" is fewest hosts, then fewest calls, then hash — deterministic, and it demotes
 * the groups that cover the fewest sites first. The generic `"*"` group is never demoted:
 * it applies everywhere and has no hostname the dynamic path could key on.
 */
export function capScriptletGroups(
  groups: readonly ScriptletGroup[],
  maxPerList: number = SCRIPTLET_GROUPS_PER_LIST,
): CappedScriptletGroups {
  const perList = new Map<string, number>();
  for (const group of groups) {
    for (const listId of group.listIds) perList.set(listId, (perList.get(listId) ?? 0) + 1);
  }
  const over = new Set([...perList].filter(([, n]) => n > maxPerList).map(([id]) => id));
  if (over.size === 0) return { groups: [...groups], dynamicHosts: [] };

  const candidates = groups
    .filter(
      (group) =>
        !group.hosts.includes(SCRIPTLET_GENERIC_HOST_KEY) && group.listIds.some((id) => over.has(id)),
    )
    .sort(
      (a, b) =>
        a.hosts.length - b.hosts.length ||
        a.calls.length - b.calls.length ||
        (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
    );

  const demoted = new Set<ScriptletGroup>();
  const dynamicHosts = new Set<string>();
  for (const group of candidates) {
    if (!group.listIds.some((id) => (perList.get(id) ?? 0) > maxPerList)) continue;
    demoted.add(group);
    for (const listId of group.listIds) perList.set(listId, (perList.get(listId) ?? 0) - 1);
    for (const host of group.hosts) dynamicHosts.add(host);
  }

  return {
    groups: groups.filter((group) => !demoted.has(group)),
    dynamicHosts: [...dynamicHosts].sort(),
  };
}

export interface ScriptletSource {
  name: string;
  fn: (...args: string[]) => void;
}

export type ScriptletSourceResolver = (nameOrAlias: string) => ScriptletSource | undefined;

function defaultSourceResolver(nameOrAlias: string): ScriptletSource | undefined {
  const name = stripJsSuffix(nameOrAlias);
  const direct = registry[name];
  if (direct !== undefined) return direct;
  for (const def of Object.values(registry)) if (def.aliases.includes(name)) return def;
  return undefined;
}

/** JSON string literal that is safe to embed in a JS source file. */
function jsString(value: string): string {
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
    `    lib[${jsString(def.name)}] = (${source});\n` +
    '  } catch (e) {}\n' +
    '})();\n'
  );
}

/**
 * JS source for one pre-registered MAIN-world group file.
 *
 * The file holds no function bodies at all: every call resolves its function from
 * `self.__iub_lib`, which the group's `libs` (registered ahead of it in the same `js`
 * array) filled in. Arguments go through `JSON.stringify`, so list data can never break
 * out of a string literal. `window.__iub_sl` records the calls that already ran so
 * overlapping group registrations (a host group and its parent-domain group both match)
 * never execute the same call twice.
 */
export function emitScriptletGroupBundle(
  group: ScriptletGroup,
  resolve: ScriptletSourceResolver = defaultSourceResolver,
): string {
  const lines: string[] = [];
  lines.push(`/* iuBlocker scriptlet bundle ${jsComment(group.hash)} */`);
  lines.push('(function () {');
  lines.push('  "use strict";');
  lines.push('  try {');
  lines.push('    var lib = self.__iub_lib || {};');
  lines.push('    var g = window.__iub_sl;');
  lines.push('    if (!g) { g = window.__iub_sl = {}; }');
  lines.push('    var run = function (key, name, args) {');
  lines.push('      if (g[key] === 1) { return; }');
  lines.push('      g[key] = 1;');
  lines.push('      var fn = lib[name];');
  lines.push('      if (typeof fn !== "function") { return; }');
  lines.push('      try { fn.apply(null, args); } catch (e) {}');
  lines.push('    };');

  for (const call of group.calls) {
    const def = resolve(call.name);
    if (def === undefined) {
      lines.push(`    /* unknown scriptlet: ${jsComment(call.name)} */`);
      continue;
    }
    const key = `${def.name}#${JSON.stringify(call.args)}`;
    const args = call.args.map(jsString).join(', ');
    lines.push(`    run(${jsString(key)}, ${jsString(def.name)}, [${args}]);`);
  }

  lines.push('  } catch (e) {}');
  lines.push('})();');
  return lines.join('\n') + '\n';
}
