import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CosmeticDB, CosmeticLookup, ScriptletCall, ScriptletDB } from '@iublocker/shared';

const compileUserFilters = vi.fn((text: string, _opts?: unknown) => ({
  dnr: text
    .split('\n')
    .filter((line) => line.startsWith('||'))
    .map((line, i) => ({
      id: i + 1,
      priority: 10,
      action: { type: 'block' as const },
      condition: { urlFilter: line },
    })),
  cosmetic: {
    version: 1 as const,
    listId: 'user',
    generic: { byId: {}, byClass: {}, complex: [] },
    specific: { 'example.com': ['.user-ad'] },
    styles: {},
    procedural: {},
    exceptions: { selectors: {}, elemhide: [], generichide: [], specifichide: [] },
  },
  scriptlets: {
    version: 1 as const,
    listId: 'user',
    byHost: { 'example.com': [{ name: 'set-constant', args: ['a', '1'] }] },
    exceptions: {},
  },
  warnings: ['line 3: unsupported option "popup"'],
}));

vi.mock('@iublocker/compiler', () => ({
  compileUserFilters: (text: string, opts: unknown) => compileUserFilters(text, opts as never),
  lookupCosmetic: (dbs: CosmeticDB[], hostname: string): CosmeticLookup => ({
    selectors: dbs.flatMap((db) => db.specific[hostname] ?? []),
    styles: [],
    procedural: [],
    elemhide: false,
    generichide: false,
    specifichide: false,
    excluded: [],
  }),
  lookupScriptlets: (dbs: ScriptletDB[], hostname: string): ScriptletCall[] =>
    dbs.flatMap((db) => db.byHost[hostname] ?? []),
  mergeCosmeticDB: (a: CosmeticDB) => a,
  mergeScriptletDB: (a: ScriptletDB) => a,
}));

import { handle, onMessage } from '../src/background/messaging/router';
import * as store from '../src/background/storage/store';
import {
  makeCosmeticDB,
  makeListEntry,
  makeRulesetManifest,
  makeScriptletDB,
  pageSender,
  resetBackground,
  stubFetch,
  tabSender,
} from './background-utils';

const manifest = makeRulesetManifest({
  lists: [
    makeListEntry('easylist', { defaultEnabled: true }),
    makeListEntry('annoy', { defaultEnabled: false, group: 'annoyances' }),
  ],
  scriptletGroups: [
    { hash: 'abc123', file: 'scriptlet-groups/abc123.js', hosts: ['example.com'], listIds: ['easylist'] },
  ],
});

let chromeMock: ReturnType<typeof resetBackground>;

function setup() {
  chromeMock = resetBackground();
  stubFetch({
    'rulesets/manifest.json': manifest,
    'rulesets/cosmetic/easylist.json': makeCosmeticDB('easylist', { specific: { 'example.com': ['.ad'] } }),
    'rulesets/scriptlets/easylist.json': makeScriptletDB('easylist'),
  });
  chromeMock._state.addTab({ id: 7, url: 'https://example.com/page' });
  chromeMock._state.addTab({ id: 8, url: 'chrome://extensions' });
}

const ok = async <T>(promise: Promise<{ ok: boolean; data?: T; error?: string }>): Promise<T> => {
  const res = await promise;
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

describe('router: content-script requests', () => {
  beforeEach(setup);

  it('cosmetic:get answers with the frame hostname resolved from the sender', async () => {
    const data = await ok(
      handle(
        { type: 'cosmetic:get', hostname: 'evil.test', topHostname: 'evil.test', frameId: 99 },
        tabSender(),
      ),
    );
    expect(data.mode).toBe('optimal');
    expect(data.selectors).toEqual(['.ad']);
    expect(data.generic).toBeNull();
  });

  it('cosmetic:get returns generic tables in complete mode only', async () => {
    await store.set({ siteModes: { 'example.com': 'complete' } });
    const data = await ok(
      handle(
        { type: 'cosmetic:get', hostname: 'example.com', topHostname: 'example.com', frameId: 0 },
        tabSender(),
      ),
    );
    expect(data.generic).not.toBeNull();
  });

  it('cosmetic:get returns nothing below optimal', async () => {
    await store.set({ siteModes: { 'example.com': 'basic' } });
    const data = await ok(
      handle(
        { type: 'cosmetic:get', hostname: 'example.com', topHostname: 'example.com', frameId: 0 },
        tabSender(),
      ),
    );
    expect(data).toMatchObject({ mode: 'basic', selectors: [], procedural: [], generic: null });
  });

  it('cosmetic:get rejects extension-page senders', async () => {
    const res = await handle(
      { type: 'cosmetic:get', hostname: 'example.com', topHostname: 'example.com', frameId: 0 },
      pageSender(),
    );
    expect(res).toMatchObject({ ok: false });
    expect(res.ok === false && res.error).toMatch(/content scripts/);
  });

  it('scriptlets:getDynamic returns user scriptlets', async () => {
    await ok(handle({ type: 'filters:setUser', text: '||ads.example.com^' }, pageSender('dashboard.html')));
    const data = await ok(handle({ type: 'scriptlets:getDynamic', hostname: 'example.com' }, tabSender()));
    expect(data.calls).toEqual([{ name: 'set-constant', args: ['a', '1'] }]);
  });

  it('blocked:getForTab uses the sender tab', async () => {
    const data = await ok(handle({ type: 'blocked:getForTab' }, tabSender()));
    expect(data.urls).toEqual([]);
  });
});

describe('router: UI requests', () => {
  beforeEach(setup);

  it('tab:getState describes the tab', async () => {
    const data = await ok(handle({ type: 'tab:getState', tabId: 7 }, pageSender()));
    expect(data).toMatchObject({
      tabId: 7,
      hostname: 'example.com',
      mode: null,
      effectiveMode: 'optimal',
      isInternal: false,
      listsEnabled: 1,
      hasCosmetic: true,
    });
  });

  it('tab:getState marks internal pages', async () => {
    const data = await ok(handle({ type: 'tab:getState', tabId: 8 }, pageSender()));
    expect(data.isInternal).toBe(true);
  });

  it('tab:getState ignores a tabId supplied by a content script', async () => {
    const data = await ok(handle({ type: 'tab:getState', tabId: 999 }, tabSender(7)));
    expect(data.tabId).toBe(7);
  });

  it('site:setMode writes the mode and the session rule', async () => {
    const data = await ok(
      handle({ type: 'site:setMode', hostname: 'example.com', mode: 'off' }, pageSender()),
    );
    expect(data.effectiveMode).toBe('off');
    expect(chromeMock._state.sessionRules).toHaveLength(1);
    expect(await store.get('siteModes')).toEqual({ 'example.com': 'off' });
  });

  it('site:setMode is refused for content scripts', async () => {
    const res = await handle({ type: 'site:setMode', hostname: 'example.com', mode: 'off' }, tabSender());
    expect(res.ok).toBe(false);
  });

  it('settings:get / settings:set round trip and validate', async () => {
    const before = await ok(handle({ type: 'settings:get' }, pageSender()));
    expect(before.defaultMode).toBe('optimal');
    const after = await ok(
      handle(
        {
          type: 'settings:set',
          patch: { updateIntervalHours: 999, theme: 'dark', cloudDeltaBaseUrl: 'http://insecure.example' },
        },
        pageSender(),
      ),
    );
    expect(after.theme).toBe('dark');
    expect(after.updateIntervalHours).toBe(168);
    expect(after.cloudDeltaBaseUrl).toBe(before.cloudDeltaBaseUrl);
    expect(chromeMock._state.alarms.get('iub-update')).toMatchObject({ periodInMinutes: 168 * 60 });
  });

  it('settings:set reschedules the update alarm', async () => {
    await ok(handle({ type: 'settings:set', patch: { updateIntervalHours: 12 } }, pageSender()));
    expect(chromeMock._state.alarms.get('iub-update')).toMatchObject({ periodInMinutes: 720 });
  });

  it('lists:get reports lists, versions and budget', async () => {
    const data = await ok(handle({ type: 'lists:get' }, pageSender()));
    expect(data.rulesetVersion).toBe(manifest.version);
    expect(data.deltaVersion).toBeNull();
    expect(data.lists.map((list) => [list.id, list.enabled])).toEqual([
      ['easylist', true],
      ['annoy', false],
    ]);
    expect(data.budget.total).toBe(330_000);
  });

  it('lists:setEnabled toggles the ruleset', async () => {
    const data = await ok(handle({ type: 'lists:setEnabled', listId: 'annoy', enabled: true }, pageSender()));
    expect(data.enabled).toBe(true);
    expect([...chromeMock._state.enabledRulesets]).toEqual(expect.arrayContaining(['easylist', 'annoy']));
    const res = await handle({ type: 'lists:setEnabled', listId: 'nope', enabled: true }, pageSender());
    expect(res).toMatchObject({ ok: false, error: 'unknown list: nope' });
  });

  it('lists:update starts an update and responds immediately', async () => {
    const data = await ok(handle({ type: 'lists:update' }, pageSender()));
    expect(data).toEqual({ started: true });
  });

  it('filters:setUser compiles, writes dynamic rules and returns warnings', async () => {
    const data = await ok(
      handle({ type: 'filters:setUser', text: '||ads.example.com^\n||track.example^' }, pageSender()),
    );
    expect(data.counts.dnr).toBe(2);
    expect(data.warnings).toHaveLength(1);
    expect(chromeMock._state.dynamicRules).toHaveLength(2);
    expect(chromeMock._state.dynamicRules[0].id).toBe(320_000);
    const stored = await ok(handle({ type: 'filters:getUser' }, pageSender()));
    expect(stored.text).toContain('||ads.example.com^');
  });

  it('filters:addUser appends and accepts picker senders', async () => {
    await ok(handle({ type: 'filters:setUser', text: '||a.example^' }, pageSender()));
    const data = await ok(
      handle({ type: 'filters:addUser', lines: ['example.com##.x', '', '||a.example^'] }, tabSender()),
    );
    expect(data.text.split('\n')).toEqual(['||a.example^', 'example.com##.x']);
    const res = await handle({ type: 'filters:addUser', lines: [] }, tabSender());
    expect(res.ok).toBe(false);
  });

  it('picker:start injects the picker content script', async () => {
    const data = await ok(handle({ type: 'picker:start', tabId: 7 }, pageSender()));
    expect(data.started).toBe(true);
    expect(chromeMock._state.calls.executeScript[0]).toMatchObject({
      target: { tabId: 7, frameIds: [0] },
      files: ['content/picker.js'],
      world: 'ISOLATED',
    });
    const res = await handle({ type: 'picker:start', tabId: 8 }, pageSender());
    expect(res).toMatchObject({ ok: false });
  });

  it('stats:get and stats:reset', async () => {
    chromeMock._state.setMatchedRules([
      { rule: { ruleId: 1, rulesetId: 'easylist' }, tabId: 7, timeStamp: Date.now() },
      { rule: { ruleId: 2, rulesetId: 'easylist' }, tabId: 7, timeStamp: Date.now() },
    ]);
    const data = await ok(handle({ type: 'stats:get', tabId: 7 }, pageSender()));
    expect(data.tab?.blocked).toBe(2);
    expect(data.blockedTotal).toBe(2);
    const reset = await ok(handle({ type: 'stats:reset' }, pageSender()));
    expect(reset.blockedTotal).toBe(0);
  });

  it('logger:get returns matched rules for a tab', async () => {
    chromeMock._state.setMatchedRules([
      { rule: { ruleId: 5, rulesetId: 'easylist' }, tabId: 7, timeStamp: 1 },
    ]);
    const data = await ok(handle({ type: 'logger:get', tabId: 7 }, pageSender()));
    expect(data.matched).toEqual([{ ruleId: 5, rulesetId: 'easylist', time: 1 }]);
  });

  it('debug:dumpState dumps storage and rule counts', async () => {
    const data = await ok(handle({ type: 'debug:dumpState' }, pageSender()));
    expect(data).toMatchObject({
      rulesetVersion: manifest.version,
      enabledLists: ['easylist'],
      userRules: 0,
    });
  });

  it('refuses unknown message shapes and foreign senders', async () => {
    const bad = await handle({ type: 'nope' } as never, pageSender());
    expect(bad).toMatchObject({ ok: false });
    const foreign = await handle({ type: 'settings:get' }, {
      id: 'other-extension',
    } as chrome.runtime.MessageSender);
    expect(foreign).toMatchObject({ ok: false, error: 'unknown sender' });
  });
});

describe('router: onMessage listener', () => {
  beforeEach(setup);

  it('responds asynchronously and keeps the channel open', async () => {
    const sendResponse = vi.fn();
    expect(onMessage({ type: 'settings:get' }, pageSender(), sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0]?.[0]).toMatchObject({ ok: true });
  });

  it('ignores broadcast events', () => {
    expect(onMessage({ type: 'event:listsUpdated' }, pageSender(), vi.fn())).toBe(false);
  });
});
