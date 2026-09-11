import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import * as registrar from '../src/background/scriptlets/registrar';
import * as store from '../src/background/storage/store';
import { makeListEntry, makeRulesetManifest, resetBackground, stubFetch } from './background-utils';

const groups = [
  {
    name: 'set-constant',
    hash: 'aaa',
    file: 'scriptlet-groups/set-constant.js',
    libs: ['scriptlet-lib/set-constant.js'],
    hosts: ['example.com', 'b.example.org'],
    listIds: ['easylist'],
  },
  {
    name: 'noop',
    hash: 'bbb',
    file: 'scriptlet-groups/noop.js',
    libs: ['scriptlet-lib/noop.js'],
    hosts: ['annoy.test'],
    listIds: ['annoy'],
  },
];

const manifest = makeRulesetManifest({
  lists: [
    makeListEntry('easylist', { defaultEnabled: true }),
    makeListEntry('annoy', { defaultEnabled: false }),
  ],
  scriptletGroups: groups,
});

let chromeMock: ReturnType<typeof resetBackground>;

function setup() {
  chromeMock = resetBackground();
  stubFetch({ 'rulesets/manifest.json': manifest });
}

describe('registrar: desired scripts', () => {
  it('builds one MAIN-world script per group with both host patterns', () => {
    const desired = registrar.buildDesired(groups, new Set(['easylist']), []);
    expect(desired).toHaveLength(1);
    expect(desired[0]).toEqual({
      id: 'sl-set-constant-0',
      // the lib first (it defines self.__iub_lib), then the group's host table.
      js: ['rulesets/scriptlet-lib/set-constant.js', 'rulesets/scriptlet-groups/set-constant.js'],
      matches: ['*://b.example.org/*', '*://*.b.example.org/*', '*://example.com/*', '*://*.example.com/*'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    });
  });

  it('splits a group with more hosts than one script may carry', () => {
    const hosts = Array.from({ length: 2_500 }, (_, i) => `h${i}.example`);
    const [first, second, third, fourth] = registrar.buildDesired(
      [{ name: 'noop', hash: 'x', file: 'scriptlet-groups/noop.js', libs: [], hosts, listIds: [] }],
      new Set(),
      [],
    );
    expect([first?.id, second?.id, third?.id, fourth?.id]).toEqual([
      'sl-noop-0',
      'sl-noop-1',
      'sl-noop-2',
      undefined,
    ]);
    // 1,000 hosts × two patterns each, then the 500-host remainder.
    expect(first?.matches).toHaveLength(2_000);
    expect(third?.matches).toHaveLength(1_000);
  });

  it('registers a generic group against every http(s) URL', () => {
    const [script] = registrar.buildDesired(
      [{ name: 'noop', hash: 'x', file: 'scriptlet-groups/noop.js', libs: [], hosts: ['*'], listIds: [] }],
      new Set(),
      [],
    );
    expect(script?.id).toBe('sl-noop-0');
    expect(script?.matches).toEqual(['http://*/*', 'https://*/*']);
  });

  it('excludes hosts in off/basic mode', () => {
    const [script] = registrar.buildDesired(groups, new Set(['easylist']), ['off.test']);
    expect(script?.excludeMatches).toEqual(['*://off.test/*', '*://*.off.test/*']);
  });

  it('derives the bundle path when the manifest has none', () => {
    expect(
      registrar.groupFilePath({ name: 'zz', hash: 'h', file: '', libs: [], hosts: [], listIds: [] }),
    ).toBe('rulesets/scriptlet-groups/zz.js');
    expect(
      registrar.groupFilePath({
        name: 'zz',
        hash: 'h',
        file: 'rulesets/x/zz.js',
        libs: [],
        hosts: [],
        listIds: [],
      }),
    ).toBe('rulesets/x/zz.js');
  });

  it('keeps lib order, dedupes, and prefixes every path with rulesets/', () => {
    expect(
      registrar.groupScriptFiles({
        name: 'zz',
        hash: 'h',
        file: 'scriptlet-groups/zz.js',
        libs: ['scriptlet-lib/a.js', '/scriptlet-lib/a.js', 'rulesets/scriptlet-lib/b.js'],
        hosts: [],
        listIds: [],
      }),
    ).toEqual([
      'rulesets/scriptlet-lib/a.js',
      'rulesets/scriptlet-lib/b.js',
      'rulesets/scriptlet-groups/zz.js',
    ]);
  });

  it('still works for a group with no libs recorded', () => {
    expect(
      registrar.groupScriptFiles({
        name: 'zz',
        hash: 'h',
        file: 'scriptlet-groups/zz.js',
        hosts: [],
        listIds: [],
      } as never),
    ).toEqual(['rulesets/scriptlet-groups/zz.js']);
  });
});

describe('registrar: reconcile', () => {
  beforeEach(setup);

  it('registers groups of enabled lists only', async () => {
    const result = await registrar.reconcile();
    expect(result.registered).toBe(1);
    const registered = await chrome.scripting.getRegisteredContentScripts();
    expect(registered.map((script) => script.id)).toEqual(['sl-set-constant-0']);
  });

  it('registers and unregisters when a list is toggled', async () => {
    await registrar.reconcile();
    await store.set({ lists: { easylist: { enabled: false }, annoy: { enabled: true } } });
    const result = await registrar.reconcile();
    expect(result.removed).toBe(1);
    expect(result.registered).toBe(1);
    const registered = await chrome.scripting.getRegisteredContentScripts();
    expect(registered.map((script) => script.id)).toEqual(['sl-noop-0']);
  });

  it('updates excludeMatches in place when a site goes off', async () => {
    await registrar.reconcile();
    await store.set({ siteModes: { 'off.test': 'off' } });
    const result = await registrar.reconcile();
    expect(result.updated).toBe(1);
    expect(result.registered).toBe(0);
    const [registered] = await chrome.scripting.getRegisteredContentScripts();
    expect(registered?.excludeMatches).toEqual(['*://off.test/*', '*://*.off.test/*']);
  });

  it('is a no-op when nothing changed', async () => {
    await registrar.reconcile();
    chromeMock._state.calls.registerContentScripts.length = 0;
    const result = await registrar.reconcile();
    expect(result).toMatchObject({ registered: 0, updated: 0, removed: 0 });
    expect(chromeMock._state.calls.registerContentScripts).toHaveLength(0);
  });

  it('registers nothing when the default mode is below optimal', async () => {
    await registrar.reconcile();
    const settings = await store.get('settings');
    await store.set({ settings: { ...settings, defaultMode: 'basic' } });
    const result = await registrar.reconcile();
    expect(result.removed).toBe(1);
    expect(await chrome.scripting.getRegisteredContentScripts()).toHaveLength(0);
  });

  it('leaves content scripts it does not own alone', async () => {
    await chrome.scripting.registerContentScripts([
      { id: 'other', js: ['x.js'], matches: ['*://*/*'] } as chrome.scripting.RegisteredContentScript,
    ]);
    await registrar.reconcile();
    const ids = (await chrome.scripting.getRegisteredContentScripts()).map((script) => script.id);
    expect(ids).toContain('other');
    expect(ids).toContain('sl-set-constant-0');
  });
});
