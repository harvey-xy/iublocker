import { describe, expect, it } from 'vitest';
import { emptyScriptletDB } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import type { ScriptletCompileOptions } from '../src/scriptlet/compile';
import {
  compileScriptlets,
  lookupScriptlets,
  lookupScriptletsDetailed,
  mergeScriptletDB,
  resolverFromRegistry,
} from '../src/scriptlet/compile';
import { fakeRegistry, fakeResolve } from './scriptlet-fixture';

function lines(text: string): RawLine[] {
  return text
    .split('\n')
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((l) => l.raw.trim() !== '');
}

const OPTS: ScriptletCompileOptions = {
  listId: 'test',
  trusted: false,
  resolve: fakeResolve,
};

function compile(text: string, opts: Partial<ScriptletCompileOptions> = {}) {
  return compileScriptlets(lines(text), { ...OPTS, ...opts });
}

describe('compileScriptlets — building', () => {
  it('keys calls by exact hostname', () => {
    const { db, dropped } = compile('example.com,test.net##+js(set-constant, a, 1)');
    expect(dropped).toEqual([]);
    expect(db.byHost).toEqual({
      'example.com': [{ name: 'set-constant', args: ['a', '1'] }],
      'test.net': [{ name: 'set-constant', args: ['a', '1'] }],
    });
  });

  it('resolves aliases to the canonical name', () => {
    expect(compile('example.com##+js(set, a, 1)').db.byHost['example.com']).toEqual([
      { name: 'set-constant', args: ['a', '1'] },
    ]);
    expect(compile('example.com##+js(aopr, a)').db.byHost['example.com']).toEqual([
      { name: 'abort-on-property-read', args: ['a'] },
    ]);
    expect(compile('example.com##+js(ra.js, href)').db.byHost['example.com']).toEqual([
      { name: 'remove-attr', args: ['href'] },
    ]);
  });

  it('keys entities by the entity key instead of expanding them', () => {
    const { db } = compile('example.*##+js(noop)');
    expect(db.byHost).toEqual({ 'example.*': [{ name: 'noop', args: [] }] });
  });

  it('records negated entities as an exception under the entity key', () => {
    const { db } = compile('example.com,~other.*##+js(noop)');
    expect(db.exceptions).toEqual({ 'other.*': ['noop'] });
  });

  it('stores generic calls under "*"', () => {
    expect(compile('##+js(noop)').db.byHost).toEqual({ '*': [{ name: 'noop', args: [] }] });
  });

  it('dedupes identical calls', () => {
    const { db } = compile('example.com##+js(noop)\nexample.com##+js(noop)');
    expect(db.byHost['example.com']).toEqual([{ name: 'noop', args: [] }]);
  });

  it('keeps calls that differ only in arguments', () => {
    const { db } = compile('example.com##+js(set, a, 1)\nexample.com##+js(set, a, 2)');
    expect(db.byHost['example.com']).toHaveLength(2);
  });

  it('accepts a registry object instead of a resolver', () => {
    const { db } = compileScriptlets(lines('example.com##+js(set, a, 1)'), {
      listId: 'test',
      trusted: false,
      registry: fakeRegistry,
    });
    expect(db.byHost['example.com']).toEqual([{ name: 'set-constant', args: ['a', '1'] }]);
  });

  it('exposes resolverFromRegistry', () => {
    const resolve = resolverFromRegistry(fakeRegistry);
    expect(resolve('set')?.name).toBe('set-constant');
    expect(resolve('set-constant.js')?.name).toBe('set-constant');
    expect(resolve('nope')).toBeUndefined();
  });

  it('produces an empty DB for an empty list', () => {
    expect(compile('').db).toEqual(emptyScriptletDB('test'));
  });

  it('ignores cosmetic and network lines', () => {
    const { db, dropped } = compile('! c\n||ads.example.com^\nexample.com##.ad');
    expect(dropped).toEqual([]);
    expect(db).toEqual(emptyScriptletDB('test'));
  });
});

describe('compileScriptlets — validation', () => {
  it('drops unknown scriptlets', () => {
    const { db, dropped } = compile('example.com##+js(does-not-exist, a)');
    expect(db.byHost).toEqual({});
    expect(dropped[0]?.reason).toContain('unknown scriptlet "does-not-exist"');
    expect(dropped[0]?.line).toBe(1);
    expect(dropped[0]?.listId).toBe('test');
  });

  it('drops calls with too few arguments', () => {
    const { dropped } = compile('example.com##+js(set-constant, a)');
    expect(dropped[0]?.reason).toContain('needs at least 2 argument(s), got 1');
  });

  it('drops calls with too many arguments', () => {
    const { dropped } = compile('example.com##+js(set-constant, a, b, c, d)');
    expect(dropped[0]?.reason).toContain('takes at most 3 argument(s), got 4');
  });

  it('accepts optional arguments', () => {
    expect(compile('example.com##+js(set-constant, a, b, c)').dropped).toEqual([]);
    expect(compile('example.com##+js(remove-attr, href)').dropped).toEqual([]);
    expect(compile('example.com##+js(noop)').dropped).toEqual([]);
  });

  it('gates trusted-* scriptlets on untrusted lists', () => {
    const { db, dropped } = compile('example.com##+js(trusted-set-cookie, a, b)');
    expect(db.byHost).toEqual({});
    expect(dropped[0]?.reason).toContain('trusted scriptlet "trusted-set-cookie"');
  });

  it('allows trusted-* scriptlets on trusted lists', () => {
    const { db, dropped } = compile('example.com##+js(trusted-set-cookie, a, b)', {
      trusted: true,
    });
    expect(dropped).toEqual([]);
    expect(db.byHost['example.com']).toEqual([{ name: 'trusted-set-cookie', args: ['a', 'b'] }]);
  });

  it('reports malformed lines as dropped', () => {
    const { dropped } = compile('example.com##+js(');
    expect(dropped).toHaveLength(1);
  });
});

describe('compileScriptlets — exceptions', () => {
  it('records exceptions per hostname and removes matching calls', () => {
    const { db } = compile('example.com##+js(noop)\nexample.com#@#+js(noop)');
    expect(db.byHost).toEqual({});
    expect(db.exceptions).toEqual({ 'example.com': ['noop'] });
  });

  it('is order-independent', () => {
    const { db } = compile('example.com#@#+js(noop)\nexample.com##+js(noop)');
    expect(db.byHost).toEqual({});
  });

  it('resolves aliases in exceptions', () => {
    const { db } = compile('example.com##+js(set, a, 1)\nexample.com#@#+js(set)');
    expect(db.byHost).toEqual({});
    expect(db.exceptions['example.com']).toEqual(['set-constant']);
  });

  it('records "*" for an empty exception', () => {
    const { db } = compile('example.com##+js(noop)\nexample.com#@#+js()');
    expect(db.exceptions).toEqual({ 'example.com': ['*'] });
    expect(db.byHost).toEqual({});
  });

  it('records unqualified exceptions under "*"', () => {
    const { db } = compile('example.com##+js(noop)\n#@#+js(noop)');
    expect(db.exceptions).toEqual({ '*': ['noop'] });
    expect(db.byHost).toEqual({});
  });

  it('warns about exceptions for unknown scriptlets but keeps them', () => {
    const { db, warnings } = compile('example.com#@#+js(who-knows)');
    expect(db.exceptions).toEqual({ 'example.com': ['who-knows'] });
    expect(warnings.join(' ')).toContain('unknown scriptlet "who-knows"');
  });

  it('turns negations into exceptions', () => {
    const { db } = compile('example.com,~sub.example.com##+js(noop)');
    expect(db.byHost).toEqual({ 'example.com': [{ name: 'noop', args: [] }] });
    expect(db.exceptions).toEqual({ 'sub.example.com': ['noop'] });
  });

  it('leaves other hostnames alone', () => {
    const { db } = compile('example.com##+js(noop)\nother.com##+js(noop)\nother.com#@#+js(noop)');
    expect(db.byHost).toEqual({ 'example.com': [{ name: 'noop', args: [] }] });
  });
});

describe('lookupScriptlets', () => {
  const db = compile(`
example.com##+js(set-constant, a, 1)
sub.example.com##+js(aopr, b)
other.com##+js(noop)
##+js(remove-attr, href)
  `).db;

  it('unions along the hostname walk plus the generic bucket', () => {
    expect(lookupScriptlets([db], 'sub.example.com')).toEqual([
      { name: 'abort-on-property-read', args: ['b'] },
      { name: 'set-constant', args: ['a', '1'] },
      { name: 'remove-attr', args: ['href'] },
    ]);
  });

  it('returns only generic calls for an unrelated host', () => {
    expect(lookupScriptlets([db], 'unrelated.test')).toEqual([{ name: 'remove-attr', args: ['href'] }]);
  });

  it('is case-insensitive', () => {
    expect(lookupScriptlets([db], 'Example.COM')).toHaveLength(2);
  });

  it('does not match a partial suffix', () => {
    expect(lookupScriptlets([db], 'notexample.com')).toEqual([{ name: 'remove-attr', args: ['href'] }]);
  });

  it('removes calls by name via exceptions along the walk', () => {
    const withException = compile(`
example.com##+js(set-constant, a, 1)
example.com##+js(noop)
sub.example.com#@#+js(set-constant)
    `).db;
    expect(lookupScriptlets([withException], 'sub.example.com')).toEqual([{ name: 'noop', args: [] }]);
    expect(lookupScriptlets([withException], 'example.com')).toHaveLength(2);
  });

  it('"*" in exceptions removes everything', () => {
    const withException = compile(`
example.com##+js(set-constant, a, 1)
sub.example.com#@#+js()
    `).db;
    expect(lookupScriptlets([withException], 'sub.example.com')).toEqual([]);
    expect(lookupScriptlets([withException], 'example.com')).toHaveLength(1);
  });

  it('applies an exception from one DB to calls from another', () => {
    const a = compile('example.com##+js(noop)', { listId: 'a' }).db;
    const b = compile('example.com#@#+js(noop)', { listId: 'b' }).db;
    expect(lookupScriptlets([a, b], 'example.com')).toEqual([]);
    expect(lookupScriptlets([b, a], 'example.com')).toEqual([]);
  });

  it('dedupes across DBs', () => {
    const a = compile('example.com##+js(noop)', { listId: 'a' }).db;
    const b = compile('example.com##+js(noop)', { listId: 'b' }).db;
    expect(lookupScriptlets([a, b], 'example.com')).toEqual([{ name: 'noop', args: [] }]);
  });

  it('returns an empty list for no DBs', () => {
    expect(lookupScriptlets([], 'example.com')).toEqual([]);
  });
});

describe('mergeScriptletDB', () => {
  const source = () =>
    compile('example.com##+js(noop)\nother.com##+js(set, a, 1)\nexample.com#@#+js(aopr)').db;

  it('is idempotent', () => {
    const a = source();
    mergeScriptletDB(a, source());
    mergeScriptletDB(a, source());
    expect(a).toEqual(source());
  });

  it('unions disjoint databases', () => {
    const a = compile('a.com##+js(noop)', { listId: 'a' }).db;
    const b = compile('b.com##+js(noop)\nb.com#@#+js(set)', { listId: 'b' }).db;
    const merged = mergeScriptletDB(a, b);
    expect(merged.listId).toBe('a');
    expect(Object.keys(merged.byHost).sort()).toEqual(['a.com', 'b.com']);
    expect(merged.exceptions).toEqual({ 'b.com': ['set-constant'] });
  });

  it('merges calls on a shared hostname without duplicates', () => {
    const a = compile('x.com##+js(noop)\nx.com##+js(set, a, 1)', { listId: 'a' }).db;
    const b = compile('x.com##+js(noop)\nx.com##+js(aopr, z)', { listId: 'b' }).db;
    mergeScriptletDB(a, b);
    expect(a.byHost['x.com']).toEqual([
      { name: 'noop', args: [] },
      { name: 'set-constant', args: ['a', '1'] },
      { name: 'abort-on-property-read', args: ['z'] },
    ]);
  });

  it('unions exception names on a shared hostname', () => {
    const a = compile('x.com#@#+js(noop)\nx.com#@#+js(set)', { listId: 'a' }).db;
    const b = compile('x.com#@#+js(set)\nx.com#@#+js(aopr)', { listId: 'b' }).db;
    mergeScriptletDB(a, b);
    expect(a.exceptions['x.com']).toEqual(['noop', 'set-constant', 'abort-on-property-read']);
  });

  it('does not alias arrays with the source', () => {
    const a = emptyScriptletDB('a');
    const b = compile('x.com##+js(noop)\nx.com#@#+js(set)').db;
    mergeScriptletDB(a, b);
    expect(a.byHost['x.com']).not.toBe(b.byHost['x.com']);
    expect(a.exceptions['x.com']).not.toBe(b.exceptions['x.com']);
  });
});

describe('lookupScriptlets — entity keys', () => {
  const db = compile(`
example.*##+js(noop)
example.com##+js(set, a, 1)
    `).db;

  it('matches an entity key against any public suffix', () => {
    expect(lookupScriptlets([db], 'example.co.uk')).toEqual([{ name: 'noop', args: [] }]);
    expect(lookupScriptlets([db], 'example.de')).toEqual([{ name: 'noop', args: [] }]);
  });

  it('matches an entity key from a subdomain', () => {
    expect(lookupScriptlets([db], 'www.example.net')).toEqual([{ name: 'noop', args: [] }]);
  });

  it('unions the entity and concrete calls', () => {
    expect(
      lookupScriptlets([db], 'example.com')
        .map((c) => c.name)
        .sort(),
    ).toEqual(['noop', 'set-constant']);
  });

  it('does not match a different base', () => {
    expect(lookupScriptlets([db], 'notexample.com')).toEqual([]);
  });

  it('honours an exception recorded under an entity key', () => {
    const excepted = compile('example.*##+js(noop)\nexample.*#@#+js(noop)').db;
    expect(lookupScriptlets([excepted], 'example.com')).toEqual([]);
  });

  it('a negated entity cancels the call on every suffix', () => {
    const negated = compile('other.com##+js(noop)\n~other.*##+js(noop)').db;
    expect(lookupScriptlets([negated], 'other.com')).toEqual([]);
  });
});

describe('lookupScriptletsDetailed', () => {
  const db = compile(`
example.*##+js(noop)
example.com##+js(set, a, 1)
    `).db;

  it('splits concrete from entity-only matches', () => {
    const found = lookupScriptletsDetailed([db], 'example.com');
    expect(found.concrete).toEqual([{ name: 'set-constant', args: ['a', '1'] }]);
    expect(found.entity).toEqual([{ name: 'noop', args: [] }]);
  });

  it('reports everything as entity when no concrete key matches', () => {
    const found = lookupScriptletsDetailed([db], 'example.co.uk');
    expect(found.concrete).toEqual([]);
    expect(found.entity).toEqual([{ name: 'noop', args: [] }]);
  });

  it('reports everything as concrete when there is no entity filter', () => {
    const plain = compile('example.com##+js(noop)').db;
    expect(lookupScriptletsDetailed([plain], 'example.com')).toEqual({
      concrete: [{ name: 'noop', args: [] }],
      entity: [],
    });
  });

  it('counts a call reachable both ways as concrete only', () => {
    const both = compile('example.*##+js(noop)\nexample.com##+js(noop)').db;
    const found = lookupScriptletsDetailed([both], 'example.com');
    expect(found.concrete).toEqual([{ name: 'noop', args: [] }]);
    expect(found.entity).toEqual([]);
  });

  it('puts the generic "*" bucket in the concrete half', () => {
    const generic = compile('##+js(noop)').db;
    expect(lookupScriptletsDetailed([generic], 'example.com').concrete).toEqual([{ name: 'noop', args: [] }]);
  });

  it('an exception for "*" empties both halves', () => {
    const off = compile('example.*##+js(noop)\nexample.com#@#+js()').db;
    expect(lookupScriptletsDetailed([off], 'example.com')).toEqual({ concrete: [], entity: [] });
  });
});
