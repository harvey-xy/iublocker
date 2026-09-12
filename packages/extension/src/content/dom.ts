/**
 * Framework-free DOM helpers shared by the cosmetic engine and the element picker.
 * Everything here must be safe to run at `document_start`, in sub-frames, and in
 * `about:blank` / `srcdoc` documents. Nothing here may throw into the page.
 */

type CssApi = { escape?: (value: string) => string };

const NEEDS_ESCAPE = /[^\w\u00a0-\uffff-]/g;

/** `CSS.escape` with a conservative fallback (jsdom has no `CSS.escape`). */
export function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: CssApi }).CSS;
  if (css && typeof css.escape === 'function') return css.escape(value);
  // A control character has no `\<char>` form (`\<newline>` is not an escape at all):
  // it must use the hex form or the whole selector fails to parse.
  let out = value.replace(NEEDS_ESCAPE, (c) => {
    const code = c.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? `\\${code.toString(16)} ` : `\\${c}`;
  });
  const first = value.charCodeAt(0);
  if (first >= 0x30 && first <= 0x39) out = `\\3${value[0] ?? ''} ${out.slice(1)}`;
  return out;
}

/*
 * Native DOM accessors, captured once. `HTMLFormElement` has a named-property getter
 * that shadows properties *and* prototype methods, so on a page like
 * `<form id=ad><input name=id><input name=getAttribute>` the expressions `el.id`,
 * `el.classList` and `el.getAttribute` all return page-controlled elements
 * ("DOM clobbering"). Everything that reads a token out of hostile DOM goes through
 * these, so a page cannot hide its ids/classes from the harvester.
 */
const nativeGetAttribute = Element.prototype.getAttribute;
const nativeElementQsa = Element.prototype.querySelectorAll;
const nativeMatches = Element.prototype.matches;

/** `getAttribute` through the native method; `null` when absent or unreadable. */
export function attribute(el: Element, name: string): string | null {
  try {
    return nativeGetAttribute.call(el, name);
  } catch {
    return null;
  }
}

/** The element's `id` attribute (clobber-proof), `''` when it has none. */
export function elementId(el: Element): string {
  return attribute(el, 'id') ?? '';
}

/** The element's class tokens (clobber-proof), split on ASCII whitespace. */
export function classTokens(el: Element): string[] {
  const raw = attribute(el, 'class');
  if (!raw) return [];
  const out: string[] = [];
  for (const token of raw.split(/[\t\n\f\r ]+/)) if (token !== '') out.push(token);
  return out;
}

/** `querySelectorAll` that never throws on an invalid selector. */
export function qsa(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** `qsa` for an element, through the native method (clobber-proof). */
export function qsaElement(el: Element, selector: string): Element[] {
  try {
    return Array.from(nativeElementQsa.call(el, selector));
  } catch {
    return [];
  }
}

/** `querySelectorAll` relative to `el`; a leading combinator is scoped with `:scope`. */
export function qsaScoped(el: Element, selector: string): Element[] {
  const s = selector.trim();
  const scoped = s.startsWith('>') || s.startsWith('+') || s.startsWith('~') ? `:scope ${s}` : s;
  return qsaElement(el, scoped);
}

/** `Element.matches` (native, clobber-proof) that never throws. */
export function matchesSafe(el: Element, selector: string): boolean {
  try {
    return nativeMatches.call(el, selector);
  } catch {
    return false;
  }
}

export type Matcher = (value: string) => boolean;

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/;
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    if ((first === '"' || first === "'") && text.endsWith(first)) return text.slice(1, -1);
  }
  return text;
}

function wildcardToRegExp(text: string): RegExp | null {
  try {
    return new RegExp(`^${text.replace(REGEX_SPECIALS, '\\$&').replace(/\\\*/g, '.*')}$`);
  } catch {
    return null;
  }
}

/**
 * Compiles a uBO-style value pattern: `/re/flags` is a regular expression, anything
 * else is a plain string (substring test, or exact test with `*` wildcards).
 * An invalid pattern compiles to a matcher that never matches.
 */
export function compileMatcher(raw: string, mode: 'substring' | 'exact' = 'substring'): Matcher {
  const text = raw.trim();
  const m = REGEX_LITERAL.exec(text);
  if (m) {
    let re: RegExp;
    try {
      re = new RegExp(m[1] ?? '', (m[2] ?? '').replace(/g/g, ''));
    } catch {
      return () => false;
    }
    return (value) => re.test(value);
  }
  const plain = unquote(text);
  if (mode === 'substring') return (value) => value.includes(plain);
  if (plain.includes('*')) {
    const re = wildcardToRegExp(plain);
    return re ? (value) => re.test(value) : () => false;
  }
  return (value) => value === plain;
}

/** Splits `key: value` at the first colon. Returns `null` for the value when absent. */
export function splitKeyValue(raw: string): [key: string, value: string | null] {
  const i = raw.indexOf(':');
  if (i === -1) return [raw.trim(), null];
  return [raw.slice(0, i).trim(), raw.slice(i + 1).trim()];
}

export interface StyleDeclaration {
  prop: string;
  value: string;
  important: boolean;
}

/** Parses a `:style()` body such as `opacity: .1 !important; color: red`. */
export function parseStyleDeclarations(text: string): StyleDeclaration[] {
  const out: StyleDeclaration[] = [];
  for (const chunk of text.split(';')) {
    const [prop, rawValue] = splitKeyValue(chunk);
    if (!prop || rawValue === null) continue;
    let value = rawValue;
    let important = false;
    const bang = value.toLowerCase().lastIndexOf('!important');
    if (bang !== -1) {
      important = true;
      value = value.slice(0, bang).trim();
    }
    if (!value) continue;
    out.push({ prop: prop.toLowerCase(), value, important });
  }
  return out;
}

/**
 * The hostname this frame should be filtered as. `about:blank`, `about:srcdoc` and
 * `data:` frames inherit the nearest same-origin ancestor's hostname.
 */
export function frameHostname(win: Window): string {
  const own = safeHostname(win);
  if (own) return own;
  let current: Window = win;
  for (let i = 0; i < 16; i++) {
    let parent: Window | null = null;
    try {
      parent = current.parent === current ? null : current.parent;
    } catch {
      return '';
    }
    if (!parent) return '';
    const host = safeHostname(parent);
    if (host) return host;
    current = parent;
  }
  return '';
}

/** The top frame's hostname when it is same-origin accessible, else `''`. */
export function topHostname(win: Window): string {
  try {
    const top = win.top;
    if (!top) return '';
    return safeHostname(top);
  } catch {
    return '';
  }
}

function safeHostname(win: Window): string {
  try {
    return (win.location.hostname || '').toLowerCase();
  } catch {
    return '';
  }
}

/** The element's inline style declaration, when it has one (SVG and HTML elements do). */
export function inlineStyle(el: Element): CSSStyleDeclaration | null {
  const style = (el as Element & { style?: CSSStyleDeclaration }).style;
  return style && typeof style.setProperty === 'function' ? style : null;
}

/** Absolute URL a media element tried to load, or `''`. */
export function elementUrl(el: Element): string {
  const tag = el.localName;
  let raw = '';
  if (tag === 'object') raw = el.getAttribute('data') ?? '';
  else raw = el.getAttribute('src') ?? '';
  if (!raw) {
    const withSrc = el as { currentSrc?: string; src?: string };
    raw = withSrc.currentSrc || withSrc.src || '';
  }
  if (!raw) return '';
  try {
    return new URL(raw, el.ownerDocument.baseURI).href;
  } catch {
    return raw;
  }
}
