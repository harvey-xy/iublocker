import { describe, expect, it } from 'vitest';
import { findMatchingParen, genericKey, scanSelector } from '../src/cosmetic/selector';
import {
  isProceduralSelector,
  normalizeNativeSelector,
  parseProceduralFilter,
} from '../src/cosmetic/procedural';
import { expandEntity, isEntity, PUBLIC_SUFFIXES } from '../src/cosmetic/entities';

describe('scanSelector', () => {
  it('collects top-level pseudo-classes', () => {
    const res = scanSelector('.a:has-text(x):upward(2)');
    if (!res.ok) throw new Error(res.reason);
    expect(res.scan.pseudos.map((p) => [p.name, p.arg])).toEqual([
      ['has-text', 'x'],
      ['upward', '2'],
    ]);
  });

  it('ignores pseudo-classes nested in parentheses or brackets', () => {
    const res = scanSelector('.a:has(.b:hover)[data-x=":hover"]');
    if (!res.ok) throw new Error(res.reason);
    expect(res.scan.pseudos.map((p) => p.name)).toEqual(['has']);
  });

  it('records top-level commas and sibling combinators', () => {
    const res = scanSelector('.a + .b, .c ~ .d');
    if (!res.ok) throw new Error(res.reason);
    expect(res.scan.commas).toHaveLength(1);
    expect(res.scan.siblings).toHaveLength(2);
  });

  it('reports structural errors', () => {
    expect(scanSelector('.a[')).toMatchObject({ ok: false });
    expect(scanSelector('.a(')).toMatchObject({ ok: false });
    expect(scanSelector('.a)')).toMatchObject({ ok: false });
    expect(scanSelector('.a{')).toMatchObject({ ok: false });
    expect(scanSelector('.a:')).toMatchObject({ ok: false });
    expect(scanSelector('a[x="y]')).toMatchObject({ ok: false });
  });

  it('treats a backslash as an escape', () => {
    const res = scanSelector('.a\\:b');
    if (!res.ok) throw new Error(res.reason);
    expect(res.scan.pseudos).toEqual([]);
  });
});

describe('findMatchingParen', () => {
  it('matches nested parentheses', () => {
    expect(findMatchingParen('(a(b)c)', 0)).toBe(6);
  });

  it('ignores parentheses inside quotes', () => {
    expect(findMatchingParen('("(")', 0)).toBe(4);
  });

  it('falls back to a quote-blind scan for unbalanced quotes', () => {
    expect(findMatchingParen("(don't)", 0)).toBe(6);
  });

  it('returns -1 when unbalanced', () => {
    expect(findMatchingParen('(a', 0)).toBe(-1);
  });
});

describe('genericKey', () => {
  const cases: [string, ReturnType<typeof genericKey>][] = [
    ['#foo', { kind: 'id', key: 'foo' }],
    ['#foo > .x', { kind: 'id', key: 'foo' }],
    ['div#foo', { kind: 'id', key: 'foo' }],
    ['.b#a', { kind: 'id', key: 'a' }],
    ['.bar', { kind: 'class', key: 'bar' }],
    ['.bar.baz', { kind: 'class', key: 'bar' }],
    ['div.bar[x]', { kind: 'class', key: 'bar' }],
    ['.a .b', { kind: 'class', key: 'a' }],
    ['.a > .b .c', { kind: 'class', key: 'a' }],
    ['.a:hover', { kind: 'class', key: 'a' }],
    ['div', { kind: 'complex' }],
    ['div > .a', { kind: 'complex' }],
    ['[data-ad]', { kind: 'complex' }],
    ['a[href*=".ad"]', { kind: 'complex' }],
    [':has(.a)', { kind: 'complex' }],
    ['.a + .b', { kind: 'complex' }],
    ['.a ~ .b', { kind: 'complex' }],
    ['.a, .b', { kind: 'complex' }],
    ['.a[', { kind: 'complex' }],
    ['#', { kind: 'complex' }],
  ];
  for (const [selector, expected] of cases) {
    it(`keys ${selector}`, () => {
      expect(genericKey(selector)).toEqual(expected);
    });
  }
});

describe('isProceduralSelector', () => {
  it('detects procedural operators', () => {
    expect(isProceduralSelector('.a:has-text(x)')).toBe(true);
    expect(isProceduralSelector('.a:upward(2)')).toBe(true);
    expect(isProceduralSelector('.a:has(.b:has-text(x))')).toBe(true);
    expect(isProceduralSelector('.a:not(.b:matches-css(a: b))')).toBe(true);
  });

  it('leaves native selectors alone', () => {
    expect(isProceduralSelector('.a:has(.b)')).toBe(false);
    expect(isProceduralSelector('.a:not(.b)')).toBe(false);
    expect(isProceduralSelector('.a')).toBe(false);
    expect(isProceduralSelector('.a[')).toBe(false);
  });
});

describe('normalizeNativeSelector', () => {
  it('rejects procedural operators', () => {
    expect(normalizeNativeSelector('.a:has-text(x)')).toMatchObject({ ok: false });
  });

  it('rejects an empty selector', () => {
    expect(normalizeNativeSelector('   ')).toMatchObject({ ok: false });
  });

  it('normalises nested legacy pseudo-classes', () => {
    expect(normalizeNativeSelector('.a:if(.b:-abp-has(.c))')).toEqual({
      ok: true,
      value: '.a:has(.b:has(.c))',
    });
  });
});

describe('parseProceduralFilter', () => {
  it('wraps a plain selector in a single css task', () => {
    expect(parseProceduralFilter('.ad')).toEqual({
      ok: true,
      value: { raw: '.ad', tasks: [['css', '.ad']] },
    });
  });

  it('passes procedural chains through', () => {
    expect(parseProceduralFilter('.a:remove()')).toEqual({
      ok: true,
      value: { raw: '.a:remove()', tasks: [['css', '.a'], ['remove']] },
    });
  });

  it('propagates errors', () => {
    expect(parseProceduralFilter('.a:nope(1)')).toMatchObject({ ok: false });
  });
});

describe('entities', () => {
  it('recognises entity entries', () => {
    expect(isEntity('example.*')).toBe(true);
    expect(isEntity('example.com')).toBe(false);
  });

  it('expands against the embedded suffix snapshot', () => {
    const hosts = expandEntity('example');
    expect(hosts).toHaveLength(300);
    expect(hosts[0]).toBe('example.com');
    expect(hosts).toContain('example.co.uk');
    expect(hosts).toContain('example.com.au');
    expect(hosts).toContain('example.co.jp');
  });

  it('honours an explicit cap and suffix set', () => {
    expect(expandEntity('example', ['com', 'net', 'org'], 2)).toEqual([
      'example.com',
      'example.net',
    ]);
  });

  it('ships more suffixes than the per-entity cap', () => {
    expect(PUBLIC_SUFFIXES.length).toBeGreaterThan(300);
    expect(new Set(PUBLIC_SUFFIXES).size).toBe(PUBLIC_SUFFIXES.length);
  });
});
