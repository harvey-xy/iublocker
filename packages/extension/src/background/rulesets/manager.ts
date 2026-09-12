/**
 * Static ruleset management. docs/RULESETS.md §2/§4, docs/ARCHITECTURE.md §6.
 *
 * `rulesets/manifest.json` ships inside the extension bundle and describes every list.
 * Storage (`lists`) holds the user's toggles; Chrome's enabled-ruleset set is reconciled
 * against it on install, on startup and on every toggle.
 */
import {
  DNR_LIMITS,
  type ListGroup,
  type RulesetListEntry,
  type RulesetManifest,
} from '@iublocker/shared';
import { log } from '../log';
import * as store from '../storage/store';

export const RULESET_MANIFEST_PATH = 'rulesets/manifest.json';

let manifestCache: RulesetManifest | null = null;
let manifestLoad: Promise<RulesetManifest> | null = null;

export function emptyRulesetManifest(): RulesetManifest {
  return {
    version: '0.0.0.0',
    builtAt: new Date(0).toISOString(),
    lists: [],
    budget: { staticRulesTotal: 0, staticRulesDefaultEnabled: 0, regexTotal: 0 },
    scriptletGroups: [],
  };
}

function isRulesetManifest(value: unknown): value is RulesetManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<RulesetManifest>;
  return typeof m.version === 'string' && Array.isArray(m.lists);
}

async function loadManifest(): Promise<RulesetManifest> {
  try {
    const res = await fetch(chrome.runtime.getURL(RULESET_MANIFEST_PATH));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    if (!isRulesetManifest(json)) throw new Error('malformed rulesets/manifest.json');
    manifestCache = {
      ...json,
      scriptletGroups: Array.isArray(json.scriptletGroups) ? json.scriptletGroups : [],
    };
  } catch (err) {
    log.error('could not load rulesets/manifest.json', err);
    manifestCache = emptyRulesetManifest();
  }
  return manifestCache;
}

export async function getManifest(): Promise<RulesetManifest> {
  if (manifestCache) return manifestCache;
  manifestLoad ??= loadManifest().finally(() => {
    manifestLoad = null;
  });
  return manifestLoad;
}

export function invalidate(): void {
  manifestCache = null;
  manifestLoad = null;
}

export async function getListEntry(listId: string): Promise<RulesetListEntry | undefined> {
  return (await getManifest()).lists.find((entry) => entry.id === listId);
}

/** Languages we consider for the first-run regional defaults. */
export function uiLanguages(): string[] {
  const langs: string[] = [];
  try {
    const ui = chrome.i18n?.getUILanguage?.();
    if (ui) langs.push(ui);
  } catch {
    /* not available in some test contexts */
  }
  const nav = (globalThis as { navigator?: { languages?: readonly string[]; language?: string } }).navigator;
  for (const lang of nav?.languages ?? []) langs.push(lang);
  if (nav?.language) langs.push(nav.language);
  return [...new Set(langs.map((l) => l.toLowerCase()))];
}

function languageMatches(listLangs: readonly string[] | undefined, languages: readonly string[]): boolean {
  if (!listLangs || listLangs.length === 0) return false;
  return listLangs.some((raw) => {
    const lang = raw.toLowerCase();
    return languages.some((have) => have === lang || have.split('-')[0] === lang.split('-')[0]);
  });
}

/** Whether a list should start enabled on a fresh profile. */
export function defaultEnabledFor(entry: RulesetListEntry, languages: readonly string[]): boolean {
  if (entry.defaultEnabled) return true;
  if ((entry.group as ListGroup) === 'regional') return languageMatches(entry.lang, languages);
  return false;
}

/** Storage toggles, filled in from the manifest for lists the user never touched. */
export async function getListStates(): Promise<Record<string, { enabled: boolean }>> {
  const [manifest, stored] = await Promise.all([getManifest(), store.get('lists')]);
  const languages = uiLanguages();
  const out: Record<string, { enabled: boolean }> = {};
  for (const entry of manifest.lists) {
    out[entry.id] = stored[entry.id] ?? { enabled: defaultEnabledFor(entry, languages) };
  }
  return out;
}

export async function enabledListIds(): Promise<string[]> {
  const states = await getListStates();
  return Object.entries(states)
    .filter(([, state]) => state.enabled)
    .map(([id]) => id);
}

/** Seed `lists` on first install (regional lists by UI language). */
export async function applyFirstRunDefaults(): Promise<Record<string, { enabled: boolean }>> {
  const [manifest, stored] = await Promise.all([getManifest(), store.get('lists')]);
  const languages = uiLanguages();
  if (!manifest.lists.some((entry) => !stored[entry.id])) return { ...stored };
  return store.update('lists', (current) => {
    const next = { ...current };
    for (const entry of manifest.lists) {
      if (next[entry.id]) continue;
      next[entry.id] = { enabled: defaultEnabledFor(entry, languages) };
    }
    return next;
  });
}

export interface Budget {
  used: number;
  available: number;
  total: number;
}

export async function getBudget(): Promise<Budget> {
  const [manifest, states] = await Promise.all([getManifest(), getListStates()]);
  let used = 0;
  for (const entry of manifest.lists) if (states[entry.id]?.enabled) used += entry.counts?.dnr ?? 0;
  let available = DNR_LIMITS.GLOBAL_STATIC_RULES - used;
  try {
    available = await chrome.declarativeNetRequest.getAvailableStaticRuleCount();
  } catch (err) {
    log.warn('getAvailableStaticRuleCount failed', err);
  }
  return { used, available, total: DNR_LIMITS.GLOBAL_STATIC_RULES };
}

/**
 * Ruleset ids the *extension* manifest declares, i.e. the only ids
 * `updateEnabledRulesets` accepts. `rulesets/manifest.json` can list more: the build drops
 * a list whose `dnr/<id>.json` was not produced from `declarative_net_request`
 * (scripts/build.ts) but copies the ruleset manifest verbatim. `null` = the manifest
 * declares none, so there is nothing to check against.
 */
function declaredRulesetIds(): Set<string> | null {
  try {
    const declared = (
      chrome.runtime.getManifest() as {
        declarative_net_request?: { rule_resources?: { id?: string }[] };
      }
    ).declarative_net_request?.rule_resources;
    if (!Array.isArray(declared) || declared.length === 0) return null;
    const ids = declared.map((entry) => entry?.id).filter((id): id is string => typeof id === 'string');
    return ids.length ? new Set(ids) : null;
  } catch {
    return null;
  }
}

/** Enable/disable one ruleset at a time so a single bad id cannot take the rest down. */
async function applyRulesetsOneByOne(enableIds: string[], disableIds: string[]): Promise<void> {
  // Disable first: that frees static rule budget the enables may need.
  for (const rulesetId of disableIds) {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: [rulesetId] });
    } catch (err) {
      log.warn(`could not disable ruleset ${rulesetId}`, err);
    }
  }
  for (const rulesetId of enableIds) {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [rulesetId] });
    } catch (err) {
      log.warn(`could not enable ruleset ${rulesetId}`, err);
    }
  }
}

/** Reconcile Chrome's enabled rulesets with storage. Returns the ids now enabled. */
export async function applyEnabledRulesets(): Promise<string[]> {
  const [manifest, states] = await Promise.all([getManifest(), getListStates()]);
  const known = new Set(manifest.lists.map((entry) => entry.id));
  const declared = declaredRulesetIds();
  const desired = new Set(
    manifest.lists
      .filter((entry) => states[entry.id]?.enabled)
      .filter((entry) => {
        if (!declared || declared.has(entry.id)) return true;
        log.warn(`list ${entry.id} has no ruleset in the extension manifest; not enabling it`);
        return false;
      })
      .map((entry) => entry.id),
  );
  if (desired.size > DNR_LIMITS.MAX_ENABLED_STATIC_RULESETS) {
    log.warn(`too many enabled rulesets (${desired.size}); Chrome allows ${DNR_LIMITS.MAX_ENABLED_STATIC_RULESETS}`);
  }
  let current: string[] = [];
  try {
    current = await chrome.declarativeNetRequest.getEnabledRulesets();
  } catch (err) {
    log.warn('getEnabledRulesets failed', err);
  }
  const enableRulesetIds = [...desired].filter((id) => !current.includes(id));
  const disableRulesetIds = current.filter((id) => known.has(id) && !desired.has(id));
  if (enableRulesetIds.length || disableRulesetIds.length) {
    try {
      await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
    } catch (err) {
      // The call is all-or-nothing: one unknown id or one list over the static budget would
      // otherwise leave *every* list in its previous state (on a fresh profile: no blocking
      // at all). Retry per ruleset so the healthy ones still land.
      log.error('updateEnabledRulesets failed; retrying one ruleset at a time', err);
      await applyRulesetsOneByOne(enableRulesetIds, disableRulesetIds);
      try {
        return await chrome.declarativeNetRequest.getEnabledRulesets();
      } catch {
        return [...desired];
      }
    }
    log.debug('rulesets enabled', enableRulesetIds, 'disabled', disableRulesetIds);
  }
  return [...desired];
}

export interface SetEnabledResult {
  enabled: boolean;
  budget: Budget;
}

export async function setListEnabled(listId: string, enabled: boolean): Promise<SetEnabledResult> {
  const entry = await getListEntry(listId);
  if (!entry) throw new Error(`unknown list: ${listId}`);
  const states = await getListStates();
  if (enabled) {
    const enabledCount = Object.values(states).filter((s) => s.enabled).length;
    if (!states[listId]?.enabled && enabledCount >= DNR_LIMITS.MAX_ENABLED_STATIC_RULESETS) {
      throw new Error(`cannot enable more than ${DNR_LIMITS.MAX_ENABLED_STATIC_RULESETS} lists`);
    }
    const budget = await getBudget();
    if ((entry.counts?.dnr ?? 0) > budget.available) {
      throw new Error(`not enough static rule budget for "${entry.title}" (needs ${entry.counts?.dnr}, ${budget.available} left)`);
    }
  }
  await store.update('lists', (stored) => ({ ...stored, [listId]: { enabled } }));
  await applyEnabledRulesets();
  await applyDisabledStaticRules();
  return { enabled, budget: await getBudget() };
}

/**
 * Apply the persisted differential update's `disabled` map through `updateStaticRules`.
 * Rule IDs disabled for a ruleset that is no longer listed are re-enabled.
 */
export async function applyDisabledStaticRules(): Promise<void> {
  const [delta, enabled] = await Promise.all([store.get('delta'), enabledListIds()]);
  const wanted = delta?.disabled ?? {};
  for (const listId of enabled) {
    const disableRuleIds = (wanted[listId] ?? []).slice(0, DNR_LIMITS.MAX_DISABLED_STATIC_RULES_PER_RULESET);
    let currentlyDisabled: number[] = [];
    try {
      // Chrome 111+; not in @types/chrome 0.0.290 yet.
      const dnr = chrome.declarativeNetRequest as unknown as {
        getDisabledRuleIds?: (options: { rulesetId: string }) => Promise<number[]>;
      };
      if (typeof dnr.getDisabledRuleIds === 'function') currentlyDisabled = await dnr.getDisabledRuleIds({ rulesetId: listId });
    } catch {
      currentlyDisabled = [];
    }
    const wantedSet = new Set(disableRuleIds);
    const toDisable = disableRuleIds.filter((id) => !currentlyDisabled.includes(id));
    const toEnable = currentlyDisabled.filter((id) => !wantedSet.has(id));
    if (!toDisable.length && !toEnable.length) continue;
    try {
      await chrome.declarativeNetRequest.updateStaticRules({
        rulesetId: listId,
        ...(toDisable.length ? { disableRuleIds: toDisable } : {}),
        ...(toEnable.length ? { enableRuleIds: toEnable } : {}),
      });
    } catch (err) {
      log.warn(`updateStaticRules failed for ${listId}`, err);
    }
  }
}

/** Per-list file paths inside the bundle. */
export function listFileUrl(entry: RulesetListEntry, kind: 'cosmetic' | 'scriptlets' | 'dnr'): string {
  const file = entry.files?.[kind] ?? `${kind}/${entry.id}.json`;
  const path = file.startsWith('rulesets/') ? file : `rulesets/${file.replace(/^\/+/, '')}`;
  return chrome.runtime.getURL(path);
}
