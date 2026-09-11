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

/**
 * Budget for `estimateProgramSize`, in RE2 instructions.
 *
 * RE2 is constructed with `max_mem = 2 KB` (Chrome's `kRegexFilterMemoryLimit`); about
 * two thirds of that goes to the forward program, and an instruction plus its bookkeeping
 * costs ~12 bytes, so the program may hold roughly 2048 * 2/3 / 12 ≈ 113 instructions.
 * Chrome **skips** a rule whose regex does not fit ("Rule with id N was skipped as the
 * regexFilter value exceeded the 2KB memory limit when compiled") — silently, as far as
 * the extension is concerned — so the compiler has to predict it.
 *
 * Calibrated against Chromium 141 on the live lists (e2e/tests/real-rulesets.spec.ts keeps
 * it honest: it fails when Chrome's rule count disagrees with the manifest's).
 */
export const MAX_REGEX_PROGRAM_SIZE = 112;

export type Re2Check = { ok: true } | { ok: false; reason: string };

const OK: Re2Check = { ok: true };

function fail(reason: string): Re2Check {
  return { ok: false, reason };
}

/**
 * Approximate the size, in RE2 instructions, of the program Chrome compiles for `source`.
 *
 * RE2 expands counted repetitions (`x{2,15}` becomes 15 copies of `x`), compiles each
 * character-class range into its own byte-range instruction, and encodes `.` and negated
 * classes as small UTF-8 automata — which is why a short regex can be far more expensive
 * than a long one. The model deliberately errs on the high side for the constructs that
 * blow up (counted repetition, negated classes) and is exact enough elsewhere.
 */
export function estimateProgramSize(source: string): number {
  let i = 0;

  const charAt = (index: number): string => source[index] ?? '';

  /** `\d`, `\w`, … cost one instruction per byte range they expand to. */
  const escapeCost = (c: string): number => {
    if (c === 'w') return 4;
    if (c === 's') return 3;
    if (c === 'W' || c === 'S') return 8;
    if (c === 'D') return 6;
    return 1;
  };

  const classCost = (): number => {
    i += 1; // '['
    let negated = false;
    if (charAt(i) === '^') {
      negated = true;
      i += 1;
    }
    let ranges = 0;
    let first = true;
    while (i < source.length && (charAt(i) !== ']' || first)) {
      first = false;
      if (charAt(i) === '\\') {
        ranges += escapeCost(charAt(i + 1));
        i += 2;
        continue;
      }
      if (charAt(i + 1) === '-' && i + 2 < source.length && charAt(i + 2) !== ']') {
        ranges += 1;
        i += 3;
        continue;
      }
      ranges += 1;
      i += 1;
    }
    i += 1; // ']'
    // A negated class matches every other code point, which RE2 encodes as a UTF-8 tree.
    return negated ? ranges + 6 : Math.max(1, ranges);
  };

  const atom = (): number => {
    const c = charAt(i);
    if (c === '(') {
      i += 1;
      if (charAt(i) === '?') {
        // Skip the group prefix: `(?:`, `(?i)`, `(?P<name>`, `(?<name>`.
        let j = i + 1;
        if (charAt(j) === ':') j += 1;
        else if (charAt(j) === '<' || charAt(j) === 'P') {
          while (j < source.length && charAt(j) !== '>') j += 1;
          j += 1;
        } else {
          while (j < source.length && charAt(j) !== ')' && charAt(j) !== ':') j += 1;
          j += 1;
        }
        i = j;
      }
      const inner = alternation();
      if (charAt(i) === ')') i += 1;
      return inner;
    }
    if (c === '[') return classCost();
    if (c === '\\') {
      const cost = escapeCost(charAt(i + 1));
      i += 2;
      return cost;
    }
    if (c === '.') {
      i += 1;
      return 4; // UTF-8 "any character" automaton
    }
    i += 1;
    return 1;
  };

  const quantified = (): number => {
    const cost = atom();
    const c = charAt(i);
    if (c === '*' || c === '+') {
      i += 1;
      if (charAt(i) === '?') i += 1;
      return cost + 2;
    }
    if (c === '?') {
      i += 1;
      if (charAt(i) === '?') i += 1;
      return cost + 1;
    }
    if (c === '{') {
      const close = source.indexOf('}', i);
      const body = close === -1 ? '' : source.slice(i + 1, close);
      const match = /^(\d+)(,(\d*))?$/.exec(body);
      if (close === -1 || !match) {
        i += 1; // a literal `{`
        return cost + 1;
      }
      i = close + 1;
      if (charAt(i) === '?') i += 1;
      const min = Number(match[1]);
      const max = match[2] === undefined ? min : match[3] ? Number(match[3]) : null;
      // `{n,}` unrolls n copies plus a loop; `{n,m}` unrolls m copies, m - n of them optional.
      if (max === null) return cost * (min + 1) + 2;
      return cost * max + (max - min);
    }
    return cost;
  };

  const sequence = (): number => {
    let total = 0;
    while (i < source.length && charAt(i) !== '|' && charAt(i) !== ')') total += quantified();
    return total;
  };

  const alternation = (): number => {
    let branches = 1;
    let total = sequence();
    while (charAt(i) === '|') {
      i += 1;
      branches += 1;
      total += sequence();
    }
    return branches > 1 ? total + branches - 1 : total;
  };

  return alternation();
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
