import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import type { Settings } from '@iublocker/shared';
import { DEFAULT_SETTINGS } from '@iublocker/shared';
import { SettingsTab } from '../src/ui/dashboard/tabs/SettingsTab';
import { checked, click, mockRouter, mount, setValue, unmount } from './ui-harness';

function settingsRouter() {
  let current: Settings = { ...DEFAULT_SETTINGS, advanced: { ...DEFAULT_SETTINGS.advanced } };
  const router = mockRouter({
    'settings:get': () => current,
    'settings:set': (m: any) => {
      current = { ...current, ...m.patch };
      return current;
    },
  });
  return {
    router,
    get current() {
      return current;
    },
  };
}

describe('Dashboard — Settings tab', () => {
  it('renders the stored settings', async () => {
    settingsRouter();
    const el = await mount(h(SettingsTab, {}));
    expect(checked(el, 'showBadgeCount')).toBe(true);
    expect(checked(el, 'autoUpdate')).toBe(true);
    expect(checked(el, 'logMatchedRules')).toBe(false);
    expect(el.querySelector<HTMLInputElement>('[data-testid="updateIntervalHours"]')?.value).toBe('6');
    expect(el.querySelector<HTMLSelectElement>('[data-testid="updateChannel"]')?.value).toBe('stable');
    expect(el.querySelector<HTMLSelectElement>('[data-testid="theme"]')?.value).toBe('auto');
    expect(
      el.querySelector('[data-segmented="default-mode"] [aria-checked="true"]')?.getAttribute('data-value'),
    ).toBe('optimal');
    unmount(el);
  });

  it('round-trips a boolean through settings:set', async () => {
    const ctx = settingsRouter();
    const el = await mount(h(SettingsTab, {}));
    await click(el.querySelector('input[data-toggle="showBadgeCount"]'));

    expect(ctx.router.last('settings:set')).toEqual({
      type: 'settings:set',
      patch: { showBadgeCount: false },
    });
    expect(ctx.current.showBadgeCount).toBe(false);
    expect(checked(el, 'showBadgeCount')).toBe(false);
    expect(el.querySelector('[role="status"]')?.textContent).toBe('settings_saved');
    unmount(el);
  });

  it('clamps the update interval and keeps the rest of the settings', async () => {
    const ctx = settingsRouter();
    const el = await mount(h(SettingsTab, {}));
    await setValue(el.querySelector('[data-testid="updateIntervalHours"]'), '999');

    expect(ctx.router.last('settings:set')).toEqual({
      type: 'settings:set',
      patch: { updateIntervalHours: 168 },
    });
    expect(ctx.current.updateIntervalHours).toBe(168);
    expect(ctx.current.updateChannel).toBe('stable');
    unmount(el);
  });

  it('patches nested advanced flags without dropping siblings', async () => {
    const ctx = settingsRouter();
    const el = await mount(h(SettingsTab, {}));
    await click(el.querySelector('input[data-toggle="logMatchedRules"]'));

    expect(ctx.router.last('settings:set')).toEqual({
      type: 'settings:set',
      patch: { advanced: { logMatchedRules: true, allowTrustedUserScriptlets: false } },
    });
    expect(ctx.current.advanced.allowTrustedUserScriptlets).toBe(false);
    unmount(el);
  });

  it('applies the theme to the document root when it changes', async () => {
    settingsRouter();
    const el = await mount(h(SettingsTab, {}));
    await setValue(el.querySelector('[data-testid="theme"]'), 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await setValue(el.querySelector('[data-testid="theme"]'), 'auto');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    unmount(el);
  });

  it('changes the default mode from the segmented control', async () => {
    const ctx = settingsRouter();
    const el = await mount(h(SettingsTab, {}));
    await click(el.querySelector('[data-segmented="default-mode"] [data-value="complete"]'));
    expect(ctx.router.last('settings:set')).toEqual({
      type: 'settings:set',
      patch: { defaultMode: 'complete' },
    });
    unmount(el);
  });
});
