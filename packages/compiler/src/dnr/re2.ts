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
 * Chrome's documented budget is 2 KB of *compiled* memory per regex. Source length is a
 * usable proxy; real lists never come close.
 */
export const MAX_REGEX_LENGTH = 2000;

export type Re2Check = { ok: true } | { ok: false; reason: string };

const OK: Re2Check = { ok: true };

function fail(reason: string): Re2Check {
  return { ok: false, reason };
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
      if (t === '{' || t === 'R' || t === '&' || t === '+') return fail('recursion/code is not supported by RE2');
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

  return OK;
}

/** Convenience boolean form. */
export function isRe2Supported(source: string): boolean {
  return checkRe2(source).ok;
}
