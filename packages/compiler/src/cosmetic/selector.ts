/**
 * Permissive CSS-selector scanning used by the cosmetic compiler.
 *
 * This is deliberately *not* a full CSS parser: it only has to be good enough to
 * (a) reject obviously broken selectors, (b) find pseudo-classes at the top level of
 * a selector so the procedural chain parser can split on them, and (c) extract the
 * generic `byId` / `byClass` key of a "simple" selector.
 */

/** `s.charAt(i)` is used everywhere instead of `s[i]` (noUncheckedIndexedAccess). */
function at(s: string, i: number): string {
  return i >= 0 && i < s.length ? s.charAt(i) : '';
}

export function isNameChar(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === '_';
}

/** Characters that may appear in an id/class identifier (escapes handled separately). */
export function isIdentChar(c: string): boolean {
  return isNameChar(c) || c.charCodeAt(0) > 0x7f;
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

/**
 * Index of the `)` matching the `(` at `open`, or -1.
 * First tries a quote-aware scan; falls back to a quote-blind scan so that text
 * arguments containing a lone apostrophe (`:has-text(don't)`) still parse.
 */
export function findMatchingParen(s: string, open: number): number {
  const quoteAware = scanParen(s, open, true);
  if (quoteAware !== -1) return quoteAware;
  return scanParen(s, open, false);
}

function scanParen(s: string, open: number, quoteAware: boolean): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = at(s, i);
    if (c === '\\') {
      i++;
      continue;
    }
    if (quoteAware && (c === '"' || c === "'")) {
      const q = c;
      let j = i + 1;
      let closed = false;
      for (; j < s.length; j++) {
        const d = at(s, j);
        if (d === '\\') {
          j++;
          continue;
        }
        if (d === q) {
          closed = true;
          break;
        }
      }
      if (!closed) return -1;
      i = j;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export interface PseudoRef {
  /** Lower-cased name without the leading colon(s). */
  name: string;
  /** Written with `::`. */
  element: boolean;
  /** Index of the first `:`. */
  start: number;
  /** Index just past the pseudo (past `)` when it has an argument). */
  end: number;
  hasArg: boolean;
  /** Raw argument text, not trimmed. */
  arg: string;
  argStart: number;
}

export interface SelectorScan {
  pseudos: PseudoRef[];
  /** Offsets of top-level `,`. */
  commas: number[];
  /** Offsets of top-level `+` / `~` combinators. */
  siblings: number[];
  /** Offset just past the first compound selector (top level). */
  firstCompoundEnd: number;
}

export type ScanResult = { ok: true; scan: SelectorScan } | { ok: false; reason: string };

/** Scan a selector, collecting top-level pseudo-classes, commas and sibling combinators. */
export function scanSelector(s: string): ScanResult {
  const pseudos: PseudoRef[] = [];
  const commas: number[] = [];
  const siblings: number[] = [];
  let firstCompoundEnd = -1;
  let bracket = 0;
  let paren = 0;
  let i = 0;

  const noteCombinator = (idx: number): void => {
    if (firstCompoundEnd === -1) firstCompoundEnd = idx;
  };

  while (i < s.length) {
    const c = at(s, i);
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      let closed = false;
      for (; j < s.length; j++) {
        const d = at(s, j);
        if (d === '\\') {
          j++;
          continue;
        }
        if (d === q) {
          closed = true;
          break;
        }
      }
      if (!closed) return { ok: false, reason: 'unterminated string in selector' };
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '}') return { ok: false, reason: `unexpected "${c}" in selector` };
    if (c === '[') {
      bracket++;
      i++;
      continue;
    }
    if (c === ']') {
      bracket--;
      if (bracket < 0) return { ok: false, reason: 'unbalanced "]" in selector' };
      i++;
      continue;
    }
    if (c === '(') {
      paren++;
      i++;
      continue;
    }
    if (c === ')') {
      paren--;
      if (paren < 0) return { ok: false, reason: 'unbalanced ")" in selector' };
      i++;
      continue;
    }
    if (bracket === 0 && paren === 0) {
      if (c === ',') {
        commas.push(i);
        noteCombinator(i);
        i++;
        continue;
      }
      if (c === '+' || c === '~') {
        siblings.push(i);
        noteCombinator(i);
        i++;
        continue;
      }
      if (c === '>') {
        noteCombinator(i);
        i++;
        continue;
      }
      if (isSpace(c)) {
        noteCombinator(i);
        i++;
        continue;
      }
      if (c === ':') {
        const start = i;
        let j = i + 1;
        const element = at(s, j) === ':';
        if (element) j++;
        const nameStart = j;
        while (j < s.length && isNameChar(at(s, j))) j++;
        const name = s.slice(nameStart, j).toLowerCase();
        if (name.length === 0) return { ok: false, reason: 'empty pseudo-class name' };
        if (at(s, j) === '(') {
          const close = findMatchingParen(s, j);
          if (close === -1) return { ok: false, reason: `unbalanced "(" after ":${name}"` };
          pseudos.push({
            name,
            element,
            start,
            end: close + 1,
            hasArg: true,
            arg: s.slice(j + 1, close),
            argStart: j + 1,
          });
          i = close + 1;
          continue;
        }
        pseudos.push({ name, element, start, end: j, hasArg: false, arg: '', argStart: j });
        i = j;
        continue;
      }
    }
    i++;
  }

  if (bracket !== 0) return { ok: false, reason: 'unbalanced "[" in selector' };
  if (paren !== 0) return { ok: false, reason: 'unbalanced "(" in selector' };
  if (firstCompoundEnd === -1) firstCompoundEnd = s.length;
  return { ok: true, scan: { pseudos, commas, siblings, firstCompoundEnd } };
}

export type GenericKey = { kind: 'id'; key: string } | { kind: 'class'; key: string } | { kind: 'complex' };

/**
 * Generic-hiding key of a selector (docs/COSMETIC-FILTERING.md §2).
 *
 * A selector is "simple" when it is a single compound selector, or a compound followed
 * by descendant/child combinators, and the FIRST compound carries an id or class token.
 */
export function genericKey(sel: string): GenericKey {
  const res = scanSelector(sel);
  if (!res.ok) return { kind: 'complex' };
  const { commas, siblings, firstCompoundEnd } = res.scan;
  if (commas.length > 0 || siblings.length > 0) return { kind: 'complex' };

  const head = sel.slice(0, firstCompoundEnd);
  let bracket = 0;
  let paren = 0;
  let firstClass = '';
  for (let i = 0; i < head.length; i++) {
    const c = at(head, i);
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let j = i + 1;
      for (; j < head.length; j++) {
        const d = at(head, j);
        if (d === '\\') {
          j++;
          continue;
        }
        if (d === q) break;
      }
      i = j;
      continue;
    }
    if (c === '[') {
      bracket++;
      continue;
    }
    if (c === ']') {
      bracket--;
      continue;
    }
    if (c === '(') {
      paren++;
      continue;
    }
    if (c === ')') {
      paren--;
      continue;
    }
    if (bracket !== 0 || paren !== 0) continue;
    if (c === '#' || c === '.') {
      const ident = readIdent(head, i + 1);
      if (ident === '') continue;
      if (c === '#') return { kind: 'id', key: ident };
      if (firstClass === '') firstClass = ident;
      i += ident.length;
    }
  }
  if (firstClass !== '') return { kind: 'class', key: firstClass };
  return { kind: 'complex' };
}

function readIdent(s: string, from: number): string {
  let out = '';
  let i = from;
  while (i < s.length) {
    const c = at(s, i);
    if (c === '\\') {
      const next = at(s, i + 1);
      if (next === '') break;
      out += next;
      i += 2;
      continue;
    }
    if (!isIdentChar(c)) break;
    out += c;
    i++;
  }
  return out;
}
