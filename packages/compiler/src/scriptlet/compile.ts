/**
 * `ScriptletDB` construction, merging and hostname lookup (docs/SCRIPTLETS.md §2 and §4).
 */
import type { DroppedFilter, ScriptletCall, ScriptletDB, ScriptletMeta } from '@iublocker/shared';
import { emptyScriptletDB, hostnameWalk } from '@iublocker/shared';
import { resolveScriptlet } from '@iublocker/scriptlets';
import type { CompileOptions, CompileScriptletResult, RawLine } from '../types';
import { expandEntity, isEntity, MAX_ENTITY_EXPANSION, PUBLIC_SUFFIXES } from '../cosmetic/entities';
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
  /** Override the embedded public-suffix snapshot (used by tests). */
  suffixes?: readonly string[];
  /** Cap on hostnames generated per `example.*` entity (default 300). */
  maxEntityExpansion?: number;
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
  const suffixes = opts.suffixes ?? PUBLIC_SUFFIXES;
  const entityCap = opts.maxEntityExpansion ?? MAX_ENTITY_EXPANSION;

  const expand = (entries: string[]): string[] => {
    const out: string[] = [];
    for (const entry of entries) {
      if (isEntity(entry)) out.push(...expandEntity(entry.slice(0, -2), suffixes, entityCap));
      else out.push(entry);
    }
    return out;
  };

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
      const hosts = expand(parsed.domains.include);
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
    const hosts = expand(parsed.domains.include);
    pending.push({ hosts: hosts.length === 0 ? [SCRIPTLET_GENERIC_HOST_KEY] : hosts, call });
    for (const host of expand(parsed.domains.exclude)) addException(host, meta.name);
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
 * Effective scriptlet calls for `hostname`: the union along the suffix walk (plus the
 * `"*"` generic bucket) across every DB, minus every exception recorded along the same
 * walk in any DB. An exception for `"*"` disables all scriptlets on the hostname.
 */
export function lookupScriptlets(dbs: ScriptletDB[], hostname: string): ScriptletCall[] {
  const walk = hostnameWalk(hostname.toLowerCase());
  const keys = [...walk, SCRIPTLET_GENERIC_HOST_KEY];

  const excluded = new Set<string>();
  for (const db of dbs) {
    for (const key of keys) {
      const names = db.exceptions[key];
      if (names === undefined) continue;
      for (const name of names) excluded.add(name);
    }
  }
  if (excluded.has(ALL_SCRIPTLETS)) return [];

  const out: ScriptletCall[] = [];
  const seen = new Set<string>();
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
  return out;
}
