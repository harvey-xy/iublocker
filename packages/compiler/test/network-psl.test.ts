import { describe, expect, it } from 'vitest';
import {
  ENTITY_EXPANSION_LIMIT,
  PUBLIC_SUFFIXES,
  entityBase,
  expandDomains,
  expandEntity,
  isEntity,
  isPublicSuffix,
  publicSuffixOf,
} from '../src/psl';

describe('public suffix snapshot', () => {
  it('starts with the most common suffix', () => {
    expect(PUBLIC_SUFFIXES[0]).toBe('com');
  });

  it('contains the suffixes filter lists actually use', () => {
    for (const s of ['com', 'net', 'org', 'co.uk', 'com.au', 'co.jp', 'com.br', 'de', 'ru', 'com.tw']) {
      expect(isPublicSuffix(s), s).toBe(true);
    }
  });

  it('has no duplicates and no leading dots', () => {
    expect(new Set(PUBLIC_SUFFIXES).size).toBe(PUBLIC_SUFFIXES.length);
    expect(PUBLIC_SUFFIXES.some((s) => s.startsWith('.'))).toBe(false);
  });

  it('is big enough to cover the long tail', () => {
    expect(PUBLIC_SUFFIXES.length).toBeGreaterThan(800);
  });
});

describe('publicSuffixOf', () => {
  const cases: [string, string][] = [
    ['example.com', 'com'],
    ['a.b.example.com', 'com'],
    ['example.co.uk', 'co.uk'],
    ['shop.example.co.uk', 'co.uk'],
    ['example.unknown-tld-here', ''],
  ];
  for (const [host, expected] of cases) {
    it(`${host} → ${expected || '<none>'}`, () => {
      expect(publicSuffixOf(host)).toBe(expected);
    });
  }
});

describe('entities', () => {
  it('recognises and unwraps entities', () => {
    expect(isEntity('example.*')).toBe(true);
    expect(isEntity('example.com')).toBe(false);
    expect(entityBase('example.*')).toBe('example');
  });

  it('expands from the snapshot when nothing is known', () => {
    const expanded = expandEntity('example');
    expect(expanded).toHaveLength(ENTITY_EXPANSION_LIMIT);
    expect(expanded[0]).toBe('example.com');
    expect(expanded.every((h) => h.startsWith('example.'))).toBe(true);
  });

  it('honours a smaller limit', () => {
    expect(expandEntity('example', { limit: 3 })).toEqual(['example.com', 'example.net', 'example.org']);
    expect(expandEntity('example', { limit: 0 })).toEqual([]);
  });

  it('prefers hostnames known to the list', () => {
    const known = new Set(['example.co.uk', 'example.de', 'other.com', 'example.not-a-suffix']);
    expect(expandEntity('example', { known })).toEqual(['example.co.uk', 'example.de']);
  });

  it('falls back to the snapshot when no known hostname matches', () => {
    const known = new Set(['other.com']);
    expect(expandEntity('example', { known, limit: 2 })).toEqual(['example.com', 'example.net']);
  });

  it('rejects an empty base', () => {
    expect(expandEntity('')).toEqual([]);
  });

  it('expandDomains passes plain domains through and sorts the result', () => {
    expect(expandDomains(['b.example', 'a.example'])).toEqual(['a.example', 'b.example']);
    expect(expandDomains(['a.example', 'x.*'], { limit: 2 })).toEqual(['a.example', 'x.com', 'x.net']);
  });

  it('expandDomains dedupes', () => {
    expect(expandDomains(['a.example', 'a.example'])).toEqual(['a.example']);
  });
});
