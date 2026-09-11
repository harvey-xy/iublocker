import { describe, expect, it } from 'vitest';
import { emptyCosmeticDB } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import { addCosmeticNetworkExceptions, compileCosmetic } from '../src/cosmetic/compile';
import { lookupCosmetic } from '../src/cosmetic/lookup';

function lines(text: string): RawLine[] {
  return text
    .split('\n')
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((l) => l.raw.trim() !== '');
}

function db(text: string, listId = 'test') {
  return compileCosmetic(lines(text), { listId, trusted: false, suffixes: ['com', 'net'] }).db;
}

describe('lookupCosmetic — hostname walk', () => {
  const list = db(`
example.com##.parent
sub.example.com##.child
other.com##.other
com##.tld
    `);

  it('returns the union along the walk', () => {
    expect(lookupCosmetic([list], 'sub.example.com').selectors).toEqual(['.child', '.parent', '.tld']);
  });

  it('does not leak from a sibling hostname', () => {
    expect(lookupCosmetic([list], 'example.com').selectors).toEqual(['.parent', '.tld']);
  });

  it('does not match a partial hostname suffix', () => {
    expect(lookupCosmetic([list], 'notexample.com').selectors).toEqual(['.tld']);
  });

  it('walks deep subdomains', () => {
    expect(lookupCosmetic([list], 'a.b.sub.example.com').selectors).toEqual(['.child', '.parent', '.tld']);
  });

  it('is case-insensitive', () => {
    expect(lookupCosmetic([list], 'Sub.Example.COM').selectors).toEqual(['.child', '.parent', '.tld']);
  });

  it('returns an empty result for an unknown hostname', () => {
    const result = lookupCosmetic([list], 'unknown.test');
    expect(result.selectors).toEqual([]);
    expect(result.styles).toEqual([]);
    expect(result.procedural).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(result.elemhide).toBe(false);
  });
});

describe('lookupCosmetic — exceptions', () => {
  it('subtracts exceptions recorded anywhere along the walk', () => {
    const list = db(`
example.com##.ad
example.com##.keep
sub.example.com#@#.ad
    `);
    expect(lookupCosmetic([list], 'sub.example.com').selectors).toEqual(['.keep']);
    expect(lookupCosmetic([list], 'example.com').selectors).toEqual(['.ad', '.keep']);
  });

  it('applies a parent-domain exception to subdomains', () => {
    const list = db('sub.example.com##.ad\nexample.com#@#.ad');
    expect(lookupCosmetic([list], 'sub.example.com').selectors).toEqual([]);
    expect(lookupCosmetic([list], 'sub.example.com').excluded).toEqual(['.ad']);
  });

  it('honours negations', () => {
    const list = db('example.com,~sub.example.com##.ad');
    expect(lookupCosmetic([list], 'example.com').selectors).toEqual(['.ad']);
    expect(lookupCosmetic([list], 'sub.example.com').selectors).toEqual([]);
    expect(lookupCosmetic([list], 'deep.sub.example.com').selectors).toEqual([]);
  });

  it('exposes excluded selectors for the generic engine', () => {
    const list = db('##.generic\nexample.com#@#.generic');
    expect(lookupCosmetic([list], 'example.com').excluded).toEqual(['.generic']);
  });

  it('subtracts exceptions from styles and procedural filters', () => {
    const list = db(`
example.com##.a:style(color: red)
example.com#?#.b:has-text(x)
sub.example.com#@#.a
sub.example.com#@?#.b:has-text(x)
    `);
    const parent = lookupCosmetic([list], 'example.com');
    expect(parent.styles).toEqual([['.a', 'color: red']]);
    expect(parent.procedural).toHaveLength(1);
    const child = lookupCosmetic([list], 'sub.example.com');
    expect(child.styles).toEqual([]);
    expect(child.procedural).toEqual([]);
  });
});

describe('lookupCosmetic — generic "*" bucket', () => {
  const list = db('#?#.p:has-text(Ad)\n##.s:style(color: red)\nexample.com#?#.q:remove()');

  it('always includes generic procedural filters', () => {
    expect(lookupCosmetic([list], 'unrelated.test').procedural.map((p) => p.raw)).toEqual([
      '.p:has-text(Ad)',
    ]);
  });

  it('merges host-specific and generic procedural filters', () => {
    expect(lookupCosmetic([list], 'example.com').procedural.map((p) => p.raw)).toEqual([
      '.q:remove()',
      '.p:has-text(Ad)',
    ]);
  });

  it('includes generic styles', () => {
    expect(lookupCosmetic([list], 'unrelated.test').styles).toEqual([['.s', 'color: red']]);
  });
});

describe('lookupCosmetic — network exception flags', () => {
  it('reports elemhide/generichide/specifichide along the walk', () => {
    const list = emptyCosmeticDB('test');
    addCosmeticNetworkExceptions(list, {
      elemhide: ['elem.com'],
      generichide: ['generic.com'],
      specifichide: ['specific.com'],
    });
    expect(lookupCosmetic([list], 'a.elem.com')).toMatchObject({
      elemhide: true,
      generichide: false,
      specifichide: false,
    });
    expect(lookupCosmetic([list], 'generic.com')).toMatchObject({ generichide: true });
    expect(lookupCosmetic([list], 'deep.specific.com')).toMatchObject({ specifichide: true });
    expect(lookupCosmetic([list], 'nothing.com')).toMatchObject({
      elemhide: false,
      generichide: false,
      specifichide: false,
    });
  });

  it('memoises the per-DB index across calls', () => {
    const list = emptyCosmeticDB('test');
    addCosmeticNetworkExceptions(list, {
      elemhide: ['elem.com'],
      generichide: [],
      specifichide: [],
    });
    expect(lookupCosmetic([list], 'elem.com').elemhide).toBe(true);
    expect(lookupCosmetic([list], 'elem.com').elemhide).toBe(true);
  });
});

describe('lookupCosmetic — multiple databases', () => {
  it('unions across DBs and dedupes', () => {
    const a = db('example.com##.ad\nexample.com##.a', 'a');
    const b = db('example.com##.ad\nexample.com##.b', 'b');
    expect(lookupCosmetic([a, b], 'example.com').selectors).toEqual(['.ad', '.a', '.b']);
  });

  it('lets an exception in one DB cancel a selector from another', () => {
    const a = db('example.com##.ad', 'a');
    const b = db('example.com#@#.ad', 'b');
    expect(lookupCosmetic([a, b], 'example.com').selectors).toEqual([]);
    expect(lookupCosmetic([b, a], 'example.com').selectors).toEqual([]);
  });

  it('dedupes identical styles and procedural filters across DBs', () => {
    const a = db('example.com##.x:style(color: red)\nexample.com#?#.p:has-text(q)', 'a');
    const b = db('example.com##.x:style(color: red)\nexample.com#?#.p:has-text(q)', 'b');
    const result = lookupCosmetic([a, b], 'example.com');
    expect(result.styles).toEqual([['.x', 'color: red']]);
    expect(result.procedural).toHaveLength(1);
  });

  it('returns an empty result for no DBs', () => {
    expect(lookupCosmetic([], 'example.com')).toEqual({
      selectors: [],
      styles: [],
      procedural: [],
      elemhide: false,
      generichide: false,
      specifichide: false,
      excluded: [],
    });
  });
});
