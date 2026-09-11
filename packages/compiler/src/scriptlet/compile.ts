/**
 * `ScriptletDB` construction, merging and hostname lookup (docs/SCRIPTLETS.md §2 and §4).
 *
 * `byHost` / `exceptions` keys are concrete hostnames, the generic bucket `"*"`, or an
 * **entity key** such as `example.*`. Entities are resolved on lookup through the
 * public-suffix walk instead of being expanded at compile time; expanding them multiplied
 * every `example.*##+js(…)` filter by a few hundred hosts and dominated the compiled DBs.
 */
import type { DroppedFilter, ScriptletCall, ScriptletDB, ScriptletMeta } from '@iublocker/shared';
import { emptyScriptletDB, hostnameWalk } from '@iublocker/shared';
import { resolveScriptlet } from '@iublocker/scriptlets';
import type { CompileOptions, CompileScriptletResult, RawLine } from '../types';
import { entityKeysFor } from '../psl';
import { parseScriptletFilter, stripJsSuffix } from './parse';

/** Hostname key for scriptlets that apply everywhere (`##+js(...)` with no domains). */
export const SCRIPTLET_GENERIC_HOST_KEY = '*';

/** Exception name meaning "every scriptlet" (`#@#+js()`). */
export const ALL_SCRIPTLETS = '*';

/** Minimal registry shape the compiler needs; `@iublocker/scriptlets` satisfies it. */
export type ScriptletResolver = (nameOrAlias: string) => ScriptletMeta | undefined;

export interface ScriptletCompileOptions extends CompileOptions {
  /** Resolve a name or alias to its metadata. Defaults to the bundled registry. */
  resolve?: ScriptletResolver;
  /** Canonical name → metadata. Convenience alternative to `resolve` (used by tests). */
  registry?: Record<string, ScriptletMeta>;
}

export function resolverFromRegistry(registry: Record<string, ScriptletMeta>): ScriptletResolver {
  const index = new Map<string, ScriptletMeta>();
  for (const meta of Object.values(registry)) {
    index.set(meta.name, meta);
    for (const alias of meta.aliases) index.set(stripJsSuffix(alias), meta);
  }
  return (nameOrAlias: string) => index.get(stripJsSuffix(nameOrAlias));
}

function resolverOf(opts: ScriptletCompileOptions): ScriptletResolver {
  if (opts.resolve !== undefined) return opts.resolve;
  if (opts.registry !== undefined) return resolverFromRegistry(opts.registry);
  return resolveScriptlet;
}

function callId(call: ScriptletCall): string {
  return JSON.stringify([call.name, call.args]);
}

/** Compile `##+js(...)` / `#@#+js(...)` lines into a `ScriptletDB`. */
export function compileScriptlets(lines: RawLine[], opts: ScriptletCompileOptions): CompileScriptletResult {
  const dropped: DroppedFilter[] = [];
  const warnings: string[] = [];
  const resolve = resolverOf(opts);

  const byHost = new Map<string, Map<string, ScriptletCall>>();
  const exceptions = new Map<string, Set<string>>();

  const addException = (host: string, name: string): void => {
    let set = exceptions.get(host);
    if (set === undefined) {
      set = new Set<string>();
      exceptions.set(host, set);
    }
    set.add(name);
  };

  const pending: { hosts: string[]; call: ScriptletCall }[] = [];

  for (const line of lines) {
    const res = parseScriptletFilter(line.raw);
    if (res === null) continue;
    if (!res.ok) {
      dropped.push({ listId: opts.listId, line: line.line, raw: line.raw, reason: res.reason });
      continue;
    }
    const parsed = res.value;

    if (parsed.exception) {
      const meta = parsed.name === '' ? undefined : resolve(parsed.name);
      const name = parsed.name === '' ? ALL_SCRIPTLETS : (meta?.name ?? parsed.name);
      if (parsed.name !== '' && meta === undefined) {
        warnings.push(`line ${line.line}: exception for unknown scriptlet "${parsed.name}"`);
      }
      const hosts = parsed.domains.include;
      if (hosts.length === 0) addException(SCRIPTLET_GENERIC_HOST_KEY, name);
      else for (const host of hosts) addException(host, name);
      continue;
    }

    const meta = resolve(parsed.name);
    if (meta === undefined) {
      dropped.push({
        listId: opts.listId,
        line: line.line,
        raw: line.raw,
        reason: `unknown scriptlet "${parsed.name}"`,
      });
      continue;
    }
    if (meta.trusted && !opts.trusted) {
      dropped.push({
        listId: opts.listId,
        line: line.line,
        raw: line.raw,
        reason: `trusted scriptlet "${meta.name}" is not allowed from an untrusted list`,
      });
      continue;
    }
    const required = meta.args.filter((a) => a.optional !== true).length;
    if (parsed.args.length < required) {
      dropped.push({
        listId: opts.listId,
        line: line.line,
        raw: line.raw,
        reason: `scriptlet "${meta.name}" needs at least ${required} argument(s), got ${parsed.args.length}`,
      });
      continue;
    }
    if (parsed.args.length > meta.args.length) {
      dropped.push({
        listId: opts.listId,
        line: line.line,
        raw: line.raw,
        reason: `scriptlet "${meta.name}" takes at most ${meta.args.length} argument(s), got ${parsed.args.length}`,
      });
      continue;
    }

    const call: ScriptletCall = { name: meta.name, args: parsed.args };
    const hosts = parsed.domains.include;
    pending.push({ hosts: hosts.length === 0 ? [SCRIPTLET_GENERIC_HOST_KEY] : hosts, call });
    for (const host of parsed.domains.exclude) addException(host, meta.name);
  }

  const globalExceptions = exceptions.get(SCRIPTLET_GENERIC_HOST_KEY) ?? new Set<string>();
  for (const { hosts, call } of pending) {
    if (globalExceptions.has(ALL_SCRIPTLETS) || globalExceptions.has(call.name)) continue;
    for (const host of hosts) {
      const local = exceptions.get(host);
      if (local !== undefined && (local.has(ALL_SCRIPTLETS) || local.has(call.name))) continue;
      let map = byHost.get(host);
      if (map === undefined) {
        map = new Map<string, ScriptletCall>();
        byHost.set(host, map);
      }
      map.set(callId(call), call);
    }
  }

  const db = emptyScriptletDB(opts.listId);
  for (const [host, calls] of byHost) {
    if (calls.size === 0) continue;
    db.byHost[host] = [...calls.values()];
  }
  for (const [host, names] of exceptions) {
    if (names.size === 0) continue;
    db.exceptions[host] = [...names];
  }
  return { db, dropped, warnings };
}

function unionInto(target: string[], source: readonly string[]): void {
  const seen = new Set(target);
  for (const value of source) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
}

/** Deep, deduplicating union of `source` into `target`. Returns `target`. */
export function mergeScriptletDB(target: ScriptletDB, source: ScriptletDB): ScriptletDB {
  for (const host of Object.keys(source.byHost)) {
    const calls = source.byHost[host];
    if (calls === undefined) continue;
    const existing = target.byHost[host];
    if (existing === undefined) {
      target.byHost[host] = calls.map((c) => ({ name: c.name, args: [...c.args] }));
      continue;
    }
    const seen = new Set(existing.map(callId));
    for (const call of calls) {
      const id = callId(call);
      if (seen.has(id)) continue;
      seen.add(id);
      existing.push({ name: call.name, args: [...call.args] });
    }
  }
  for (const host of Object.keys(source.exceptions)) {
    const names = source.exceptions[host];
    if (names === undefined) continue;
    const existing = target.exceptions[host];
    if (existing === undefined) target.exceptions[host] = [...names];
    else unionInto(existing, names);
  }
  return target;
}

/**
 * `byHost` / `exceptions` keys that apply to a hostname: the suffix walk, the entity keys
 * above the public suffix, and the generic `"*"` bucket.
 *
 * Memoised — the worker asks for the same handful of hostnames repeatedly and the group
 * builder asks once per `byHost` key.
 */
const keyCache = new Map<string, { concrete: string[]; entity: string[] }>();
const KEY_CACHE_MAX = 4096;

export function scriptletKeysFor(hostname: string): { concrete: string[]; entity: string[] } {
  const cached = keyCache.get(hostname);
  if (cached !== undefined) return cached;
  const keys = {
    concrete: [...hostnameWalk(hostname), SCRIPTLET_GENERIC_HOST_KEY],
    entity: entityKeysFor(hostname),
  };
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  keyCache.set(hostname, keys);
  return keys;
}

/** Calls for a hostname, split by how they were matched. docs/SCRIPTLETS.md §3. */
export interface DetailedScriptletLookup {
  /**
   * Matched by a concrete hostname key (or the generic `"*"` bucket). These are the calls
   * the build pre-registers as MAIN-world content scripts.
   */
  concrete: ScriptletCall[];
  /**
   * Matched *only* through an entity key (`example.*`). `registerContentScripts` needs
   * literal match patterns, so these cannot be pre-registered and are injected from the
   * worker at `onCommitted` instead.
   */
  entity: ScriptletCall[];
}

/**
 * Effective scriptlet calls for `hostname`, split into the pre-registerable (concrete) and
 * the dynamic (entity-only) halves.
 *
 * Exceptions are collected from every key — concrete *and* entity — in every DB first, so
 * `~example.*##+js(…)` and `example.*#@#+js(…)` cancel calls exactly like a hostname
 * exception. An exception for `"*"` disables every scriptlet on the hostname.
 */
export function lookupScriptletsDetailed(dbs: ScriptletDB[], hostname: string): DetailedScriptletLookup {
  const { concrete: concreteKeys, entity: entityKeys } = scriptletKeysFor(hostname.toLowerCase());

  const excluded = new Set<string>();
  for (const db of dbs) {
    for (const key of concreteKeys) {
      const names = db.exceptions[key];
      if (names !== undefined) for (const name of names) excluded.add(name);
    }
    for (const key of entityKeys) {
      const names = db.exceptions[key];
      if (names !== undefined) for (const name of names) excluded.add(name);
    }
  }
  if (excluded.has(ALL_SCRIPTLETS)) return { concrete: [], entity: [] };

  const seen = new Set<string>();
  const collect = (keys: readonly string[], out: ScriptletCall[]): void => {
    for (const db of dbs) {
      for (const key of keys) {
        const calls = db.byHost[key];
        if (calls === undefined) continue;
        for (const call of calls) {
          if (excluded.has(call.name)) continue;
          const id = callId(call);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push(call);
        }
      }
    }
  };

  // Concrete first: a call reachable both ways belongs to the pre-registered group.
  const concrete: ScriptletCall[] = [];
  collect(concreteKeys, concrete);
  const entity: ScriptletCall[] = [];
  if (entityKeys.length > 0) collect(entityKeys, entity);
  return { concrete, entity };
}

/**
 * Effective scriptlet calls for `hostname`: the union along the suffix walk and the
 * matching entity keys (plus the `"*"` generic bucket) across every DB, minus every
 * exception recorded under any of those keys in any DB.
 */
export function lookupScriptlets(dbs: ScriptletDB[], hostname: string): ScriptletCall[] {
  const { concrete, entity } = lookupScriptletsDetailed(dbs, hostname);
  return entity.length === 0 ? concrete : [...concrete, ...entity];
}
