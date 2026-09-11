/**
 * Tiny wrapper over `chrome.i18n`. Every user-facing string in the UI goes through `t()`.
 * Missing messages fall back to the key so a forgotten translation is obvious but harmless.
 */

type I18nApi = {
  getMessage(key: string, substitutions?: string | string[]): string;
  getUILanguage?(): string;
};

function api(): I18nApi | undefined {
  const c = (globalThis as { chrome?: { i18n?: I18nApi } }).chrome;
  return c && c.i18n && typeof c.i18n.getMessage === 'function' ? c.i18n : undefined;
}

/** Translate `key`, optionally substituting `$1`…`$9`. Falls back to `key`. */
export function t(key: string, substitutions?: string | (string | number)[]): string {
  const i18n = api();
  if (!i18n) return key;
  const subs = Array.isArray(substitutions) ? substitutions.map(String) : substitutions;
  let message = '';
  try {
    message = i18n.getMessage(key, subs);
  } catch {
    message = '';
  }
  return message === '' || message == null ? key : message;
}

/** UI language reported by the browser, e.g. `zh-TW`. */
export function uiLanguage(): string {
  const i18n = api();
  try {
    return i18n?.getUILanguage?.() || 'en';
  } catch {
    return 'en';
  }
}
