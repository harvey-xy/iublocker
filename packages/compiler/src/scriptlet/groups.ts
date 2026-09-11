/**
 * Host-group computation and MAIN-world bundle emission (docs/SCRIPTLETS.md §3).
 *
 * Hostnames whose *effective* call list is identical share one generated file, which the
 * `ScriptletRegistrar` registers with `matches: ['*://*.host/*', …]`. Subdomain
 * inheritance therefore happens through the match patterns, so only the exact hostnames
 * present in a `ScriptletDB.byHost` are listed.
 */
import type { ScriptletCall, ScriptletDB, ScriptletGroup } from '@iublocker/shared';
import { hostnameWalk } from '@iublocker/shared';
import { registry } from '@iublocker/scriptlets';
import { SCRIPTLET_GENERIC_HOST_KEY, lookupScriptlets } from './compile';
import { shortHash } from './hash';
import { stripJsSuffix } from './parse';

export const SCRIPTLET_GROUP_DIR = 'scriptlet-groups';

export function scriptletGroupFile(hash: string): string {
  return `${SCRIPTLET_GROUP_DIR}/${hash}.js`;
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
 * Groups are returned sorted by hash so the build is reproducible.
 */
export function computeScriptletGroups(dbs: { listId: string; db: ScriptletDB }[]): ScriptletGroup[] {
  const all = dbs.map((d) => d.db);
  const hosts = new Set<string>();
  for (const { db } of dbs) for (const host of Object.keys(db.byHost)) hosts.add(host);

  const groups = new Map<string, ScriptletGroup>();
  for (const host of [...hosts].sort()) {
    const calls = lookupScriptlets(all, host);
    if (calls.length === 0) continue;
    const canonical = canonicalCalls(calls);
    const hash = shortHash(canonical);
    let group = groups.get(canonical);
    if (group === undefined) {
      group = {
        hash,
        file: scriptletGroupFile(hash),
        hosts: [],
        listIds: [],
        calls: JSON.parse(canonical) as ScriptletCall[],
      };
      groups.set(canonical, group);
    }
    group.hosts.push(host);
    const keys = host === SCRIPTLET_GENERIC_HOST_KEY ? [SCRIPTLET_GENERIC_HOST_KEY] : [...hostnameWalk(host), SCRIPTLET_GENERIC_HOST_KEY];
    for (const { listId, db } of dbs) {
      if (group.listIds.includes(listId)) continue;
      if (keys.some((key) => db.byHost[key] !== undefined)) group.listIds.push(listId);
    }
  }

  return [...groups.values()].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
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

/**
 * JS source for one pre-registered MAIN-world bundle.
 *
 * Every scriptlet body is embedded verbatim (it is trusted, bundled code); every argument
 * goes through `JSON.stringify`, so list data can never break out of a string literal.
 * `window.__iub_sl` records the calls that already ran so overlapping groups (a host group
 * and its parent-domain group both match) never execute the same call twice.
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
  lines.push('    var g = window.__iub_sl;');
  lines.push('    if (!g) { g = window.__iub_sl = {}; }');
  lines.push('    var run = function (key, fn, args) {');
  lines.push('      if (g[key] === 1) { return; }');
  lines.push('      g[key] = 1;');
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
    lines.push(`    run(${jsString(key)}, (${def.fn.toString()}), [${args}]);`);
  }

  lines.push('  } catch (e) {}');
  lines.push('})();');
  return lines.join('\n') + '\n';
}
