/* Shared helpers for the `background-*` unit tests (workstream T4). */
import { vi } from 'vitest';
import type { CosmeticDB, RulesetManifest, ScriptletDB } from '@iublocker/shared';
import { installChromeMock, type ChromeMock, type InstallOptions } from './chrome-mock';
import * as cosmeticIndex from '../src/background/cosmetic/index';
import * as injector from '../src/background/injector';
import * as lifecycle from '../src/background/lifecycle';
import * as manager from '../src/background/rulesets/manager';
import * as scriptletIndex from '../src/background/scriptlets/index';
import * as stats from '../src/background/stats';
import * as store from '../src/background/storage/store';
import * as updater from '../src/background/updater';

/** Fresh chrome mock + every module-level cache dropped. */
export function resetBackground(options: InstallOptions = {}): ChromeMock {
  const chromeMock = installChromeMock(options);
  store.__resetForTests();
  cosmeticIndex.__resetForTests();
  scriptletIndex.__resetForTests();
  injector.__resetForTests();
  stats.__resetForTests();
  lifecycle.__resetForTests();
  updater.__resetForTests();
  manager.invalidate();
  return chromeMock;
}

export interface FetchRoutes {
  /** Path inside the extension (e.g. `rulesets/manifest.json`) or a full URL → body. */
  [path: string]: unknown;
}

export interface FetchStub {
  calls: string[];
  routes: FetchRoutes;
  headers: Record<string, Record<string, string>>;
  /** Status override per path, e.g. `{ 'delta/0.0.0.json': 304 }`. */
  status: Record<string, number>;
}

/** Serves extension-bundle files (and remote URLs) as JSON. */
export function stubFetch(routes: FetchRoutes = {}): FetchStub {
  const stub: FetchStub = { calls: [], routes: { ...routes }, headers: {}, status: {} };
  const find = (url: string): string | undefined => {
    if (url in stub.routes) return url;
    return Object.keys(stub.routes).find((key) => url.endsWith(key));
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      stub.calls.push(url);
      const key = find(url);
      const statusKey = Object.keys(stub.status).find((k) => url.endsWith(k));
      const status = statusKey ? stub.status[statusKey] : key ? 200 : 404;
      const headers = { get: (name: string) => (key ? (stub.headers[key]?.[name.toLowerCase()] ?? null) : null) };
      return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        json: async () => {
          if (key === undefined) throw new Error(`no route for ${url}`);
          return stub.routes[key];
        },
        text: async () => JSON.stringify(key === undefined ? null : stub.routes[key]),
      };
    }),
  );
  return stub;
}

export function makeCosmeticDB(listId: string, patch: Partial<CosmeticDB> = {}): CosmeticDB {
  return {
    version: 1,
    listId,
    generic: { byId: {}, byClass: {}, complex: [] },
    specific: {},
    styles: {},
    procedural: {},
    exceptions: { selectors: {}, elemhide: [], generichide: [], specifichide: [] },
    ...patch,
  };
}

export function makeScriptletDB(listId: string, patch: Partial<ScriptletDB> = {}): ScriptletDB {
  return { version: 1, listId, byHost: {}, exceptions: {}, ...patch };
}

export function makeListEntry(id: string, patch: Record<string, unknown> = {}): RulesetManifest['lists'][number] {
  return {
    id,
    title: id,
    group: 'ads',
    defaultEnabled: true,
    trusted: false,
    sources: [],
    counts: { dnr: 10, regex: 0, cosmeticGeneric: 0, cosmeticSpecific: 0, procedural: 0, scriptlets: 0, dropped: 0 },
    files: { dnr: `dnr/${id}.json`, cosmetic: `cosmetic/${id}.json`, scriptlets: `scriptlets/${id}.json` },
    ...patch,
  } as RulesetManifest['lists'][number];
}

export function makeRulesetManifest(patch: Partial<RulesetManifest> = {}): RulesetManifest {
  return {
    version: '2026.09.11.1',
    builtAt: '2026-09-11T00:00:00.000Z',
    lists: [makeListEntry('easylist')],
    budget: { staticRulesTotal: 10, staticRulesDefaultEnabled: 10, regexTotal: 0 },
    scriptletGroups: [],
    ...patch,
  };
}

export const EXT_ORIGIN = 'chrome-extension://test-extension-id';

export const pageSender = (path = 'popup.html'): chrome.runtime.MessageSender =>
  ({ id: 'test-extension-id', url: `${EXT_ORIGIN}/${path}` }) as chrome.runtime.MessageSender;

export const tabSender = (
  tabId = 7,
  url = 'https://example.com/page',
  frameId = 0,
): chrome.runtime.MessageSender =>
  ({ id: 'test-extension-id', url, frameId, tab: { id: tabId, url } }) as unknown as chrome.runtime.MessageSender;
