import { describe, expect, it } from 'vitest';
import { regexLiteral, unsafeRegexReason, unsafeValuePatternReason } from '../src/regex-safety';

/**
 * These regexes run inside the page (procedural matchers on every mutation pass, scriptlet
 * arguments in the MAIN world) with no timeout, so a catastrophically backtracking one
 * hangs the tab. The checker must be conservative in both directions: it may not accept a
 * known blow-up, and it may not reject the shapes real lists use.
 */
describe('unsafeRegexReason', () => {
  const unsafe: [string, string][] = [
    ['(a+)+', 'nested unbounded quantifier'],
    ['(.*)*', 'nested unbounded quantifier'],
    ['(\\s*\\S*)*', 'nested unbounded quantifier'],
    ['([a-z]+)*b', 'nested unbounded quantifier'],
    ['(?:a+)+', 'nested unbounded quantifier'],
    ['(a+){2,}', 'nested unbounded quantifier'],
    ['(x(a+))+', 'nested unbounded quantifier'],
    ['(a|a)*', 'is repeated'],
    ['(a|ab)+', 'share a prefix'],
    ['(\\d|\\w)+', 'match the same characters'],
    ['([0-9]|[0-8])*', 'match the same characters'],
  ];
  for (const [source, reason] of unsafe) {
    it(`flags ${source}`, () => {
      expect(unsafeRegexReason(source)).toContain(reason);
    });
  }

  const safe = [
    '(a|b)+',
    '(\\s|\\S)*',
    '(foo|bar)*',
    '(ab|cd)+',
    '[a-z]+[0-9]+',
    '^https?:\\/\\/',
    'ad[0-9]+\\.js',
    '(?:abc)+',
    '(a+)?',
    '(a+){0,1}',
    '\\d{2,}',
    '(a|b|c){3}',
    '^(?:\\d{1,3}\\.){3}\\d{1,3}$',
    '"homad":\\{"state":"enabled"\\}',
    'Sponsor(ed|isé)',
    '^2\\.\\d (apache|tomcat|nginx)$',
  ];
  for (const source of safe) {
    it(`accepts ${source}`, () => {
      expect(unsafeRegexReason(source)).toBeNull();
    });
  }

  it('rejects an absurdly long expression', () => {
    expect(unsafeRegexReason('a'.repeat(2001))).toContain('longer than');
  });
});

describe('unsafeValuePatternReason', () => {
  it('only looks at /…/ literals', () => {
    expect(unsafeValuePatternReason('(a+)+')).toBeNull();
    expect(unsafeValuePatternReason('/(a+)+/')).toContain('catastrophic');
    expect(unsafeValuePatternReason('/(a+)+/i')).toContain('catastrophic');
  });

  it('checks every part it is given', () => {
    expect(unsafeValuePatternReason('name', null, undefined, '/(a|ab)*/')).toContain('catastrophic');
  });

  it('parses a literal the way the runtime does', () => {
    expect(regexLiteral(' /ab/i ')).toEqual({ source: 'ab', flags: 'i' });
    expect(regexLiteral('/ab')).toBeNull();
    expect(regexLiteral('plain')).toBeNull();
  });
});
