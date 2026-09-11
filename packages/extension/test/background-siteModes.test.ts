import { beforeEach, describe, expect, it } from 'vitest';
import { ID_RANGE, PRIORITY } from '@iublocker/shared';
import * as siteModes from '../src/background/siteModes';
import * as store from '../src/background/storage/store';
import { resetBackground } from './background-utils';

describe('siteModes: resolution', () => {
  beforeEach(() => {
    resetBackground();
  });

  it('falls back to settings.defaultMode', async () => {
    expect(await siteModes.resolveMode('example.com')).toBe('optimal');
  });

  it('prefers the exact hostname, then parents', async () => {
    await store.set({ siteModes: { 'example.com': 'off', 'a.example.com': 'complete' } });
    expect(await siteModes.resolveMode('a.example.com')).toBe('complete');
    expect(await siteModes.resolveMode('b.a.example.com')).toBe('complete');
    expect(await siteModes.resolveMode('c.example.com')).toBe('off');
    expect(await siteModes.resolveMode('example.com')).toBe('off');
    expect(await siteModes.resolveMode('other.com')).toBe('optimal');
  });

  it('normalises the hostname before looking it up', async () => {
    await siteModes.setMode('Example.COM.', 'basic');
    expect(await siteModes.getExplicitMode('example.com')).toBe('basic');
    expect(await siteModes.resolveMode('EXAMPLE.com')).toBe('basic');
  });

  it('rejects invalid hostnames', async () => {
    await expect(siteModes.setMode('not a host', 'off')).rejects.toThrow(/invalid hostname/);
  });

  it('clears an override with null', async () => {
    await siteModes.setMode('example.com', 'off');
    expect(await siteModes.setMode('example.com', null)).toBe('optimal');
    expect(await siteModes.getExplicitMode('example.com')).toBeNull();
  });

  it('reports hostnames below optimal for the registrar', async () => {
    await store.set({ siteModes: { 'a.com': 'off', 'b.com': 'basic', 'c.com': 'complete' } });
    const below = await siteModes.hostsBelowOptimal();
    expect(below.hosts).toEqual(['a.com', 'b.com']);
    expect(below.defaultBelowOptimal).toBe(false);
  });
});

describe('siteModes: session rules', () => {
  let chromeMock: ReturnType<typeof resetBackground>;
  beforeEach(() => {
    chromeMock = resetBackground();
  });

  it('installs one allowAllRequests rule for off sites', async () => {
    await siteModes.setMode('example.com', 'off');
    const rules = chromeMock._state.sessionRules;
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: ID_RANGE.SITE.start,
      priority: PRIORITY.SITE_OFF,
      action: { type: 'allowAllRequests' },
      condition: { requestDomains: ['example.com'], resourceTypes: ['main_frame', 'sub_frame'] },
    });
    expect(rules[0].id).toBeGreaterThanOrEqual(ID_RANGE.SITE.start);
    expect(rules[0].id).toBeLessThanOrEqual(ID_RANGE.SITE.end);
  });

  it('removes the rule when the site is no longer off', async () => {
    await siteModes.setMode('example.com', 'off');
    await siteModes.setMode('example.com', 'optimal');
    expect(chromeMock._state.sessionRules).toHaveLength(0);
  });

  it('excludes sub-hostnames that opted back in', async () => {
    await store.set({ siteModes: { 'example.com': 'off', 'shop.example.com': 'complete' } });
    await siteModes.syncSessionRules();
    expect(chromeMock._state.sessionRules[0].condition).toMatchObject({
      requestDomains: ['example.com'],
      excludedRequestDomains: ['shop.example.com'],
    });
  });

  it('covers everything when the default mode is off', async () => {
    const settings = await store.get('settings');
    await store.set({ settings: { ...settings, defaultMode: 'off' }, siteModes: { 'news.com': 'optimal' } });
    await siteModes.syncSessionRules();
    const [rule] = chromeMock._state.sessionRules;
    expect(rule.condition).toMatchObject({ urlFilter: '*', excludedRequestDomains: ['news.com'] });
  });

  it('re-syncs from storage at worker start and replaces stale rules', async () => {
    // A rule left over from a previous session, for a site that is no longer off.
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: ID_RANGE.SITE.start,
          priority: PRIORITY.SITE_OFF,
          action: { type: 'allowAllRequests' },
          condition: { requestDomains: ['stale.com'], resourceTypes: ['main_frame', 'sub_frame'] },
        } as unknown as chrome.declarativeNetRequest.Rule,
      ],
    });
    await chrome.storage.local.set({ siteModes: { 'fresh.com': 'off' } });
    store.__resetForTests();

    await siteModes.syncSessionRules();
    const rules = chromeMock._state.sessionRules;
    expect(rules).toHaveLength(1);
    expect(rules[0].condition.requestDomains).toEqual(['fresh.com']);
  });

  it('leaves rules outside the site range alone', async () => {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: ID_RANGE.TEMP.start,
          action: { type: 'block' },
          condition: { urlFilter: 'x' },
        } as unknown as chrome.declarativeNetRequest.Rule,
      ],
    });
    await siteModes.setMode('example.com', 'off');
    expect(chromeMock._state.sessionRules.map((r: { id: number }) => r.id)).toContain(ID_RANGE.TEMP.start);
  });
});
