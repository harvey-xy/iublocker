import { describe, expect, it } from 'vitest';
import corpus from './fixtures/re2-corpus.json';
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
    // rejected too — every literal character costs an instruction. Chromium 141 takes a
    // bare run of 112 literals and skips 113 (test/tools/re2-oracle.mjs), which is the
    // budget minus the Fail, Match and `.*?`-loop instructions every program carries.
    const literals = MAX_REGEX_PROGRAM_SIZE - 4;
    expect(estimateProgramSize('a'.repeat(literals))).toBe(MAX_REGEX_PROGRAM_SIZE);
    expect(isRe2Supported('a'.repeat(literals))).toBe(true);
    expect(isRe2Supported('a'.repeat(literals + 1))).toBe(false);
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
    // Fail + Match + the `.*?` loop of an unanchored program, then one byte range each.
    expect(estimateProgramSize('abc')).toBe(7);
  });

  /**
   * Each of these is a construct whose price the oracle measured directly, by binary
   * searching the largest repetition count Chromium 141 still accepts. They are the
   * load-bearing parts of the model: a character class costs one instruction per maximal
   * byte range plus an Alt between them, a range and its exact case-twin share one
   * folding instruction, and `.` is a plain byte range because Chrome matches URLs in
   * Latin-1 rather than UTF-8.
   */
  it('prices each construct the way RE2 compiles it', () => {
    const budget = MAX_REGEX_PROGRAM_SIZE - 4; // what is left for the body of `x{n}`
    const perCopy = (source: string, n: number): number => (estimateProgramSize(`${source}{${n}}`) - 4) / n;

    expect(perCopy('a', 10)).toBe(1); // one literal byte
    expect(perCopy('[0-9]', 10)).toBe(1); // one range
    expect(perCopy('[a-z]', 10)).toBe(1); // `A-Z` ∪ `a-z` folds into one range
    expect(perCopy('[0-9a-f]', 10)).toBe(3); // two ranges: 2k - 1
    expect(perCopy('\\w', 10)).toBe(5); // [0-9] [_] [A-Za-z]
    expect(perCopy('[aceg]', 10)).toBe(7); // four ranges that cannot merge
    expect(perCopy('.', 10)).toBe(3); // Latin-1: two ranges, no UTF-8 automaton
    expect(perCopy('[^a]', 10)).toBe(5); // folding splits the gap in two
    expect(perCopy('(?:aa|bb)', 10)).toBe(5); // two branches plus one Alt
    expect(perCopy('(?:a|b|c|d)', 10)).toBe(1); // …but single characters fold to `[a-d]`

    // Chromium 141: `a{112}` is accepted and `a{113}` skipped.
    expect(estimateProgramSize(`a{${budget}}`)).toBe(MAX_REGEX_PROGRAM_SIZE);
    expect(isRe2Supported(`a{${budget}}`)).toBe(true);
    expect(isRe2Supported(`a{${budget + 1}}`)).toBe(false);
    // `^` costs one instruction instead of the two-instruction unanchored `.*?` loop…
    expect(isRe2Supported(`^a{${budget + 1}}`)).toBe(true);
    // …and a literal prefix after `^` is lifted out of the program entirely.
    expect(estimateProgramSize('^https:\\/\\/a')).toBe(estimateProgramSize('a'));
  });

  it('rejects a repetition count RE2 will not even parse', () => {
    const check = checkRe2('a{1001}');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('repetition count');
  });
});

/**
 * Every regex-pattern filter in the shipped lists, plus the handful the estimator used to
 * wave through, labelled with what Chromium 141 did with it — see
 * `packages/compiler/test/tools/re2-oracle.mjs`, which produced the fixture by feeding
 * each one to `declarativeNetRequest.updateDynamicRules` in a real browser.
 *
 * The contract is asymmetric on purpose. A regex Chrome skips **must** be rejected here:
 * shipping it means the manifest claims a rule Chrome silently drops, and
 * e2e/tests/real-rulesets.spec.ts fails on the count mismatch. A regex Chrome accepts
 * should be accepted, but over-charging one only costs us that filter, so any that the
 * model cannot price exactly are listed below instead of being papered over.
 */
describe('checkRe2 — the live-list corpus, as judged by Chromium 141', () => {
  /** Chrome-accepted regexes this estimator still rejects. Keep at zero if you can. */
  const KNOWN_FALSE_REJECTS: string[] = [];

  it('covers the whole corpus', () => {
    expect(corpus.length).toBeGreaterThan(400);
    expect(corpus.filter((entry) => !entry.chromeAccepts).length).toBeGreaterThan(100);
  });

  for (const { regex, chromeAccepts } of corpus) {
    const label = regex.length > 56 ? `${regex.slice(0, 56)}…` : regex;
    if (!chromeAccepts) {
      it(`rejects ${label}`, () => {
        expect(checkRe2(regex).ok, regex).toBe(false);
      });
      continue;
    }
    if (KNOWN_FALSE_REJECTS.includes(regex)) {
      it(`over-charges ${label} (known)`, () => {
        expect(checkRe2(regex).ok, regex).toBe(false);
      });
      continue;
    }
    it(`accepts ${label}`, () => {
      expect(checkRe2(regex), regex).toEqual({ ok: true });
    });
  }
});
