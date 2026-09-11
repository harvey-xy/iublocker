import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import type { ListsGetResponse, RulesetListEntry } from '@iublocker/shared';
import { ListsTab } from '../src/ui/dashboard/tabs/ListsTab';
import { click, mockRouter, mount, text, unmount } from './ui-harness';

function entry(
  id: string,
  group: RulesetListEntry['group'],
  enabled: boolean,
): ListsGetResponse['lists'][number] {
  return {
    id,
    title: `${id} title`,
    group,
    defaultEnabled: true,
    trusted: true,
    license: 'CC BY-SA 3.0',
    homepage: `https://example.org/${id}`,
    sources: [],
    counts: {
      dnr: 1000,
      regex: 2,
      cosmeticGeneric: 10,
      cosmeticSpecific: 20,
      procedural: 5,
      scriptlets: 3,
      dropped: 0,
    },
    files: { dnr: `dnr/${id}.json`, cosmetic: `cosmetic/${id}.json`, scriptlets: `scriptlets/${id}.json` },
    enabled,
  };
}

const response: ListsGetResponse = {
  lists: [entry('easyprivacy', 'privacy', false), entry('easylist', 'ads', true)],
  rulesetVersion: '2026.01.02.1',
  deltaVersion: null,
  budget: { used: 2000, available: 8000, total: 10000 },
  updater: { lastCheck: 1_700_000_000_000, lastSuccess: 1_700_000_000_000, lastError: 'network down' },
};

describe('Dashboard — Lists tab', () => {
  it('renders one card per list group, in group order', async () => {
    mockRouter({ 'lists:get': () => response });
    const el = await mount(h(ListsTab, {}));
    const titles = [...el.querySelectorAll('.card-title')].map((n) => n.textContent);
    expect(titles).toEqual(['lists_budget_title', 'group_ads', 'group_privacy']);
    expect(text(el)).toContain('easylist title');
    expect(text(el)).toContain('easyprivacy title');
    unmount(el);
  });

  it('shows the budget meter and the updater error', async () => {
    mockRouter({ 'lists:get': () => response });
    const el = await mount(h(ListsTab, {}));
    const meter = el.querySelector<HTMLElement>('.meter');
    expect(meter?.getAttribute('aria-label')).toBe('lists_budget_summary');
    expect(meter?.querySelector<HTMLElement>('.meter-fill')?.style.width).toBe('20%');
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('lists_last_error');
    unmount(el);
  });

  it('toggles a list through lists:setEnabled and applies the returned budget', async () => {
    const router = mockRouter({
      'lists:get': () => response,
      'lists:setEnabled': (m: any) => ({
        enabled: m.enabled,
        budget: { used: 1000, available: 9000, total: 10000 },
      }),
    });
    const el = await mount(h(ListsTab, {}));
    const toggle = el.querySelector<HTMLInputElement>('input[data-toggle="easylist"]');
    expect(toggle?.checked).toBe(true);
    await click(toggle);

    expect(router.last('lists:setEnabled')).toEqual({
      type: 'lists:setEnabled',
      listId: 'easylist',
      enabled: false,
    });
    expect(el.querySelector<HTMLInputElement>('input[data-toggle="easylist"]')?.checked).toBe(false);
    expect(el.querySelector<HTMLElement>('.meter-fill')?.style.width).toBe('10%');
    unmount(el);
  });

  it('triggers lists:update from "Update now"', async () => {
    const router = mockRouter({ 'lists:get': () => response, 'lists:update': () => ({ started: true }) });
    const el = await mount(h(ListsTab, {}));
    await click(el.querySelector('.card-actions .btn'));
    expect(router.last('lists:update')).toEqual({ type: 'lists:update' });
    unmount(el);
  });

  it('surfaces a router error with a retry affordance', async () => {
    mockRouter({});
    const el = await mount(h(ListsTab, {}));
    expect(el.querySelector('.errorbox')?.textContent).toContain('no route for lists:get');
    unmount(el);
  });
});
