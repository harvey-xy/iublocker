import { beforeEach, describe, expect, it } from 'vitest';
import { h } from 'preact';
import { act } from 'preact/test-utils';
import { DEFAULT_SETTINGS } from '@iublocker/shared';
import { Dashboard } from '../src/ui/dashboard/Dashboard';
import { flush, mockRouter, mount, text, unmount } from './ui-harness';

function router() {
  return mockRouter({
    'settings:get': () => DEFAULT_SETTINGS,
    'lists:get': () => ({
      lists: [],
      rulesetVersion: '2026.01.02.1',
      deltaVersion: null,
      budget: { used: 0, available: 10, total: 10 },
      updater: { lastCheck: 0, lastSuccess: 0 },
    }),
    'filters:getUser': () => ({ text: '', warnings: [], counts: { dnr: 0, cosmetic: 0, scriptlets: 0 } }),
    'debug:dumpState': () => ({ siteModes: {} }),
  });
}

beforeEach(() => {
  location.hash = '';
});

describe('Dashboard shell', () => {
  it('defaults to the Lists tab and exposes tab semantics', async () => {
    router();
    const el = await mount(h(Dashboard, {}));
    const tabs = [...el.querySelectorAll('[role="tab"]')].map((n) => n.textContent);
    expect(tabs).toEqual(['tab_lists', 'tab_filters', 'tab_sites', 'tab_settings', 'tab_about']);
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('tab_lists');
    expect(el.querySelector('[role="tabpanel"]')?.id).toBe('panel-lists');
    unmount(el);
  });

  it('switches panels on hash change', async () => {
    router();
    const el = await mount(h(Dashboard, {}));
    await act(async () => {
      location.hash = '#filters';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await flush();
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('tab_filters');
    expect(text(el)).toContain('filters_title');
    unmount(el);
  });

  it('falls back to Lists for an unknown hash', async () => {
    location.hash = '#nope';
    router();
    const el = await mount(h(Dashboard, {}));
    expect(el.querySelector('[aria-selected="true"]')?.textContent).toBe('tab_lists');
    unmount(el);
  });
});
