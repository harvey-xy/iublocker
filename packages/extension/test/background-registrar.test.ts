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
    hash: 'aaa',
    file: 'scriptlet-groups/aaa.js',
    hosts: ['example.com', 'b.example.org'],
    listIds: ['easylist'],
  },
  { hash: 'bbb', file: 'scriptlet-groups/bbb.js', hosts: ['annoy.test'], listIds: ['annoy'] },
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
      id: 'sl-aaa',
      js: ['rulesets/scriptlet-groups/aaa.js'],
      matches: ['*://b.example.org/*', '*://*.b.example.org/*', '*://example.com/*', '*://*.example.com/*'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      persistAcrossSessions: true,
    });
  });

  it('excludes hosts in off/basic mode', () => {
    const [script] = registrar.buildDesired(groups, new Set(['easylist']), ['off.test']);
    expect(script?.excludeMatches).toEqual(['*://off.test/*', '*://*.off.test/*']);
  });

  it('derives the bundle path when the manifest has none', () => {
    expect(registrar.groupFilePath({ hash: 'zz', file: '', hosts: [], listIds: [] })).toBe(
      'rulesets/scriptlet-groups/zz.js',
    );
    expect(registrar.groupFilePath({ hash: 'zz', file: 'rulesets/x/zz.js', hosts: [], listIds: [] })).toBe(
      'rulesets/x/zz.js',
    );
  });
});

describe('registrar: reconcile', () => {
  beforeEach(setup);

  it('registers groups of enabled lists only', async () => {
    const result = await registrar.reconcile();
    expect(result.registered).toBe(1);
    const registered = await chrome.scripting.getRegisteredContentScripts();
    expect(registered.map((script) => script.id)).toEqual(['sl-aaa']);
  });

  it('registers and unregisters when a list is toggled', async () => {
    await registrar.reconcile();
    await store.set({ lists: { easylist: { enabled: false }, annoy: { enabled: true } } });
    const result = await registrar.reconcile();
    expect(result.removed).toBe(1);
    expect(result.registered).toBe(1);
    const registered = await chrome.scripting.getRegisteredContentScripts();
    expect(registered.map((script) => script.id)).toEqual(['sl-bbb']);
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
    expect(ids).toContain('sl-aaa');
  });
});
