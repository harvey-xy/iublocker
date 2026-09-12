/**
 * CosmeticIndex — lazily loads every enabled list's compiled cosmetic DB plus the user
 * and delta DBs, and answers per-hostname lookups. docs/COSMETIC-FILTERING.md §2.
 *
 * Module state is a pure cache: it is rebuilt from storage + the bundle after every
 * worker restart and dropped by `invalidate()` on list toggles, user saves and updates.
 */
import type { CosmeticDB, CosmeticGeneric, CosmeticLookup, RulesetListEntry } from '@iublocker/shared';
import { lookupCosmetic } from '../compiler-api';
import { log } from '../log';
import { enabledListIds, getManifest, listFileUrl } from '../rulesets/manager';
import * as store from '../storage/store';

/** Per-list DBs never change within an extension version: keep them across invalidations. */
const listDbCache = new Map<string, CosmeticDB | null>();

let dbs: CosmeticDB[] | null = null;
let loading: Promise<CosmeticDB[]> | null = null;
let genericCache: CosmeticGeneric | null = null;
/**
 * Bumped by `invalidate()`. A load (or a lookup) that started before an invalidation must
 * not publish its now-stale result into the caches, or a toggled list keeps filtering (or
 * stops filtering) until the next invalidation.
 */
let generation = 0;
const lookupCache = new Map<string, CosmeticLookup>();
const LOOKUP_CACHE_MAX = 256;

function isCosmeticDB(value: unknown): value is CosmeticDB {
  if (!value || typeof value !== 'object') return false;
  const db = value as Partial<CosmeticDB>;
  return db.version === 1 && typeof db.listId === 'string' && typeof db.specific === 'object';
}

async function fetchListDb(entry: RulesetListEntry): Promise<CosmeticDB | null> {
  if (listDbCache.has(entry.id)) return listDbCache.get(entry.id) ?? null;
  let db: CosmeticDB | null = null;
  try {
    const res = await fetch(listFileUrl(entry, 'cosmetic'));
    if (res.ok) {
      const json: unknown = await res.json();
      if (isCosmeticDB(json)) db = json;
      else log.warn(`cosmetic DB for ${entry.id} is malformed`);
    } else if (res.status !== 404) {
      log.warn(`cosmetic DB for ${entry.id}: HTTP ${res.status}`);
    }
  } catch (err) {
    log.warn(`cosmetic DB for ${entry.id} could not be loaded`, err);
  }
  listDbCache.set(entry.id, db);
  return db;
}

async function load(): Promise<CosmeticDB[]> {
  const gen = generation;
  const [manifest, enabled, userCompiled, delta] = await Promise.all([
    getManifest(),
    enabledListIds(),
    store.get('userCompiled'),
    store.get('delta'),
  ]);
  const enabledSet = new Set(enabled);
  const entries = manifest.lists.filter((entry) => enabledSet.has(entry.id));
  const loaded = await Promise.all(entries.map((entry) => fetchListDb(entry)));
  const out = loaded.filter((db): db is CosmeticDB => db !== null);
  if (delta?.cosmetic && isCosmeticDB(delta.cosmetic)) out.push(delta.cosmetic);
  if (userCompiled?.cosmetic && isCosmeticDB(userCompiled.cosmetic)) out.push(userCompiled.cosmetic);
  if (gen === generation) dbs = out;
  log.debug(`cosmetic index: ${out.length} DB(s)`);
  return out;
}

export async function getDbs(): Promise<CosmeticDB[]> {
  if (dbs) return dbs;
  loading ??= load().finally(() => {
    loading = null;
  });
  return loading;
}

export async function lookup(hostname: string): Promise<CosmeticLookup> {
  const host = hostname.toLowerCase();
  const cached = lookupCache.get(host);
  if (cached) return cached;
  const gen = generation;
  const all = await getDbs();
  let result: CosmeticLookup;
  try {
    result = lookupCosmetic(all, host);
  } catch (err) {
    log.error('lookupCosmetic failed', err);
    result = {
      selectors: [],
      styles: [],
      procedural: [],
      elemhide: false,
      generichide: false,
      specifichide: false,
      excluded: [],
    };
  }
  if (gen === generation) {
    if (lookupCache.size >= LOOKUP_CACHE_MAX) lookupCache.clear();
    lookupCache.set(host, result);
  }
  return result;
}

/** Merged generic tables across all loaded DBs (complete mode only). */
export async function genericTables(): Promise<CosmeticGeneric> {
  if (genericCache) return genericCache;
  const gen = generation;
  const all = await getDbs();
  const byId: Record<string, string[]> = {};
  const byClass: Record<string, string[]> = {};
  const complex = new Set<string>();
  for (const db of all) {
    const generic = db.generic;
    if (!generic) continue;
    for (const [token, selectors] of Object.entries(generic.byId ?? {})) {
      const target = (byId[token] ??= []);
      for (const selector of selectors) if (!target.includes(selector)) target.push(selector);
    }
    for (const [token, selectors] of Object.entries(generic.byClass ?? {})) {
      const target = (byClass[token] ??= []);
      for (const selector of selectors) if (!target.includes(selector)) target.push(selector);
    }
    for (const selector of generic.complex ?? []) complex.add(selector);
  }
  const tables: CosmeticGeneric = { byId, byClass, complex: [...complex] };
  if (gen === generation) genericCache = tables;
  return tables;
}

/** True when any loaded DB has something for this hostname. */
export async function hasAnyFor(hostname: string): Promise<boolean> {
  const result = await lookup(hostname);
  return result.selectors.length > 0 || result.styles.length > 0 || result.procedural.length > 0;
}

export function invalidate(): void {
  generation++;
  dbs = null;
  loading = null;
  genericCache = null;
  lookupCache.clear();
}

/** Test helper: also drop the per-list bundle cache. */
export function __resetForTests(): void {
  invalidate();
  listDbCache.clear();
}
