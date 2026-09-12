/**
 * Service worker entry point.
 *
 * MV3 requires every event listener to be registered synchronously during the first
 * turn of the worker (docs/ARCHITECTURE.md §2), otherwise events that woke the worker
 * are lost. Nothing here awaits: state is hydrated lazily inside the handlers.
 */
import * as injector from './injector';
import { log } from './log';
import { onMessage } from './messaging/router';
import * as lifecycle from './lifecycle';
import * as stats from './stats';
import * as store from './storage/store';
import * as updater from './updater';

chrome.runtime.onInstalled.addListener((details) => {
  void lifecycle.onInstalled(details);
});

chrome.runtime.onStartup.addListener(() => {
  void lifecycle.onStartup();
});

chrome.runtime.onMessage.addListener(onMessage);

chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId === 0) stats.resetTab(details.tabId, details.timeStamp || Date.now());
    injector.onCommitted(details);
  },
  { url: [{ schemes: ['http', 'https'] }] },
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  // `getMatchedRules` is quota-limited per extension (stats.ts): never spend a call on a
  // background tab whose badge nobody is looking at.
  if (tab && tab.active === false) return;
  void stats.refreshBadge(tabId).catch((err) => log.debug('badge refresh failed', err));
});

chrome.tabs.onActivated.addListener((info) => {
  // A tab that finished loading in the background never got a badge (see above); refresh
  // it when it becomes the tab the user is looking at.
  void stats.refreshBadge(info.tabId).catch((err) => log.debug('badge refresh failed', err));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  stats.forgetTab(tabId);
  injector.forgetTab(tabId);
  void store.session.dropTab(tabId).catch(() => undefined);
});

chrome.alarms.onAlarm.addListener(updater.onAlarm);

chrome.storage.onChanged.addListener(store.handleStorageChanged);

// Only fires for unpacked installs; the sole source of blocked request URLs (collapse).
const ruleMatched = chrome.declarativeNetRequest.onRuleMatchedDebug;
if (ruleMatched && typeof ruleMatched.addListener === 'function') {
  ruleMatched.addListener(stats.noteMatchedRule);
}

// Wake-up path: the worker may be started by any of the events above.
void lifecycle.ensureInitialised().catch((err) => log.error('init failed', err));

log.debug('service worker started');
