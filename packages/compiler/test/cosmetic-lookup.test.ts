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
  return compileCosmetic(lines(text), { listId, trusted: false }).db;
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

describe('lookupCosmetic — entity keys', () => {
  const list = db(`
example.*##.entity
example.com##.concrete
sub.example.*##.sub-entity
    `);

  it('matches an entity key against any public suffix', () => {
    expect(lookupCosmetic([list], 'example.com').selectors.sort()).toEqual(['.concrete', '.entity']);
    expect(lookupCosmetic([list], 'example.co.uk').selectors).toEqual(['.entity']);
    expect(lookupCosmetic([list], 'example.de').selectors).toEqual(['.entity']);
  });

  it('matches an entity key from a subdomain', () => {
    expect(lookupCosmetic([list], 'www.example.net').selectors).toEqual(['.entity']);
  });

  it('matches a multi-label entity key only at the right depth', () => {
    expect(lookupCosmetic([list], 'sub.example.org').selectors.sort()).toEqual(['.entity', '.sub-entity']);
    expect(lookupCosmetic([list], 'other.example.org').selectors).toEqual(['.entity']);
  });

  it('does not match a different base', () => {
    expect(lookupCosmetic([list], 'notexample.com').selectors).toEqual([]);
    expect(lookupCosmetic([list], 'example.com.evil.net').selectors).toEqual([]);
  });

  it('applies an exception recorded under an entity key', () => {
    const withException = db('example.*##.ad\nsite.com##.ad\n~site.*##.keep\nsite.*#@#.ad');
    expect(lookupCosmetic([withException], 'site.com').selectors).toEqual([]);
    expect(lookupCosmetic([withException], 'example.com').selectors).toEqual(['.ad']);
  });

  it('keeps working for hostnames with no known public suffix', () => {
    expect(lookupCosmetic([list], 'localhost').selectors).toEqual([]);
    expect(lookupCosmetic([list], '127.0.0.1').selectors).toEqual([]);
  });

  it('picks up entity :style() and procedural filters', () => {
    const styled = db('example.*##.a:style(opacity:0)\nexample.*#?#.b:has-text(Ad)');
    const found = lookupCosmetic([styled], 'example.co.uk');
    expect(found.styles).toEqual([['.a', 'opacity:0']]);
    expect(found.procedural).toHaveLength(1);
  });
});

describe('hostname keys that collide with Object.prototype', () => {
  it('stores and finds them as real own keys', () => {
    const list = db(`
__proto__##.a
constructor##.b
__proto__##.c:style(color:red)
constructor##.d:has-text(x)
    `);
    expect(Object.keys(list.specific).sort()).toEqual(['__proto__', 'constructor']);
    expect(lookupCosmetic([list], '__proto__').selectors).toEqual(['.a']);
    expect(lookupCosmetic([list], '__proto__').styles).toEqual([['.c', 'color:red']]);
    expect(lookupCosmetic([list], 'constructor').selectors).toEqual(['.b']);
    expect(lookupCosmetic([list], 'constructor').procedural.map((p) => p.raw)).toEqual(['.d:has-text(x)']);
  });

  it('never hands a prototype member to a page whose hostname is one', () => {
    const empty = emptyCosmeticDB('empty');
    for (const host of ['constructor', 'toString', '__proto__', 'valueOf']) {
      const found = lookupCosmetic([empty], host);
      expect(found.selectors, host).toEqual([]);
      expect(found.styles, host).toEqual([]);
      expect(found.procedural, host).toEqual([]);
      expect(found.excluded, host).toEqual([]);
    }
  });

  it('survives a JSON round trip', () => {
    const round = JSON.parse(JSON.stringify(db('__proto__##.a'))) as ReturnType<typeof db>;
    expect(lookupCosmetic([round], '__proto__').selectors).toEqual(['.a']);
  });
});
