/**
 * `CosmeticDB` construction, merging and network-exception folding.
 * docs/COSMETIC-FILTERING.md §2.
 *
 * Hostname keys are stored exactly as the filter wrote them: a concrete hostname, the
 * generic bucket `"*"`, or an **entity key** such as `example.*`. Entities are resolved at
 * lookup time (`lookupCosmetic` → `entityKeysFor`), never expanded here — expanding them
 * against the public-suffix snapshot used to multiply every `example.*##…` filter by a few
 * hundred and was the single biggest source of dead selectors in the compiled DBs.
 */
import type { CosmeticDB, DroppedFilter, ProceduralFilter } from '@iublocker/shared';
import { emptyCosmeticDB } from '@iublocker/shared';
import type { CompileCosmeticResult, CompileOptions, CosmeticNetworkExceptions, RawLine } from '../types';
import type { CosmeticForm, ParsedCosmetic } from './parse';
import { parseCosmeticFilter } from './parse';
import { getEntry, setEntry } from '../record';
import { genericKey } from './selector';

/** Hostname key used for filters that apply everywhere (generic `:style()` / procedural). */
export const GENERIC_HOST_KEY = '*';

/** docs/COSMETIC-FILTERING.md §2: warn above 2,000 generic complex selectors. */
export const MAX_GENERIC_COMPLEX = 2000;

export interface CosmeticCompileOptions extends CompileOptions {
  /** Cap on `generic.complex` (default {@link MAX_GENERIC_COMPLEX}). */
  maxGenericComplex?: number;
}

const NUL = '\u0000';

function push<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (set === undefined) {
    set = new Set<V>();
    map.set(key, set);
  }
  set.add(value);
}

function toRecord(map: Map<string, Set<string>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  // Keys are hostnames and id/class tokens straight out of the list: `setEntry`, because
  // `out['__proto__'] = …` would replace the prototype instead of storing the entry.
  for (const [key, set] of map) {
    if (set.size === 0) continue;
    setEntry(out, key, [...set]);
  }
  return out;
}

/** The selector text an exception (`#@#`) uses to cancel a filter. */
function exceptionKey(body: CosmeticForm, rawBody: string): string {
  switch (body.form) {
    case 'plain':
      return body.selector;
    case 'style':
      return body.selector;
    default:
      return rawBody;
  }
}

/** Compile cosmetic filter lines into a `CosmeticDB`. */
export function compileCosmetic(lines: RawLine[], opts: CosmeticCompileOptions): CompileCosmeticResult {
  const dropped: DroppedFilter[] = [];
  const warnings: string[] = [];
  const complexCap = opts.maxGenericComplex ?? MAX_GENERIC_COMPLEX;

  // Phase A — parse.
  const records: ParsedCosmetic[] = [];
  for (const line of lines) {
    const res = parseCosmeticFilter(line.raw);
    if (res === null) continue;
    if (!res.ok) {
      dropped.push({ listId: opts.listId, line: line.line, raw: line.raw, reason: res.reason });
      continue;
    }
    records.push(res.value);
  }

  // Phase B — collect exceptions (order-independent).
  /** Selectors cancelled everywhere by an unqualified `#@#`. */
  const globalExceptions = new Set<string>();
  /** hostname → selectors cancelled on that hostname. */
  const hostExceptions = new Map<string, Set<string>>();

  for (const parsed of records) {
    const key = exceptionKey(parsed.body, parsed.rawBody);
    if (parsed.exception) {
      const hosts = parsed.domains.include;
      if (hosts.length === 0) globalExceptions.add(key);
      else for (const host of hosts) push(hostExceptions, host, key);
      continue;
    }
    for (const host of parsed.domains.exclude) push(hostExceptions, host, key);
  }

  // Phase C — build.
  const byId = new Map<string, Set<string>>();
  const byClass = new Map<string, Set<string>>();
  const complex = new Set<string>();
  const specific = new Map<string, Set<string>>();
  const styles = new Map<string, Set<string>>();
  const procedural = new Map<string, Map<string, ProceduralFilter>>();

  const addProcedural = (host: string, filter: ProceduralFilter): void => {
    let map = procedural.get(host);
    if (map === undefined) {
      map = new Map<string, ProceduralFilter>();
      procedural.set(host, map);
    }
    map.set(JSON.stringify(filter), filter);
  };

  let genericExcluded = 0;
  for (const parsed of records) {
    if (parsed.exception) continue;
    const hosts = parsed.domains.include;
    const body = parsed.body;

    if (hosts.length === 0) {
      const key = exceptionKey(body, parsed.rawBody);
      if (globalExceptions.has(key)) {
        genericExcluded++;
        continue;
      }
      if (body.form === 'plain') {
        const gk = genericKey(body.selector);
        if (gk.kind === 'id') push(byId, gk.key, body.selector);
        else if (gk.kind === 'class') push(byClass, gk.key, body.selector);
        else complex.add(body.selector);
      } else if (body.form === 'style') {
        push(styles, GENERIC_HOST_KEY, `${body.selector}${NUL}${body.style}`);
      } else {
        addProcedural(GENERIC_HOST_KEY, body.filter);
      }
      continue;
    }

    for (const host of hosts) {
      if (body.form === 'plain') push(specific, host, body.selector);
      else if (body.form === 'style') push(styles, host, `${body.selector}${NUL}${body.style}`);
      else addProcedural(host, body.filter);
    }
  }

  // Phase D — apply per-hostname exceptions to the sets we just built.
  for (const [host, keys] of hostExceptions) {
    const sel = specific.get(host);
    if (sel !== undefined) for (const key of keys) sel.delete(key);
    const sty = styles.get(host);
    if (sty !== undefined) {
      for (const entry of [...sty]) {
        const idx = entry.indexOf(NUL);
        if (keys.has(entry.slice(0, idx))) sty.delete(entry);
      }
    }
    const proc = procedural.get(host);
    if (proc !== undefined) {
      for (const [id, filter] of [...proc]) if (keys.has(filter.raw)) proc.delete(id);
    }
  }

  // Phase E — serialise.
  const db: CosmeticDB = emptyCosmeticDB(opts.listId);
  db.generic.byId = toRecord(byId);
  db.generic.byClass = toRecord(byClass);
  let complexList = [...complex];
  if (complexList.length > complexCap) {
    warnings.push(
      `generic.complex holds ${complexList.length} selectors; keeping the first ${complexCap} (docs/COSMETIC-FILTERING.md §2)`,
    );
    complexList = complexList.slice(0, complexCap);
  }
  db.generic.complex = complexList;
  db.specific = toRecord(specific);
  for (const [host, entries] of styles) {
    const out: [string, string][] = [];
    for (const entry of entries) {
      const idx = entry.indexOf(NUL);
      out.push([entry.slice(0, idx), entry.slice(idx + 1)]);
    }
    if (out.length > 0) setEntry(db.styles, host, out);
  }
  for (const [host, map] of procedural) {
    if (map.size === 0) continue;
    setEntry(db.procedural, host, [...map.values()]);
  }
  db.exceptions.selectors = toRecord(hostExceptions);

  if (genericExcluded > 0) {
    warnings.push(`${genericExcluded} generic selector(s) removed by unqualified "#@#" exceptions`);
  }

  return { db, dropped, warnings };
}

function unionInto(target: string[], source: readonly string[]): string[] {
  if (source.length === 0) return target;
  const seen = new Set(target);
  for (const value of source) {
    if (seen.has(value)) continue;
    seen.add(value);
    target.push(value);
  }
  return target;
}

function unionRecord(target: Record<string, string[]>, source: Record<string, string[]>): void {
  for (const key of Object.keys(source)) {
    const values = getEntry(source, key);
    if (values === undefined) continue;
    const existing = getEntry(target, key);
    if (existing === undefined) setEntry(target, key, [...values]);
    else unionInto(existing, values);
  }
}

/** Fold `$elemhide` / `$generichide` / `$specifichide` hostnames from the network compiler. */
export function addCosmeticNetworkExceptions(db: CosmeticDB, ex: CosmeticNetworkExceptions): void {
  const lower = (hosts: readonly string[]): string[] => hosts.map((h) => h.toLowerCase());
  unionInto(db.exceptions.elemhide, lower(ex.elemhide));
  unionInto(db.exceptions.generichide, lower(ex.generichide));
  unionInto(db.exceptions.specifichide, lower(ex.specifichide));
}

/** Deep, deduplicating union of `source` into `target`. Returns `target`. */
export function mergeCosmeticDB(target: CosmeticDB, source: CosmeticDB): CosmeticDB {
  unionRecord(target.generic.byId, source.generic.byId);
  unionRecord(target.generic.byClass, source.generic.byClass);
  unionInto(target.generic.complex, source.generic.complex);
  unionRecord(target.specific, source.specific);

  for (const host of Object.keys(source.styles)) {
    const entries = getEntry(source.styles, host);
    if (entries === undefined) continue;
    const existing = getEntry(target.styles, host);
    if (existing === undefined) {
      setEntry(
        target.styles,
        host,
        entries.map((e) => [e[0], e[1]] as [string, string]),
      );
      continue;
    }
    const seen = new Set(existing.map((e) => `${e[0]}${NUL}${e[1]}`));
    for (const entry of entries) {
      const id = `${entry[0]}${NUL}${entry[1]}`;
      if (seen.has(id)) continue;
      seen.add(id);
      existing.push([entry[0], entry[1]]);
    }
  }

  for (const host of Object.keys(source.procedural)) {
    const filters = getEntry(source.procedural, host);
    if (filters === undefined) continue;
    const existing = getEntry(target.procedural, host);
    if (existing === undefined) {
      setEntry(
        target.procedural,
        host,
        filters.map((f) => ({ raw: f.raw, tasks: f.tasks })),
      );
      continue;
    }
    const seen = new Set(existing.map((f) => JSON.stringify(f)));
    for (const filter of filters) {
      const id = JSON.stringify(filter);
      if (seen.has(id)) continue;
      seen.add(id);
      existing.push(filter);
    }
  }

  unionRecord(target.exceptions.selectors, source.exceptions.selectors);
  unionInto(target.exceptions.elemhide, source.exceptions.elemhide);
  unionInto(target.exceptions.generichide, source.exceptions.generichide);
  unionInto(target.exceptions.specifichide, source.exceptions.specifichide);
  return target;
}
