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

type ChangeListener<K extends StoreKey> = (value: LocalStorageSchema[K], previous: LocalStorageSchema[K]) => void;
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
  if (Object.keys(changed).length === 0) return;
  // Persist first: a failed write must not leave the cache ahead of storage.
  await chrome.storage.local.set(changed);
  for (const key of Object.keys(changed) as StoreKey[]) {
    (data as unknown as Record<string, unknown>)[key] = changed[key];
  }
  for (const key of Object.keys(changed) as StoreKey[]) {
    notify(key, data[key], previous[key] as LocalStorageSchema[StoreKey]);
  }
}

/** Read-modify-write a single key. */
export async function update<K extends StoreKey>(
  key: K,
  fn: (current: LocalStorageSchema[K]) => LocalStorageSchema[K],
): Promise<LocalStorageSchema[K]> {
  const current = await get(key);
  const next = fn(current);
  await set({ [key]: next } as Partial<LocalStorageSchema>);
  return next;
}

function notify<K extends StoreKey>(key: K, value: LocalStorageSchema[K], previous: LocalStorageSchema[K]): void {
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

export const session = {
  async getTab(tabId: number): Promise<TabSessionState | null> {
    const key = tabSessionKey(tabId);
    const got = (await chrome.storage.session.get(key)) as Record<string, TabSessionState | undefined>;
    return got[key] ?? null;
  },
  async setTab(tabId: number, state: TabSessionState): Promise<void> {
    await chrome.storage.session.set({ [tabSessionKey(tabId)]: state });
  },
  async patchTab(tabId: number, patch: Partial<TabSessionState>): Promise<TabSessionState> {
    const current = (await session.getTab(tabId)) ?? { hostname: '', blocked: 0, lastUrl: '' };
    const next = { ...current, ...patch };
    await session.setTab(tabId, next);
    return next;
  },
  async dropTab(tabId: number): Promise<void> {
    await chrome.storage.session.remove([tabSessionKey(tabId), pickerActiveKey(tabId)]);
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
};

/** Test helper: drop all module-level state. */
export function __resetForTests(): void {
  cache = null;
  hydration = null;
  listeners.clear();
}
