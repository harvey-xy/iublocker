import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import type { ListsGetResponse, Settings, TabState } from '@iublocker/shared';
import { DEFAULT_SETTINGS } from '@iublocker/shared';
import { Popup } from '../src/ui/popup/Popup';
import { click, mockRouter, mount, text, unmount } from './ui-harness';

const tabState: TabState = {
  tabId: 7,
  url: 'https://example.com/page',
  hostname: 'example.com',
  mode: null,
  effectiveMode: 'basic',
  blockedCount: 12,
  listsEnabled: 4,
  hasScriptlets: true,
  hasCosmetic: true,
  isInternal: false,
};

const settings: Settings = { ...DEFAULT_SETTINGS, defaultMode: 'optimal' };

const listsResponse: ListsGetResponse = {
  lists: [],
  rulesetVersion: '2026.01.02.1',
  deltaVersion: '2026.01.09.3',
  budget: { used: 100, available: 900, total: 1000 },
  updater: { lastCheck: 0, lastSuccess: 0 },
};

function routes(overrides: Record<string, (m: any) => unknown> = {}) {
  return mockRouter({
    'tab:getState': () => tabState,
    'settings:get': () => settings,
    'stats:get': () => ({ since: 0, blockedTotal: 4242, perDay: {} }),
    'lists:get': () => listsResponse,
    'site:setMode': (m: any) => ({ effectiveMode: m.mode ?? settings.defaultMode }),
    'picker:start': () => ({ started: true }),
    'lists:update': () => ({ started: true }),
    ...overrides,
  });
}

beforeEach(() => {
  (globalThis as any).chrome.tabs.query = async () => [{ id: 7, url: tabState.url }];
  (globalThis as any).chrome.tabs.create = () => {};
  (globalThis as any).chrome.tabs.reload = () => {};
  // jsdom's window.close() tears the document down; the popup legitimately calls it.
  Object.defineProperty(window, 'close', { value: () => {}, configurable: true, writable: true });
});

describe('Popup', () => {
  it('renders the site, counters and versions', async () => {
    routes();
    const el = await mount(h(Popup, {}));
    expect(el.querySelector('.pop-host')?.textContent).toBe('example.com');
    const counts = [...el.querySelectorAll('.pop-count-value')].map((n) => n.textContent);
    expect(counts).toEqual(['12', '4,242']);
    expect(text(el)).toContain('popup_version');
    unmount(el);
  });

  it('reflects effectiveMode in the mode radiogroup and marks the default', async () => {
    routes();
    const el = await mount(h(Popup, {}));
    const group = el.querySelector('[data-segmented="site-mode"]');
    expect(group?.getAttribute('role')).toBe('radiogroup');
    const radios = [...(group?.querySelectorAll('[role="radio"]') ?? [])];
    expect(radios.map((r) => r.getAttribute('data-value'))).toEqual(['off', 'basic', 'optimal', 'complete']);
    expect(group?.querySelector('[aria-checked="true"]')?.getAttribute('data-value')).toBe('basic');
    // settings.defaultMode === 'optimal' carries the "(default)" marker
    expect(group?.querySelector('[data-value="optimal"] .segment-marker')).toBeTruthy();
    expect(group?.querySelector('[data-value="basic"] .segment-marker')).toBeNull();
    unmount(el);
  });

  it('sends site:setMode with the hostname and clicked mode, then offers a reload', async () => {
    const router = routes();
    const el = await mount(h(Popup, {}));
    await click(el.querySelector('[data-segmented="site-mode"] [data-value="complete"]'));

    expect(router.last('site:setMode')).toEqual({
      type: 'site:setMode',
      hostname: 'example.com',
      mode: 'complete',
    });
    expect(
      el.querySelector('[data-segmented="site-mode"] [aria-checked="true"]')?.getAttribute('data-value'),
    ).toBe('complete');
    expect(text(el)).toContain('popup_reload_to_apply');
    // an override now exists, so the reset action shows up
    expect(text(el)).toContain('popup_reset_default');
    unmount(el);
  });

  it('resets the per-site override with mode: null', async () => {
    const router = routes({ 'tab:getState': () => ({ ...tabState, mode: 'off', effectiveMode: 'off' }) });
    const el = await mount(h(Popup, {}));
    expect(text(el)).toContain('popup_reset_default');
    const reset = [...el.querySelectorAll('.pop-override .btn')][0];
    await click(reset);
    expect(router.last('site:setMode')).toEqual({
      type: 'site:setMode',
      hostname: 'example.com',
      mode: null,
    });
    unmount(el);
  });

  it('starts the picker for the active tab', async () => {
    const router = routes();
    const el = await mount(h(Popup, {}));
    const pick = [...el.querySelectorAll('.pop-actions .btn')].find(
      (b) => b.textContent === 'popup_pick_element',
    );
    await click(pick);
    expect(router.last('picker:start')).toEqual({ type: 'picker:start', tabId: 7 });
    unmount(el);
  });

  it('shows the internal-page state without a mode selector', async () => {
    routes({
      'tab:getState': () => ({ ...tabState, hostname: '', url: 'chrome://extensions', isInternal: true }),
    });
    const el = await mount(h(Popup, {}));
    expect(el.querySelector('.pop-host')?.textContent).toBe('popup_internal_page');
    expect(el.querySelector('[data-segmented="site-mode"]')).toBeNull();
    unmount(el);
  });

  it('triggers a list update and reacts to event:listsUpdated', async () => {
    const router = routes();
    const el = await mount(h(Popup, {}));
    const update = [...el.querySelectorAll('.pop-foot .btn')][0];
    await click(update);
    expect(router.last('lists:update')).toEqual({ type: 'lists:update' });
    expect(text(el)).toContain('popup_updating');
    unmount(el);
  });
});
