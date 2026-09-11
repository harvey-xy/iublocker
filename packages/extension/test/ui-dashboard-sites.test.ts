import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { SitesTab, readSiteModes } from '../src/ui/dashboard/tabs/SitesTab';
import { click, mockRouter, mount, setValue, text, unmount } from './ui-harness';

const dump = { siteModes: { 'example.com': 'off', 'news.example.org': 'complete', bogus: 42 } };

describe('Dashboard — Sites tab', () => {
  it('reads only valid site modes out of sites:get', () => {
    expect(readSiteModes(dump)).toEqual({ 'example.com': 'off', 'news.example.org': 'complete' });
    expect(readSiteModes({})).toBeNull();
    expect(readSiteModes(null)).toBeNull();
  });

  it('lists the overrides sorted by hostname', async () => {
    mockRouter({ 'sites:get': () => dump });
    const el = await mount(h(SitesTab, {}));
    const hosts = [...el.querySelectorAll('tbody td.mono')].map((n) => n.textContent);
    expect(hosts).toEqual(['example.com', 'news.example.org']);
    expect(el.querySelector<HTMLSelectElement>('select[data-site="example.com"]')?.value).toBe('off');
    unmount(el);
  });

  it('changes a mode through site:setMode', async () => {
    const router = mockRouter({
      'sites:get': () => dump,
      'site:setMode': () => ({ effectiveMode: 'basic' }),
    });
    const el = await mount(h(SitesTab, {}));
    await setValue(el.querySelector('select[data-site="example.com"]'), 'basic');
    expect(router.last('site:setMode')).toEqual({
      type: 'site:setMode',
      hostname: 'example.com',
      mode: 'basic',
    });
    unmount(el);
  });

  it('removes an override with mode: null', async () => {
    const router = mockRouter({
      'sites:get': () => dump,
      'site:setMode': () => ({ effectiveMode: 'optimal' }),
    });
    const el = await mount(h(SitesTab, {}));
    await click(el.querySelector('tbody .btn-danger'));
    expect(router.last('site:setMode')).toEqual({
      type: 'site:setMode',
      hostname: 'example.com',
      mode: null,
    });
    expect([...el.querySelectorAll('tbody td.mono')].map((n) => n.textContent)).toEqual(['news.example.org']);
    unmount(el);
  });

  it('rejects an invalid hostname before sending anything', async () => {
    const router = mockRouter({
      'sites:get': () => dump,
      'site:setMode': () => ({ effectiveMode: 'off' }),
    });
    const el = await mount(h(SitesTab, {}));
    await setValue(el.querySelector('[data-testid="sites-add-host"]'), 'not a host');
    await click(el.querySelector('tfoot .btn-primary'));
    expect(router.sent('site:setMode')).toHaveLength(0);
    expect(text(el)).toContain('sites_invalid_hostname');
    unmount(el);
  });

  it('adds a normalised hostname with the chosen mode', async () => {
    const router = mockRouter({
      'sites:get': () => dump,
      'site:setMode': () => ({ effectiveMode: 'basic' }),
    });
    const el = await mount(h(SitesTab, {}));
    await setValue(el.querySelector('[data-testid="sites-add-host"]'), '  Shop.Example.NET. ');
    await setValue(el.querySelector('[data-testid="sites-add-mode"]'), 'basic');
    await click(el.querySelector('tfoot .btn-primary'));
    expect(router.last('site:setMode')).toEqual({
      type: 'site:setMode',
      hostname: 'shop.example.net',
      mode: 'basic',
    });
    expect([...el.querySelectorAll('tbody td.mono')].map((n) => n.textContent)).toEqual([
      'example.com',
      'news.example.org',
      'shop.example.net',
    ]);
    unmount(el);
  });

  it('refuses a duplicate override', async () => {
    const router = mockRouter({
      'sites:get': () => dump,
      'site:setMode': () => ({ effectiveMode: 'off' }),
    });
    const el = await mount(h(SitesTab, {}));
    await setValue(el.querySelector('[data-testid="sites-add-host"]'), 'example.com');
    await click(el.querySelector('tfoot .btn-primary'));
    expect(router.sent('site:setMode')).toHaveLength(0);
    expect(text(el)).toContain('sites_duplicate');
    unmount(el);
  });
});
