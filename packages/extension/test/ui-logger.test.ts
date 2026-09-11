import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import type { MatchedRuleSummary } from '@iublocker/shared';
import { Logger, parseTabId } from '../src/ui/logger/Logger';
import { click, mockRouter, mount, setValue, text, unmount } from './ui-harness';

const matched: MatchedRuleSummary[] = [
  {
    ruleId: 101,
    rulesetId: 'easylist',
    url: 'https://ads.example.com/banner.js',
    type: 'script',
    time: 1_700_000_000_000,
  },
  {
    ruleId: 202,
    rulesetId: 'easyprivacy',
    url: 'https://track.example.net/px.gif',
    type: 'image',
    time: 1_700_000_001_000,
  },
  {
    ruleId: 303,
    rulesetId: 'easylist',
    url: 'https://cdn.example.com/frame.html',
    type: 'sub_frame',
    time: 1_700_000_002_000,
  },
];

describe('Logger', () => {
  it('parses the tabId query parameter', () => {
    expect(parseTabId('?tabId=42')).toBe(42);
    expect(parseTabId('?tabId=abc')).toBeNull();
    expect(parseTabId('')).toBeNull();
    expect(parseTabId('?tabId=-1')).toBeNull();
  });

  it('asks the router for the tab and renders one row per matched rule', async () => {
    const router = mockRouter({ 'logger:get': () => ({ matched }) });
    const el = await mount(h(Logger, { tabId: 7 }));
    expect(router.last('logger:get')).toEqual({ type: 'logger:get', tabId: 7 });
    const rows = el.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('ads.example.com/banner.js');
    expect(rows[0]?.textContent).toContain('easylist');
    expect(rows[0]?.textContent).toContain('101');
    expect(el.querySelector('[data-testid="logger-count"]')?.textContent).toBe('logger_rows');
    unmount(el);
  });

  it('filters rows by url, type, ruleset and rule id', async () => {
    mockRouter({ 'logger:get': () => ({ matched }) });
    const el = await mount(h(Logger, { tabId: 7 }));
    await setValue(el.querySelector('[data-testid="logger-filter"]'), 'easyprivacy');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    await setValue(el.querySelector('[data-testid="logger-filter"]'), 'sub_frame');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    await setValue(el.querySelector('[data-testid="logger-filter"]'), '303');
    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
    await setValue(el.querySelector('[data-testid="logger-filter"]'), 'nothing-matches');
    expect(text(el)).toContain('logger_empty');
    unmount(el);
  });

  it('stops polling while paused', async () => {
    const router = mockRouter({ 'logger:get': () => ({ matched }) });
    const el = await mount(h(Logger, { tabId: 7 }));
    const before = router.sent('logger:get').length;
    await click(el.querySelector('.card-actions .btn'));
    expect(text(el)).toContain('logger_paused');
    expect(router.sent('logger:get')).toHaveLength(before);
    // resuming issues an immediate refresh
    await click(el.querySelector('.card-actions .btn'));
    expect(router.sent('logger:get').length).toBeGreaterThan(before);
    unmount(el);
  });

  it('explains the missing tabId instead of polling', async () => {
    const router = mockRouter({ 'logger:get': () => ({ matched }) });
    const el = await mount(h(Logger, { tabId: null }));
    expect(text(el)).toContain('logger_no_tab');
    expect(router.sent('logger:get')).toHaveLength(0);
    unmount(el);
  });
});
