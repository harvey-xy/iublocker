import { describe, expect, it } from 'vitest';
import type { ScriptletCall, ScriptletDB, ScriptletGroup } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import { compileScriptlets } from '../src/scriptlet/compile';
import type { ScriptletSourceResolver } from '../src/scriptlet/groups';
import {
  canonicalCalls,
  capScriptletGroups,
  collectScriptletLibs,
  computeScriptletGroups,
  emitScriptletGroupBundle,
  emitScriptletLib,
  libsFor,
  scriptletGroupFile,
  scriptletLibFile,
  SCRIPTLET_GROUP_DIR,
  SCRIPTLET_GROUPS_PER_LIST,
  SCRIPTLET_LIB_DIR,
} from '../src/scriptlet/groups';
import { fnv1a64, shortHash } from '../src/scriptlet/hash';
import { fakeResolve } from './scriptlet-fixture';

function lines(text: string): RawLine[] {
  return text
    .split('\n')
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((l) => l.raw.trim() !== '');
}

/** Groups always resolve against the fake registry these tests compile with. */
function groupsOf(dbs: { listId: string; db: ScriptletDB }[]): ScriptletGroup[] {
  return computeScriptletGroups(dbs, fakeResolve);
}

function compile(text: string, listId = 'test'): ScriptletDB {
  return compileScriptlets(lines(text), {
    listId,
    trusted: false,
    resolve: fakeResolve,
  }).db;
}

type Scope = Record<string, unknown> & { __log: unknown[][] };

function newScope(win: Record<string, unknown> = {}): Scope {
  return { __log: [] as unknown[][], ...win } as Scope;
}

/** Evaluate one emitted file with `window` and `self` both bound to `scope`. */
function evaluate(source: string, scope: Scope): void {
  const fn = new Function('window', 'self', source) as (w: unknown, s: unknown) => void;
  fn(scope, scope);
}

/** Load a group's lib files into `scope`, the way `js: [...libs, file]` does. */
function loadLibs(
  group: ScriptletGroup,
  resolve: ScriptletSourceResolver = fakeResolve,
  scope: Scope = newScope(),
): Scope {
  for (const lib of group.libs) {
    const name = lib.slice(SCRIPTLET_LIB_DIR.length + 1, -'.js'.length);
    const source = emitScriptletLib(name, resolve);
    if (source !== null) evaluate(source, scope);
  }
  return scope;
}

/** Run a whole group (libs then call list) and return what the scriptlets logged. */
function runGroup(
  group: ScriptletGroup,
  resolve: ScriptletSourceResolver = fakeResolve,
  win: Record<string, unknown> = {},
): unknown[][] {
  const scope = loadLibs(group, resolve, newScope(win));
  evaluate(emitScriptletGroupBundle(group, resolve), scope);
  return scope.__log;
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

  it('is stable for equal names and arguments', () => {
    const calls: ScriptletCall[] = [
      { name: 'noop', args: [] },
      { name: 'noop', args: [] },
    ];
    expect(canonicalCalls(calls)).toBe('[{"name":"noop","args":[]},{"name":"noop","args":[]}]');
  });

  it('orders by argument when names are equal', () => {
    expect(
      canonicalCalls([
        { name: 'set-constant', args: ['b'] },
        { name: 'set-constant', args: ['a'] },
      ]),
    ).toBe('[{"name":"set-constant","args":["a"]},{"name":"set-constant","args":["b"]}]');
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
    const groups = groupsOf([{ listId: 'test', db }]);
    expect(groups).toHaveLength(2);
    const noopGroup = groups.find((g) => g.calls[0]?.name === 'noop');
    expect(noopGroup?.hosts).toEqual(['a.com', 'b.com']);
    expect(noopGroup?.listIds).toEqual(['test']);
    expect(noopGroup?.libs).toEqual(['scriptlet-lib/noop.js']);
  });

  it('names files under scriptlet-groups/ with a 12-hex hash', () => {
    const db = compile('a.com##+js(noop)');
    const group = groupsOf([{ listId: 'test', db }])[0];
    expect(group).toBeDefined();
    expect(group?.hash).toHaveLength(12);
    expect(group?.file).toBe(`${SCRIPTLET_GROUP_DIR}/${group?.hash}.js`);
    expect(scriptletGroupFile('abc')).toBe('scriptlet-groups/abc.js');
  });

  it('only lists exact hostnames (subdomains inherit via match patterns)', () => {
    const db = compile('example.com##+js(noop)');
    const groups = groupsOf([{ listId: 'test', db }]);
    expect(groups[0]?.hosts).toEqual(['example.com']);
  });

  it('folds parent-domain calls into a subdomain group', () => {
    const db = compile('example.com##+js(noop)\nsub.example.com##+js(set, x, 1)');
    const groups = groupsOf([{ listId: 'test', db }]);
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
    const groups = groupsOf([{ listId: 'test', db }]);
    expect(groups).toHaveLength(2);
    const b = groups.find((g) => g.hosts.includes('b.com'));
    expect(b?.calls).toEqual([{ name: 'noop', args: [] }]);
  });

  it('drops hostnames whose calls are all excepted', () => {
    const db = compile('a.com##+js(noop)\na.com#@#+js()');
    expect(groupsOf([{ listId: 'test', db }])).toEqual([]);
  });

  it('merges hostnames across lists and records every contributing list', () => {
    const a = compile('shared.com##+js(noop)', 'list-a');
    const b = compile('shared.com##+js(set, x, 1)', 'list-b');
    const groups = groupsOf([
      { listId: 'list-a', db: a },
      { listId: 'list-b', db: b },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.listIds).toEqual(['list-a', 'list-b']);
    expect(groups[0]?.calls).toHaveLength(2);
  });

  it('is deterministic and sorted by hash', () => {
    const db = compile('a.com##+js(noop)\nb.com##+js(set, x, 1)\nc.com##+js(aopr, y)');
    const once = groupsOf([{ listId: 'test', db }]);
    const twice = groupsOf([{ listId: 'test', db }]);
    expect(once).toEqual(twice);
    expect([...once].sort((x, y) => (x.hash < y.hash ? -1 : 1))).toEqual(once);
  });

  it('handles the generic "*" bucket as its own group', () => {
    const db = compile('##+js(noop)');
    const groups = groupsOf([{ listId: 'test', db }]);
    expect(groups[0]?.hosts).toEqual(['*']);
  });

  it('returns nothing for empty databases', () => {
    expect(groupsOf([])).toEqual([]);
    expect(groupsOf([{ listId: 'test', db: compile('') }])).toEqual([]);
  });
});

describe('computeScriptletGroups — entity keys', () => {
  it('never groups an entity key (no literal match pattern exists)', () => {
    const db = compile('example.*##+js(noop)');
    expect(groupsOf([{ listId: 'test', db }])).toEqual([]);
  });

  it('groups the concrete hosts of a list that also has entity filters', () => {
    const db = compile('example.*##+js(noop)\nreal.com##+js(set, x, 1)');
    const groups = groupsOf([{ listId: 'test', db }]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.hosts).toEqual(['real.com']);
    expect(groups[0]?.calls).toEqual([{ name: 'set-constant', args: ['x', '1'] }]);
  });

  it('leaves the entity half of a concrete host to the dynamic path', () => {
    const db = compile('example.*##+js(noop)\nexample.com##+js(set, x, 1)');
    const groups = groupsOf([{ listId: 'test', db }]);
    // `example.com` matches both keys; only the concrete call is pre-registered.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.hosts).toEqual(['example.com']);
    expect(groups[0]?.calls).toEqual([{ name: 'set-constant', args: ['x', '1'] }]);
  });
});

describe('scriptlet libs', () => {
  it('names lib files under scriptlet-lib/', () => {
    expect(scriptletLibFile('set-constant')).toBe('scriptlet-lib/set-constant.js');
    expect(SCRIPTLET_LIB_DIR).toBe('scriptlet-lib');
  });

  it('refuses names that could escape the directory', () => {
    expect(() => scriptletLibFile('../evil')).toThrow();
    expect(() => scriptletLibFile('a/b')).toThrow();
    expect(() => scriptletLibFile('')).toThrow();
  });

  it('lists one lib per distinct scriptlet, in first-use order', () => {
    expect(
      libsFor(
        [
          { name: 'noop', args: [] },
          { name: 'set-constant', args: ['a', '1'] },
          { name: 'noop', args: ['x'] },
        ],
        fakeResolve,
      ),
    ).toEqual(['scriptlet-lib/noop.js', 'scriptlet-lib/set-constant.js']);
  });

  it('canonicalises aliases so one lib serves both spellings', () => {
    expect(libsFor([{ name: 'set', args: [] }], fakeResolve)).toEqual(['scriptlet-lib/set-constant.js']);
  });

  it('skips unknown scriptlets instead of pointing at a missing file', () => {
    expect(libsFor([{ name: 'missing-one', args: [] }], fakeResolve)).toEqual([]);
  });

  it('collects the union of every group lib, deduped and sorted', () => {
    const db = compile('a.com##+js(noop)\nb.com##+js(set, x, 1)\nc.com##+js(noop)');
    expect(collectScriptletLibs(groupsOf([{ listId: 'test', db }]))).toEqual([
      'scriptlet-lib/noop.js',
      'scriptlet-lib/set-constant.js',
    ]);
  });

  it('defines the function on self.__iub_lib under its canonical name', () => {
    const source = emitScriptletLib('set-constant', fakeResolve);
    expect(source).not.toBeNull();
    const scope = newScope();
    evaluate(source as string, scope);
    const lib = scope['__iub_lib'] as Record<string, unknown>;
    expect(typeof lib['set-constant']).toBe('function');
  });

  it('returns null for an unknown scriptlet', () => {
    expect(emitScriptletLib('missing-one', fakeResolve)).toBeNull();
  });

  it('emits each function body exactly once no matter how many groups use it', () => {
    const db = compile('a.com##+js(set, a, 1)\nb.com##+js(set, a, 2)\nc.com##+js(set, b, 1)');
    const groups = groupsOf([{ listId: 'test', db }]);
    expect(groups).toHaveLength(3);
    const libs = collectScriptletLibs(groups);
    expect(libs).toEqual(['scriptlet-lib/set-constant.js']);
    // No group file carries a function body.
    for (const group of groups) {
      expect(emitScriptletGroupBundle(group, fakeResolve)).not.toContain('__log.push');
    }
  });
});

describe('emitScriptletGroupBundle', () => {
  const group = (calls: ScriptletCall[]): ScriptletGroup => ({
    hash: 'deadbeef1234',
    file: 'scriptlet-groups/deadbeef1234.js',
    libs: libsFor(calls, fakeResolve),
    hosts: ['example.com'],
    listIds: ['test'],
    calls,
  });

  it('runs every call against the functions the libs defined', () => {
    expect(
      runGroup(
        group([
          { name: 'set-constant', args: ['foo', 'false'] },
          { name: 'abort-on-property-read', args: ['bar'] },
        ]),
      ),
    ).toEqual([
      ['set-constant', 'foo', 'false'],
      ['abort-on-property-read', 'bar'],
    ]);
  });

  it('carries the call list only — no scriptlet body', () => {
    const source = emitScriptletGroupBundle(group([{ name: 'noop', args: [] }]), fakeResolve);
    expect(source).toContain('run("noop#[]", "noop", []);');
    expect(source).toContain('self.__iub_lib');
    // The fake scriptlet's body would show up as `__log.push`.
    expect(source).not.toContain('__log');
    // A one-call group is the fixed preamble plus a single line.
    expect(source.length).toBeLessThan(600);
  });

  it('does nothing when the lib is missing instead of throwing', () => {
    const source = emitScriptletGroupBundle(group([{ name: 'noop', args: [] }]), fakeResolve);
    const scope = newScope();
    expect(() => evaluate(source, scope)).not.toThrow();
    expect(scope.__log).toEqual([]);
  });

  it('sets the __iub_sl guard and never runs the same call twice', () => {
    const g = group([{ name: 'noop', args: [] }]);
    const scope = loadLibs(g);
    const source = emitScriptletGroupBundle(g, fakeResolve);
    evaluate(source, scope);
    evaluate(source, scope);
    expect(scope.__log).toEqual([['noop']]);
    expect(scope['__iub_sl']).toEqual({ 'noop#[]': 1 });
  });

  it('runs the same scriptlet with different arguments separately', () => {
    expect(
      runGroup(
        group([
          { name: 'set-constant', args: ['a', '1'] },
          { name: 'set-constant', args: ['a', '2'] },
        ]),
      ),
    ).toEqual([
      ['set-constant', 'a', '1'],
      ['set-constant', 'a', '2'],
    ]);
  });

  it('JSON-encodes arguments so they cannot break out of the literal', () => {
    const nasty = '"); window.__pwned = 1; //';
    const g = group([{ name: 'log-args', args: [nasty, "');\n'"] }]);
    const scope = loadLibs(g);
    evaluate(emitScriptletGroupBundle(g, fakeResolve), scope);
    expect(scope.__log).toEqual([['log-args', nasty, "');\n'"]]);
    expect(scope['__pwned']).toBeUndefined();
  });

  it('escapes line and paragraph separators', () => {
    const g = group([{ name: 'log-args', args: ['a b c'] }]);
    expect(emitScriptletGroupBundle(g, fakeResolve)).not.toContain(' ');
    expect(runGroup(g)).toEqual([['log-args', 'a b c', undefined]]);
  });

  it('escapes "</" so the source is safe to inline', () => {
    const g = group([{ name: 'log-args', args: ['</script>'] }]);
    expect(emitScriptletGroupBundle(g, fakeResolve)).not.toContain('</script>');
    expect(runGroup(g)).toEqual([['log-args', '</script>', undefined]]);
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
    const calls: ScriptletCall[] = [
      { name: 'boom', args: [] },
      { name: 'noop', args: [] },
    ];
    const g: ScriptletGroup = {
      hash: 'deadbeef1234',
      file: 'scriptlet-groups/deadbeef1234.js',
      libs: libsFor(calls, throwing),
      hosts: ['example.com'],
      listIds: ['test'],
      calls,
    };
    expect(runGroup(g, throwing)).toEqual([['noop']]);
  });

  it('skips unknown scriptlets with a comment', () => {
    const g = group([
      { name: 'missing-one', args: [] },
      { name: 'noop', args: [] },
    ]);
    expect(emitScriptletGroupBundle(g, fakeResolve)).toContain('/* unknown scriptlet: missing-one */');
    expect(runGroup(g)).toEqual([['noop']]);
  });

  it('emits a header comment with the group hash', () => {
    const g = group([]);
    expect(
      emitScriptletGroupBundle(g, fakeResolve).startsWith('/* iuBlocker scriptlet bundle deadbeef1234 */'),
    ).toBe(true);
    expect(runGroup(g)).toEqual([]);
  });

  it('shims the esbuild __name helper so keepNames output still runs', () => {
    const named = (_name: string) => ({
      name: 'named',
      // What esbuild's `keepNames` produces inside a transpiled scriptlet body.
      fn: new Function(
        'return function () { var inner = __name(function () {}, "inner"); window.__log.push(["named", typeof inner]); }',
      )() as (...args: string[]) => void,
    });
    const calls: ScriptletCall[] = [{ name: 'named', args: [] }];
    const g: ScriptletGroup = {
      hash: 'deadbeef1234',
      file: 'scriptlet-groups/deadbeef1234.js',
      libs: libsFor(calls, named),
      hosts: ['example.com'],
      listIds: ['test'],
      calls,
    };
    expect(runGroup(g, named)).toEqual([['named', 'function']]);
  });

  it('falls back to the bundled registry when no resolver is given', () => {
    const g = group([{ name: 'noop', args: [] }]);
    const source = emitScriptletGroupBundle(g);
    expect(source.startsWith('/* iuBlocker scriptlet bundle deadbeef1234 */')).toBe(true);
    expect(() => new Function('window', 'self', source)).not.toThrow();
  });

  it('round-trips a compiled list end to end', () => {
    const db = compile('example.com##+js(set, adConfig, false)\nexample.com##+js(noop)');
    const groups = groupsOf([{ listId: 'test', db }]);
    const first = groups[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(first.libs).toEqual(['scriptlet-lib/noop.js', 'scriptlet-lib/set-constant.js']);
    expect(runGroup(first)).toEqual([['noop'], ['set-constant', 'adConfig', 'false']]);
  });

  it('the real bundled registry serialises through serializeScriptletFn', () => {
    const source = emitScriptletLib('set-constant');
    expect(source).not.toBeNull();
    expect(source).toContain('self.__iub_lib');
    expect(() => new Function('window', 'self', source as string)).not.toThrow();
  });
});

describe('capScriptletGroups', () => {
  /** `n` hosts, each with its own distinct call list → `n` one-host groups. */
  function manyGroups(n: number, listId = 'big'): ScriptletDB {
    const text = Array.from({ length: n }, (_, i) => `h${i}.example##+js(set, p${i}, 1)`).join('\n');
    return compile(text, listId);
  }

  it('exposes the documented default', () => {
    expect(SCRIPTLET_GROUPS_PER_LIST).toBe(3000);
  });

  it('is a no-op below the cap', () => {
    const groups = groupsOf([{ listId: 'big', db: manyGroups(5) }]);
    expect(groups).toHaveLength(5);
    const capped = capScriptletGroups(groups, 10);
    expect(capped.groups).toEqual(groups);
    expect(capped.dynamicHosts).toEqual([]);
  });

  it('demotes the smallest groups until the list fits', () => {
    const groups = groupsOf([{ listId: 'big', db: manyGroups(6) }]);
    const capped = capScriptletGroups(groups, 4);
    expect(capped.groups).toHaveLength(4);
    expect(capped.dynamicHosts).toHaveLength(2);
    // Every demoted host is gone from the kept groups.
    const kept = new Set(capped.groups.flatMap((g) => g.hosts));
    for (const host of capped.dynamicHosts) expect(kept.has(host)).toBe(false);
  });

  it('prefers to keep the groups that cover the most hosts', () => {
    const db = compile(
      ['a.example##+js(noop)', 'b.example##+js(noop)', 'c.example##+js(set, x, 1)'].join('\n'),
    );
    const groups = groupsOf([{ listId: 'test', db }]);
    const capped = capScriptletGroups(groups, 1);
    expect(capped.groups).toHaveLength(1);
    expect(capped.groups[0]?.hosts).toEqual(['a.example', 'b.example']);
    expect(capped.dynamicHosts).toEqual(['c.example']);
  });

  it('never demotes the generic "*" group', () => {
    const db = compile('##+js(noop)\na.example##+js(set, x, 1)\nb.example##+js(set, y, 1)');
    const groups = groupsOf([{ listId: 'test', db }]);
    const capped = capScriptletGroups(groups, 1);
    expect(capped.groups.some((g) => g.hosts.includes('*'))).toBe(true);
  });

  it('leaves a second list under the cap alone', () => {
    const big = manyGroups(4, 'big');
    const small = compile('only.example##+js(noop)', 'small');
    const groups = groupsOf([
      { listId: 'big', db: big },
      { listId: 'small', db: small },
    ]);
    const capped = capScriptletGroups(groups, 2);
    expect(capped.groups.some((g) => g.hosts.includes('only.example'))).toBe(true);
    const perList = capped.groups.filter((g) => g.listIds.includes('big'));
    expect(perList.length).toBeLessThanOrEqual(2);
  });

  it('is deterministic', () => {
    const groups = groupsOf([{ listId: 'big', db: manyGroups(8) }]);
    const a = capScriptletGroups(groups, 3);
    const b = capScriptletGroups(groups, 3);
    expect(a.dynamicHosts).toEqual(b.dynamicHosts);
    expect(a.groups.map((g) => g.hash)).toEqual(b.groups.map((g) => g.hash));
    expect([...a.dynamicHosts].sort()).toEqual(a.dynamicHosts);
  });
});
