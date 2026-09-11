/**
 * Stats and badge. docs/ARCHITECTURE.md §4.5 — never per request: the badge is refreshed
 * from `declarativeNetRequest.getMatchedRules()` when a tab finishes loading and when the
 * popup asks, throttled to at most one call per second and tab.
 */
import type { MatchedRuleSummary, Stats } from '@iublocker/shared';
import { errorMessage, log } from './log';
import { getSettings } from './settings';
import * as store from './storage/store';

export const BADGE_THROTTLE_MS = 1_000;
const MAX_MATCHED_PER_TAB = 500;
const MAX_BLOCKED_URLS_PER_TAB = 500;
const MAX_DAYS_KEPT = 90;
const BADGE_COLOR = '#3a6ea5';

interface TabCounters {
  /** Matched-rule count last observed for this tab. */
  count: number;
  lastRefresh: number;
  /** Page-load timestamp, used to scope getMatchedRules to the current document. */
  since: number;
}

const counters = new Map<number, TabCounters>();
const blockedUrls = new Map<number, string[]>();
const matchedByTab = new Map<number, MatchedRuleSummary[]>();
const inFlight = new Map<number, Promise<number>>();

export function dayKey(when: number = Date.now()): string {
  return new Date(when).toISOString().slice(0, 10);
}

function counterFor(tabId: number): TabCounters {
  let counter = counters.get(tabId);
  if (!counter) {
    counter = { count: 0, lastRefresh: 0, since: 0 };
    counters.set(tabId, counter);
  }
  return counter;
}

/** Called when a main frame commits: the tab starts counting from zero again. */
export function resetTab(tabId: number, when: number = Date.now()): void {
  counters.set(tabId, { count: 0, lastRefresh: 0, since: when });
  blockedUrls.delete(tabId);
  matchedByTab.delete(tabId);
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

async function doRefresh(tabId: number, now: number): Promise<number> {
  const counter = counterFor(tabId);
  counter.lastRefresh = now;
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

  const count = matched.length;
  const delta = count - counter.count;
  counter.count = count;
  if (delta > 0) await addToTotals(delta);
  await store.session.patchTab(tabId, { blocked: count, matched: summaries.slice(-50) });
  await setBadge(tabId, count);
  return count;
}

/**
 * Refresh the badge for a tab. Throttled to one `getMatchedRules` call per second per
 * tab unless `force` is set (popup open).
 */
export async function refreshBadge(tabId: number, options: { force?: boolean; now?: number } = {}): Promise<number> {
  if (tabId < 0) return 0;
  const now = options.now ?? Date.now();
  const counter = counterFor(tabId);
  if (!options.force && now - counter.lastRefresh < BADGE_THROTTLE_MS) return counter.count;
  const pending = inFlight.get(tabId);
  if (pending) return pending;
  const promise = doRefresh(tabId, now).finally(() => inFlight.delete(tabId));
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
 * does it is the only source of blocked request URLs (the collapse hint the content script
 * asks for through `blocked:getForTab`).
 */
export function noteMatchedRule(info: chrome.declarativeNetRequest.MatchedRuleInfoDebug): void {
  const tabId = info.request?.tabId ?? -1;
  const url = info.request?.url;
  if (tabId < 0 || !url) return;
  const list = blockedUrls.get(tabId) ?? [];
  if (list.length >= MAX_BLOCKED_URLS_PER_TAB) list.shift();
  list.push(url);
  blockedUrls.set(tabId, list);
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
    counter.lastRefresh = 0;
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
}
