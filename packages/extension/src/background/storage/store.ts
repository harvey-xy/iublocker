/**
 * Typed access layer over `chrome.storage`. docs/STORAGE.md "Access layer".
 *
 * The service worker restarts constantly: the first access after a start hydrates an
 * in-memory cache with a single `storage.local.get(null)` call. No other module is
 * allowed to touch `chrome.storage` directly (except `migrations.ts`, through `raw`).
 */
import {
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  pickerActiveKey,
  tabSessionKey,
  type LocalStorageSchema,
  type Settings,
  type TabSessionState,
} from '@iublocker/shared';
import { log } from '../log';

export type StoreKey = keyof LocalStorageSchema;

/** Fresh defaults; never share sub-objects between calls. */
export function defaults(): LocalStorageSchema {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced } },
    siteModes: {},
    lists: {},
    userFiltersText: '',
    userCompiled: null,
    delta: null,
    updater: { lastCheck: 0, lastSuccess: 0 },
    stats: { since: Date.now(), blockedTotal: 0, perDay: {} },
    pickerDrafts: {},
  };
}

function mergeSettings(stored: unknown): Settings {
  const base: Settings = { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced } };
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<Settings>;
  const advanced = { ...base.advanced, ...(s.advanced ?? {}) };
  return { ...base, ...s, advanced };
}

let cache: LocalStorageSchema | null = null;
let hydration: Promise<LocalStorageSchema> | null = null;
/**
 * Keys this module is writing right now. `storage.onChanged` also fires for our own
 * writes; those are already reflected in the cache, so they are swallowed once.
 */
const selfWrites = new Map<StoreKey, number>();

function markSelfWrite(key: StoreKey, delta: number): void {
  const next = (selfWrites.get(key) ?? 0) + delta;
  if (next > 0) selfWrites.set(key, next);
  else selfWrites.delete(key);
}

type ChangeListener<K extends StoreKey> = (
  value: LocalStorageSchema[K],
  previous: LocalStorageSchema[K],
) => void;
const listeners = new Map<StoreKey, Set<ChangeListener<StoreKey>>>();

async function hydrate(): Promise<LocalStorageSchema> {
  const stored = (await chrome.storage.local.get(null)) as Partial<LocalStorageSchema>;
  const next = defaults();
  for (const key of Object.keys(next) as StoreKey[]) {
    if (!(key in stored)) continue;
    const value = stored[key];
    if (value === undefined) continue;
    if (key === 'settings') next.settings = mergeSettings(value);
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  cache = next;
  return next;
}

/** Hydrate the cache once per worker start. Safe to call concurrently. */
export async function ready(): Promise<LocalStorageSchema> {
  if (cache) return cache;
  hydration ??= hydrate().finally(() => {
    hydration = null;
  });
  return hydration;
}

export async function get<K extends StoreKey>(key: K): Promise<LocalStorageSchema[K]> {
  const data = await ready();
  return data[key];
}

export async function getAll(): Promise<LocalStorageSchema> {
  return { ...(await ready()) };
}

/** Synchronous read; `undefined` when the cache is not hydrated yet. */
export function peek<K extends StoreKey>(key: K): LocalStorageSchema[K] | undefined {
  return cache ? cache[key] : undefined;
}

export async function set(patch: Partial<LocalStorageSchema>): Promise<void> {
  const data = await ready();
  const changed: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as StoreKey[]) {
    const value = patch[key];
    if (value === undefined) continue;
    previous[key] = data[key];
    changed[key] = value;
  }
  const keys = Object.keys(changed) as StoreKey[];
  if (keys.length === 0) return;
  for (const key of keys) markSelfWrite(key, 1);
  try {
    // Persist first: a failed write must not leave the cache ahead of storage.
    await chrome.storage.local.set(changed);
  } catch (err) {
    for (const key of keys) markSelfWrite(key, -1);
    throw err;
  }
  for (const key of Object.keys(changed) as StoreKey[]) {
    (data as unknown as Record<string, unknown>)[key] = changed[key];
  }
  for (const key of Object.keys(changed) as StoreKey[]) {
    notify(key, data[key], previous[key] as LocalStorageSchema[StoreKey]);
  }
}

/**
 * Serialises the read-modify-write chain per key. Two `update()` calls that overlap would
 * otherwise both read the pre-write value and the second write would silently drop the
 * first one (blocked counters from two tabs finishing at once, two site-mode toggles…).
 */
const updateQueues = new Map<StoreKey, Promise<unknown>>();

/** Read-modify-write a single key. Concurrent updates of the same key are serialised. */
export function update<K extends StoreKey>(
  key: K,
  fn: (current: LocalStorageSchema[K]) => LocalStorageSchema[K],
): Promise<LocalStorageSchema[K]> {
  const run = async (): Promise<LocalStorageSchema[K]> => {
    const current = await get(key);
    const next = fn(current);
    // Returning the value it was given is how an updater says "nothing to write".
    if (next === current) return current;
    await set({ [key]: next } as Partial<LocalStorageSchema>);
    return next;
  };
  const previous = updateQueues.get(key) ?? Promise.resolve();
  const result = previous.then(run, run);
  // A rejected update must not break the chain for the next caller.
  updateQueues.set(
    key,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

function notify<K extends StoreKey>(
  key: K,
  value: LocalStorageSchema[K],
  previous: LocalStorageSchema[K],
): void {
  const set_ = listeners.get(key);
  if (!set_) return;
  for (const cb of [...set_]) {
    try {
      (cb as ChangeListener<K>)(value, previous);
    } catch (err) {
      log.error('store.onChange listener threw', err);
    }
  }
}

export function onChange<K extends StoreKey>(key: K, cb: ChangeListener<K>): () => void {
  let set_ = listeners.get(key);
  if (!set_) {
    set_ = new Set();
    listeners.set(key, set_);
  }
  set_.add(cb as ChangeListener<StoreKey>);
  return () => set_?.delete(cb as ChangeListener<StoreKey>);
}

/**
 * Registered from the entry point: keeps the cache coherent when another extension
 * context (or a `raw` write) changes `storage.local`.
 */
export function handleStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): void {
  if (areaName !== 'local' || !cache) return;
  for (const [key, change] of Object.entries(changes)) {
    if (!(key in cache)) continue;
    const k = key as StoreKey;
    if ((selfWrites.get(k) ?? 0) > 0) {
      markSelfWrite(k, -1);
      continue;
    }
    const previous = cache[k];
    const value = change.newValue === undefined ? defaults()[k] : change.newValue;
    if (value === previous) continue;
    (cache as unknown as Record<string, unknown>)[k] = k === 'settings' ? mergeSettings(value) : value;
    notify(k, cache[k], previous);
  }
}

/** Escape hatch for `migrations.ts` only. */
export const raw = {
  async getAll(): Promise<Record<string, unknown>> {
    return (await chrome.storage.local.get(null)) as Record<string, unknown>;
  },
  async set(patch: Record<string, unknown>): Promise<void> {
    await chrome.storage.local.set(patch);
  },
  async remove(keys: string[]): Promise<void> {
    if (keys.length) await chrome.storage.local.remove(keys);
  },
  invalidate(): void {
    cache = null;
    hydration = null;
  },
};

/* ------------------------------------------------------------------ session ---- */

/**
 * Timestamps of the `declarativeNetRequest.getMatchedRules()` calls we already spent.
 * Chrome's quota lives in the browser process and survives worker restarts, so the log
 * has to live in session storage rather than in worker memory (see `stats.ts`).
 */
const MATCHED_RULE_CALLS_KEY = 'dnrGetMatchedRulesCalls';

/**
 * Per-tab serialisation of the session read-modify-writes. `patchTab` is called from the
 * injector (main-frame commit) and from the stats refresh at the same time; unserialised,
 * one of them reads the pre-write record and writes a mix of old and new fields back — a
 * stale `hostname` there makes every sub-frame of the new page resolve the *previous*
 * page's site mode. Keeping `dropTab` in the same queue also stops a late patch from
 * resurrecting a closed tab's record.
 */
const tabWrites = new Map<number, Promise<unknown>>();

function withTabLock<T>(tabId: number, run: () => Promise<T>): Promise<T> {
  const previous = tabWrites.get(tabId) ?? Promise.resolve();
  const result = previous.then(run, run);
  tabWrites.set(
    tabId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}

export const session = {
  async getTab(tabId: number): Promise<TabSessionState | null> {
    const key = tabSessionKey(tabId);
    const got = (await chrome.storage.session.get(key)) as Record<string, TabSessionState | undefined>;
    return got[key] ?? null;
  },
  async setTab(tabId: number, state: TabSessionState): Promise<void> {
    await chrome.storage.session.set({ [tabSessionKey(tabId)]: state });
  },
  patchTab(tabId: number, patch: Partial<TabSessionState>): Promise<TabSessionState> {
    return withTabLock(tabId, async () => {
      const current = (await session.getTab(tabId)) ?? { hostname: '', blocked: 0, lastUrl: '' };
      const next = { ...current, ...patch };
      await session.setTab(tabId, next);
      return next;
    });
  },
  dropTab(tabId: number): Promise<void> {
    return withTabLock(tabId, async () => {
      await chrome.storage.session.remove([tabSessionKey(tabId), pickerActiveKey(tabId)]);
      tabWrites.delete(tabId);
    });
  },
  async setPickerActive(tabId: number, active: boolean): Promise<void> {
    const key = pickerActiveKey(tabId);
    if (active) await chrome.storage.session.set({ [key]: true });
    else await chrome.storage.session.remove(key);
  },
  async isPickerActive(tabId: number): Promise<boolean> {
    const key = pickerActiveKey(tabId);
    const got = (await chrome.storage.session.get(key)) as Record<string, boolean | undefined>;
    return got[key] === true;
  },
  async getMatchedRuleCalls(): Promise<number[]> {
    const got = (await chrome.storage.session.get(MATCHED_RULE_CALLS_KEY)) as Record<string, unknown>;
    const value = got[MATCHED_RULE_CALLS_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  },
  async setMatchedRuleCalls(times: readonly number[]): Promise<void> {
    await chrome.storage.session.set({ [MATCHED_RULE_CALLS_KEY]: [...times] });
  },
};

/** Test helper: drop all module-level state. */
export function __resetForTests(): void {
  cache = null;
  hydration = null;
  listeners.clear();
  selfWrites.clear();
  updateQueues.clear();
  tabWrites.clear();
}
