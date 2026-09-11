import { describe, expect, it, afterEach } from 'vitest';
import { t, uiLanguage } from '../src/ui/lib/i18n';

const original = (globalThis as any).chrome.i18n;

afterEach(() => {
  (globalThis as any).chrome.i18n = original;
});

describe('t()', () => {
  it('returns the translated message when one exists', () => {
    (globalThis as any).chrome.i18n = {
      getMessage: (key: string) => (key === 'popup_blocked_tab' ? 'Blocked here' : ''),
      getUILanguage: () => 'zh-TW',
    };
    expect(t('popup_blocked_tab')).toBe('Blocked here');
    expect(uiLanguage()).toBe('zh-TW');
  });

  it('falls back to the key when the message is missing', () => {
    (globalThis as any).chrome.i18n = { getMessage: () => '' };
    expect(t('no_such_key')).toBe('no_such_key');
  });

  it('falls back to the key when chrome.i18n is unavailable', () => {
    (globalThis as any).chrome.i18n = undefined;
    expect(t('popup_blocked_tab')).toBe('popup_blocked_tab');
    expect(uiLanguage()).toBe('en');
  });

  it('passes substitutions through as strings', () => {
    const seen: unknown[] = [];
    (globalThis as any).chrome.i18n = {
      getMessage: (key: string, subs?: unknown) => {
        seen.push(subs);
        return `${key}:${Array.isArray(subs) ? subs.join(',') : ''}`;
      },
    };
    expect(t('popup_lists_enabled', [3])).toBe('popup_lists_enabled:3');
    expect(seen).toEqual([['3']]);
  });

  it('survives a throwing getMessage', () => {
    (globalThis as any).chrome.i18n = {
      getMessage: () => {
        throw new Error('boom');
      },
    };
    expect(t('anything')).toBe('anything');
  });
});
