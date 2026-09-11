import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@iublocker/shared';
import * as store from '../src/background/storage/store';
import { resetBackground } from './background-utils';

describe('store', () => {
  beforeEach(() => {
    resetBackground();
  });

  it('hydrates once per worker start with a single storage.local.get', async () => {
    const spy = vi.spyOn(chrome.storage.local, 'get');
    await Promise.all([store.get('settings'), store.get('siteModes'), store.get('stats')]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(null);
  });

  it('fills in defaults for keys that were never written', async () => {
    expect(await store.get('settings')).toEqual(DEFAULT_SETTINGS);
    expect(await store.get('siteModes')).toEqual({});
    expect(await store.get('delta')).toBeNull();
  });

  it('merges partial settings from storage with the current defaults', async () => {
    await chrome.storage.local.set({ settings: { theme: 'dark', advanced: { logMatchedRules: true } } });
    store.__resetForTests();
    const settings = await store.get('settings');
    expect(settings.theme).toBe('dark');
    expect(settings.advanced).toEqual({ logMatchedRules: true, allowTrustedUserScriptlets: false });
    expect(settings.updateIntervalHours).toBe(DEFAULT_SETTINGS.updateIntervalHours);
  });

  it('writes through to storage and notifies listeners exactly once', async () => {
    const seen: string[][] = [];
    store.onChange('siteModes', (value) => seen.push(Object.keys(value)));
    await store.set({ siteModes: { 'a.com': 'off' } });
    (chrome.storage.onChanged as unknown as { emit(changes: unknown, area: string): void }).emit(
      { siteModes: { newValue: { 'a.com': 'off' } } },
      'local',
    );
    expect(seen).toEqual([['a.com']]);
    expect(
      (chrome.storage.local as unknown as { _dump(): Record<string, unknown> })._dump().siteModes,
    ).toEqual({
      'a.com': 'off',
    });
  });

  it('picks up changes made by another extension context', async () => {
    await store.get('siteModes');
    const seen: unknown[] = [];
    store.onChange('siteModes', (value) => seen.push(value));
    store.handleStorageChanged({ siteModes: { newValue: { 'b.com': 'complete' } } }, 'local');
    expect(await store.get('siteModes')).toEqual({ 'b.com': 'complete' });
    expect(seen).toHaveLength(1);
  });

  it('ignores changes to other storage areas', async () => {
    await store.get('siteModes');
    store.handleStorageChanged({ siteModes: { newValue: { 'c.com': 'off' } } }, 'session');
    expect(await store.get('siteModes')).toEqual({});
  });

  it('does not update the cache when the write fails', async () => {
    await store.get('siteModes');
    const original = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (async () => {
      throw new Error('quota');
    }) as typeof chrome.storage.local.set;
    await expect(store.set({ siteModes: { 'd.com': 'off' } })).rejects.toThrow('quota');
    expect(await store.get('siteModes')).toEqual({});
    chrome.storage.local.set = original;
  });

  it('read-modify-writes a key', async () => {
    await store.update('stats', (stats) => ({ ...stats, blockedTotal: stats.blockedTotal + 5 }));
    expect((await store.get('stats')).blockedTotal).toBe(5);
  });

  it('keeps per-tab session state', async () => {
    await store.session.patchTab(3, { hostname: 'example.com', lastUrl: 'https://example.com/' });
    await store.session.patchTab(3, { blocked: 4 });
    expect(await store.session.getTab(3)).toEqual({
      hostname: 'example.com',
      lastUrl: 'https://example.com/',
      blocked: 4,
    });
    await store.session.setPickerActive(3, true);
    expect(await store.session.isPickerActive(3)).toBe(true);
    await store.session.dropTab(3);
    expect(await store.session.getTab(3)).toBeNull();
    expect(await store.session.isPickerActive(3)).toBe(false);
  });
});
