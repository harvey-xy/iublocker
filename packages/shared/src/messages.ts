/// <reference types="chrome" />
import type { SiteMode } from './modes';
import type { CosmeticGeneric, ProceduralFilter } from './cosmetic';
import type { ScriptletCall } from './scriptlets';
import type { Settings, MatchedRuleSummary, Stats, UpdaterState } from './storage';
import type { RulesetListEntry } from './rulesets';

/** Requests handled by the service worker router. docs/MESSAGING.md */
export type Request =
  | { type: 'cosmetic:get'; hostname: string; topHostname: string; frameId: number }
  | { type: 'scriptlets:getDynamic'; hostname: string }
  | { type: 'tab:getState'; tabId?: number }
  | { type: 'site:setMode'; hostname: string; mode: SiteMode | null }
  | { type: 'settings:get' }
  | { type: 'settings:set'; patch: Partial<Settings> }
  | { type: 'lists:get' }
  | { type: 'lists:setEnabled'; listId: string; enabled: boolean }
  | { type: 'lists:update' }
  | { type: 'filters:getUser' }
  | { type: 'filters:setUser'; text: string }
  | { type: 'filters:addUser'; lines: string[] }
  | { type: 'picker:start'; tabId: number }
  | { type: 'stats:get'; tabId?: number }
  | { type: 'stats:reset' }
  | { type: 'logger:get'; tabId: number }
  | { type: 'blocked:getForTab' }
  | { type: 'debug:dumpState' };

export type RequestType = Request['type'];

export interface CosmeticGetResponse {
  mode: SiteMode;
  /** Procedural filters for this frame's hostname (specific + generic-procedural if complete). */
  procedural: ProceduralFilter[];
  /** Selectors to apply from the content script (e.g. when insertCSS was not possible). Usually empty. */
  selectors: string[];
  styles: [selector: string, style: string][];
  /** Generic tables, only in complete mode and when not generichide. */
  generic: CosmeticGeneric | null;
  excluded: string[];
  elemhide: boolean;
}

export interface TabState {
  tabId: number;
  url: string;
  hostname: string;
  /** Explicit per-site override (null = default). */
  mode: SiteMode | null;
  effectiveMode: SiteMode;
  blockedCount: number;
  listsEnabled: number;
  hasScriptlets: boolean;
  hasCosmetic: boolean;
  isInternal: boolean;
}

export interface ListsGetResponse {
  lists: (RulesetListEntry & { enabled: boolean })[];
  rulesetVersion: string;
  deltaVersion: string | null;
  budget: { used: number; available: number; total: number };
  updater: UpdaterState;
}

export interface UserFiltersResponse {
  text: string;
  warnings: string[];
  counts: { dnr: number; cosmetic: number; scriptlets: number };
}

export type ResponseMap = {
  'cosmetic:get': CosmeticGetResponse;
  'scriptlets:getDynamic': { calls: ScriptletCall[] };
  'tab:getState': TabState;
  'site:setMode': { effectiveMode: SiteMode };
  'settings:get': Settings;
  'settings:set': Settings;
  'lists:get': ListsGetResponse;
  'lists:setEnabled': { enabled: boolean; budget: ListsGetResponse['budget'] };
  'lists:update': { started: boolean };
  'filters:getUser': UserFiltersResponse;
  'filters:setUser': UserFiltersResponse;
  'filters:addUser': UserFiltersResponse;
  'picker:start': { started: boolean };
  'stats:get': Stats & { tab?: { blocked: number } };
  'stats:reset': Stats;
  'logger:get': { matched: MatchedRuleSummary[] };
  'blocked:getForTab': { urls: string[] };
  'debug:dumpState': Record<string, unknown>;
};

export type ResponseFor<T extends RequestType> = ResponseMap[T];

export type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Events broadcast from the worker to extension pages. */
export type Event =
  | { type: 'event:listsUpdated'; version: string; ok: boolean; error?: string }
  | { type: 'event:siteModeChanged'; hostname: string; mode: SiteMode | null }
  | { type: 'event:userFiltersChanged' }
  | { type: 'event:statsChanged'; tabId: number; blocked: number };

/** Helper for typed sendMessage from any context. */
export async function sendRequest<R extends Request>(req: R): Promise<ResponseFor<R['type']>> {
  const attempt = () =>
    new Promise<Envelope<ResponseFor<R['type']>>>((resolve, reject) => {
      chrome.runtime.sendMessage(req, (res: Envelope<ResponseFor<R['type']>>) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(res);
      });
    });
  let res: Envelope<ResponseFor<R['type']>>;
  try {
    res = await attempt();
  } catch {
    await new Promise((r) => setTimeout(r, 100));
    res = await attempt();
  }
  if (!res) throw new Error('empty response');
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
