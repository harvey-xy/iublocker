import { describe, expect, it } from 'vitest';
import { MAX_REGEX_LENGTH, checkRe2, isRe2Supported } from '../src/dnr/re2';

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

  it('rejects regexes over the size budget', () => {
    const long = `a${'b'.repeat(MAX_REGEX_LENGTH)}`;
    expect(isRe2Supported(long)).toBe(false);
    expect(isRe2Supported(`a${'b'.repeat(MAX_REGEX_LENGTH - 2)}`)).toBe(true);
  });
});
