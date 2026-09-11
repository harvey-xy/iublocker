import { describe, expect, it } from 'vitest';
import {
  MAX_REGEX_LENGTH,
  MAX_REGEX_PROGRAM_SIZE,
  checkRe2,
  estimateProgramSize,
  isRe2Supported,
} from '../src/dnr/re2';

describe('checkRe2 — accepted', () => {
  const accepted = [
    'ads?[0-9]+\\.js',
    '^https?:\\/\\/[a-z]+\\.ad\\.example\\.com\\/',
    '\\bad\\b',
    '\\Bnot-a-boundary',
    'banner[0-9]{2,4}\\.(gif|png)$',
    'a*?b+?c??',
    '(?i)CaseInsensitive',
    '(?:non-capturing)',
    '(?P<name>captured)',
    '(?<name>captured)',
    '[\\]abc]',
    '[^]]',
    'a{2,}',
    '\\z',
  ];
  for (const source of accepted) {
    it(`accepts ${source}`, () => {
      expect(checkRe2(source), source).toEqual({ ok: true });
    });
  }
});

describe('checkRe2 — rejected', () => {
  const rejected: [string, string][] = [
    ['', 'empty regex'],
    ['a(?=b)', 'lookahead'],
    ['a(?!b)', 'lookahead'],
    ['(?<=a)b', 'lookbehind'],
    ['(?<!a)b', 'lookbehind'],
    ['(a)\\1', 'backreference'],
    ['(?<n>a)\\k<n>', 'named backreferences'],
    ['a*+', 'possessive'],
    ['a++', 'possessive'],
    ['a?+', 'possessive'],
    ['a{2}+', 'possessive'],
    ['(?>atomic)', 'atomic'],
    ['(?#comment)', 'comments'],
    ['abc\\Z', '\\Z'],
    ['abc\\G', '\\G'],
    ['abc\\K', '\\K'],
    ['[abc', 'unterminated character class'],
    ['(unbalanced', 'invalid regex'],
    ['trailing\\', 'trailing backslash'],
    ['ünicode', 'non-ASCII'],
  ];
  for (const [source, expected] of rejected) {
    it(`rejects ${source || '<empty>'}`, () => {
      const result = checkRe2(source);
      expect(result.ok, source).toBe(false);
      if (!result.ok) expect(result.reason).toContain(expected);
    });
  }

  it('rejects regexes over the source-length bound', () => {
    const long = `a${'b'.repeat(MAX_REGEX_LENGTH)}`;
    const result = checkRe2(long);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(`longer than ${MAX_REGEX_LENGTH}`);
    // A regex that fits the length bound but not Chrome's compiled-memory budget is
    // rejected too — every literal character costs an instruction.
    expect(isRe2Supported(`a${'b'.repeat(MAX_REGEX_PROGRAM_SIZE)}`)).toBe(false);
    expect(isRe2Supported(`a${'b'.repeat(MAX_REGEX_PROGRAM_SIZE - 2)}`)).toBe(true);
  });
});

/**
 * Chrome compiles `regexFilter` with a 2 KB memory budget and silently *skips* rules
 * whose regex does not fit, so the compiler has to predict it (docs/TESTING.md,
 * "Real-list load verification"). Both tables below are real filters from the live lists,
 * labelled with what Chromium 141 actually did with them.
 */
describe("estimateProgramSize — Chrome's 2 KB regex budget", () => {
  const skippedByChrome = [
    // `[0-9a-f]{56}` unrolls to 112 byte-range instructions on its own.
    '^https:\\/\\/(a|c)\\.[0-9a-f]{56}\\.com$',
    '^https?:\\/\\/.*\\/[a-z0-9A-Z_]{2,15}\\.(php|jx|jsx|1ph|jsf|jz|jsm|j$)',
    '^https?:\\/\\/(www\\.)?([a-z0-9]{5,32}\\.)([a-z]{2,8})\\/[0-9a-f]{32}\\/invoke\\.js$',
    '^https?://[a-z0-9]+\\.in\\.net/+[-a-z0-9_?&=]{25,}',
    '^https?://([^.]+\\.)+[a-z]+\\.(?:biz|ru|space)/[a-z][/?][-a-z0-9_?&=]{5,45}$',
  ];
  for (const source of skippedByChrome) {
    it(`rejects ${source.slice(0, 48)}…`, () => {
      const check = checkRe2(source);
      expect(check.ok, source).toBe(false);
      if (!check.ok) expect(check.reason).toMatch(/2 KB compiled-memory budget/);
      expect(estimateProgramSize(source)).toBeGreaterThan(MAX_REGEX_PROGRAM_SIZE);
    });
  }

  const acceptedByChrome = [
    ':\\/\\/[A-Za-z0-9]+.ru\\/[A-Za-z0-9]{20,25}.js',
    'm.realgfporn.com\\/[a-z]{1,13}[0-9]{1,13}[a-z]{1,13}.js',
    '^https?:\\/\\/[-a-z]{6,}\\.(?:com?|info|pro|xyz)\\/[a-d][-.\\/A-Z_a-z][DHWXm][-.\\/A-Z_a-z][59FVZ][-.\\/A-Z_a-z][6swyz][-.\\/A-Z_a-z][-\\/0-9A-Z_a-z][-.\\/A-Z_a-z][-\\/0-9A-Z_a-z]+(?:$|\\?)',
    '^https?:\\/\\/www\\.stratege\\.ru\\/misc\\/[a-z0-9]{25,}',
    '^https:\\/\\/[a-z]{8,12}\\.com\\/en\\/(?:[a-z]{2,5}\\/){0,2}[a-z]{2,}\\?(?:[a-z]+=(?:\\d+|[a-z]+)&)*?id=[12]\\d{6}',
    'banner_[0-9]+x[0-9]+\\.(gif|png|jpg)',
  ];
  for (const source of acceptedByChrome) {
    it(`accepts ${source.slice(0, 48)}…`, () => {
      expect(checkRe2(source), source).toEqual({ ok: true });
      expect(estimateProgramSize(source)).toBeLessThanOrEqual(MAX_REGEX_PROGRAM_SIZE);
    });
  }

  it('charges counted repetition for every unrolled copy', () => {
    expect(estimateProgramSize('a{10}')).toBeGreaterThan(estimateProgramSize('a{2}'));
    expect(estimateProgramSize('[0-9a-f]{20}')).toBeGreaterThan(estimateProgramSize('[0-9]{20}'));
    expect(estimateProgramSize('abc')).toBe(3);
  });
});
