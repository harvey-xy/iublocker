import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, afterEach } from 'vitest';
import { SITE_MODES } from '@iublocker/shared';
import { t, uiLanguage } from '../src/ui/lib/i18n';
import { LIST_GROUP_ORDER } from '../src/ui/lib/mode-options';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', 'public', '_locales');
const uiDir = join(here, '..', 'src', 'ui');

type Messages = Record<string, { message: string }>;

function messages(locale: string): Messages {
  return JSON.parse(readFileSync(join(localesDir, locale, 'messages.json'), 'utf8')) as Messages;
}

function placeholders(message: string): string[] {
  return [...new Set(message.match(/\$\d/g) ?? [])].sort();
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Keys the UI asks for: literal `t('key')` plus the documented dynamic families. */
function usedKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sourceFiles(uiDir)) {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/\bt\(\s*'([a-z0-9_]+)'/g)) keys.add(m[1] as string);
  }
  for (const mode of SITE_MODES) {
    keys.add(`mode_${mode}`);
    keys.add(`mode_${mode}_desc`);
  }
  for (const group of LIST_GROUP_ORDER) keys.add(`group_${group}`);
  for (const channel of ['stable', 'nightly']) keys.add(`channel_${channel}`);
  for (const theme of ['auto', 'light', 'dark']) keys.add(`theme_${theme}`);
  return [...keys];
}

describe('_locales', () => {
  const en = messages('en');

  it('has the same key set in every locale', () => {
    const expected = Object.keys(en).sort();
    for (const locale of ['zh_TW', 'zh_CN']) {
      expect(Object.keys(messages(locale)).sort(), locale).toEqual(expected);
    }
  });

  it('uses the same $n placeholders in every locale', () => {
    for (const locale of ['zh_TW', 'zh_CN']) {
      const other = messages(locale);
      for (const [key, entry] of Object.entries(en)) {
        expect(placeholders(other[key]?.message ?? ''), `${locale}/${key}`).toEqual(
          placeholders(entry.message),
        );
      }
    }
  });

  it('defines every key the UI asks for', () => {
    const missing = usedKeys().filter((key) => !(key in en));
    expect(missing).toEqual([]);
  });

  it('has a non-empty message for every key', () => {
    for (const locale of ['en', 'zh_TW', 'zh_CN']) {
      const empty = Object.entries(messages(locale))
        .filter(([, entry]) => typeof entry.message !== 'string' || entry.message.trim() === '')
        .map(([key]) => key);
      expect(empty, locale).toEqual([]);
    }
  });
});

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
