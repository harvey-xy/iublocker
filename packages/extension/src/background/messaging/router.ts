/**
 * The single typed message router. docs/MESSAGING.md.
 *
 * Every `Request` in `@iublocker/shared` is handled here and answered with an
 * `Envelope<T>`; errors never cross the boundary as exceptions.
 *
 * Sender rules:
 *  - content-script requests take their tab/frame from `sender`, never from the payload;
 *  - requests that change state are restricted to extension pages (popup/dashboard),
 *    with one deliberate exception: `filters:addUser` may come from the picker content
 *    script, and its payload is validated before use.
 */
import {
  hostnameFromUrl,
  isWebUrl,
  modeAtLeast,
  type Envelope,
  type ListsGetResponse,
  type Request,
  type RequestType,
  type ResponseFor,
  type ResponseMap,
  type TabState,
} from '@iublocker/shared';
import * as cosmeticIndex from '../cosmetic/index';
import * as injector from '../injector';
import { ensureInitialised } from '../lifecycle';
import { errorMessage, log } from '../log';
import * as picker from '../picker';
import * as manager from '../rulesets/manager';
import { RANGES, getRulesInRange } from '../rulesets/dynamic';
import * as registrar from '../scriptlets/registrar';
import * as scriptletIndex from '../scriptlets/index';
import { getSettings, setSettings } from '../settings';
import * as siteModes from '../siteModes';
import * as stats from '../stats';
import * as store from '../storage/store';
import * as updater from '../updater';
import * as user from '../user';
import { broadcast } from './broadcast';

const MAX_USER_LINES = 500;
const MAX_USER_LINE_LENGTH = 2_000;

type AnyResponse = ResponseMap[RequestType];

function isExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  const base = chrome.runtime.getURL('');
  return typeof sender.url === 'string' && sender.url.startsWith(base);
}

function requireSameExtension(sender: chrome.runtime.MessageSender): void {
  if (sender.id && sender.id !== chrome.runtime.id) throw new Error('unknown sender');
}

function requireExtensionPage(sender: chrome.runtime.MessageSender, type: string): void {
  if (!isExtensionPage(sender)) throw new Error(`${type} is only available to extension pages`);
}

interface FrameRef {
  tabId: number;
  frameId: number;
  url: string;
}

/** Tab/frame of a content-script sender. Client-supplied tab ids are ignored. */
function requireFrame(sender: chrome.runtime.MessageSender, type: string): FrameRef {
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0 || isExtensionPage(sender)) {
    throw new Error(`${type} is only available to content scripts`);
  }
  return { tabId, frameId: sender.frameId ?? 0, url: sender.url ?? sender.tab?.url ?? '' };
}

/** Tab id for a UI request: explicit for extension pages, sender-derived otherwise. */
async function resolveTabId(
  sender: chrome.runtime.MessageSender,
  requested: number | undefined,
  type: string,
): Promise<number> {
  if (isExtensionPage(sender)) {
    if (typeof requested === 'number' && requested >= 0) return requested;
    // Extension pages without an explicit tabId (the popup, or a dashboard tab) mean
    // "the tab the user is looking at": the active tab of the last focused window.
    try {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (typeof active?.id === 'number' && active.id >= 0) return active.id;
    } catch {
      /* fall through */
    }
    const own = sender.tab?.id;
    if (typeof own === 'number' && own >= 0) return own;
    throw new Error(`${type} needs a tabId`);
  }
  const tabId = sender.tab?.id;
  if (tabId === undefined || tabId < 0) throw new Error(`${type}: no tab for this sender`);
  return tabId;
}

function sanitiseFilterLines(lines: unknown): string[] {
  if (!Array.isArray(lines)) throw new Error('filters:addUser expects an array of lines');
  const out: string[] = [];
  for (const line of lines.slice(0, MAX_USER_LINES)) {
    if (typeof line !== 'string') continue;
    const trimmed = (line.split(/\r?\n/)[0] ?? '').trim();
    if (trimmed.length === 0 || trimmed.length > MAX_USER_LINE_LENGTH) continue;
    out.push(trimmed);
  }
  if (out.length === 0) throw new Error('no usable filter lines');
  return out;
}

async function buildListsResponse(): Promise<ListsGetResponse> {
  const [manifest, states, delta, updaterState, budget] = await Promise.all([
    manager.getManifest(),
    manager.getListStates(),
    store.get('delta'),
    store.get('updater'),
    manager.getBudget(),
  ]);
  return {
    lists: manifest.lists.map((entry) => ({ ...entry, enabled: states[entry.id]?.enabled ?? false })),
    rulesetVersion: manifest.version,
    deltaVersion: delta?.version ?? null,
    budget,
    updater: updaterState,
  };
}

async function buildTabState(tabId: number): Promise<TabState> {
  let url = '';
  try {
    const tab = await chrome.tabs.get(tabId);
    url = tab?.url ?? '';
  } catch {
    url = '';
  }
  const hostname = hostnameFromUrl(url);
  const isInternal = !isWebUrl(url);
  const [explicit, effectiveMode, enabled] = await Promise.all([
    hostname ? siteModes.getExplicitMode(hostname) : Promise.resolve(null),
    hostname ? siteModes.resolveMode(hostname) : getSettings().then((s) => s.defaultMode),
    manager.enabledListIds(),
  ]);
  const [blockedCount, hasCosmetic, calls] = await Promise.all([
    isInternal ? Promise.resolve(0) : stats.refreshBadge(tabId, { force: true }),
    hostname ? cosmeticIndex.hasAnyFor(hostname) : Promise.resolve(false),
    hostname ? scriptletIndex.lookupAll(hostname) : Promise.resolve([]),
  ]);
  return {
    tabId,
    url,
    hostname,
    mode: explicit,
    effectiveMode,
    blockedCount,
    listsEnabled: enabled.length,
    hasScriptlets: calls.length > 0,
    hasCosmetic,
    isInternal,
  };
}

async function dispatch(msg: Request, sender: chrome.runtime.MessageSender): Promise<AnyResponse> {
  switch (msg.type) {
    case 'cosmetic:get': {
      const frame = requireFrame(sender, msg.type);
      const hostname = hostnameFromUrl(frame.url) || msg.hostname;
      const topHostname =
        (await injector.resolveTopHostname(frame.tabId, frame.frameId, frame.url)) || hostname;
      const mode = await siteModes.resolveMode(topHostname);
      const empty = {
        mode,
        procedural: [],
        selectors: [],
        styles: [],
        generic: null,
        excluded: [],
        elemhide: false,
      };
      if (!hostname || !modeAtLeast(mode, 'optimal')) return empty;
      const lookup = await cosmeticIndex.lookup(hostname);
      if (lookup.elemhide) return { ...empty, elemhide: true };
      // The worker already pushed the specific CSS with insertCSS at onCommitted; only
      // hand it to the content script when that injection did not happen.
      const injected = injector.wasInjected(frame.tabId, frame.frameId, hostname);
      const suppressSpecific = injected || lookup.specifichide;
      return {
        mode,
        // Procedural filters need JS evaluation on the page and are the main breakage
        // source after generic hiding, so they are reserved for `complete` (docs §4).
        procedural: mode === 'complete' ? lookup.procedural : [],
        selectors: suppressSpecific ? [] : lookup.selectors,
        styles: suppressSpecific ? [] : lookup.styles,
        generic: mode === 'complete' && !lookup.generichide ? await cosmeticIndex.genericTables() : null,
        excluded: lookup.excluded,
        elemhide: false,
      };
    }

    case 'scriptlets:getDynamic': {
      const frame = requireFrame(sender, msg.type);
      const hostname = hostnameFromUrl(frame.url) || msg.hostname;
      const topHostname =
        (await injector.resolveTopHostname(frame.tabId, frame.frameId, frame.url)) || hostname;
      const mode = await siteModes.resolveMode(topHostname);
      if (!hostname || !modeAtLeast(mode, 'optimal')) return { calls: [] };
      return { calls: await scriptletIndex.lookupDynamic(hostname) };
    }

    case 'tab:getState': {
      const tabId = await resolveTabId(sender, msg.tabId, msg.type);
      return buildTabState(tabId);
    }

    case 'site:setMode': {
      requireExtensionPage(sender, msg.type);
      const effectiveMode = await siteModes.setMode(msg.hostname, msg.mode);
      cosmeticIndex.invalidate();
      try {
        await registrar.reconcile();
      } catch (err) {
        log.warn('registrar reconcile after mode change failed', err);
      }
      broadcast({ type: 'event:siteModeChanged', hostname: msg.hostname, mode: msg.mode });
      return { effectiveMode };
    }

    case 'sites:get': {
      const [siteModesMap, settings] = await Promise.all([siteModes.getSiteModes(), getSettings()]);
      return { siteModes: siteModesMap, defaultMode: settings.defaultMode };
    }

    case 'settings:get':
      return getSettings();

    case 'settings:set': {
      requireExtensionPage(sender, msg.type);
      const { settings, changed } = await setSettings(msg.patch);
      if (changed.includes('defaultMode')) {
        await siteModes.syncSessionRules();
        await registrar.reconcile().catch((err) => log.warn('reconcile failed', err));
      }
      if (changed.includes('autoUpdate') || changed.includes('updateIntervalHours')) {
        await updater.scheduleAlarm();
      }
      return settings;
    }

    case 'lists:get':
      return buildListsResponse();

    case 'lists:setEnabled': {
      requireExtensionPage(sender, msg.type);
      const result = await manager.setListEnabled(msg.listId, msg.enabled);
      cosmeticIndex.invalidate();
      scriptletIndex.invalidate();
      await registrar.reconcile().catch((err) => log.warn('reconcile failed', err));
      return result;
    }

    case 'lists:update': {
      requireExtensionPage(sender, msg.type);
      void updater.runUpdate({ force: true }).catch((err) => log.error('manual update failed', err));
      return { started: true };
    }

    case 'filters:getUser':
      return user.getUserFilters();

    case 'filters:setUser': {
      requireExtensionPage(sender, msg.type);
      if (typeof msg.text !== 'string') throw new Error('filters:setUser expects text');
      return user.setUserFilters(msg.text);
    }

    case 'filters:addUser': {
      requireSameExtension(sender);
      return user.addUserFilters(sanitiseFilterLines(msg.lines));
    }

    case 'picker:start': {
      requireExtensionPage(sender, msg.type);
      const tabId = await resolveTabId(sender, msg.tabId, msg.type);
      return { started: await picker.startPicker(tabId) };
    }

    case 'stats:get': {
      const tabId = typeof msg.tabId === 'number' && isExtensionPage(sender) ? msg.tabId : sender.tab?.id;
      // Refresh first: the counters feed the daily totals we are about to read.
      const blocked =
        typeof tabId === 'number' && tabId >= 0 ? await stats.refreshBadge(tabId, { force: true }) : null;
      const all = await stats.getStats();
      return blocked === null ? all : { ...all, tab: { blocked } };
    }

    case 'stats:reset': {
      requireExtensionPage(sender, msg.type);
      return stats.resetStats();
    }

    case 'logger:get': {
      requireExtensionPage(sender, msg.type);
      const tabId = await resolveTabId(sender, msg.tabId, msg.type);
      return { matched: await stats.getMatchedForTab(tabId) };
    }

    case 'blocked:getForTab': {
      const frame = requireFrame(sender, msg.type);
      return { urls: stats.getBlockedUrls(frame.tabId) };
    }

    case 'debug:dumpState': {
      requireExtensionPage(sender, msg.type);
      const [data, manifest, enabled, userRules, deltaRules, registered] = await Promise.all([
        store.getAll(),
        manager.getManifest(),
        manager.enabledListIds(),
        getRulesInRange(RANGES.user),
        getRulesInRange(RANGES.delta),
        chrome.scripting.getRegisteredContentScripts().catch(() => []),
      ]);
      return {
        version: chrome.runtime.getManifest().version,
        rulesetVersion: manifest.version,
        schemaVersion: data.schemaVersion,
        settings: data.settings,
        siteModes: data.siteModes,
        enabledLists: enabled,
        userRules: userRules.length,
        deltaRules: deltaRules.length,
        deltaVersion: data.delta?.version ?? null,
        updater: data.updater,
        registeredScriptletGroups: registered.length,
        stats: data.stats,
      };
    }

    default: {
      const exhaustive: never = msg;
      throw new Error(`unknown request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Handle one request. Always resolves; errors become `{ ok: false, error }`. */
export async function handle<R extends Request>(
  msg: R,
  sender: chrome.runtime.MessageSender,
): Promise<Envelope<ResponseFor<R['type']>>> {
  try {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') throw new Error('malformed request');
    requireSameExtension(sender);
    await ensureInitialised();
    const data = (await dispatch(msg, sender)) as ResponseFor<R['type']>;
    return { ok: true, data };
  } catch (err) {
    const error = errorMessage(err);
    log.debug(`request ${msg?.type} failed:`, error);
    return { ok: false, error };
  }
}

/** `chrome.runtime.onMessage` listener; registered synchronously at worker start. */
export function onMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  const isEvent =
    typeof (message as { type?: string })?.type === 'string' &&
    (message as { type: string }).type.startsWith('event:');
  if (isEvent) return false;
  handle(message as Request, sender).then(sendResponse, (err: unknown) => {
    sendResponse({ ok: false, error: errorMessage(err) });
  });
  return true;
}
