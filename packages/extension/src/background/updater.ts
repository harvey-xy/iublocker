/**
 * Differential list updates. docs/ARCHITECTURE.md §7, docs/RULESETS.md §6.
 *
 * An alarm (`iub-update`, every `settings.updateIntervalHours`) fetches
 * `<cloudDeltaBaseUrl>/delta/<extension version>.json` with an ETag, validates it, and
 * applies it atomically:
 *   dnr.add     → dynamic rules in ID_RANGE.DELTA (rewritten as a whole)
 *   dnr.disable → `updateStaticRules` per list (≤ 5,000 ids)
 *   cosmetic/scriptlets → merged into `storage.delta` and the in-memory indexes
 * Any failure rolls the dynamic range back and leaves the previously applied delta intact.
 */
import {
  BUILD_BUDGET,
  DNR_LIMITS,
  type AppliedDelta,
  type CosmeticDB,
  type DNRRule,
  type DeltaFile,
  type ScriptletCall,
  type ScriptletDB,
} from '@iublocker/shared';
import * as cosmeticIndex from './cosmetic/index';
import { errorMessage, log } from './log';
import { broadcast } from './messaging/broadcast';
import * as manager from './rulesets/manager';
import { RANGES, getRulesInRange, rewriteRange } from './rulesets/dynamic';
import * as registrar from './scriptlets/registrar';
import * as scriptletIndex from './scriptlets/index';
import { getSettings } from './settings';
import * as store from './storage/store';

export const ALARM_NAME = 'iub-update';

let running: Promise<UpdateResult> | null = null;

export interface UpdateResult {
  ok: boolean;
  version?: string;
  error?: string;
  skipped?: 'disabled' | 'unchanged' | 'not-modified' | 'base-mismatch' | 'no-delta';
}

/* ------------------------------------------------------------------ scheduling -- */

export async function scheduleAlarm(): Promise<void> {
  const settings = await getSettings();
  if (!settings.autoUpdate) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  const periodInMinutes = Math.max(60, Math.round(settings.updateIntervalHours * 60));
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing && existing.periodInMinutes === periodInMinutes) return;
  chrome.alarms.create(ALARM_NAME, { periodInMinutes, delayInMinutes: Math.min(periodInMinutes, 5) });
  log.debug(`update alarm every ${periodInMinutes} min`);
}

export function onAlarm(alarm: chrome.alarms.Alarm): void {
  if (alarm.name !== ALARM_NAME) return;
  void runUpdate().catch((err) => log.error('scheduled update failed', err));
}

/* ------------------------------------------------------------------ validation -- */

function isRecordOfNumberArrays(value: unknown): value is Record<string, number[]> {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).every(
    (v) => Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isInteger(n)),
  );
}

/** A rule we are willing to install from a remote delta. */
export function isSafeDeltaRule(rule: unknown): rule is DNRRule {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Partial<DNRRule>;
  if (!r.action || typeof r.action.type !== 'string') return false;
  if (!r.condition || typeof r.condition !== 'object') return false;
  if (r.action.type === 'redirect') {
    const redirect = r.action.redirect;
    // List data may only redirect to a bundled resource (docs/RULESETS.md §6). `url`,
    // `regexSubstitution` and `transform` can all point a request at an arbitrary remote
    // origin, so an `extensionPath` is the only accepted form.
    if (!redirect || typeof redirect.extensionPath !== 'string') return false;
    if (!redirect.extensionPath.startsWith('/')) return false;
    if (
      redirect.url !== undefined ||
      redirect.regexSubstitution !== undefined ||
      redirect.transform !== undefined
    ) {
      return false;
    }
  }
  return true;
}

export function isDeltaFile(value: unknown): value is DeltaFile {
  if (!value || typeof value !== 'object') return false;
  const d = value as Partial<DeltaFile>;
  if (typeof d.base !== 'string' || typeof d.version !== 'string') return false;
  if (!d.dnr || typeof d.dnr !== 'object') return false;
  if (!Array.isArray(d.dnr.add)) return false;
  if (!isRecordOfNumberArrays(d.dnr.disable ?? {})) return false;
  if (d.cosmetic && typeof d.cosmetic !== 'object') return false;
  if (d.scriptlets && typeof d.scriptlets !== 'object') return false;
  return true;
}

/* --------------------------------------------------------------------- merging -- */

function emptyCosmetic(listId: string): CosmeticDB {
  return {
    version: 1,
    listId,
    generic: { byId: {}, byClass: {}, complex: [] },
    specific: {},
    styles: {},
    procedural: {},
    exceptions: { selectors: {}, elemhide: [], generichide: [], specifichide: [] },
  };
}

/**
 * Removals carried by a delta are folded into the stored DB's exception sets: the
 * `AppliedDelta` shape only has room for an additive DB, and `lookupCosmetic()` already
 * subtracts `exceptions.selectors` during the hostname walk.
 */
export function foldCosmeticRemovals(db: CosmeticDB, removeSpecific: Record<string, string[]>): CosmeticDB {
  const selectors: Record<string, string[]> = { ...(db.exceptions?.selectors ?? {}) };
  for (const [host, list] of Object.entries(removeSpecific ?? {})) {
    if (!Array.isArray(list)) continue;
    selectors[host] = [...new Set([...(selectors[host] ?? []), ...list])];
  }
  return { ...db, exceptions: { ...db.exceptions, selectors } };
}

export function foldScriptletRemovals(db: ScriptletDB, remove: Record<string, ScriptletCall[]>): ScriptletDB {
  const exceptions: Record<string, string[]> = { ...(db.exceptions ?? {}) };
  for (const [host, calls] of Object.entries(remove ?? {})) {
    if (!Array.isArray(calls)) continue;
    const names = calls.map((call) => call?.name).filter((name): name is string => typeof name === 'string');
    exceptions[host] = [...new Set([...(exceptions[host] ?? []), ...names])];
  }
  return { ...db, exceptions };
}

/* ------------------------------------------------------------------ the update -- */

export function deltaUrl(baseUrl: string, version: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/delta/${version}.json`;
}

async function fetchDelta(url: string, etag: string | undefined, noStore: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (etag && !noStore) headers['If-None-Match'] = etag;
  return fetch(url, {
    headers,
    cache: noStore ? 'no-store' : 'default',
    credentials: 'omit',
    redirect: 'follow',
  });
}

async function applyDelta(file: DeltaFile): Promise<void> {
  const previousRules = await getRulesInRange(RANGES.delta);
  const previousDelta = await store.get('delta');

  const rules = file.dnr.add.filter(isSafeDeltaRule).slice(0, BUILD_BUDGET.DELTA_DYNAMIC_RULES);
  try {
    await rewriteRange(RANGES.delta, rules, { maxRules: BUILD_BUDGET.DELTA_DYNAMIC_RULES });

    const disabled: Record<string, number[]> = {};
    for (const [listId, ids] of Object.entries(file.dnr.disable ?? {})) {
      disabled[listId] = ids.slice(0, DNR_LIMITS.MAX_DISABLED_STATIC_RULES_PER_RULESET);
    }

    const cosmeticAdd = (file.cosmetic?.add as CosmeticDB | undefined) ?? emptyCosmetic('delta');
    const scriptletAdd =
      (file.scriptlets?.add as ScriptletDB | undefined) ??
      ({ version: 1, listId: 'delta', byHost: {}, exceptions: {} } as ScriptletDB);

    const applied: AppliedDelta = {
      base: file.base,
      version: file.version,
      appliedAt: Date.now(),
      cosmetic: foldCosmeticRemovals(
        { ...cosmeticAdd, listId: 'delta' },
        file.cosmetic?.removeSpecific ?? {},
      ),
      scriptlets: foldScriptletRemovals({ ...scriptletAdd, listId: 'delta' }, file.scriptlets?.remove ?? {}),
      disabled,
    };
    await store.set({ delta: applied });
    await manager.applyDisabledStaticRules();
  } catch (err) {
    log.error('delta apply failed; rolling back', err);
    try {
      await rewriteRange(RANGES.delta, previousRules);
      await store.set({ delta: previousDelta });
      await manager.applyDisabledStaticRules();
    } catch (rollbackErr) {
      log.error('delta rollback failed', rollbackErr);
    }
    throw err;
  }

  cosmeticIndex.invalidate();
  scriptletIndex.invalidate();
  await registrar.reconcile();
}

async function doUpdate(force: boolean): Promise<UpdateResult> {
  const settings = await getSettings();
  const now = Date.now();
  if (!settings.autoUpdate && !force) return { ok: true, skipped: 'disabled' };

  const state = await store.get('updater');
  await store.set({ updater: { ...state, lastCheck: now } });

  const version = chrome.runtime.getManifest().version;
  const url = deltaUrl(settings.cloudDeltaBaseUrl, version);
  const noStore = settings.updateChannel === 'nightly';

  try {
    // `cloudDeltaBaseUrl` is user-overridable for self-hosting (docs/STORAGE.md); a value
    // that predates the https check in `sanitiseSettings` must not be fetched in the clear.
    if (!url.startsWith('https://')) throw new Error(`insecure delta URL: ${url}`);
    const res = await fetchDelta(url, state.etag, noStore);
    if (typeof res.url === 'string' && res.url !== '' && !res.url.startsWith('https://')) {
      throw new Error(`delta redirected to an insecure URL: ${res.url}`);
    }
    if (res.status === 304) {
      await store.set({ updater: { ...state, lastCheck: now, lastSuccess: now, lastError: undefined } });
      return { ok: true, skipped: 'not-modified' };
    }
    if (res.status === 404) {
      await store.set({ updater: { ...state, lastCheck: now, lastError: undefined } });
      return { ok: true, skipped: 'no-delta' };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const etag = res.headers?.get?.('etag') ?? undefined;
    const json: unknown = await res.json();
    if (!isDeltaFile(json)) throw new Error('malformed delta file');

    const manifest = await manager.getManifest();
    if (json.base !== manifest.version) {
      log.warn(`discarding delta for base ${json.base}; shipped rulesets are ${manifest.version}`);
      await store.set({
        updater: { ...state, lastCheck: now, lastError: `delta base ${json.base} ≠ ${manifest.version}` },
      });
      return { ok: false, skipped: 'base-mismatch', error: 'delta base mismatch' };
    }

    const current = await store.get('delta');
    if (!force && current && current.version === json.version) {
      await store.set({
        updater: { ...state, lastCheck: now, lastSuccess: now, etag, lastError: undefined },
      });
      return { ok: true, version: json.version, skipped: 'unchanged' };
    }

    await applyDelta(json);
    await store.set({ updater: { lastCheck: now, lastSuccess: Date.now(), etag, lastError: undefined } });
    log.info(`applied delta ${json.version}`);
    broadcast({ type: 'event:listsUpdated', version: json.version, ok: true });
    return { ok: true, version: json.version };
  } catch (err) {
    const error = errorMessage(err);
    await store.set({ updater: { ...state, lastCheck: now, lastError: error } });
    log.error('list update failed', error);
    broadcast({ type: 'event:listsUpdated', version: '', ok: false, error });
    return { ok: false, error };
  }
}

/** Run an update; concurrent callers share the in-flight run. */
export function runUpdate(options: { force?: boolean } = {}): Promise<UpdateResult> {
  if (running) return running;
  running = doUpdate(options.force === true).finally(() => {
    running = null;
  });
  return running;
}

export function isRunning(): boolean {
  return running !== null;
}

export function __resetForTests(): void {
  running = null;
}
