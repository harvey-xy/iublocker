/**
 * Selector generation for the element picker (docs/COSMETIC-FILTERING.md §5).
 *
 * Pure functions over a DOM tree — no chrome APIs, no UI — so the heuristics are
 * unit-testable in jsdom. Preference order for a target element:
 * `#id` (stable and unique) → tag + stable classes → `[attr]` → positional path
 * capped at depth 6. Classes and ids that look machine-generated are dropped.
 */

import { classTokens, cssEscape, elementId, matchesSafe, qsa } from './dom';

/** CSS-in-JS prefixes with a hashed suffix: `css-1x2y3z`, `sc-bdVaJa`, `jss42`. */
const GENERATED_PREFIX =
  /^(?:css|sc|jsx|jss|emotion|glamor|makeStyles|MuiBox)-(?=[A-Za-z0-9]*\d|[a-z0-9]*[A-Z])[A-Za-z0-9]{4,}$/;
const NUMBERED_PREFIX = /^(?:jss|css|sc)\d{1,6}$/;
const HEX_HASH = /^[a-f0-9]{6,}$/i;
/** Trailing chunk of a token, e.g. `banner` in `ad-banner`, `a1b2c` in `Button_a1b2c`. */
const TOKEN_TAIL = /(?:^|[_-])([A-Za-z0-9]{5,})$/;
const NUMERIC_ID = /^[A-Za-z_-]*\d{2,}[A-Za-z_-]*$/;
const MAX_CLASSES = 3;
export const MAX_PATH_DEPTH = 6;
/** Attributes worth using as a selector anchor when there is no usable class. */
const ATTR_CANDIDATES = /^(?:data-[\w-]+|aria-label|role|name|type|alt|title)$/;
const MAX_ATTR_VALUE = 40;

/**
 * A control character or line separator cannot go inside a CSS string (the selector
 * would not parse) and must never reach a one-line filter, so such values fall back to
 * the bare `[attr]` form.
 */
function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/** True when a class/id token looks machine-generated (hash, CSS-in-JS, random). */
export function isGeneratedToken(token: string): boolean {
  if (token.length === 0 || token.length > 24) return true;
  if (/^\d/.test(token)) return true;
  if (GENERATED_PREFIX.test(token) || NUMBERED_PREFIX.test(token)) return true;
  if (HEX_HASH.test(token)) return true;
  return hasHashedTail(token);
}

/** A tail mixing at least two letters and two digits (`Button_a1b2c`, `x9fK2q`). */
function hasHashedTail(token: string): boolean {
  const m = TOKEN_TAIL.exec(token);
  const tail = m?.[1] ?? '';
  if (tail.length < 5) return false;
  const digits = tail.replace(/\D/g, '').length;
  const letters = tail.replace(/[^A-Za-z]/g, '').length;
  return digits >= 2 && letters >= 2;
}

/** True when an id is worth using: stable-looking and not an instance counter. */
export function isUsableId(id: string | null | undefined): boolean {
  if (!id) return false;
  if (/\s/.test(id)) return false;
  if (isGeneratedToken(id)) return false;
  if (NUMERIC_ID.test(id)) return false;
  return true;
}

/** The element's classes with generated-looking ones removed (capped). */
export function stableClasses(el: Element): string[] {
  const out: string[] = [];
  for (const token of classTokens(el)) {
    if (out.length >= MAX_CLASSES) break;
    if (isGeneratedToken(token)) continue;
    out.push(token);
  }
  return out;
}

export function countMatches(doc: Document, selector: string): number {
  return qsa(doc, selector).length;
}

function idSelector(el: Element): string | null {
  const id = elementId(el);
  if (!isUsableId(id)) return null;
  const selector = `#${cssEscape(id)}`;
  const doc = el.ownerDocument;
  if (doc && countMatches(doc, selector) !== 1) return null;
  return selector;
}

function classSelector(el: Element, limit = MAX_CLASSES): string | null {
  const classes = stableClasses(el).slice(0, limit);
  if (classes.length === 0) return null;
  return `${el.localName}${classes.map((c) => `.${cssEscape(c)}`).join('')}`;
}

/** `tag[data-x="y"]` for a stable-looking attribute, when classes are unusable. */
export function attributeSelector(el: Element): string | null {
  for (const attr of Array.from(el.attributes)) {
    if (!ATTR_CANDIDATES.test(attr.name)) continue;
    const value = attr.value;
    if (value.length === 0 || value.length > MAX_ATTR_VALUE) {
      return `${el.localName}[${attr.name}]`;
    }
    if (isGeneratedToken(value) || hasUnsafeChar(value)) {
      return `${el.localName}[${attr.name}]`;
    }
    return `${el.localName}[${attr.name}="${value.replace(/["\\]/g, '\\$&')}"]`;
  }
  return null;
}

/** 1-based `:nth-of-type` index, or 0 when the element is the only one of its type. */
export function nthOfTypeIndex(el: Element): number {
  const parent = el.parentElement;
  if (!parent) return 0;
  let index = 0;
  let count = 0;
  for (const sibling of Array.from(parent.children)) {
    if (sibling.localName !== el.localName) continue;
    count += 1;
    if (sibling === el) index = count;
  }
  return count > 1 ? index : 0;
}

/** Positional path, anchored on a unique id when one is found, capped at `maxDepth`. */
export function pathSelector(el: Element, maxDepth = MAX_PATH_DEPTH): string {
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && depth < maxDepth; depth++) {
    const tag = node.localName;
    if (tag === 'html' || tag === 'body') {
      parts.unshift(tag);
      break;
    }
    if (depth > 0) {
      const id = idSelector(node);
      if (id) {
        parts.unshift(id);
        break;
      }
    }
    const index = nthOfTypeIndex(node);
    parts.unshift(index > 0 ? `${tag}:nth-of-type(${index})` : tag);
    node = node.parentElement;
  }
  return parts.join(' > ');
}

/** The selector the picker starts from. */
export function generateSelector(el: Element): string {
  const id = idSelector(el);
  if (id) return id;
  const classes = classSelector(el);
  if (classes && matchesSafe(el, classes)) return classes;
  const attr = attributeSelector(el);
  if (attr && matchesSafe(el, attr)) return attr;
  return pathSelector(el);
}

/** Selector variants for one element, ordered narrowest → broadest. */
export function elementVariants(el: Element): string[] {
  const out: string[] = [];
  const push = (selector: string | null): void => {
    if (!selector) return;
    if (out.includes(selector)) return;
    if (!matchesSafe(el, selector)) return;
    out.push(selector);
  };
  push(pathSelector(el));
  push(idSelector(el));
  push(classSelector(el));
  push(classSelector(el, 1));
  if (stableClasses(el).length === 0) push(attributeSelector(el));
  push(el.localName);
  return out;
}

export interface LadderEntry {
  element: Element;
  /** 0 = the clicked element, 1 = its parent, … */
  depth: number;
  selector: string;
}

/** Ancestor chain of `el` (inclusive), stopping at `<body>`. */
export function ancestorChain(el: Element, maxDepth = MAX_PATH_DEPTH): Element[] {
  const chain: Element[] = [];
  let node: Element | null = el;
  while (node && chain.length <= maxDepth) {
    chain.push(node);
    if (node.localName === 'body' || node.localName === 'html') break;
    node = node.parentElement;
  }
  return chain;
}

/**
 * The full broaden/narrow ladder: every variant of the clicked element (narrow →
 * broad) followed by every variant of each ancestor. Index 0 is the narrowest.
 */
export function buildLadder(target: Element, maxDepth = MAX_PATH_DEPTH): LadderEntry[] {
  const out: LadderEntry[] = [];
  const seen = new Set<string>();
  ancestorChain(target, maxDepth).forEach((element, depth) => {
    for (const selector of elementVariants(element)) {
      if (seen.has(selector)) continue;
      seen.add(selector);
      out.push({ element, depth, selector });
    }
  });
  if (out.length === 0) out.push({ element: target, depth: 0, selector: target.localName });
  return out;
}

/** Index of the selector the picker should start on. */
export function defaultLadderIndex(ladder: readonly LadderEntry[], target: Element): number {
  const preferred = generateSelector(target);
  const index = ladder.findIndex((entry) => entry.depth === 0 && entry.selector === preferred);
  if (index !== -1) return index;
  const first = ladder.findIndex((entry) => entry.depth === 0);
  return first === -1 ? 0 : first;
}

/** One step towards a broader selector (up the variants, then up the ancestors). */
export function broadenIndex(index: number, ladder: readonly LadderEntry[]): number {
  return Math.min(index + 1, Math.max(ladder.length - 1, 0));
}

/** One step towards a narrower / more specific selector. */
export function narrowIndex(index: number): number {
  return Math.max(index - 1, 0);
}

/**
 * `hostname##selector`, the cosmetic filter the picker creates — or `null` when either
 * half is missing. Without a hostname the line would be `##selector`, a *generic*
 * filter that hides the element on every site the user visits, so this fails closed.
 */
export function filterFor(hostname: string, selector: string): string | null {
  if (hostname === '' || selector === '') return null;
  return `${hostname}##${selector}`;
}
