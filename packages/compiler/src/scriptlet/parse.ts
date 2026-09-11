/**
 * Scriptlet filter parser: `example.com##+js(name, arg1, arg2)` and
 * `example.com#@#+js(name)` (docs/SCRIPTLETS.md §2).
 *
 * Argument syntax (uBO):
 *  - arguments are comma separated, surrounding whitespace is trimmed;
 *  - `\,` is a literal comma;
 *  - an argument may be single- or double-quoted, in which case the quotes are stripped
 *    and `\'`, `\"`, `\\` are unescaped;
 *  - an argument that starts with `/` is treated as a regular-expression literal and is
 *    kept verbatim (slashes, flags and any commas inside it included).
 */
import type { DomainList, ParseResult } from '../cosmetic/parse';
import { parseDomainList, splitCosmetic } from '../cosmetic/parse';

export interface ParsedScriptlet {
  domains: DomainList;
  exception: boolean;
  /** Scriptlet name with a trailing `.js` stripped; empty for `#@#+js()` (= all). */
  name: string;
  args: string[];
  /** The `+js(…)` body exactly as written, for diagnostics. */
  raw: string;
}

interface RawArg {
  value: string;
  quoted: boolean;
}

function at(s: string, i: number): string {
  return i >= 0 && i < s.length ? s.charAt(i) : '';
}

function isWs(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function isAsciiLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

/** Split the inside of `+js(…)` into arguments. */
export function splitScriptletArgs(text: string): ParseResult<string[]> {
  const raw = splitScriptletArgsRaw(text);
  if (!raw.ok) return raw;
  const out = raw.value.map((a) => a.value);
  const last = raw.value[raw.value.length - 1];
  // Drop a single trailing empty slot produced by `+js(name,)`; a quoted `''` is kept.
  if (raw.value.length > 1 && last !== undefined && last.value === '' && !last.quoted) out.pop();
  return { ok: true, value: out };
}

function splitScriptletArgsRaw(text: string): ParseResult<RawArg[]> {
  const args: RawArg[] = [];
  if (text.trim() === '') return { ok: true, value: args };

  let i = 0;
  const n = text.length;
  for (;;) {
    while (i < n && isWs(at(text, i))) i++;

    const c = at(text, i);
    if (c === '"' || c === "'") {
      const quote = c;
      let value = '';
      let j = i + 1;
      let closed = false;
      for (; j < n; j++) {
        const d = at(text, j);
        if (d === '\\') {
          const e = at(text, j + 1);
          if (e === '\\' || e === quote) {
            value += e;
            j++;
            continue;
          }
          value += d;
          continue;
        }
        if (d === quote) {
          closed = true;
          break;
        }
        value += d;
      }
      if (!closed) return { ok: false, reason: 'unterminated quoted scriptlet argument' };
      args.push({ value, quoted: true });
      i = j + 1;
      while (i < n && isWs(at(text, i))) i++;
      if (i < n && at(text, i) !== ',') {
        return { ok: false, reason: 'unexpected text after a quoted scriptlet argument' };
      }
      if (i >= n) break;
      i++;
      continue;
    }

    if (c === '/') {
      const end = findRegexEnd(text, i);
      if (end !== -1) {
        let j = end + 1;
        while (j < n && isAsciiLetter(at(text, j))) j++;
        let k = j;
        while (k < n && isWs(at(text, k))) k++;
        // Only a regex literal when it is followed by an argument separator or the end;
        // otherwise it is an ordinary argument that happens to start with "/".
        if (k >= n || at(text, k) === ',') {
          args.push({ value: text.slice(i, j), quoted: false });
          i = k;
          if (i >= n) break;
          i++;
          continue;
        }
      }
      // Not a closed regex literal: fall through to plain parsing.
    }

    let value = '';
    let done = true;
    for (; i < n; i++) {
      const d = at(text, i);
      if (d === '\\' && at(text, i + 1) === ',') {
        value += ',';
        i++;
        continue;
      }
      if (d === ',') {
        done = false;
        i++;
        break;
      }
      value += d;
    }
    args.push({ value: value.trim(), quoted: false });
    if (done) break;
  }

  return { ok: true, value: args };
}

/** Index of the closing `/` of a regex literal starting at `start`, or -1. */
function findRegexEnd(text: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < text.length; i++) {
    const c = at(text, i);
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i;
  }
  return -1;
}

/** Strip a trailing `.js` from a scriptlet name (`abort-on-property-read.js`). */
export function stripJsSuffix(name: string): string {
  return name.endsWith('.js') ? name.slice(0, -3) : name;
}

/**
 * Parse one scriptlet filter line.
 *
 * Returns `null` when the line is not a scriptlet filter (so the caller can skip it) and
 * `{ ok: false, reason }` when it looks like one but is malformed.
 */
export function parseScriptletFilter(raw: string): ParseResult<ParsedScriptlet> | null {
  const line = raw.trim();
  if (line === '' || line.charAt(0) === '!' || line.charAt(0) === '[') return null;

  if (line.includes('#%#//scriptlet')) {
    return { ok: false, reason: 'AdGuard "#%#//scriptlet" syntax is not supported' };
  }

  const split = splitCosmetic(line);
  if (split === null) return null;
  const { domains: domainText, separator, body } = split;
  if (!body.startsWith('+js(')) return null;

  if (separator !== '##' && separator !== '#@#') {
    return { ok: false, reason: `"+js()" is not allowed after "${separator}"` };
  }
  if (!body.endsWith(')')) return { ok: false, reason: 'unbalanced "(" in "+js()"' };

  const domains = parseDomainList(domainText);
  if (!domains.ok) return domains;

  const inner = body.slice(4, -1);
  const parts = splitScriptletArgs(inner);
  if (!parts.ok) return parts;

  const exception = separator === '#@#';
  const first = parts.value[0];
  const name = first === undefined ? '' : stripJsSuffix(first.trim());
  if (name === '' && !exception) {
    return { ok: false, reason: 'missing scriptlet name in "+js()"' };
  }

  return {
    ok: true,
    value: { domains: domains.value, exception, name, args: parts.value.slice(1), raw: body },
  };
}
