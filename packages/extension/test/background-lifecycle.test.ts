import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, ID_RANGE } from '@iublocker/shared';

vi.mock('@iublocker/compiler', () => ({
  lookupCosmetic: () => ({
    selectors: [],
    styles: [],
    procedural: [],
    elemhide: false,
    generichide: false,
    specifichide: false,
    excluded: [],
  }),
  lookupScriptlets: () => [],
  mergeCosmeticDB: (a: unknown) => a,
  mergeScriptletDB: (a: unknown) => a,
  compileUserFilters: () => ({ dnr: [], cosmetic: null, scriptlets: null, warnings: [] }),
}));

import * as lifecycle from '../src/background/lifecycle';
import * as manager from '../src/background/rulesets/manager';
import { runMigrations } from '../src/background/storage/migrations';
import * as store from '../src/background/storage/store';
import {
  makeCosmeticDB,
  makeListEntry,
  makeRulesetManifest,
  makeScriptletDB,
  resetBackground,
  stubFetch,
} from './background-utils';

const manifest = makeRulesetManifest({
  lists: [
    makeListEntry('easylist', { defaultEnabled: true }),
    makeListEntry('easylist-de', { defaultEnabled: false, group: 'regional', lang: ['de'] }),
    makeListEntry('easylist-zh', { defaultEnabled: false, group: 'regional', lang: ['zh'] }),
  ],
  scriptletGroups: [
    {
      name: 'noop',
      hash: 'aaa',
      file: 'scriptlet-groups/noop.js',
      libs: ['scriptlet-lib/noop.js'],
      hosts: ['example.com'],
      listIds: ['easylist'],
    },
  ],
});

let chromeMock: ReturnType<typeof resetBackground>;

function setup(uiLanguage = 'en-US') {
  chromeMock = resetBackground({ uiLanguage, manifestVersion: '1.2.3' });
  stubFetch({ 'rulesets/manifest.json': manifest });
}

describe('migrations', () => {
  beforeEach(() => setup());

  it('stamps the schema version and seeds defaults on a fresh profile', async () => {
    const result = await runMigrations();
    expect(result).toMatchObject({ from: 0, to: SCHEMA_VERSION });
    expect(await store.get('schemaVersion')).toBe(SCHEMA_VERSION);
    expect((await store.get('settings')).defaultMode).toBe('optimal');
  });

  it('is idempotent', async () => {
    await runMigrations();
    await store.set({ siteModes: { 'a.com': 'off' } });
    const second = await runMigrations();
    expect(second.applied).toEqual([]);
    expect(await store.get('siteModes')).toEqual({ 'a.com': 'off' });
  });

  it('leaves data from a newer schema untouched', async () => {
    await chrome.storage.local.set({ schemaVersion: SCHEMA_VERSION + 5 });
    store.__resetForTests();
    const result = await runMigrations();
    expect(result.to).toBe(SCHEMA_VERSION + 5);
  });
});

describe('lifecycle: onInstalled', () => {
  beforeEach(() => setup('de'));

  it('seeds list defaults including regional lists for the UI language', async () => {
    await lifecycle.onInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails);
    const lists = await store.get('lists');
    expect(lists).toEqual({
      easylist: { enabled: true },
      'easylist-de': { enabled: true },
      'easylist-zh': { enabled: false },
    });
    expect([...chromeMock._state.enabledRulesets].sort()).toEqual(['easylist', 'easylist-de']);
  });

  it('registers the scriptlet groups and the update alarm', async () => {
    await lifecycle.onInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails);
    expect((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)).toEqual(['sl-noop-0']);
    expect(chromeMock._state.alarms.has('iub-update')).toBe(true);
  });

  it('keeps user toggles on an update and adds newly shipped lists', async () => {
    await store.set({ lists: { easylist: { enabled: false } } });
    await lifecycle.onInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails);
    const lists = await store.get('lists');
    expect(lists.easylist).toEqual({ enabled: false });
    expect(lists['easylist-de']).toEqual({ enabled: true });
  });

  it('discards a delta built against another ruleset snapshot', async () => {
    await store.set({
      delta: {
        base: '1999.01.01.1',
        version: 'old',
        appliedAt: 1,
        cosmetic: makeCosmeticDB('delta'),
        scriptlets: makeScriptletDB('delta'),
        disabled: { easylist: [1] },
      },
    });
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        { id: ID_RANGE.DELTA.start, action: { type: 'block' }, condition: { urlFilter: 'x' } },
      ] as unknown as chrome.declarativeNetRequest.Rule[],
    });
    await lifecycle.onInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails);
    expect(await store.get('delta')).toBeNull();
    expect(chromeMock._state.dynamicRules).toHaveLength(0);
  });

  it('keeps a delta whose base matches the shipped snapshot', async () => {
    await store.set({
      delta: {
        base: manifest.version,
        version: 'current',
        appliedAt: 1,
        cosmetic: makeCosmeticDB('delta'),
        scriptlets: makeScriptletDB('delta'),
        disabled: { easylist: [7] },
      },
    });
    await lifecycle.onInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails);
    expect((await store.get('delta'))?.version).toBe('current');
    expect(chromeMock._state.calls.updateStaticRules[0]).toMatchObject({
      rulesetId: 'easylist',
      disableRuleIds: [7],
    });
  });

  it('never throws', async () => {
    chromeMock.declarativeNetRequest.updateEnabledRulesets = async () => {
      throw new Error('boom');
    };
    await expect(
      lifecycle.onInstalled({ reason: 'install' } as chrome.runtime.InstalledDetails),
    ).resolves.toBeUndefined();
  });

  it('still syncs session rules and scriptlet groups when enabling rulesets fails', async () => {
    // The four reconciliation steps are independent: a Chrome error in the first one must
    // not leave `off` sites blocked and every scriptlet group unregistered.
    await store.set({ siteModes: { 'off.test': 'off' } });
    chromeMock.declarativeNetRequest.updateEnabledRulesets = async () => {
      throw new Error('boom');
    };
    await lifecycle.onInstalled({ reason: 'update' } as chrome.runtime.InstalledDetails);
    expect(chromeMock._state.sessionRules[0].condition.requestDomains).toEqual(['off.test']);
    expect((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)).toEqual([
      'sl-noop-0',
    ]);
  });
});

describe('manager: enabling rulesets Chrome may refuse', () => {
  beforeEach(() => setup('de'));

  it('retries one ruleset at a time when the batch call fails', async () => {
    // `updateEnabledRulesets` is all-or-nothing: one bad id would otherwise leave every
    // list in its previous state (on a fresh profile: nothing enabled at all).
    const real = chromeMock.declarativeNetRequest.updateEnabledRulesets;
    chromeMock.declarativeNetRequest.updateEnabledRulesets = (async (o: {
      enableRulesetIds?: string[];
      disableRulesetIds?: string[];
    }) => {
      if ((o.enableRulesetIds ?? []).includes('easylist-de')) throw new Error('no such ruleset');
      return real(o as never);
    }) as typeof chromeMock.declarativeNetRequest.updateEnabledRulesets;

    await manager.applyFirstRunDefaults();
    const enabled = await manager.applyEnabledRulesets();
    expect(enabled).toContain('easylist');
    expect([...chromeMock._state.enabledRulesets]).toEqual(['easylist']);
  });

  it('never enables a list the extension manifest has no ruleset for', async () => {
    chromeMock.runtime.getManifest = (() => ({
      version: '1.2.3',
      declarative_net_request: { rule_resources: [{ id: 'easylist', enabled: true, path: 'x' }] },
    })) as typeof chromeMock.runtime.getManifest;
    await manager.applyFirstRunDefaults();
    const enabled = await manager.applyEnabledRulesets();
    expect(enabled).toEqual(['easylist']);
    expect([...chromeMock._state.enabledRulesets]).toEqual(['easylist']);
    expect(chromeMock._state.calls.updateEnabledRulesets[0]).toMatchObject({
      enableRulesetIds: ['easylist'],
    });
  });
});

describe('lifecycle: onStartup', () => {
  beforeEach(() => setup());

  it('re-syncs session rules and scriptlet groups after a browser restart', async () => {
    await store.set({ siteModes: { 'off.test': 'off' } });
    await lifecycle.onStartup();
    expect(chromeMock._state.sessionRules[0].condition.requestDomains).toEqual(['off.test']);
    expect((await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id)).toEqual(['sl-noop-0']);
    expect(chromeMock._state.alarms.has('iub-update')).toBe(true);
  });

  it('ensureInitialised hydrates once per worker start', async () => {
    await Promise.all([lifecycle.ensureInitialised(), lifecycle.ensureInitialised()]);
    expect(store.peek('settings')).toBeDefined();
  });
});

describe('manager: first-run language matching', () => {
  it('matches the UI language loosely', () => {
    const de = makeListEntry('de', { defaultEnabled: false, group: 'regional', lang: ['de'] });
    expect(manager.defaultEnabledFor(de, ['de-at'])).toBe(true);
    expect(manager.defaultEnabledFor(de, ['en-us'])).toBe(false);
    const always = makeListEntry('x', { defaultEnabled: true, group: 'ads' });
    expect(manager.defaultEnabledFor(always, ['en-us'])).toBe(true);
  });
});
