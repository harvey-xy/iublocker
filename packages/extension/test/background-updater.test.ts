import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, ID_RANGE, type DeltaFile } from '@iublocker/shared';

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

import * as updater from '../src/background/updater';
import * as store from '../src/background/storage/store';
import {
  makeCosmeticDB,
  makeListEntry,
  makeRulesetManifest,
  makeScriptletDB,
  resetBackground,
  stubFetch,
  type FetchStub,
} from './background-utils';

const manifest = makeRulesetManifest({ lists: [makeListEntry('easylist')] });
const EXT_VERSION = '1.2.3';
const DELTA_PATH = `delta/${EXT_VERSION}.json`;

function makeDelta(patch: Partial<DeltaFile> = {}): DeltaFile {
  return {
    base: manifest.version,
    version: '2026.09.12.1',
    builtAt: '2026-09-12T00:00:00.000Z',
    dnr: {
      add: [
        { id: 0, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['newads.example'] } },
        { id: 0, priority: 1, action: { type: 'block' }, condition: { requestDomains: ['newads2.example'] } },
      ],
      disable: { easylist: [12, 34] },
    },
    cosmetic: {
      add: makeCosmeticDB('delta', { specific: { 'example.com': ['.fresh-ad'] } }),
      removeSpecific: { 'example.com': ['.stale-ad'] },
    },
    scriptlets: {
      add: makeScriptletDB('delta', { byHost: { 'example.com': [{ name: 'set-constant', args: ['x', '1'] }] } }),
      remove: { 'other.com': [{ name: 'noop', args: [] }] },
    },
    ...patch,
  };
}

let chromeMock: ReturnType<typeof resetBackground>;
let fetchStub: FetchStub;

function setup(routes: Record<string, unknown> = {}) {
  chromeMock = resetBackground({ manifestVersion: EXT_VERSION });
  fetchStub = stubFetch({ 'rulesets/manifest.json': manifest, ...routes });
}

describe('updater: validation', () => {
  beforeEach(() => setup());

  it('accepts a well-formed delta and rejects junk', () => {
    expect(updater.isDeltaFile(makeDelta())).toBe(true);
    expect(updater.isDeltaFile({ base: 'x' })).toBe(false);
    expect(updater.isDeltaFile({ base: 'x', version: 'y', dnr: { add: 'no' } })).toBe(false);
    expect(updater.isDeltaFile(null)).toBe(false);
  });

  it('refuses rules that redirect to a remote URL', () => {
    expect(
      updater.isSafeDeltaRule({
        id: 1,
        action: { type: 'redirect', redirect: { url: 'https://evil.example/x.js' } },
        condition: {},
      }),
    ).toBe(false);
    expect(
      updater.isSafeDeltaRule({
        id: 1,
        action: { type: 'redirect', redirect: { extensionPath: '/resources/noop.js' } },
        condition: {},
      }),
    ).toBe(true);
  });

  it('builds the documented delta URL', () => {
    expect(updater.deltaUrl(DEFAULT_SETTINGS.cloudDeltaBaseUrl, '1.2.3')).toBe(
      `${DEFAULT_SETTINGS.cloudDeltaBaseUrl}/delta/1.2.3.json`,
    );
    expect(updater.deltaUrl('https://example.com/base/', '1.0.0')).toBe('https://example.com/base/delta/1.0.0.json');
  });

  it('folds removals into exception sets', () => {
    const db = updater.foldCosmeticRemovals(makeCosmeticDB('delta'), { 'a.com': ['.x'] });
    expect(db.exceptions.selectors).toEqual({ 'a.com': ['.x'] });
    const sdb = updater.foldScriptletRemovals(makeScriptletDB('delta'), { 'a.com': [{ name: 'aopr', args: [] }] });
    expect(sdb.exceptions).toEqual({ 'a.com': ['aopr'] });
  });
});

describe('updater: apply', () => {
  beforeEach(() => setup({ [DELTA_PATH]: makeDelta() }));

  it('applies dnr adds, static disables and the stored DB', async () => {
    const result = await updater.runUpdate({ force: true });
    expect(result).toMatchObject({ ok: true, version: '2026.09.12.1' });

    const rules = chromeMock._state.dynamicRules;
    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe(ID_RANGE.DELTA.start);
    expect(rules[1].id).toBe(ID_RANGE.DELTA.start + 1);

    expect(chromeMock._state.calls.updateStaticRules[0]).toMatchObject({
      rulesetId: 'easylist',
      disableRuleIds: [12, 34],
    });

    const stored = await store.get('delta');
    expect(stored).toMatchObject({ base: manifest.version, version: '2026.09.12.1', disabled: { easylist: [12, 34] } });
    expect(stored?.cosmetic.specific['example.com']).toEqual(['.fresh-ad']);
    expect(stored?.cosmetic.exceptions.selectors['example.com']).toEqual(['.stale-ad']);
    expect(stored?.scriptlets.exceptions['other.com']).toEqual(['noop']);

    const state = await store.get('updater');
    expect(state.lastSuccess).toBeGreaterThan(0);
    expect(state.lastError).toBeUndefined();
  });

  it('broadcasts event:listsUpdated', async () => {
    await updater.runUpdate({ force: true });
    expect(chromeMock._state.calls.sendMessage).toContainEqual(
      expect.objectContaining({ type: 'event:listsUpdated', ok: true, version: '2026.09.12.1' }),
    );
  });

  it('skips an unchanged version but re-applies when forced', async () => {
    await updater.runUpdate({ force: true });
    const before = chromeMock._state.calls.updateStaticRules.length;
    expect(await updater.runUpdate()).toMatchObject({ skipped: 'unchanged' });
    expect(chromeMock._state.calls.updateStaticRules).toHaveLength(before);
  });

  it('honours the ETag and 304 responses', async () => {
    fetchStub.headers[DELTA_PATH] = { etag: 'W/"abc"' };
    await updater.runUpdate({ force: true });
    expect((await store.get('updater')).etag).toBe('W/"abc"');
    fetchStub.status[DELTA_PATH] = 304;
    expect(await updater.runUpdate({ force: true })).toMatchObject({ skipped: 'not-modified' });
  });

  it('does not run when autoUpdate is off (unless forced)', async () => {
    const settings = await store.get('settings');
    await store.set({ settings: { ...settings, autoUpdate: false } });
    expect(await updater.runUpdate()).toMatchObject({ skipped: 'disabled' });
    expect(await updater.runUpdate({ force: true })).toMatchObject({ ok: true });
  });

  it('drops unsafe remote redirects from the payload', async () => {
    setup({
      [DELTA_PATH]: makeDelta({
        dnr: {
          add: [
            { id: 0, action: { type: 'redirect', redirect: { url: 'https://evil.example/x' } }, condition: { urlFilter: 'a' } },
            { id: 0, action: { type: 'block' }, condition: { urlFilter: 'b' } },
          ],
          disable: {},
        },
      }),
    });
    await updater.runUpdate({ force: true });
    expect(chromeMock._state.dynamicRules).toHaveLength(1);
    expect(chromeMock._state.dynamicRules[0].action.type).toBe('block');
  });
});

describe('updater: failures', () => {
  it('discards a delta built for another ruleset snapshot', async () => {
    setup({ [DELTA_PATH]: makeDelta({ base: '1999.01.01.1' }) });
    const result = await updater.runUpdate({ force: true });
    expect(result).toMatchObject({ ok: false, skipped: 'base-mismatch' });
    expect(chromeMock._state.dynamicRules).toHaveLength(0);
    expect(await store.get('delta')).toBeNull();
  });

  it('reports a malformed delta without touching state', async () => {
    setup({ [DELTA_PATH]: { nonsense: true } });
    const result = await updater.runUpdate({ force: true });
    expect(result.ok).toBe(false);
    expect((await store.get('updater')).lastError).toMatch(/malformed/);
    expect(await store.get('delta')).toBeNull();
  });

  it('treats a missing delta file as "nothing to do"', async () => {
    setup();
    expect(await updater.runUpdate({ force: true })).toMatchObject({ skipped: 'no-delta' });
  });

  it('rolls the dynamic range back when the apply fails midway', async () => {
    setup({ [DELTA_PATH]: makeDelta() });
    // A previous delta is in place; its dynamic rules must survive a failed apply.
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [
        {
          id: ID_RANGE.DELTA.start,
          priority: 1,
          action: { type: 'block' },
          condition: { requestDomains: ['old.example'] },
        } as unknown as chrome.declarativeNetRequest.Rule,
      ],
    });
    const localSet = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (async (patch: Record<string, unknown>) => {
      if ('delta' in patch) throw new Error('quota exceeded');
      return localSet(patch);
    }) as typeof chrome.storage.local.set;

    const result = await updater.runUpdate({ force: true });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/quota exceeded/);

    const rules = chromeMock._state.dynamicRules;
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.requestDomains).toEqual(['old.example']);
    expect(await store.get('delta')).toBeNull();
    expect((await store.get('updater')).lastError).toMatch(/quota exceeded/);
  });
});

describe('updater: alarm', () => {
  beforeEach(() => setup());

  it('creates and clears the update alarm', async () => {
    await updater.scheduleAlarm();
    expect(chromeMock._state.alarms.get(updater.ALARM_NAME)).toMatchObject({ periodInMinutes: 360 });
    const settings = await store.get('settings');
    await store.set({ settings: { ...settings, autoUpdate: false } });
    await updater.scheduleAlarm();
    expect(chromeMock._state.alarms.has(updater.ALARM_NAME)).toBe(false);
  });

  it('ignores foreign alarms', async () => {
    updater.onAlarm({ name: 'something-else' } as chrome.alarms.Alarm);
    expect(updater.isRunning()).toBe(false);
  });
});
