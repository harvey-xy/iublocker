/**
 * Conservative RE2 syntax checker.
 *
 * Chrome compiles `condition.regexFilter` with RE2, and `declarativeNetRequest
 * .isRegexSupported()` is only available at runtime. At build time we approximate it:
 * anything this checker rejects is guaranteed to be rejected by RE2 too, and anything it
 * accepts is *very likely* accepted (we also require it to parse as a JS RegExp, which
 * catches unbalanced groups, bad ranges and dangling quantifiers).
 *
 * RE2 does NOT support: lookahead/lookbehind, backreferences, possessive quantifiers,
 * atomic groups, conditionals, `\Z`, `\G`, `\K`, recursion, `(?#comments)`.
 * RE2 DOES support: `\b`, `\B`, named groups `(?P<x>…)` and `(?<x>…)`, `(?i)` flags,
 * lazy quantifiers, unicode classes.
 */

/**
 * Chrome's documented budget is 2 KB of *compiled* memory per regex. Source length alone
 * is not a usable proxy: `[0-9a-f]{56}` is 13 characters and blows the budget, while a
 * 150-character regex of plain literals fits. `estimateProgramSize` models the expansion
 * instead; this is only the outer bound on the source itself.
 */
export const MAX_REGEX_LENGTH = 2000;

/** RE2 refuses a counted repetition larger than this before it compiles anything. */
const MAX_REPEAT = 1000;

/**
 * Largest program, in RE2 instructions, that Chrome will compile a `regexFilter` into.
 *
 * Chrome builds every `regexFilter` with `re2::RE2` under `max_mem = 2 KB`
 * (`kRegexMaxMemKb`), which RE2 turns into a ceiling on the number of `Prog::Inst`s the
 * forward program may hold. Over the ceiling the compile fails and Chrome **skips** the
 * rule — "Rule with id N was skipped as the regexFilter value exceeded the 2KB memory
 * limit when compiled" — silently, as far as the extension is concerned, so the compiler
 * has to predict it.
 *
 * 116 is measured, not derived: `packages/compiler/test/tools/re2-oracle.mjs` drives
 * Chromium 141 and binary-searches the largest accepted `n` for a family of patterns.
 * `a{n}` tops out at n = 112 and `^a{n}` at n = 113, which pins the budget at
 * 112 + 2 (Fail + Match) + 2 (the `.*?` loop of an unanchored program) = 116.
 */
export const MAX_REGEX_PROGRAM_SIZE = 116;

/** Every program holds a Fail instruction and a Match instruction. */
const PROGRAM_BASE = 2;
/** An unanchored program is prefixed with a `.*?` loop: one ByteRange plus one Alt. */
const UNANCHORED_LOOP = 2;
/** A `^` that survives to the compiler is a single EmptyWidth instruction. */
const EMPTY_WIDTH = 1;

export type Re2Check = { ok: true } | { ok: false; reason: string };

const OK: Re2Check = { ok: true };

function fail(reason: string): Re2Check {
  return { ok: false, reason };
}

/* ------------------------------------------------------------------------------------ *
 * Byte sets
 *
 * Chrome compiles URL patterns in RE2's Latin-1 encoding, so a "rune" is a byte and a
 * character class is a subset of 0x00–0xFF — no UTF-8 automaton is ever built. Classes
 * are therefore modelled as a 256-bit set, which makes negation, union and the range
 * count exact instead of approximate.
 * ------------------------------------------------------------------------------------ */

type ByteSet = Uint8Array;

const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;

function emptySet(): ByteSet {
  return new Uint8Array(256);
}

/**
 * Add a byte range. `regexFilter` is matched case-insensitively unless the filter carries
 * `$match-case`, so RE2 parses with `FoldCase` and the class is closed over ASCII case
 * before it is negated — which is why `[^a]` costs more than `[^0]`: it has to exclude
 * `A` as well, splitting one range into two.
 */
function addRange(set: ByteSet, lo: number, hi: number): void {
  for (let c = Math.max(0, lo); c <= Math.min(255, hi); c += 1) {
    set[c] = 1;
    if (c >= UPPER_A && c <= UPPER_Z) set[c + 32] = 1;
    else if (c >= LOWER_A && c <= LOWER_Z) set[c - 32] = 1;
  }
}

function negate(set: ByteSet): void {
  for (let c = 0; c < 256; c += 1) set[c] = set[c] ? 0 : 1;
}

/**
 * Instructions RE2 emits for a class: one ByteRange per maximal range, joined by an Alt
 * each (k ranges ⇒ k + (k − 1) instructions).
 *
 * The one subtlety is case folding. `ByteRange` carries a `foldcase` flag, so an
 * upper-case range and the *exactly* corresponding lower-case range collapse into a
 * single instruction: `[a-z]` (which folding turned into `A-Z` ∪ `a-z`) costs 1, not 3,
 * and `\w` costs 5 rather than the 7 its four ranges suggest. A partial overlap does not
 * collapse, which is why `[^a]`'s `[\x42-\x60]` and `[\x62-\xFF]` stay separate.
 */
function classCost(set: ByteSet): number {
  const lo: number[] = [];
  const hi: number[] = [];
  for (let c = 0; c < 256; c += 1) {
    if (!set[c]) continue;
    if (lo.length > 0 && (hi[hi.length - 1] as number) === c - 1) hi[hi.length - 1] = c;
    else {
      lo.push(c);
      hi.push(c);
    }
  }
  if (lo.length === 0) return 1; // an empty class compiles to the Fail instruction
  let ranges = lo.length;
  for (let a = 0; a < lo.length; a += 1) {
    const l = lo[a] as number;
    const h = hi[a] as number;
    if (l < UPPER_A || h > UPPER_Z) continue;
    for (let b = 0; b < lo.length; b += 1) {
      if (lo[b] === l + 32 && hi[b] === h + 32) {
        ranges -= 1; // one folded ByteRange covers both halves
        break;
      }
    }
  }
  return 2 * ranges - 1;
}

/** `\d`, `\w`, `\s` and their negations, as byte sets. */
function perlClass(c: string): ByteSet | null {
  const set = emptySet();
  switch (c.toLowerCase()) {
    case 'd':
      addRange(set, 0x30, 0x39);
      break;
    case 'w':
      addRange(set, 0x30, 0x39);
      addRange(set, UPPER_A, UPPER_Z);
      addRange(set, LOWER_A, LOWER_Z);
      addRange(set, 0x5f, 0x5f);
      break;
    case 's':
      addRange(set, 0x09, 0x0a);
      addRange(set, 0x0c, 0x0d);
      addRange(set, 0x20, 0x20);
      break;
    default:
      return null;
  }
  if (c >= 'A' && c <= 'Z') negate(set);
  return set;
}

/** `.` matches every byte but `\n`. */
function dotSet(): ByteSet {
  const set = emptySet();
  addRange(set, 0x00, 0x09);
  addRange(set, 0x0b, 0xff);
  return set;
}

/** Escapes that stand for one literal byte rather than a class or an assertion. */
const ESCAPE_LITERAL: Record<string, number> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  f: 0x0c,
  v: 0x0b,
  a: 0x07,
  '0': 0x00,
};

/** Zero-width assertions: one EmptyWidth instruction each. */
const ESCAPE_ASSERTION = 'bBAzZ';

/* ------------------------------------------------------------------------------------ *
 * The estimator
 * ------------------------------------------------------------------------------------ */

/**
 * Approximate the size, in RE2 instructions, of the program Chrome compiles for `source`.
 *
 * ## The model
 *
 * Every construct is priced by what RE2 actually allocates, in the order RE2 does it.
 * Each number below is pinned by a binary search against Chromium 141
 * (`packages/compiler/test/tools/re2-oracle.mjs`); the whole table reproduces all 53
 * probe families exactly.
 *
 * 1. **Literal prefix.** `RE2::Init` calls `Regexp::RequiredPrefix`: when the pattern is
 *    `^` followed by a run of plain literals, that run is lifted out into a separate
 *    memcmp-able string and never reaches the program — and the `^` goes with it, so the
 *    program is unanchored again. `^https:\/\/a{n}` accepts n = 112 where the same
 *    pattern without the `^` accepts only 104: the eight characters of `https://` are
 *    free. The run stops before a quantified character, because `https?` parses as the
 *    literal string `http` followed by `s?`.
 * 2. **Fixed overhead.** A Fail instruction and a Match instruction always; plus a `.*?`
 *    loop (ByteRange + Alt) when the program is unanchored, or one EmptyWidth instruction
 *    for a `^` that survived step 1. Hence `^a{n}` fits exactly one more `a` than `a{n}`.
 * 3. **Counted repetition is unrolled** by `Regexp::Simplify` before compiling: `x{n}` is
 *    n copies, `x{n,m}` is m copies plus (m − n) Alts for the optional tail, and `x{n,}`
 *    is n copies plus one Alt for the trailing `+`. This is the whole reason a 13-character
 *    `[0-9a-f]{56}` does not fit while 112 characters of literal text do.
 * 4. **Character classes** are byte sets (Latin-1: no UTF-8 automaton, `.` costs 3 and not
 *    a dozen). k maximal ranges cost k ByteRange plus k − 1 Alt, except that an upper-case
 *    range and its exact lower-case twin share one case-folding ByteRange.
 * 5. **Alternation** costs one Alt per extra branch — but RE2's parser first folds an
 *    alternation of single characters into a character class, so `(?:a|b|c|d)` is `[a-d]`,
 *    one instruction, not seven.
 * 6. `?`, `*` and `+` each add one Alt; `^`, `$`, `\b`, `\B` are one instruction each;
 *    capturing groups cost nothing because Chrome sets `never_capture`.
 *
 * The result is an instruction count directly comparable to `MAX_REGEX_PROGRAM_SIZE`.
 */
export function estimateProgramSize(source: string): number {
  let i = 0;
  let body = source;
  let total = PROGRAM_BASE;

  const charAt = (s: string, index: number): string => s[index] ?? '';

  /** A top-level `|` makes the whole regexp an Alternate, which is never prefix-stripped. */
  const hasTopLevelAlternation = (s: string): boolean => {
    let depth = 0;
    let inClass = false;
    for (let k = 0; k < s.length; k += 1) {
      const c = charAt(s, k);
      if (c === '\\') {
        k += 1;
        continue;
      }
      if (inClass) {
        if (c === ']') inClass = false;
        continue;
      }
      if (c === '[') inClass = true;
      else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      else if (c === '|' && depth === 0) return true;
    }
    return false;
  };

  /** Characters that start something other than a plain literal. */
  const isLiteralStart = (s: string, k: number): boolean => {
    const c = charAt(s, k);
    if (c === '') return false;
    if (c === '\\') {
      const n = charAt(s, k + 1);
      return n !== '' && ESCAPE_ASSERTION.indexOf(n) === -1 && perlClass(n) === null;
    }
    return '^$.|?*+()[]{}'.indexOf(c) === -1;
  };

  if (!hasTopLevelAlternation(body) && (body.startsWith('^') || body.startsWith('\\A'))) {
    const skip = body.startsWith('^') ? 1 : 2;
    // Longest run of literals after the anchor, minus a trailing quantified one.
    let end = skip;
    const starts: number[] = [];
    while (isLiteralStart(body, end)) {
      starts.push(end);
      end += charAt(body, end) === '\\' ? 2 : 1;
    }
    if (starts.length > 0 && '?*+{'.indexOf(charAt(body, end)) !== -1) {
      end = starts[starts.length - 1] as number;
      starts.pop();
    }
    if (starts.length > 0) {
      body = body.slice(end); // the prefix (and the `^` with it) never reaches the program
      total += UNANCHORED_LOOP;
    } else {
      body = body.slice(skip);
      total += EMPTY_WIDTH;
    }
  } else {
    total += UNANCHORED_LOOP;
  }

  const at = (index: number): string => body[index] ?? '';

  /** Parse a `[...]` class into its byte set. */
  const classSet = (): ByteSet => {
    const set = emptySet();
    i += 1; // '['
    let negated = false;
    if (at(i) === '^') {
      negated = true;
      i += 1;
    }
    let first = true;
    while (i < body.length && (at(i) !== ']' || first)) {
      first = false;
      let lo: number | null = null;
      if (at(i) === '\\') {
        const n = at(i + 1);
        const perl = perlClass(n);
        i += 2;
        if (perl) {
          for (let c = 0; c < 256; c += 1) if (perl[c]) set[c] = 1;
          continue;
        }
        lo = ESCAPE_LITERAL[n] ?? n.charCodeAt(0);
      } else {
        lo = at(i).charCodeAt(0);
        i += 1;
      }
      if (at(i) === '-' && i + 1 < body.length && at(i + 1) !== ']') {
        i += 1;
        let hi: number;
        if (at(i) === '\\') {
          const n = at(i + 1);
          i += 2;
          hi = ESCAPE_LITERAL[n] ?? n.charCodeAt(0);
        } else {
          hi = at(i).charCodeAt(0);
          i += 1;
        }
        addRange(set, lo, hi);
        continue;
      }
      addRange(set, lo, lo);
    }
    i += 1; // ']'
    if (negated) negate(set);
    return set;
  };

  /** One literal byte, as a set, so single-character alternations can be unioned. */
  const literalSet = (byte: number): ByteSet => {
    const set = emptySet();
    addRange(set, byte, byte);
    return set;
  };

  /** An atom plus, when it is exactly one byte or one class, the set it matches. */
  type Atom = { cost: number; set: ByteSet | null };

  const atom = (): Atom => {
    const c = at(i);
    if (c === '(') {
      i += 1;
      if (at(i) === '?') {
        // Skip the group prefix: `(?:`, `(?i)`, `(?P<name>`, `(?<name>`.
        let j = i + 1;
        if (at(j) === ':') j += 1;
        else if (at(j) === '<' || at(j) === 'P') {
          while (j < body.length && at(j) !== '>') j += 1;
          j += 1;
        } else {
          while (j < body.length && at(j) !== ')' && at(j) !== ':') j += 1;
          j += 1;
        }
        i = j;
      }
      const inner = alternation();
      if (at(i) === ')') i += 1;
      return inner; // capturing costs nothing: Chrome sets never_capture
    }
    if (c === '[') {
      const set = classSet();
      return { cost: classCost(set), set };
    }
    if (c === '\\') {
      const n = at(i + 1);
      i += 2;
      const perl = perlClass(n);
      if (perl) return { cost: classCost(perl), set: perl };
      if (ESCAPE_ASSERTION.indexOf(n) !== -1) return { cost: EMPTY_WIDTH, set: null };
      const byte = ESCAPE_LITERAL[n] ?? n.charCodeAt(0);
      return { cost: 1, set: literalSet(byte) };
    }
    if (c === '.') {
      i += 1;
      const set = dotSet();
      return { cost: classCost(set), set };
    }
    if (c === '^' || c === '$') {
      i += 1;
      return { cost: EMPTY_WIDTH, set: null };
    }
    i += 1;
    return { cost: 1, set: literalSet(c.charCodeAt(0)) };
  };

  const quantified = (): Atom => {
    const a = atom();
    const c = at(i);
    if (c === '*' || c === '+' || c === '?') {
      i += 1;
      if (at(i) === '?') i += 1;
      return { cost: a.cost + 1, set: null };
    }
    if (c === '{') {
      const close = body.indexOf('}', i);
      const spec = close === -1 ? '' : body.slice(i + 1, close);
      const match = /^(\d+)(,(\d*))?$/.exec(spec);
      if (close === -1 || !match) {
        i += 1; // a literal `{`
        return { cost: a.cost + 1, set: null };
      }
      i = close + 1;
      if (at(i) === '?') i += 1;
      const min = Number(match[1]);
      const max = match[2] === undefined ? min : match[3] ? Number(match[3]) : null;
      // `{n,}` unrolls to n copies and one Alt for the trailing `+`;
      // `{n,m}` to m copies and one Alt for each of the m - n optional ones.
      if (max === null) return { cost: Math.max(min, 1) * a.cost + 1, set: null };
      return { cost: a.cost * max + (max - min), set: null };
    }
    return a;
  };

  const sequence = (): Atom => {
    let total_ = 0;
    let only: Atom | null = null;
    let count = 0;
    while (i < body.length && at(i) !== '|' && at(i) !== ')') {
      const a = quantified();
      total_ += a.cost;
      only = a;
      count += 1;
    }
    return { cost: total_, set: count === 1 && only ? only.set : null };
  };

  const alternation = (): Atom => {
    const parts: Atom[] = [sequence()];
    while (at(i) === '|') {
      i += 1;
      parts.push(sequence());
    }
    if (parts.length === 1) return parts[0] as Atom;
    // RE2's parser folds an alternation of single characters or classes into one class.
    if (parts.every((p) => p.set !== null)) {
      const union = emptySet();
      for (const p of parts) {
        const set = p.set as ByteSet;
        for (let c = 0; c < 256; c += 1) if (set[c]) union[c] = 1;
      }
      return { cost: classCost(union), set: union };
    }
    let sum = 0;
    for (const p of parts) sum += p.cost;
    return { cost: sum + parts.length - 1, set: null };
  };

  total += alternation().cost;
  return total;
}

/**
 * Validate a regex source (without delimiters) for use as `condition.regexFilter`.
 */
export function checkRe2(source: string): Re2Check {
  if (source === '') return fail('empty regex');
  if (source.length > MAX_REGEX_LENGTH) return fail(`regex longer than ${MAX_REGEX_LENGTH} characters`);

  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) > 127) return fail('regex contains non-ASCII characters');
  }

  // RE2 accepts a few constructs JS RegExp does not (inline flags, `(?P<name>`). The
  // probe is the same expression rewritten so the JS parser can still check its structure.
  let probe = '';
  let inClass = false;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i] as string;

    if (c === '\\') {
      const n = source[i + 1];
      if (n === undefined) return fail('trailing backslash');
      if (n >= '1' && n <= '9' && !inClass) return fail(`backreference "\\${n}" is not supported by RE2`);
      if (n === 'Z') return fail('"\\Z" is not supported by RE2 (use "$" or "\\z")');
      if (n === 'G') return fail('"\\G" is not supported by RE2');
      if (n === 'K') return fail('"\\K" is not supported by RE2');
      if (n === 'k' && !inClass) return fail('named backreferences are not supported by RE2');
      probe += n === 'z' && !inClass ? '$' : c + n;
      i += 1;
      continue;
    }

    if (inClass) {
      if (c === ']') inClass = false;
      probe += c;
      continue;
    }

    if (c === '[') {
      inClass = true;
      probe += c;
      // A `]` immediately after `[` or `[^` is a literal.
      if (source[i + 1] === '^') {
        probe += '^';
        i += 1;
      }
      if (source[i + 1] === ']') {
        probe += '\\]';
        i += 1;
      }
      continue;
    }

    if (c === '(') {
      if (source[i + 1] !== '?') {
        probe += c;
        continue;
      }
      const t = source[i + 2];
      if (t === '=' || t === '!') return fail('lookahead is not supported by RE2');
      if (t === '>') return fail('atomic groups are not supported by RE2');
      if (t === '#') return fail('regex comments are not supported by RE2');
      if (t === '(') return fail('conditionals are not supported by RE2');
      if (t === '{' || t === 'R' || t === '&' || t === '+')
        return fail('recursion/code is not supported by RE2');
      if (t === '<') {
        const u = source[i + 3];
        if (u === '=' || u === '!') return fail('lookbehind is not supported by RE2');
        probe += '(?<';
        i += 2;
        continue;
      }
      if (t === 'P' && source[i + 3] === '<') {
        probe += '(?<';
        i += 3;
        continue;
      }
      // Inline flag group: `(?i)`, `(?is)`, `(?i-s:` …
      let j = i + 2;
      while (j < source.length && 'imsuU-'.indexOf(source[j] as string) !== -1) j += 1;
      const terminator = source[j];
      if (j > i + 2 && terminator === ')') {
        i = j;
        continue;
      }
      if (j > i + 2 && terminator === ':') {
        probe += '(?:';
        i = j;
        continue;
      }
      probe += c;
      continue;
    }

    if (c === '*' || c === '+' || c === '?' || c === '}') {
      if (source[i + 1] === '+') return fail('possessive quantifiers are not supported by RE2');
    }
    probe += c;
  }

  if (inClass) return fail('unterminated character class');

  try {
    // Catches structural errors (unbalanced groups, invalid ranges, nothing to repeat).
    new RegExp(probe);
  } catch (err) {
    return fail(`invalid regex: ${err instanceof Error ? err.message : String(err)}`);
  }

  // RE2 refuses an oversized counted repetition outright, before it compiles anything.
  for (const m of source.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    if (min > MAX_REPEAT || max > MAX_REPEAT)
      return fail(`repetition count larger than ${MAX_REPEAT} is not supported by RE2`);
  }

  const programSize = estimateProgramSize(source);
  if (programSize > MAX_REGEX_PROGRAM_SIZE) {
    return fail(
      `regex is too complex for Chrome's 2 KB compiled-memory budget ` +
        `(~${programSize} RE2 instructions, limit ${MAX_REGEX_PROGRAM_SIZE})`,
    );
  }

  return OK;
}

/** Convenience boolean form. */
export function isRe2Supported(source: string): boolean {
  return checkRe2(source).ok;
}
