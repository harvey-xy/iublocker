/** External links used by the UI. Kept in one place so the repo can be forked cleanly. */
export const REPO_URL = 'https://github.com/harvey-xy/iublocker';
export const FILTER_SYNTAX_URL = `${REPO_URL}/blob/main/docs/FILTER-SYNTAX.md`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/**
 * An `http(s)` URL, or `null`. List metadata (`title`, `homepage`, `license`) can come
 * from the list *text* (`! Homepage:` — `packages/compiler/src/parser/classify.ts`), so
 * it is list-controlled: never put it in an `href` unnormalised. Extension-page CSP
 * blocks `javascript:` from running, but a `data:`/`blob:`/`chrome-extension:` link
 * should not be offered either.
 */
export function safeHttpUrl(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** True when a settings URL is acceptable to store (`settings:set` enforces the same). */
export function isHttpsUrl(raw: string): boolean {
  try {
    return new URL(raw).protocol === 'https:';
  } catch {
    return false;
  }
}
