import { describe, expect, it } from 'vitest';
import type { ScriptletCall, ScriptletDB, ScriptletGroup } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import { compileScriptlets } from '../src/scriptlet/compile';
import {
  canonicalCalls,
  computeScriptletGroups,
  emitScriptletGroupBundle,
  scriptletGroupFile,
  SCRIPTLET_GROUP_DIR,
} from '../src/scriptlet/groups';
import { fnv1a64, shortHash } from '../src/scriptlet/hash';
import { fakeResolve } from './scriptlet-fixture';

function lines(text: string): RawLine[] {
  return text
    .split('\n')
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((l) => l.raw.trim() !== '');
}

function compile(text: string, listId = 'test'): ScriptletDB {
  return compileScriptlets(lines(text), {
    listId,
    trusted: false,
    resolve: fakeResolve,
    suffixes: ['com', 'net'],
  }).db;
}

/** Run an emitted bundle against a fake `window` and return what the scriptlets logged. */
function runBundle(source: string, win: Record<string, unknown> = {}): unknown[][] {
  const window = { __log: [] as unknown[][], ...win };
  const fn = new Function('window', source) as (w: unknown) => void;
  fn(window);
  return window.__log;
}

describe('fnv1a64', () => {
  it('matches the reference vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325');
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('b')).toBe('af63df4c8601f1a5');
    expect(fnv1a64('foobar')).toBe('85944171f73967e8');
  });

  it('handles non-ASCII input as UTF-8', () => {
    expect(fnv1a64('日本語')).toHaveLength(16);
    expect(fnv1a64('日本語')).not.toBe(fnv1a64('日本'));
  });

  it('shortHash takes the first 12 hex digits', () => {
    expect(shortHash('foobar')).toBe('85944171f739');
    expect(shortHash('foobar', 8)).toBe('85944171');
  });
});

describe('canonicalCalls', () => {
  it('is order-independent', () => {
    const a: ScriptletCall[] = [
      { name: 'noop', args: [] },
      { name: 'set-constant', args: ['a', '1'] },
    ];
    const b: ScriptletCall[] = [
      { name: 'set-constant', args: ['a', '1'] },
      { name: 'noop', args: [] },
    ];
    expect(canonicalCalls(a)).toBe(canonicalCalls(b));
  });

  it('distinguishes different arguments', () => {
    expect(canonicalCalls([{ name: 'set-constant', args: ['a', '1'] }])).not.toBe(
      canonicalCalls([{ name: 'set-constant', args: ['a', '2'] }]),
    );
  });
});

describe('computeScriptletGroups', () => {
  it('groups hostnames with identical effective call lists', () => {
    const db = compile(`
a.com##+js(noop)
b.com##+js(noop)
c.com##+js(set, x, 1)
    `);
    const groups = computeScriptletGroups([{ listId: 'test', db }]);
    expect(groups).toHaveLength(2);
    const noopGroup = groups.find((g) => g.calls[0]?.name === 'noop');
    expect(noopGroup?.hosts).toEqual(['a.com', 'b.com']);
    expect(noopGroup?.listIds).toEqual(['test']);
  });

  it('names files under scriptlet-groups/ with a 12-hex hash', () => {
    const db = compile('a.com##+js(noop)');
    const group = computeScriptletGroups([{ listId: 'test', db }])[0];
    expect(group).toBeDefined();
    expect(group?.hash).toHaveLength(12);
    expect(group?.file).toBe(`${SCRIPTLET_GROUP_DIR}/${group?.hash}.js`);
    expect(scriptletGroupFile('abc')).toBe('scriptlet-groups/abc.js');
  });

  it('only lists exact hostnames (subdomains inherit via match patterns)', () => {
    const db = compile('example.com##+js(noop)');
    const groups = computeScriptletGroups([{ listId: 'test', db }]);
    expect(groups[0]?.hosts).toEqual(['example.com']);
  });

  it('folds parent-domain calls into a subdomain group', () => {
    const db = compile('example.com##+js(noop)\nsub.example.com##+js(set, x, 1)');
    const groups = computeScriptletGroups([{ listId: 'test', db }]);
    const sub = groups.find((g) => g.hosts.includes('sub.example.com'));
    expect(sub?.calls.map((c) => c.name).sort()).toEqual(['noop', 'set-constant']);
  });

  it('applies exceptions before grouping', () => {
    const db = compile(`
a.com##+js(noop)
a.com##+js(set, x, 1)
b.com##+js(noop)
b.com##+js(set, x, 1)
b.com#@#+js(set)
    `);
    const groups = computeScriptletGroups([{ listId: 'test', db }]);
    expect(groups).toHaveLength(2);
    const b = groups.find((g) => g.hosts.includes('b.com'));
    expect(b?.calls).toEqual([{ name: 'noop', args: [] }]);
  });

  it('drops hostnames whose calls are all excepted', () => {
    const db = compile('a.com##+js(noop)\na.com#@#+js()');
    expect(computeScriptletGroups([{ listId: 'test', db }])).toEqual([]);
  });

  it('merges hostnames across lists and records every contributing list', () => {
    const a = compile('shared.com##+js(noop)', 'list-a');
    const b = compile('shared.com##+js(set, x, 1)', 'list-b');
    const groups = computeScriptletGroups([
      { listId: 'list-a', db: a },
      { listId: 'list-b', db: b },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.listIds).toEqual(['list-a', 'list-b']);
    expect(groups[0]?.calls).toHaveLength(2);
  });

  it('is deterministic and sorted by hash', () => {
    const db = compile('a.com##+js(noop)\nb.com##+js(set, x, 1)\nc.com##+js(aopr, y)');
    const once = computeScriptletGroups([{ listId: 'test', db }]);
    const twice = computeScriptletGroups([{ listId: 'test', db }]);
    expect(once).toEqual(twice);
    expect([...once].sort((x, y) => (x.hash < y.hash ? -1 : 1))).toEqual(once);
  });

  it('handles the generic "*" bucket as its own group', () => {
    const db = compile('##+js(noop)');
    const groups = computeScriptletGroups([{ listId: 'test', db }]);
    expect(groups[0]?.hosts).toEqual(['*']);
  });

  it('returns nothing for empty databases', () => {
    expect(computeScriptletGroups([])).toEqual([]);
    expect(computeScriptletGroups([{ listId: 'test', db: compile('') }])).toEqual([]);
  });
});

describe('emitScriptletGroupBundle', () => {
  const group = (calls: ScriptletCall[]): ScriptletGroup => ({
    hash: 'deadbeef1234',
    file: 'scriptlet-groups/deadbeef1234.js',
    hosts: ['example.com'],
    listIds: ['test'],
    calls,
  });

  it('emits runnable JS that invokes every call', () => {
    const source = emitScriptletGroupBundle(
      group([
        { name: 'set-constant', args: ['foo', 'false'] },
        { name: 'abort-on-property-read', args: ['bar'] },
      ]),
      fakeResolve,
    );
    expect(runBundle(source)).toEqual([
      ['set-constant', 'foo', 'false'],
      ['abort-on-property-read', 'bar'],
    ]);
  });

  it('sets the __iub_sl guard and never runs the same call twice', () => {
    const source = emitScriptletGroupBundle(group([{ name: 'noop', args: [] }]), fakeResolve);
    const window = { __log: [] as unknown[][] };
    const fn = new Function('window', source) as (w: unknown) => void;
    fn(window);
    fn(window);
    expect(window.__log).toEqual([['noop']]);
    expect((window as unknown as { __iub_sl: Record<string, number> }).__iub_sl).toEqual({
      'noop#[]': 1,
    });
  });

  it('runs the same scriptlet with different arguments separately', () => {
    const source = emitScriptletGroupBundle(
      group([
        { name: 'set-constant', args: ['a', '1'] },
        { name: 'set-constant', args: ['a', '2'] },
      ]),
      fakeResolve,
    );
    expect(runBundle(source)).toEqual([
      ['set-constant', 'a', '1'],
      ['set-constant', 'a', '2'],
    ]);
  });

  it('JSON-encodes arguments so they cannot break out of the literal', () => {
    const nasty = '"); window.__pwned = 1; //';
    const source = emitScriptletGroupBundle(
      group([{ name: 'log-args', args: [nasty, "');\n'"] }]),
      fakeResolve,
    );
    const window = { __log: [] as unknown[][] };
    const fn = new Function('window', source) as (w: unknown) => void;
    fn(window);
    expect(window.__log).toEqual([['log-args', nasty, "');\n'"]]);
    expect((window as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('escapes line and paragraph separators', () => {
    const source = emitScriptletGroupBundle(
      group([{ name: 'log-args', args: ['a\u2028b\u2029c'] }]),
      fakeResolve,
    );
    expect(source).not.toContain('\u2028');
    expect(runBundle(source)).toEqual([['log-args', 'a\u2028b\u2029c', undefined]]);
  });

  it('escapes "</" so the source is safe to inline', () => {
    const source = emitScriptletGroupBundle(
      group([{ name: 'log-args', args: ['</script>'] }]),
      fakeResolve,
    );
    expect(source).not.toContain('</script>');
    expect(runBundle(source)).toEqual([['log-args', '</script>', undefined]]);
  });

  it('swallows scriptlet exceptions and keeps going', () => {
    const throwing = (name: string) =>
      name === 'boom'
        ? {
            name: 'boom',
            fn: function () {
              throw new Error('boom');
            },
          }
        : fakeResolve(name);
    const source = emitScriptletGroupBundle(
      group([
        { name: 'boom', args: [] },
        { name: 'noop', args: [] },
      ]),
      throwing,
    );
    expect(runBundle(source)).toEqual([['noop']]);
  });

  it('skips unknown scriptlets with a comment', () => {
    const source = emitScriptletGroupBundle(
      group([
        { name: 'missing-one', args: [] },
        { name: 'noop', args: [] },
      ]),
      fakeResolve,
    );
    expect(source).toContain('/* unknown scriptlet: missing-one */');
    expect(runBundle(source)).toEqual([['noop']]);
  });

  it('emits a header comment with the group hash', () => {
    const source = emitScriptletGroupBundle(group([]), fakeResolve);
    expect(source.startsWith('/* iuBlocker scriptlet bundle deadbeef1234 */')).toBe(true);
    expect(runBundle(source)).toEqual([]);
  });

  it('round-trips a compiled list end to end', () => {
    const db = compile('example.com##+js(set, adConfig, false)\nexample.com##+js(noop)');
    const groups = computeScriptletGroups([{ listId: 'test', db }]);
    const first = groups[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    const log = runBundle(emitScriptletGroupBundle(first, fakeResolve));
    expect(log).toEqual([['noop'], ['set-constant', 'adConfig', 'false']]);
  });
});
