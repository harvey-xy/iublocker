/**
 * Conservative "catastrophic backtracking" check for regular expressions that a filter
 * list hands to the **page**.
 *
 * Procedural cosmetic arguments (`:has-text(/…/)`, `:matches-attr(k=/…/)`,
 * `:matches-css(prop: /…/)`, `:remove-class(/…/)`) and `/…/` scriptlet arguments are
 * compiled to `RegExp` and run inside the content script or the page, on every mutation
 * pass, with no timeout and nothing to interrupt them. A backtracking blow-up there is an
 * unkillable hang of the tab, so a list — or a mistyped user filter — must not be able to
 * express one. `regexFilter` is exempt: Chrome compiles those with RE2, which cannot
 * backtrack.
 *
 * The check is deliberately narrow, because a false positive silently drops a working
 * filter. It flags exactly two shapes, both of which need exponential time on a
 * non-matching input:
 *
 * - a **nested unbounded quantifier** — a group repeated more than once whose body
 *   already repeats without bound: `(a+)+`, `(.*)*`, `(\s*\S*){2,}`;
 * - an **overlapping alternation under a quantifier** — a repeated group whose branches
 *   can match the same text, so the engine has a choice at every character: `(a|a)*`,
 *   `(a|ab)+`, `(\d|\w)+`.
 *
 * `(a|b)+`, `(\s|\S)*`, `(foo|bar)*` and `[a-z]+[0-9]+` are all accepted: their branches
 * are disjoint, or there is no nesting at all.
 */

/** Longest expression worth analysing (and worth running on a page at all). */
export const MAX_REGEX_SOURCE = 2000;

const META = new Set(['\\', '^', '$', '.', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}']);

/** `/source/flags` → its parts, mirroring the runtime's `compileMatcher`. */
export function regexLiteral(text: string): { source: string; flags: string } | null {
  const m = /^\/(.+)\/([a-z]*)$/.exec(text.trim());
  if (m === null) return null;
  return { source: m[1] as string, flags: m[2] ?? '' };
}

/** Index just past the `]` closing the class that starts at `open`. */
function skipClass(s: string, open: number): number {
  let i = open + 1;
  if (s.charAt(i) === '^') i += 1;
  if (s.charAt(i) === ']') i += 1; // a leading `]` is a literal
  for (; i < s.length; i += 1) {
    const c = s.charAt(i);
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === ']') return i;
  }
  return s.length - 1;
}

interface Quantifier {
  /** Index just past the quantifier (lazy `?` included). */
  end: number;
  /** Greatest number of repetitions, `Infinity` when open-ended. */
  max: number;
}

/** The quantifier at `i`, or null when there is none. */
function quantifierAt(s: string, i: number): Quantifier | null {
  const c = s.charAt(i);
  const lazy = (end: number): number => (s.charAt(end) === '?' || s.charAt(end) === '+' ? end + 1 : end);
  if (c === '*' || c === '+') return { end: lazy(i + 1), max: Infinity };
  if (c === '?') return { end: lazy(i + 1), max: 1 };
  if (c !== '{') return null;
  const close = s.indexOf('}', i);
  if (close === -1) return null;
  const body = s.slice(i + 1, close);
  if (!/^\d+(,\d*)?$/.test(body)) return null;
  const comma = body.indexOf(',');
  if (comma === -1) return { end: lazy(close + 1), max: Number(body) };
  const upper = body.slice(comma + 1);
  return { end: lazy(close + 1), max: upper === '' ? Infinity : Number(upper) };
}

/** True when `body` repeats something without bound at any depth (`*`, `+`, `{n,}`). */
function containsUnbounded(body: string): boolean {
  for (let i = 0; i < body.length; i += 1) {
    const c = body.charAt(i);
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '[') {
      i = skipClass(body, i);
      continue;
    }
    const q = quantifierAt(body, i);
    if (q !== null && q.max === Infinity) return true;
    if (q !== null) i = q.end - 1;
  }
  return false;
}

/** Top-level `|` branches of a group body. */
function branchesOf(body: string): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body.charAt(i);
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '[') {
      i = skipClass(body, i);
      continue;
    }
    if (c === '(') depth += 1;
    else if (c === ')') depth = depth > 0 ? depth - 1 : 0;
    else if (c === '|' && depth === 0) {
      out.push(body.slice(start, i));
      start = i + 1;
    }
  }
  out.push(body.slice(start));
  return out;
}

/** Group-opening syntax that carries no matchable text (`(?:`, `(?<name>`, `(?=`, …). */
function stripGroupPrefix(body: string): string {
  if (!body.startsWith('?')) return body;
  if (body.startsWith('?:') || body.startsWith('?=') || body.startsWith('?!')) return body.slice(2);
  if (body.startsWith('?<=') || body.startsWith('?<!')) return body.slice(3);
  const angle = body.indexOf('>');
  if ((body.startsWith('?<') || body.startsWith('?P<')) && angle !== -1) return body.slice(angle + 1);
  return body.slice(1);
}

/** A 0–127 membership set plus "matches something above 127". */
interface CharSet {
  ascii: Uint8Array;
  wide: boolean;
}

function emptyCharSet(): CharSet {
  return { ascii: new Uint8Array(128), wide: false };
}

function addRange(set: CharSet, lo: number, hi: number): void {
  for (let c = lo; c <= Math.min(hi, 127); c += 1) set.ascii[c] = 1;
  if (hi > 127) set.wide = true;
}

function addClassEscape(set: CharSet, letter: string): boolean {
  switch (letter) {
    case 'd':
      addRange(set, 0x30, 0x39);
      return true;
    case 'w':
      addRange(set, 0x30, 0x39);
      addRange(set, 0x41, 0x5a);
      addRange(set, 0x61, 0x7a);
      addRange(set, 0x5f, 0x5f);
      return true;
    case 's':
      for (const c of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]) addRange(set, c, c);
      set.wide = true; // U+00A0, U+2028, …
      return true;
    case 'D':
    case 'W':
    case 'S': {
      const positive = emptyCharSet();
      addClassEscape(positive, letter.toLowerCase());
      for (let c = 0; c < 128; c += 1) set.ascii[c] = positive.ascii[c] ? 0 : 1;
      set.wide = !positive.wide || letter !== 'S';
      return true;
    }
    case 't':
      addRange(set, 0x09, 0x09);
      return true;
    case 'n':
      addRange(set, 0x0a, 0x0a);
      return true;
    case 'r':
      addRange(set, 0x0d, 0x0d);
      return true;
    case 'f':
      addRange(set, 0x0c, 0x0c);
      return true;
    case 'v':
      addRange(set, 0x0b, 0x0b);
      return true;
    default:
      return false;
  }
}

/**
 * The characters a branch that is exactly *one* atom can match, or null when the branch is
 * anything else (several atoms, a group, a quantified atom, an anchor…).
 */
function atomCharSet(branch: string): CharSet | null {
  const b = branch.trim();
  if (b === '') return null;
  const set = emptyCharSet();
  if (b === '.') {
    addRange(set, 0, 127);
    set.ascii[0x0a] = 0;
    set.wide = true;
    return set;
  }
  if (b.length === 1) {
    if (META.has(b)) return null;
    const code = b.charCodeAt(0);
    addRange(set, code, code);
    return set;
  }
  if (b.length === 2 && b.charAt(0) === '\\') {
    const letter = b.charAt(1);
    if (addClassEscape(set, letter)) return set;
    if (META.has(letter) || /[^A-Za-z0-9]/.test(letter)) {
      const code = letter.charCodeAt(0);
      addRange(set, code, code);
      return set;
    }
    return null;
  }
  if (b.startsWith('[') && skipClass(b, 0) === b.length - 1) {
    let i = 1;
    let negated = false;
    if (b.charAt(i) === '^') {
      negated = true;
      i += 1;
    }
    const inner = emptyCharSet();
    while (i < b.length - 1) {
      let lo: number;
      if (b.charAt(i) === '\\') {
        const letter = b.charAt(i + 1);
        if (addClassEscape(inner, letter)) {
          i += 2;
          continue;
        }
        lo = letter.charCodeAt(0);
        i += 2;
      } else {
        lo = b.charCodeAt(i);
        i += 1;
      }
      if (b.charAt(i) === '-' && i + 1 < b.length - 1) {
        const nextIsEscape = b.charAt(i + 1) === '\\';
        const hi = nextIsEscape ? b.charCodeAt(i + 2) : b.charCodeAt(i + 1);
        i += nextIsEscape ? 3 : 2;
        addRange(inner, lo, hi);
        continue;
      }
      addRange(inner, lo, lo);
    }
    if (!negated) return inner;
    for (let c = 0; c < 128; c += 1) set.ascii[c] = inner.ascii[c] ? 0 : 1;
    set.wide = !inner.wide;
    return set;
  }
  return null;
}

function intersects(a: CharSet, b: CharSet): boolean {
  if (a.wide && b.wide) return true;
  for (let c = 0; c < 128; c += 1) if (a.ascii[c] && b.ascii[c]) return true;
  return false;
}

function isPlainLiteral(branch: string): boolean {
  if (branch === '') return false;
  for (const c of branch) if (META.has(c)) return false;
  return true;
}

/** Why the branches of a repeated group overlap, or null when they are disjoint. */
function overlappingAlternation(body: string): string | null {
  const branches = branchesOf(body);
  if (branches.length < 2) return null;
  for (let i = 0; i < branches.length; i += 1) {
    for (let j = i + 1; j < branches.length; j += 1) {
      const a = (branches[i] as string).trim();
      const b = (branches[j] as string).trim();
      if (a === b && a !== '') return `alternation branch "${a}" is repeated`;
      if (isPlainLiteral(a) && isPlainLiteral(b) && (a.startsWith(b) || b.startsWith(a))) {
        return `alternation branches "${a}" and "${b}" share a prefix`;
      }
      const sa = atomCharSet(a);
      const sb = atomCharSet(b);
      if (sa !== null && sb !== null && intersects(sa, sb)) {
        return `alternation branches "${a}" and "${b}" match the same characters`;
      }
    }
  }
  return null;
}

/**
 * Why `source` may backtrack catastrophically, or null when it looks safe.
 * See the module comment for what is and is not flagged.
 */
export function unsafeRegexReason(source: string): string | null {
  if (source.length > MAX_REGEX_SOURCE) {
    return `regular expression longer than ${MAX_REGEX_SOURCE} characters`;
  }
  const open: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const c = source.charAt(i);
    if (c === '\\') {
      i += 1;
      continue;
    }
    if (c === '[') {
      i = skipClass(source, i);
      continue;
    }
    if (c === '(') {
      open.push(i);
      continue;
    }
    if (c !== ')') continue;
    const start = open.pop();
    if (start === undefined) continue;
    const q = quantifierAt(source, i + 1);
    if (q === null || q.max <= 1) continue;
    const body = stripGroupPrefix(source.slice(start + 1, i));
    if (containsUnbounded(body)) {
      return `nested unbounded quantifier in "(${body})" — catastrophic backtracking`;
    }
    const overlap = overlappingAlternation(body);
    if (overlap !== null) {
      return `${overlap} inside a repeated group — catastrophic backtracking`;
    }
    i = q.end - 1;
  }
  return null;
}

/**
 * Check every `/…/` literal a uBO value pattern may hold.
 *
 * `text` is the raw argument; `parts` are the pieces the runtime compiles separately
 * (`:matches-attr(name=/re/)` compiles the name and the value on their own).
 */
export function unsafeValuePatternReason(...parts: (string | null | undefined)[]): string | null {
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    const literal = regexLiteral(part);
    if (literal === null) continue;
    const reason = unsafeRegexReason(literal.source);
    if (reason !== null) return reason;
  }
  return null;
}
