/**
 * Stats and badge. docs/ARCHITECTURE.md §4.5.
 *
 * `declarativeNetRequest.getMatchedRules()` is quota-limited by Chrome:
 * `MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL` (20) calls per `GETMATCHEDRULES_QUOTA_INTERVAL`
 * (10 minutes) into a single bucket for the whole extension, and only calls made with a
 * user gesture are exempt — a service worker never has one. Refreshing once per page load
 * therefore burns the quota within the first minute of browsing and every later call fails,
 * so the counters are fed as follows:
 *
 *   - unpacked installs receive `onRuleMatchedDebug` and count every match for free; as
 *     soon as one event arrives we never call `getMatchedRules` again;
 *   - otherwise a call is spent at most once every `BACKGROUND_REFRESH_SPACING_MS` for
 *     background (tab finished loading) refreshes, and `RESERVED_FORCED_CALLS` of every
 *     interval are kept for refreshes the user is waiting for (popup, logger);
 *   - when the quota is spent the last known count is kept (rehydrated from
 *     `storage.session` after a worker restart) instead of resetting the badge to zero.
 *
 * The spent-call log lives in `storage.session` because Chrome's bucket outlives the
 * worker (docs/STORAGE.md).
 */
import type { MatchedRuleSummary, Stats } from '@iublocker/shared';
import { errorMessage, log } from './log';
import { getSettings } from './settings';
import * as store from './storage/store';

export const BADGE_THROTTLE_MS = 1_000;
/** Chrome's `declarativeNetRequest.MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL`. */
export const MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL = 20;
/** Chrome's `declarativeNetRequest.GETMATCHEDRULES_QUOTA_INTERVAL` (10 minutes). */
export const GETMATCHEDRULES_QUOTA_INTERVAL_MS = 10 * 60 * 1_000;
/** Calls held back in every interval for popup/logger refreshes. */
export const RESERVED_FORCED_CALLS = 8;
/** Minimum spacing between two background refreshes (fits the non-reserved calls). */
export const BACKGROUND_REFRESH_SPACING_MS = Math.ceil(
  GETMATCHEDRULES_QUOTA_INTERVAL_MS / (MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL - RESERVED_FORCED_CALLS),
);
/** The popup asks twice (`tab:getState` + `stats:get`); that must cost one call. */
export const FORCED_COALESCE_MS = 2_000;

const MAX_MATCHED_PER_TAB = 500;
const MAX_BLOCKED_URLS_PER_TAB = 500;
const MAX_DAYS_KEPT = 90;
const BADGE_COLOR = '#3a6ea5';

interface TabCounters {
  /** Matched-rule count for the document currently loaded in this tab. */
  count: number;
  /** How much of `count` is already folded into the daily totals. */
  reported: number;
  lastRefresh: number;
  lastForced: number;
  /** Page-load timestamp, used to scope getMatchedRules to the current document. */
  since: number;
}

const counters = new Map<number, TabCounters>();
const blockedUrls = new Map<number, string[]>();
const matchedByTab = new Map<number, MatchedRuleSummary[]>();
const inFlight = new Map<number, Promise<number>>();

/** True once `onRuleMatchedDebug` has fired: an unpacked install, no quota needed. */
let debugFeed = false;
/** Timestamps of the `getMatchedRules` calls spent in the current quota interval. */
let quotaCalls: number[] = [];
let quotaReady: Promise<void> | null = null;

export function dayKey(when: number = Date.now()): string {
  return new Date(when).toISOString().slice(0, 10);
}

function counterFor(tabId: number): TabCounters {
  let counter = counters.get(tabId);
  if (!counter) {
    counter = { count: 0, reported: 0, lastRefresh: 0, lastForced: 0, since: 0 };
    counters.set(tabId, counter);
  }
  return counter;
}

/** Fire-and-forget badge clear; the tab may be gone already. */
function clearBadge(tabId: number): void {
  try {
    const pending = chrome.action.setBadgeText({ tabId, text: '' }) as unknown as
      | Promise<void>
      | undefined;
    if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
  } catch {
    /* the tab closed between the commit and this call */
  }
}

/** Called when a main frame commits: the tab starts counting from zero again. */
export function resetTab(tabId: number, when: number = Date.now()): void {
  counters.set(tabId, { count: 0, reported: 0, lastRefresh: 0, lastForced: 0, since: when });
  blockedUrls.delete(tabId);
  matchedByTab.delete(tabId);
  // The next refresh may be several seconds away (quota), so drop the previous document's
  // count instead of showing it for the new page.
  clearBadge(tabId);
}

export function forgetTab(tabId: number): void {
  counters.delete(tabId);
  blockedUrls.delete(tabId);
  matchedByTab.delete(tabId);
  inFlight.delete(tabId);
}

async function addToTotals(delta: number): Promise<void> {
  if (delta <= 0) return;
  await store.update('stats', (stats: Stats) => {
    const key = dayKey();
    const perDay = { ...stats.perDay, [key]: (stats.perDay[key] ?? 0) + delta };
    const days = Object.keys(perDay).sort();
    for (const day of days.slice(0, Math.max(0, days.length - MAX_DAYS_KEPT))) delete perDay[day];
    return { ...stats, blockedTotal: stats.blockedTotal + delta, perDay };
  });
}

async function setBadge(tabId: number, count: number): Promise<void> {
  const settings = await getSettings();
  const text = settings.showBadgeCount && count > 0 ? (count > 999 ? '999+' : String(count)) : '';
  try {
    await chrome.action.setBadgeText({ tabId, text });
    if (text) await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR });
  } catch (err) {
    log.debug('setBadgeText failed', errorMessage(err));
  }
}

/** Hydrate the spent-call log once per worker start; Chrome's bucket outlives us. */
async function readyQuota(): Promise<void> {
  quotaReady ??= (async () => {
    const stored = await store.session.getMatchedRuleCalls();
    quotaCalls = [...new Set([...stored, ...quotaCalls])].sort((a, b) => a - b);
  })().catch((err) => {
    log.debug('could not read the getMatchedRules call log', errorMessage(err));
  });
  return quotaReady;
}

/**
 * Reserve one `getMatchedRules` call. `false` means "do not call it": either the interval's
 * budget is gone or a background refresh came too soon after the previous call.
 */
async function takeQuotaSlot(now: number, force: boolean): Promise<boolean> {
  await readyQuota();
  const cutoff = now - GETMATCHEDRULES_QUOTA_INTERVAL_MS;
  quotaCalls = quotaCalls.filter((when) => when > cutoff);
  const budget = force
    ? MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL
    : MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL - RESERVED_FORCED_CALLS;
  if (quotaCalls.length >= budget) return false;
  if (!force) {
    const last = quotaCalls.length ? Math.max(...quotaCalls) : Number.NEGATIVE_INFINITY;
    if (now - last < BACKGROUND_REFRESH_SPACING_MS) return false;
  }
  quotaCalls.push(now);
  void store.session
    .setMatchedRuleCalls(quotaCalls)
    .catch((err) => log.debug('could not persist the getMatchedRules call log', errorMessage(err)));
  return true;
}

/** Test/debug helper: how many calls are left in the current interval. */
export function quotaRemaining(now: number = Date.now()): number {
  const cutoff = now - GETMATCHEDRULES_QUOTA_INTERVAL_MS;
  return Math.max(
    0,
    MAX_GETMATCHEDRULES_CALLS_PER_INTERVAL - quotaCalls.filter((when) => when > cutoff).length,
  );
}

/** Keep the badge on the last count we know instead of clearing it. */
async function keepLastKnown(tabId: number, counter: TabCounters): Promise<number> {
  let known = counter.count;
  if (known === 0) {
    const session = await store.session.getTab(tabId);
    known = session?.blocked ?? 0;
    // Those matches were already added to the totals before the worker restarted.
    if (known > counter.reported) counter.reported = known;
  }
  counter.count = known;
  await setBadge(tabId, known);
  return known;
}

async function doRefresh(tabId: number, now: number, force: boolean): Promise<number> {
  const counter = counterFor(tabId);
  counter.lastRefresh = now;
  if (force) counter.lastForced = now;

  if (!debugFeed) {
    if (!(await takeQuotaSlot(now, force))) {
      log.debug(`getMatchedRules quota spent; keeping the last count for tab ${tabId}`);
      return keepLastKnown(tabId, counter);
    }
    let matched: chrome.declarativeNetRequest.MatchedRuleInfo[] = [];
    try {
      const filter: chrome.declarativeNetRequest.MatchedRulesFilter = { tabId };
      if (counter.since > 0) filter.minTimeStamp = counter.since;
      const result = await chrome.declarativeNetRequest.getMatchedRules(filter);
      matched = result?.rulesMatchedInfo ?? [];
    } catch (err) {
      log.debug('getMatchedRules failed', errorMessage(err));
      return counter.count;
    }
    const summaries: MatchedRuleSummary[] = matched.map((info) => ({
      ruleId: info.rule.ruleId,
      rulesetId: info.rule.rulesetId,
      time: info.timeStamp,
    }));
    matchedByTab.set(tabId, summaries.slice(-MAX_MATCHED_PER_TAB));
    counter.count = matched.length;
  }

  const count = counter.count;
  const delta = count - counter.reported;
  if (delta > 0) {
    counter.reported = count;
    await addToTotals(delta);
  }
  await store.session.patchTab(tabId, {
    blocked: count,
    matched: (matchedByTab.get(tabId) ?? []).slice(-50),
  });
  await setBadge(tabId, count);
  return count;
}

/**
 * Refresh the badge for a tab. Background refreshes are throttled per tab *and* spaced
 * globally so the `getMatchedRules` quota survives a browsing session; `force` (popup,
 * logger) may use the reserved calls but is coalesced over `FORCED_COALESCE_MS`.
 */
export async function refreshBadge(
  tabId: number,
  options: { force?: boolean; now?: number } = {},
): Promise<number> {
  if (tabId < 0) return 0;
  const now = options.now ?? Date.now();
  const force = options.force === true;
  const counter = counterFor(tabId);
  const pending = inFlight.get(tabId);
  if (pending) return pending;
  if (force) {
    if (now - counter.lastForced < FORCED_COALESCE_MS) return counter.count;
  } else if (now - counter.lastRefresh < BADGE_THROTTLE_MS) {
    return counter.count;
  }
  const promise = doRefresh(tabId, now, force).finally(() => inFlight.delete(tabId));
  inFlight.set(tabId, promise);
  return promise;
}

export async function getTabBlocked(tabId: number): Promise<number> {
  const cached = counters.get(tabId);
  if (cached) return cached.count;
  const session = await store.session.getTab(tabId);
  return session?.blocked ?? 0;
}

export async function getMatchedForTab(tabId: number): Promise<MatchedRuleSummary[]> {
  await refreshBadge(tabId, { force: true });
  const cached = matchedByTab.get(tabId);
  if (cached && cached.length) return cached;
  const session = await store.session.getTab(tabId);
  return session?.matched ?? [];
}

/**
 * `declarativeNetRequest.onRuleMatchedDebug` only fires for unpacked installs, but when it
 * does it is both the only source of blocked request URLs (the collapse hint the content
 * script asks for through `blocked:getForTab`) and a quota-free match counter: once we have
 * seen one event, the badge is fed from here and `getMatchedRules` is never called again.
 */
export function noteMatchedRule(info: chrome.declarativeNetRequest.MatchedRuleInfoDebug): void {
  debugFeed = true;
  const tabId = info.request?.tabId ?? -1;
  const url = info.request?.url;
  if (tabId < 0) return;
  if (url) {
    const list = blockedUrls.get(tabId) ?? [];
    if (list.length >= MAX_BLOCKED_URLS_PER_TAB) list.shift();
    list.push(url);
    blockedUrls.set(tabId, list);
  }
  const counter = counterFor(tabId);
  counter.count++;
  const summaries = matchedByTab.get(tabId) ?? [];
  if (summaries.length >= MAX_MATCHED_PER_TAB) summaries.shift();
  summaries.push({
    ruleId: info.rule?.ruleId ?? 0,
    rulesetId: info.rule?.rulesetId ?? '',
    url,
    type: info.request?.type,
    time: Date.now(),
  });
  matchedByTab.set(tabId, summaries);
}

/** Whether matches are counted from `onRuleMatchedDebug` (unpacked install). */
export function usesDebugFeed(): boolean {
  return debugFeed;
}

export function getBlockedUrls(tabId: number): string[] {
  return [...(blockedUrls.get(tabId) ?? [])];
}

export async function getStats(): Promise<Stats> {
  return store.get('stats');
}

export async function resetStats(): Promise<Stats> {
  const stats: Stats = { since: Date.now(), blockedTotal: 0, perDay: {} };
  await store.set({ stats });
  for (const counter of counters.values()) {
    counter.count = 0;
    counter.reported = 0;
    counter.lastRefresh = 0;
    counter.lastForced = 0;
  }
  blockedUrls.clear();
  matchedByTab.clear();
  return stats;
}

export function __resetForTests(): void {
  counters.clear();
  blockedUrls.clear();
  matchedByTab.clear();
  inFlight.clear();
  quotaCalls = [];
  quotaReady = null;
  debugFeed = false;
}
