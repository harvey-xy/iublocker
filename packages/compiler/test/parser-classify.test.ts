import { describe, expect, it } from 'vitest';
import {
  classifyLines,
  evaluateIfExpression,
  findCosmeticSeparator,
  isPlainHostname,
  parseHostsLine,
} from '../src/parser/classify';

describe('findCosmeticSeparator', () => {
  const cases: [string, string | null][] = [
    ['example.com##.ad', '##'],
    ['example.com#@#.ad', '#@#'],
    ['example.com#?#.ad:has-text(x)', '#?#'],
    ['example.com#@?#.ad', '#@?#'],
    ['example.com#$#.ad { color: red }', '#$#'],
    ['example.com#@$#.ad { color: red }', '#@$#'],
    ['example.com#$?#.ad:has(x) { color: red }', '#$?#'],
    ['example.com#@$?#.ad', '#@$?#'],
    ['example.com#%#//scriptlet("x")', '#%#'],
    ['##.generic', '##'],
    ['||example.com/a#b', null],
    ['||example.com/path$domain=x.com', null],
    ['@@||example.com^$document', null],
    ['||example.com/#/spa/ads', null],
  ];
  for (const [line, expected] of cases) {
    it(`${line} → ${expected ?? 'network'}`, () => {
      expect(findCosmeticSeparator(line)?.sep ?? null).toBe(expected);
    });
  }
});

describe('isPlainHostname', () => {
  const cases: [string, boolean][] = [
    ['example.com', true],
    ['a.b.example.com', true],
    ['under_score.example.com', true],
    ['nodot', false],
    ['bad host.com', false],
    ['trailing.', false],
    ['double..dot.com', false],
    ['', false],
  ];
  for (const [host, expected] of cases) {
    it(`${host || '<empty>'} → ${expected}`, () => {
      expect(isPlainHostname(host)).toBe(expected);
    });
  }
});

describe('parseHostsLine', () => {
  it('parses 0.0.0.0 lines', () => {
    expect(parseHostsLine('0.0.0.0 ads.example.com', false)).toEqual(['ads.example.com']);
  });
  it('parses 127.0.0.1 lines with a trailing comment', () => {
    expect(parseHostsLine('127.0.0.1 ads.example.com # tracker', false)).toEqual(['ads.example.com']);
  });
  it('parses multiple hosts on one line', () => {
    expect(parseHostsLine('0.0.0.0 a.example.com b.example.com', false)).toEqual([
      'a.example.com',
      'b.example.com',
    ]);
  });
  it('consumes but ignores localhost entries', () => {
    expect(parseHostsLine('127.0.0.1 localhost', false)).toEqual([]);
    expect(parseHostsLine('0.0.0.0 broadcasthost', false)).toEqual([]);
  });
  it('rejects non-hosts lines', () => {
    expect(parseHostsLine('||ads.example.com^', false)).toBeNull();
    expect(parseHostsLine('bare.example.com', false)).toBeNull();
  });
  it('accepts bare hostnames only in hosts format', () => {
    expect(parseHostsLine('bare.example.com', true)).toEqual(['bare.example.com']);
  });
});

describe('evaluateIfExpression', () => {
  const cases: [string, boolean][] = [
    ['env_chromium', true],
    ['env_firefox', false],
    ['!env_firefox', true],
    ['env=chromium', true],
    ['env=firefox', false],
    ['env_chromium && !env_firefox', true],
    ['env_firefox || env_chromium', true],
    ['(env_firefox || env_safari)', false],
    ['adguard', false],
    ['cap_html_filtering', false],
    ['', false],
  ];
  for (const [expr, expected] of cases) {
    it(`${expr || '<empty>'} → ${expected}`, () => {
      expect(evaluateIfExpression(expr, 'chromium')).toBe(expected);
    });
  }
});

describe('classifyLines', () => {
  it('captures list metadata', () => {
    const { meta } = classifyLines(
      [
        '[Adblock Plus 2.0]',
        '! Title: Test List',
        '! Version: 2026.1',
        '! Expires: 4 days',
        '! Homepage: https://x.invalid',
        '! Last modified: today',
        '! Licence: GPL-3.0',
      ].join('\n'),
    );
    expect(meta).toEqual({
      title: 'Test List',
      version: '2026.1',
      expires: '4 days',
      homepage: 'https://x.invalid',
      lastModified: 'today',
      license: 'GPL-3.0',
    });
  });

  it('buckets each filter form', () => {
    const result = classifyLines(
      [
        '! comment',
        '||ads.example.com^',
        'example.com##.ad',
        'example.com#@#.ad',
        'example.com#?#.ad:has-text(x)',
        'example.com##+js(set-constant, a, 1)',
        'example.com#@#+js(set-constant, a, 1)',
        'example.com##^div[ad]',
        '',
      ].join('\n'),
    );
    expect(result.network.map((l) => l.raw)).toEqual(['||ads.example.com^']);
    expect(result.cosmetic.map((l) => l.raw)).toEqual([
      'example.com##.ad',
      'example.com#@#.ad',
      'example.com#?#.ad:has-text(x)',
    ]);
    expect(result.scriptlet.map((l) => l.raw)).toEqual([
      'example.com##+js(set-constant, a, 1)',
      'example.com#@#+js(set-constant, a, 1)',
    ]);
    expect(result.html.map((l) => l.raw)).toEqual(['example.com##^div[ad]']);
    expect(result.comments).toBe(1);
  });

  it('keeps 1-based line numbers', () => {
    const result = classifyLines('! c\n\n||a.example.com^\nexample.com##.ad');
    expect(result.network[0]).toEqual({ line: 3, raw: '||a.example.com^' });
    expect(result.cosmetic[0]).toEqual({ line: 4, raw: 'example.com##.ad' });
  });

  it('normalises hosts-file lines into ||host^ filters', () => {
    const result = classifyLines('0.0.0.0 a.example.com\n127.0.0.1 b.example.com\n0.0.0.0 localhost');
    expect(result.network.map((l) => l.raw)).toEqual(['||a.example.com^', '||b.example.com^']);
  });

  it('reads bare hostnames when format is hosts', () => {
    const result = classifyLines('bare.example.com\n# a comment\n0.0.0.0 x.example.com', { format: 'hosts' });
    expect(result.network.map((l) => l.raw)).toEqual(['||bare.example.com^', '||x.example.com^']);
  });

  it('does not treat bare hostnames as hosts lines in abp format', () => {
    const result = classifyLines('bare.example.com', { format: 'abp' });
    expect(result.network.map((l) => l.raw)).toEqual(['bare.example.com']);
  });

  it('honours !#if / !#else / !#endif', () => {
    const result = classifyLines(
      [
        '!#if env_chromium',
        '||yes.example.com^',
        '!#else',
        '||no.example.com^',
        '!#endif',
        '!#if env_firefox',
        '||never.example.com^',
        '!#else',
        '||fallback.example.com^',
        '!#endif',
      ].join('\n'),
    );
    expect(result.network.map((l) => l.raw)).toEqual(['||yes.example.com^', '||fallback.example.com^']);
  });

  it('handles nested !#if blocks', () => {
    const result = classifyLines(
      [
        '!#if env_firefox',
        '!#if env_chromium',
        '||inner.example.com^',
        '!#endif',
        '!#endif',
        '!#if env_chromium',
        '!#if env_chromium',
        '||ok.example.com^',
        '!#endif',
        '!#endif',
      ].join('\n'),
    );
    expect(result.network.map((l) => l.raw)).toEqual(['||ok.example.com^']);
  });

  it('ignores !#include', () => {
    const result = classifyLines('!#include fragments/a.txt\n||a.example.com^');
    expect(result.network.map((l) => l.raw)).toEqual(['||a.example.com^']);
    expect(result.comments).toBe(1);
  });

  it('strips carriage returns', () => {
    const result = classifyLines('||a.example.com^\r\nexample.com##.ad\r\n');
    expect(result.network[0]?.raw).toBe('||a.example.com^');
    expect(result.cosmetic[0]?.raw).toBe('example.com##.ad');
  });

  it('routes AdGuard scriptlets and raw JS separately', () => {
    const result = classifyLines(
      'example.com#%#//scriptlet("set-constant", "a", "1")\nexample.com#%#window.x = 1',
    );
    expect(result.scriptlet).toHaveLength(1);
    expect(result.html).toHaveLength(1);
  });
});

describe('AdGuard platform tokens', () => {
  it('is true for adguard_ext_chromium_mv3', () => {
    expect(evaluateIfExpression('adguard_ext_chromium_mv3', 'chromium')).toBe(true);
    expect(evaluateIfExpression('(adguard_ext_chromium_mv3 || adguard_ext_firefox)', 'chromium')).toBe(true);
  });

  it('skips the sections AdGuard excludes from MV3 builds', () => {
    // AdGuard Spyware guards its ~210k-line CNAME tracker section exactly like this.
    const text = [
      '||keep.example^',
      '!#if (!adguard_ext_safari && !adguard_app_ios && !adguard_ext_android_cb && !adguard_ext_chromium_mv3)',
      '||cname-tracker.example^',
      '!#endif',
      '!#if (adguard_ext_chromium_mv3)',
      '||mv3-only.example^',
      '!#endif',
    ].join('\n');
    const result = classifyLines(text);
    expect(result.network.map((l) => l.raw)).toEqual(['||keep.example^', '||mv3-only.example^']);
  });

  it('stays false for the other AdGuard platforms', () => {
    for (const token of ['adguard_ext_safari', 'adguard_app_ios', 'adguard_ext_android_cb']) {
      expect(evaluateIfExpression(token, 'chromium')).toBe(false);
    }
  });
});

describe('list-controlled metadata keys', () => {
  it('ignores `Object.prototype` names instead of writing a junk field', () => {
    // `META_KEYS['constructor']` on an object literal is a function, not `undefined`.
    const result = classifyLines(
      ['! constructor: boom', '! __proto__: boom', '! toString: boom', '! Title: Real'].join('\n'),
    );
    expect(result.meta).toEqual({ title: 'Real' });
  });
});
