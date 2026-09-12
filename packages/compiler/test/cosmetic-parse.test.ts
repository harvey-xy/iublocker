import { describe, expect, it } from 'vitest';
import type { ProceduralTask } from '@iublocker/shared';
import type { ParsedCosmetic } from '../src/cosmetic/parse';
import { parseCosmeticFilter, parseDomainList, splitCosmetic } from '../src/cosmetic/parse';

function ok(raw: string): ParsedCosmetic {
  const res = parseCosmeticFilter(raw);
  if (res === null) throw new Error(`expected a cosmetic filter, got a skipped line: ${raw}`);
  if (!res.ok) throw new Error(`expected ${raw} to parse, got: ${res.reason}`);
  return res.value;
}

function err(raw: string): string {
  const res = parseCosmeticFilter(raw);
  if (res === null) throw new Error(`expected a parse error, got a skipped line: ${raw}`);
  if (res.ok) throw new Error(`expected ${raw} to fail, got: ${JSON.stringify(res.value)}`);
  return res.reason;
}

function tasks(raw: string): ProceduralTask[] {
  const value = ok(raw);
  if (value.body.form !== 'procedural') {
    throw new Error(`expected a procedural filter, got ${value.body.form}`);
  }
  return value.body.filter.tasks;
}

function plain(raw: string): string {
  const value = ok(raw);
  if (value.body.form !== 'plain') throw new Error(`expected a plain filter, got ${value.body.form}`);
  return value.body.selector;
}

describe('splitCosmetic', () => {
  const cases: [string, string, string, string][] = [
    ['##.ad', '', '##', '.ad'],
    ['example.com##.ad', 'example.com', '##', '.ad'],
    ['###banner', '', '##', '#banner'],
    ['example.com###banner', 'example.com', '##', '#banner'],
    ['example.com#@#.ad', 'example.com', '#@#', '.ad'],
    ['example.com#?#.a:has-text(x)', 'example.com', '#?#', '.a:has-text(x)'],
    ['example.com#@?#.a:has-text(x)', 'example.com', '#@?#', '.a:has-text(x)'],
    ['example.com#$#.a { color: red }', 'example.com', '#$#', '.a { color: red }'],
    ['example.com#@$#.a { color: red }', 'example.com', '#@$#', '.a { color: red }'],
    ['example.com#$?#.a:has-text(x) { color: red }', 'example.com', '#$?#', '.a:has-text(x) { color: red }'],
    ['example.com#@$?#.a { color: red }', 'example.com', '#@$?#', '.a { color: red }'],
  ];
  for (const [raw, domains, separator, body] of cases) {
    it(`splits ${raw}`, () => {
      expect(splitCosmetic(raw)).toEqual({ domains, separator, body });
    });
  }

  it('returns null for non-cosmetic lines', () => {
    expect(splitCosmetic('||example.com^')).toBeNull();
    expect(splitCosmetic('example.com#%#//scriptlet("x")')).toBeNull();
    expect(splitCosmetic('||example.com/x#fragment')).toBeNull();
  });
});

describe('parseDomainList', () => {
  it('parses an empty list', () => {
    expect(parseDomainList('')).toEqual({ ok: true, value: { include: [], exclude: [] } });
    expect(parseDomainList('   ')).toEqual({ ok: true, value: { include: [], exclude: [] } });
  });

  it('parses includes, negations and entities', () => {
    expect(parseDomainList('example.com, ~sub.example.com,other.*')).toEqual({
      ok: true,
      value: { include: ['example.com', 'other.*'], exclude: ['sub.example.com'] },
    });
  });

  it('lower-cases hostnames', () => {
    expect(parseDomainList('EXAMPLE.COM')).toEqual({
      ok: true,
      value: { include: ['example.com'], exclude: [] },
    });
  });

  it('rejects invalid entries', () => {
    expect(parseDomainList('exa mple.com')).toMatchObject({ ok: false });
    expect(parseDomainList('/re/')).toMatchObject({ ok: false });
    expect(parseDomainList('a.com,,b.com')).toMatchObject({ ok: false });
    expect(parseDomainList('~')).toMatchObject({ ok: false });
    expect(parseDomainList('.*')).toMatchObject({ ok: false });
  });
});

describe('parseCosmeticFilter — line forms', () => {
  it('skips non-cosmetic lines', () => {
    expect(parseCosmeticFilter('')).toBeNull();
    expect(parseCosmeticFilter('! a comment')).toBeNull();
    expect(parseCosmeticFilter('[Adblock Plus 2.0]')).toBeNull();
    expect(parseCosmeticFilter('||ads.example.com^')).toBeNull();
    expect(parseCosmeticFilter('example.com##+js(aopr, x)')).toBeNull();
  });

  it('parses a generic hiding filter', () => {
    const value = ok('##.ad');
    expect(value.separator).toBe('##');
    expect(value.exception).toBe(false);
    expect(value.domains).toEqual({ include: [], exclude: [] });
    expect(value.body).toEqual({ form: 'plain', selector: '.ad' });
  });

  it('parses a specific hiding filter', () => {
    expect(ok('example.com##.ad').domains).toEqual({ include: ['example.com'], exclude: [] });
  });

  it('parses negations and entities', () => {
    expect(ok('example.com,~sub.example.com##.ad').domains).toEqual({
      include: ['example.com'],
      exclude: ['sub.example.com'],
    });
    expect(ok('example.*##.ad').domains).toEqual({ include: ['example.*'], exclude: [] });
    expect(ok('~example.com##.ad').domains).toEqual({ include: [], exclude: ['example.com'] });
  });

  it('parses exceptions', () => {
    expect(ok('example.com#@#.ad').exception).toBe(true);
    expect(ok('#@#.ad').exception).toBe(true);
    expect(ok('example.com#@?#.a:has-text(x)').exception).toBe(true);
    expect(ok('example.com#@$#.a { color: red }').exception).toBe(true);
    expect(ok('example.com##.ad').exception).toBe(false);
  });

  it('parses an id selector after "###"', () => {
    expect(plain('###banner')).toBe('#banner');
  });

  it('keeps the raw body for exception matching', () => {
    expect(ok('example.com#?#.a:has-text( x )').rawBody).toBe('.a:has-text( x )');
  });

  it('reports errors', () => {
    expect(err('exa mple.com##.ad')).toContain('invalid hostname');
    expect(err('/re/##.ad')).toContain('regex domains');
    expect(err('example.com##')).toContain('empty cosmetic filter body');
    expect(err('example.com##   ')).toContain('empty cosmetic filter body');
    expect(err('example.com##^script:has-text(ads)')).toContain('HTML filtering');
  });
});

describe('parseCosmeticFilter — native selectors', () => {
  const valid: [string, string][] = [
    ['##.ad', '.ad'],
    ['##div.ad', 'div.ad'],
    ['##.a, .b', '.a, .b'],
    ['##.a > .b', '.a > .b'],
    ['##.a + .b', '.a + .b'],
    ['##a[href^="http"]', 'a[href^="http"]'],
    ['##.a:hover', '.a:hover'],
    ['##.a::before', '.a::before'],
    ['##.a:nth-child(2n+1)', '.a:nth-child(2n+1)'],
    ['##.a:has(.b)', '.a:has(.b)'],
    ['##.a:not(.b)', '.a:not(.b)'],
    ['##.a:is(.b, .c)', '.a:is(.b, .c)'],
    ['##.a:where(.b)', '.a:where(.b)'],
    ['##*', '*'],
    // legacy spellings are normalised
    ['##.a:if(.b)', '.a:has(.b)'],
    ['##.a:if-not(.b)', '.a:not(.b)'],
    ['##.a:-abp-has(.b)', '.a:has(.b)'],
    ['##.a:matches(.b)', '.a:is(.b)'],
    // `#?#` with a plain selector degrades to plain hiding
    ['#?#.ad', '.ad'],
  ];
  for (const [raw, expected] of valid) {
    it(`accepts ${raw}`, () => {
      expect(plain(raw)).toBe(expected);
    });
  }

  const invalid: [string, string][] = [
    ['##.a{display:none}', 'unexpected "{"'],
    ['##.a[b', 'unbalanced "["'],
    ['##.a]', 'unbalanced "]"'],
    ['##.a)', 'unbalanced ")"'],
    ['##.a:foo(x)', 'unknown pseudo-class ":foo"'],
    ['##.a:bogus', 'unknown pseudo-class ":bogus"'],
    ['##.a:has(.b:nope)', 'unknown pseudo-class ":nope"'],
    ['##.a:has()', 'empty selector'],
    ['##a[href="x]', 'unterminated string'],
  ];
  for (const [raw, expected] of invalid) {
    it(`rejects ${raw}`, () => {
      expect(err(raw)).toContain(expected);
    });
  }
});

describe('parseCosmeticFilter — procedural operators', () => {
  const cases: [string, ProceduralTask[]][] = [
    [
      '##.a:has-text(Sponsored)',
      [
        ['css', '.a'],
        ['has-text', 'Sponsored'],
      ],
    ],
    [
      '##.a:has-text(/spon\\w+/i)',
      [
        ['css', '.a'],
        ['has-text', '/spon\\w+/i'],
      ],
    ],
    [
      "##.a:has-text(don't)",
      [
        ['css', '.a'],
        ['has-text', "don't"],
      ],
    ],
    [
      '##.a:contains(x)',
      [
        ['css', '.a'],
        ['has-text', 'x'],
      ],
    ],
    [
      '##.a:-abp-contains(x)',
      [
        ['css', '.a'],
        ['has-text', 'x'],
      ],
    ],
    [
      '##.a:matches-css(display: none)',
      [
        ['css', '.a'],
        ['matches-css', 'display: none'],
      ],
    ],
    [
      '##.a:matches-css-before(content: ads)',
      [
        ['css', '.a'],
        ['matches-css-before', 'content: ads'],
      ],
    ],
    [
      '##.a:matches-css-after(content: x)',
      [
        ['css', '.a'],
        ['matches-css-after', 'content: x'],
      ],
    ],
    [
      '##.a:matches-attr(data-ad)',
      [
        ['css', '.a'],
        ['matches-attr', 'data-ad'],
      ],
    ],
    [
      '##.a:matches-path(/shop)',
      [
        ['css', '.a'],
        ['matches-path', '/shop'],
      ],
    ],
    [
      '##.a:matches-media((min-width: 100px))',
      [
        ['css', '.a'],
        ['matches-media', '(min-width: 100px)'],
      ],
    ],
    [
      '##.a:min-text-length(10)',
      [
        ['css', '.a'],
        ['min-text-length', 10],
      ],
    ],
    [
      '##.a:min-text-length(0)',
      [
        ['css', '.a'],
        ['min-text-length', 0],
      ],
    ],
    [
      '##.a:upward(3)',
      [
        ['css', '.a'],
        ['upward', 3],
      ],
    ],
    [
      '##.a:upward(div.wrap)',
      [
        ['css', '.a'],
        ['upward', 'div.wrap'],
      ],
    ],
    [
      '##.a:nth-ancestor(2)',
      [
        ['css', '.a'],
        ['upward', 2],
      ],
    ],
    [
      '##.a:xpath(//div[@id="b"])',
      [
        ['css', '.a'],
        ['xpath', '//div[@id="b"]'],
      ],
    ],
    [
      '##.a:watch-attr(class)',
      [
        ['css', '.a'],
        ['watch-attr', 'class'],
      ],
    ],
    ['##.a:others()', [['css', '.a'], ['others']]],
    ['##.a:remove()', [['css', '.a'], ['remove']]],
    ['##.a:has-text(x):remove()', [['css', '.a'], ['has-text', 'x'], ['remove']]],
    [
      '##.a:remove-attr(onclick)',
      [
        ['css', '.a'],
        ['remove-attr', 'onclick'],
      ],
    ],
    [
      '##.a:remove-class(ad)',
      [
        ['css', '.a'],
        ['remove-class', 'ad'],
      ],
    ],
    [
      '##a[href]:has-text(Ad):remove-attr(/^data-/)',
      [
        ['css', 'a[href]'],
        ['has-text', 'Ad'],
        ['remove-attr', '/^data-/'],
      ],
    ],
    [
      '##.a:remove-attr(x):remove-class(y)',
      [
        ['css', '.a'],
        ['remove-attr', 'x'],
        ['remove-class', 'y'],
      ],
    ],
    [
      '##.a:has(.b:has-text(x))',
      [
        ['css', '.a'],
        [
          'has',
          {
            raw: '.b:has-text(x)',
            tasks: [
              ['css', '.b'],
              ['has-text', 'x'],
            ],
          },
        ],
      ],
    ],
    [
      '##.a:not(.b:has-text(x))',
      [
        ['css', '.a'],
        [
          'not',
          {
            raw: '.b:has-text(x)',
            tasks: [
              ['css', '.b'],
              ['has-text', 'x'],
            ],
          },
        ],
      ],
    ],
    [
      '##.a:if(.b:has-text(x))',
      [
        ['css', '.a'],
        [
          'has',
          {
            raw: '.b:has-text(x)',
            tasks: [
              ['css', '.b'],
              ['has-text', 'x'],
            ],
          },
        ],
      ],
    ],
    [
      '##.a:if-not(.b:has-text(x))',
      [
        ['css', '.a'],
        [
          'not',
          {
            raw: '.b:has-text(x)',
            tasks: [
              ['css', '.b'],
              ['has-text', 'x'],
            ],
          },
        ],
      ],
    ],
    // implicit `*` when the chain starts with an operator
    [
      '##:has-text(Ad)',
      [
        ['css', '*'],
        ['has-text', 'Ad'],
      ],
    ],
    // plain CSS between and after operators becomes `css` steps
    [
      '##.a:has-text(x) .b',
      [
        ['css', '.a'],
        ['has-text', 'x'],
        ['css', '.b'],
      ],
    ],
    [
      '##.a:has-text(x) > .b',
      [
        ['css', '.a'],
        ['has-text', 'x'],
        ['css', '> .b'],
      ],
    ],
    [
      '##.a:has-text(x) .b:upward(1)',
      [
        ['css', '.a'],
        ['has-text', 'x'],
        ['css', '.b'],
        ['upward', 1],
      ],
    ],
    // arguments are trimmed
    [
      '##.a:has-text(  x  )',
      [
        ['css', '.a'],
        ['has-text', 'x'],
      ],
    ],
    // procedural inside a `#?#` filter
    [
      'example.com#?#.a:has-text(x)',
      [
        ['css', '.a'],
        ['has-text', 'x'],
      ],
    ],
    // AdGuard `#$?#` = procedural + style
    [
      'example.com#$?#.a:has-text(x) { color: red }',
      [
        ['css', '.a'],
        ['has-text', 'x'],
        ['style', 'color: red'],
      ],
    ],
  ];
  for (const [raw, expected] of cases) {
    it(`parses ${raw}`, () => {
      expect(tasks(raw)).toEqual(expected);
    });
  }

  const invalid: [string, string][] = [
    ['##.a:min-text-length(abc)', 'non-negative integer'],
    ['##.a:min-text-length(-1)', 'non-negative integer'],
    ['##.a:upward(0)', 'out of range'],
    ['##.a:upward(999)', 'out of range'],
    ['##.a:upward()', 'requires an argument'],
    ['##.a:upward(.b:has-text(x))', 'procedural operator'],
    ['##.a:others(x)', 'takes no argument'],
    ['##.a:remove(x)', 'takes no argument'],
    ['##.a:has-text()', 'requires an argument'],
    ['##.a:style()', 'requires an argument'],
    ['##.a:xpath()', 'requires an argument'],
    ['##.a:has-text(x', 'unbalanced "("'],
    ['##.a, .b:has-text(x)', 'selector list'],
    ['##.a:has-text(x):foo(y)', 'unknown pseudo-class ":foo"'],
  ];
  for (const [raw, expected] of invalid) {
    it(`rejects ${raw}`, () => {
      expect(err(raw)).toContain(expected);
    });
  }
});

describe('parseCosmeticFilter — style injection', () => {
  it('parses uBO :style()', () => {
    expect(ok('example.com##.ad:style(opacity: 0.1 !important)').body).toEqual({
      form: 'style',
      selector: '.ad',
      style: 'opacity: 0.1 !important',
    });
  });

  it('parses AdGuard #$#', () => {
    expect(ok('example.com#$#.ad { color: red }').body).toEqual({
      form: 'style',
      selector: '.ad',
      style: 'color: red',
    });
  });

  it('parses a generic :style()', () => {
    const value = ok('##.ad:style(display: block)');
    expect(value.domains.include).toEqual([]);
    expect(value.body).toEqual({ form: 'style', selector: '.ad', style: 'display: block' });
  });

  it('keeps :style() procedural when the chain has other operators', () => {
    expect(tasks('##.a:has-text(x):style(color: red)')).toEqual([
      ['css', '.a'],
      ['has-text', 'x'],
      ['style', 'color: red'],
    ]);
  });

  it('rejects malformed AdGuard bodies', () => {
    expect(err('example.com#$#.ad')).toContain('selector { declarations }');
    expect(err('example.com#$#.ad { }')).toContain('empty declarations');
    expect(err('example.com#$# { color: red }')).toContain('empty selector');
    expect(err('example.com#$#.ad { color: red } trailing')).toContain('trailing text');
    expect(err('example.com#$#abort-on-property-read foo')).toContain('selector { declarations }');
  });
});

/**
 * Regressions from the adversarial compiler review.
 *
 * The runtime injects specific selectors as one `sel1,sel2,…{display:none!important}` rule
 * per 1,000 selectors, and the CSS parser discards a selector list *whole* when one member
 * is invalid. A single Chrome-invalid selector therefore used to destroy every other hiding
 * selector for that hostname (187 selectors across 19 real sites).
 */
describe('CSS-invalid selectors never reach the plain path', () => {
  const nested = [
    '.sliderItem.active:has(span.news-item:has(img[alt="Anzeige"]))',
    'div:has(> div:has(> .adsbygoogle))',
    '.elementor-hidden-desktop:has(> div.e-con-inner:only-child:not(:has(*)))',
    'a:not(b:has(c:has(d)))',
    // `:if()` is the legacy spelling of `:has()`, so this nests too.
    '.a:has(.b:if(.c))',
  ];
  for (const selector of nested) {
    it(`evaluates ${selector} procedurally`, () => {
      const value = ok(`example.com##${selector}`);
      expect(value.body.form).toBe('procedural');
    });
  }

  it('leaves valid :has() nesting on the native path', () => {
    expect(plain('example.com##.a:has(.b)')).toBe('.a:has(.b)');
    expect(plain('example.com##.a:not(:has(.b))')).toBe('.a:not(:has(.b))');
    expect(plain('example.com##.a:has(.b) .c:has(.d)')).toBe('.a:has(.b) .c:has(.d)');
    // `:is()` / `:where()` take a forgiving list, so a `:has()` inside one is not invalid.
    expect(plain('example.com##a:has(:is(b:has(c)))')).toBe('a:has(:is(b:has(c)))');
  });

  it('keeps the nested argument valid on its own', () => {
    expect(tasks('example.com##li:has(a:has(.sponsored-prefix))')).toEqual([
      ['css', 'li'],
      ['has', { raw: 'a:has(.sponsored-prefix)', tasks: [['css', 'a:has(.sponsored-prefix)']] }],
    ]);
  });
});

describe('domain lists', () => {
  it('treats a bare "*" as "every domain"', () => {
    expect(parseDomainList('*')).toEqual({ ok: true, value: { include: [], exclude: [] } });
    const value = ok('~bing.com,*##iframe[id]');
    expect(value.domains).toEqual({ include: [], exclude: ['bing.com'] });
  });

  it('punycodes non-ASCII names, which is what location.hostname reports', () => {
    expect(parseDomainList('пример.рф,fanserial.*')).toEqual({
      ok: true,
      value: { include: ['xn--e1afmkfd.xn--p1ai', 'fanserial.*'], exclude: [] },
    });
  });

  it('rejects "~*"', () => {
    expect(err('~*##.ad')).toContain('excludes every domain');
  });
});

describe('page-evaluated regex arguments', () => {
  it('drops a procedural matcher that can backtrack catastrophically', () => {
    expect(err('example.com##.a:has-text(/(\\s*\\S*)*x/)')).toContain('catastrophic backtracking');
    expect(err('example.com##.a:matches-attr(data-x=/(a+)+/)')).toContain('catastrophic backtracking');
    expect(err('example.com##div:remove-class(/(x|xy)+/)')).toContain('catastrophic backtracking');
  });

  it('keeps the regexes real lists actually use', () => {
    expect(tasks('example.com##.a:has-text(/Sponsor(ed|isé)/)')).toHaveLength(2);
    expect(tasks('example.com##div:remove-class(/^ad-/)')).toHaveLength(2);
    expect(tasks('example.com##.a:matches-css(width: /^[0-9]{3}px$/)')).toHaveLength(2);
  });
});
