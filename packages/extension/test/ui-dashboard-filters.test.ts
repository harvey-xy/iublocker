import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import type { UserFiltersResponse } from '@iublocker/shared';
import { FiltersTab } from '../src/ui/dashboard/tabs/FiltersTab';
import { click, mockRouter, mount, setValue, text, unmount } from './ui-harness';

const initial: UserFiltersResponse = {
  text: '! mine\nexample.com##.ad',
  warnings: [],
  counts: { dnr: 0, cosmetic: 1, scriptlets: 0 },
};

describe('Dashboard — My filters tab', () => {
  it('loads the stored text and counts its lines', async () => {
    mockRouter({ 'filters:getUser': () => initial });
    const el = await mount(h(FiltersTab, {}));
    expect(el.querySelector<HTMLTextAreaElement>('.filters-area')?.value).toBe(initial.text);
    expect(el.querySelector('[data-testid="filters-lines"]')?.textContent).toBe('filters_lines');
    expect(text(el)).toContain('filters_no_warnings');
    unmount(el);
  });

  it('applies edits through filters:setUser and renders the returned warnings', async () => {
    const router = mockRouter({
      'filters:getUser': () => initial,
      'filters:setUser': (m: any): UserFiltersResponse => ({
        text: m.text,
        warnings: ['line 2: unsupported option $foo'],
        counts: { dnr: 1, cosmetic: 1, scriptlets: 0 },
      }),
    });
    const el = await mount(h(FiltersTab, {}));
    await setValue(el.querySelector('.filters-area'), '||ads.example.com^$foo');
    await click(el.querySelector('.card-actions .btn'));

    expect(router.last('filters:setUser')).toEqual({
      type: 'filters:setUser',
      text: '||ads.example.com^$foo',
    });
    expect(el.querySelector('.warnings')?.textContent).toContain('unsupported option $foo');
    expect(text(el)).toContain('filters_applied');
    unmount(el);
  });

  it('disables Apply until the text changes', async () => {
    mockRouter({ 'filters:getUser': () => initial });
    const el = await mount(h(FiltersTab, {}));
    const apply = el.querySelector<HTMLButtonElement>('.card-actions .btn');
    expect(apply?.disabled).toBe(true);
    await setValue(el.querySelector('.filters-area'), 'example.org##.x');
    expect(el.querySelector<HTMLButtonElement>('.card-actions .btn')?.disabled).toBe(false);
    unmount(el);
  });
});
