import { describe, expect, it } from 'vitest';
import type { ScriptletCall, ScriptletDB } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import { compileScriptlets } from '../src/scriptlet/compile';
import type { ScriptletGroupBuild, ScriptletSourceResolver } from '../src/scriptlet/groups';
import {
  canonicalCalls,
  collectScriptletLibs,
  computeScriptletGroups,
  emitScriptletGroupBundle,
  emitScriptletLib,
  libsFor,
  scriptletGroupFile,
  scriptletLibFile,
  SCRIPTLET_GROUP_DIR,
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
function groupsOf(dbs: { listId: string; db: ScriptletDB }[]): ScriptletGroupBuild[] {
  return computeScriptletGroups(dbs, fakeResolve);
}

/** Groups for one filter-list text. */
function groupsFor(text: string, listId = 'test'): ScriptletGroupBuild[] {
  return groupsOf([{ listId, db: compile(text, listId) }]);
}

function groupNamed(groups: readonly ScriptletGroupBuild[], name: string): ScriptletGroupBuild {
  const group = groups.find((g) => g.name === name);
  if (group === undefined) throw new Error(`no group for ${name}`);
  return group;
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

/** Evaluate one emitted file with `window`/`self` bound to `scope` and a fake `location`. */
function evaluate(source: string, scope: Scope, hostname = 'example.com'): void {
  const fn = new Function('window', 'self', 'location', source) as (
    w: unknown,
    s: unknown,
    l: unknown,
  ) => void;
  fn(scope, scope, { hostname });
}

/** Load a group's lib files into `scope`, the way `js: [...libs, file]` does. */
function loadLibs(
  group: ScriptletGroupBuild,
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

/** Run a whole group (libs then table) on `hostname` and return what the scriptlets logged. */
function runGroup(
  group: ScriptletGroupBuild,
  hostname = 'example.com',
  resolve: ScriptletSourceResolver = fakeResolve,
  win: Record<string, unknown> = {},
): unknown[][] {
  const scope = loadLibs(group, resolve, newScope(win));
  evaluate(emitScriptletGroupBundle(group), scope, hostname);
  return scope.__log;
}

/** Everything the build would run on `hostname`, across every group. */
function runAll(groups: readonly ScriptletGroupBuild[], hostname: string): unknown[][] {
  const scope = newScope();
  for (const group of groups) {
    loadLibs(group, fakeResolve, scope);
    evaluate(emitScriptletGroupBundle(group), scope, hostname);
  }
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
  it('makes one group per scriptlet name, not per call list', () => {
    const groups = groupsFor(`
a.com##+js(noop)
b.com##+js(noop)
b.com##+js(set, x, 1)
c.com##+js(set, x, 2)
    `);
    expect(groups.map((g) => g.name)).toEqual(['noop', 'set-constant']);
    expect(groupNamed(groups, 'noop').hosts).toEqual(['a.com', 'b.com']);
    expect(groupNamed(groups, 'set-constant').hosts).toEqual(['b.com', 'c.com']);
  });

  it('names files and libs after the scriptlet', () => {
    const group = groupsFor('a.com##+js(noop)')[0] as ScriptletGroupBuild;
    expect(group.file).toBe(`${SCRIPTLET_GROUP_DIR}/noop.js`);
    expect(group.libs).toEqual([`${SCRIPTLET_LIB_DIR}/noop.js`]);
    expect(group.hash).toHaveLength(12);
    expect(scriptletGroupFile('abc')).toBe('scriptlet-groups/abc.js');
  });

  it('records one argument vector per distinct call', () => {
    const group = groupsFor('a.com##+js(set, x, 1)\nb.com##+js(set, x, 2)\nc.com##+js(set, x, 1)')[0];
    expect(group?.argsList).toEqual([
      ['x', '1'],
      ['x', '2'],
    ]);
    expect(group?.hostArgs).toEqual({ 'a.com': [0], 'b.com': [1], 'c.com': [0] });
  });

  it('keeps several argument vectors for one hostname', () => {
    const group = groupsFor('a.com##+js(set, x, 1)\na.com##+js(set, y, 2)')[0];
    expect(group?.hostArgs).toEqual({ 'a.com': [0, 1] });
    expect(runGroup(group as ScriptletGroupBuild, 'a.com')).toEqual([
      ['set-constant', 'x', '1'],
      ['set-constant', 'y', '2'],
    ]);
  });

  it('drops a subdomain that adds nothing to its parent domain', () => {
    const groups = groupsFor('example.com##+js(noop)\nsub.example.com##+js(noop)');
    // `*://*.example.com/*` already covers the subdomain and the runtime suffix walk finds
    // the parent row, so the subdomain costs neither a match pattern nor a table entry.
    expect(groups[0]?.hosts).toEqual(['example.com']);
    expect(groups[0]?.hostArgs).toEqual({ 'example.com': [0] });
  });

  it('keeps only what a subdomain adds on top of its parent', () => {
    const group = groupsFor('example.com##+js(set, x, 1)\nsub.example.com##+js(set, y, 2)')[0];
    expect(group?.hostArgs).toEqual({ 'example.com': [0], 'sub.example.com': [1] });
    // The parent's call still reaches the subdomain through the suffix walk.
    expect(runGroup(group as ScriptletGroupBuild, 'sub.example.com')).toEqual([
      ['set-constant', 'y', '2'],
      ['set-constant', 'x', '1'],
    ]);
  });

  it('applies exceptions before grouping', () => {
    const groups = groupsFor(`
a.com##+js(noop)
a.com##+js(set, x, 1)
b.com##+js(noop)
b.com##+js(set, x, 1)
b.com#@#+js(set)
    `);
    expect(groupNamed(groups, 'noop').hosts).toEqual(['a.com', 'b.com']);
    expect(groupNamed(groups, 'set-constant').hosts).toEqual(['a.com']);
  });

  it('drops hostnames whose calls are all excepted', () => {
    expect(groupsFor('a.com##+js(noop)\na.com#@#+js()')).toEqual([]);
  });

  it('merges hostnames across lists and records every contributing list', () => {
    const groups = groupsOf([
      { listId: 'list-a', db: compile('shared.com##+js(noop)', 'list-a') },
      { listId: 'list-b', db: compile('shared.com##+js(noop)\nother.com##+js(noop)', 'list-b') },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.listIds).toEqual(['list-a', 'list-b']);
    expect(groups[0]?.hosts).toEqual(['other.com', 'shared.com']);
  });

  it('attributes a scriptlet only to the lists that actually call it', () => {
    const groups = groupsOf([
      { listId: 'list-a', db: compile('a.com##+js(noop)', 'list-a') },
      { listId: 'list-b', db: compile('b.com##+js(set, x, 1)', 'list-b') },
    ]);
    expect(groupNamed(groups, 'noop').listIds).toEqual(['list-a']);
    expect(groupNamed(groups, 'set-constant').listIds).toEqual(['list-b']);
  });

  it('is deterministic and sorted by name', () => {
    const db = compile('a.com##+js(noop)\nb.com##+js(set, x, 1)\nc.com##+js(aopr, y)');
    const once = groupsOf([{ listId: 'test', db }]);
    const twice = groupsOf([{ listId: 'test', db }]);
    expect(once).toEqual(twice);
    expect(once.map((g) => g.name)).toEqual(['abort-on-property-read', 'noop', 'set-constant']);
  });

  it('returns nothing for empty databases', () => {
    expect(groupsOf([])).toEqual([]);
    expect(groupsOf([{ listId: 'test', db: compile('') }])).toEqual([]);
  });

  it('skips scriptlets with no bundled body', () => {
    const db: ScriptletDB = {
      version: 1,
      listId: 'test',
      byHost: { 'a.com': [{ name: 'missing-one', args: [] }] },
      exceptions: {},
    };
    expect(groupsOf([{ listId: 'test', db }])).toEqual([]);
  });
});

describe('computeScriptletGroups — the generic bucket', () => {
  it('registers on every URL and keeps the generic arguments apart', () => {
    const group = groupsFor('##+js(noop)')[0];
    expect(group?.hosts).toEqual(['*']);
    expect(group?.genericArgs).toEqual([0]);
    expect(group?.hostArgs).toEqual({});
  });

  it('runs the generic call on any hostname', () => {
    const group = groupsFor('##+js(noop)')[0] as ScriptletGroupBuild;
    expect(runGroup(group, 'whatever.test')).toEqual([['noop']]);
  });

  it('drops hosts that only repeat the generic call', () => {
    const group = groupsFor('##+js(set, x, 1)\na.com##+js(set, x, 1)\nb.com##+js(set, y, 2)')[0];
    expect(group?.hosts).toEqual(['*']);
    expect(group?.hostArgs).toEqual({ 'b.com': [1] });
  });

  it('does not run the generic call where an exception cancels it', () => {
    const group = groupsFor('##+js(noop)\noff.com#@#+js(noop)')[0] as ScriptletGroupBuild;
    expect(group.exclude).toEqual(['off.com']);
    expect(runGroup(group, 'off.com')).toEqual([]);
    expect(runGroup(group, 'sub.off.com')).toEqual([]);
    expect(runGroup(group, 'other.com')).toEqual([['noop']]);
  });
});

describe('computeScriptletGroups — exceptions', () => {
  it('excludes a subdomain the parent group would otherwise cover', () => {
    const group = groupsFor('example.com##+js(noop)\nsub.example.com#@#+js(noop)')[0];
    expect(group?.hosts).toEqual(['example.com']);
    expect(group?.exclude).toEqual(['sub.example.com']);
    expect(runGroup(group as ScriptletGroupBuild, 'sub.example.com')).toEqual([]);
    expect(runGroup(group as ScriptletGroupBuild, 'deep.sub.example.com')).toEqual([]);
    expect(runGroup(group as ScriptletGroupBuild, 'other.example.com')).toEqual([['noop']]);
  });

  it('handles the `example.com,~sub.example.com##+js(...)` negation', () => {
    const group = groupsFor('example.com,~sub.example.com##+js(noop)')[0];
    expect(group?.hosts).toEqual(['example.com']);
    expect(group?.exclude).toEqual(['sub.example.com']);
    expect(runGroup(group as ScriptletGroupBuild, 'sub.example.com')).toEqual([]);
    expect(runGroup(group as ScriptletGroupBuild, 'example.com')).toEqual([['noop']]);
  });

  it('cancels every scriptlet for `#@#+js()`', () => {
    const groups = groupsFor('example.com##+js(noop)\nexample.com##+js(set, x, 1)\nsub.example.com#@#+js()');
    for (const group of groups) {
      expect(group.exclude).toEqual(['sub.example.com']);
      expect(runGroup(group, 'sub.example.com')).toEqual([]);
    }
    expect(runAll(groups, 'example.com')).toHaveLength(2);
  });

  it('cancels across lists', () => {
    const groups = groupsOf([
      { listId: 'list-a', db: compile('example.com##+js(noop)', 'list-a') },
      { listId: 'list-b', db: compile('sub.example.com#@#+js(noop)', 'list-b') },
    ]);
    expect(groups[0]?.exclude).toEqual(['sub.example.com']);
  });

  it('leaves out exceptions no registered host could reach', () => {
    const group = groupsFor('example.com##+js(noop)\nunrelated.test#@#+js(noop)')[0];
    expect(group?.exclude).toEqual([]);
  });
});

describe('computeScriptletGroups — entity keys', () => {
  it('never groups an entity key (no literal match pattern exists)', () => {
    expect(groupsFor('example.*##+js(noop)')).toEqual([]);
  });

  it('groups the concrete hosts of a list that also has entity filters', () => {
    const groups = groupsFor('example.*##+js(noop)\nreal.com##+js(set, x, 1)');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('set-constant');
    expect(groups[0]?.hosts).toEqual(['real.com']);
  });

  it('leaves the entity half of a concrete host to the dynamic path', () => {
    const groups = groupsFor('example.*##+js(noop)\nexample.com##+js(set, x, 1)');
    // `example.com` matches both keys; only the concrete call is pre-registered.
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('set-constant');
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
    expect(() => scriptletGroupFile('a/b')).toThrow();
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
    // The same holds for the group an alias lands in.
    expect(groupsFor('a.com##+js(set, x, 1)\nb.com##+js(set-constant, y, 2)')).toHaveLength(1);
  });

  it('skips unknown scriptlets instead of pointing at a missing file', () => {
    expect(libsFor([{ name: 'missing-one', args: [] }], fakeResolve)).toEqual([]);
  });

  it('collects the union of every group lib, deduped and sorted', () => {
    expect(
      collectScriptletLibs(groupsFor('a.com##+js(noop)\nb.com##+js(set, x, 1)\nc.com##+js(noop)')),
    ).toEqual(['scriptlet-lib/noop.js', 'scriptlet-lib/set-constant.js']);
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

  it('emits each function body exactly once no matter how many hosts use it', () => {
    const groups = groupsFor('a.com##+js(set, a, 1)\nb.com##+js(set, a, 2)\nc.com##+js(set, b, 1)');
    expect(groups).toHaveLength(1);
    expect(collectScriptletLibs(groups)).toEqual(['scriptlet-lib/set-constant.js']);
    // No group file carries a function body.
    expect(emitScriptletGroupBundle(groups[0] as ScriptletGroupBuild)).not.toContain('__log.push');
  });
});

describe('emitScriptletGroupBundle', () => {
  const group = (text: string, name: string): ScriptletGroupBuild => groupNamed(groupsFor(text), name);

  it('runs the scriptlet the host table names', () => {
    const groups = groupsFor('example.com##+js(set, foo, false)\nexample.com##+js(aopr, bar)');
    expect(runAll(groups, 'example.com')).toEqual([
      ['abort-on-property-read', 'bar'],
      ['set-constant', 'foo', 'false'],
    ]);
  });

  it('runs nothing on a hostname the table does not cover', () => {
    expect(runGroup(group('example.com##+js(noop)', 'noop'), 'elsewhere.test')).toEqual([]);
  });

  it('carries the table only — no scriptlet body', () => {
    const source = emitScriptletGroupBundle(group('a.com##+js(noop)', 'noop'));
    expect(source).toContain('self.__iub_lib');
    expect(source).toContain('"a.com"');
    // The fake scriptlet's body would show up as `__log.push`.
    expect(source).not.toContain('__log');
    // A one-host group is the fixed preamble plus a handful of literals.
    expect(source.length).toBeLessThan(1_200);
  });

  it('does nothing when the lib is missing instead of throwing', () => {
    const source = emitScriptletGroupBundle(group('a.com##+js(noop)', 'noop'));
    const scope = newScope();
    expect(() => evaluate(source, scope, 'a.com')).not.toThrow();
    expect(scope.__log).toEqual([]);
  });

  it('sets the __iub_sl guard and never runs the same call twice', () => {
    const g = group('a.com##+js(noop)', 'noop');
    const scope = loadLibs(g);
    const source = emitScriptletGroupBundle(g);
    evaluate(source, scope, 'a.com');
    evaluate(source, scope, 'a.com');
    expect(scope.__log).toEqual([['noop']]);
    expect(scope['__iub_sl']).toEqual({ 'noop#[]': 1 });
  });

  it('runs a parent and a child row once each, deduping identical arguments', () => {
    const g = group('example.com##+js(set, x, 1)\nsub.example.com##+js(set, x, 1)', 'set-constant');
    expect(runGroup(g, 'sub.example.com')).toEqual([['set-constant', 'x', '1']]);
  });

  it('runs the same scriptlet with different arguments separately', () => {
    const g = group('a.com##+js(set, a, 1)\na.com##+js(set, a, 2)', 'set-constant');
    expect(runGroup(g, 'a.com')).toEqual([
      ['set-constant', 'a', '1'],
      ['set-constant', 'a', '2'],
    ]);
  });

  it('matches a subdomain through the suffix walk', () => {
    const g = group('example.com##+js(noop)', 'noop');
    expect(runGroup(g, 'deep.sub.example.com')).toEqual([['noop']]);
    expect(runGroup(g, 'notexample.com')).toEqual([]);
  });

  it('survives an empty hostname', () => {
    expect(runGroup(group('a.com##+js(noop)', 'noop'), '')).toEqual([]);
  });

  it('is not confused by a hostname that names an Object.prototype member', () => {
    const g = group('a.com##+js(noop)', 'noop');
    expect(runGroup(g, 'constructor')).toEqual([]);
    expect(runGroup(g, 'hasownproperty.toString')).toEqual([]);
  });

  it('JSON-encodes arguments so they cannot break out of the literal', () => {
    const nasty = '"); window.__pwned = 1; //';
    const db: ScriptletDB = {
      version: 1,
      listId: 'test',
      byHost: { 'a.com': [{ name: 'log-args', args: [nasty, "');\n'"] }] },
      exceptions: {},
    };
    const g = groupsOf([{ listId: 'test', db }])[0] as ScriptletGroupBuild;
    const scope = loadLibs(g);
    evaluate(emitScriptletGroupBundle(g), scope, 'a.com');
    expect(scope.__log).toEqual([['log-args', nasty, "');\n'"]]);
    expect(scope['__pwned']).toBeUndefined();
  });

  it('escapes line and paragraph separators', () => {
    const db: ScriptletDB = {
      version: 1,
      listId: 'test',
      byHost: { 'a.com': [{ name: 'log-args', args: ['a b c'] }] },
      exceptions: {},
    };
    const g = groupsOf([{ listId: 'test', db }])[0] as ScriptletGroupBuild;
    expect(emitScriptletGroupBundle(g)).not.toContain(' ');
    expect(runGroup(g, 'a.com')).toEqual([['log-args', 'a b c', undefined]]);
  });

  it('escapes "</" so the source is safe to inline', () => {
    const db: ScriptletDB = {
      version: 1,
      listId: 'test',
      byHost: { 'a.com': [{ name: 'log-args', args: ['</script>'] }] },
      exceptions: {},
    };
    const g = groupsOf([{ listId: 'test', db }])[0] as ScriptletGroupBuild;
    expect(emitScriptletGroupBundle(g)).not.toContain('</script>');
    expect(runGroup(g, 'a.com')).toEqual([['log-args', '</script>', undefined]]);
  });

  it('swallows scriptlet exceptions and keeps going', () => {
    const throwing = (name: string): ReturnType<ScriptletSourceResolver> =>
      name === 'boom'
        ? {
            name: 'boom',
            fn: function () {
              throw new Error('boom');
            },
          }
        : fakeResolve(name);
    const db: ScriptletDB = {
      version: 1,
      listId: 'test',
      byHost: {
        'a.com': [
          { name: 'boom', args: ['1'] },
          { name: 'boom', args: ['2'] },
        ],
      },
      exceptions: {},
    };
    const g = computeScriptletGroups([{ listId: 'test', db }], throwing)[0] as ScriptletGroupBuild;
    const scope = loadLibs(g, throwing);
    expect(() => evaluate(emitScriptletGroupBundle(g), scope, 'a.com')).not.toThrow();
    // Both calls were attempted; the guard marks them so a re-run does not repeat them.
    expect(scope['__iub_sl']).toEqual({ 'boom#["1"]': 1, 'boom#["2"]': 1 });
  });

  it('emits a header comment with the scriptlet name', () => {
    const g = group('a.com##+js(noop)', 'noop');
    expect(emitScriptletGroupBundle(g).startsWith('/* iuBlocker scriptlet group noop */')).toBe(true);
  });

  it('shims the esbuild __name helper so keepNames output still runs', () => {
    const named = (name: string): ReturnType<ScriptletSourceResolver> =>
      name === 'named'
        ? {
            name: 'named',
            // What esbuild's `keepNames` produces inside a transpiled scriptlet body.
            fn: new Function(
              'return function () { var inner = __name(function () {}, "inner"); window.__log.push(["named", typeof inner]); }',
            )() as (...args: string[]) => void,
          }
        : fakeResolve(name);
    const db: ScriptletDB = {
      version: 1,
      listId: 'test',
      byHost: { 'a.com': [{ name: 'named', args: [] }] },
      exceptions: {},
    };
    const g = computeScriptletGroups([{ listId: 'test', db }], named)[0] as ScriptletGroupBuild;
    expect(runGroup(g, 'a.com', named)).toEqual([['named', 'function']]);
  });

  it('the real bundled registry serialises through serializeScriptletFn', () => {
    const source = emitScriptletLib('set-constant');
    expect(source).not.toBeNull();
    expect(source).toContain('self.__iub_lib');
    expect(() => new Function('window', 'self', source as string)).not.toThrow();
  });

  it('round-trips a compiled list end to end', () => {
    const groups = groupsFor('example.com##+js(set, adConfig, false)\nexample.com##+js(noop)');
    expect(collectScriptletLibs(groups)).toEqual(['scriptlet-lib/noop.js', 'scriptlet-lib/set-constant.js']);
    expect(runAll(groups, 'www.example.com')).toEqual([['noop'], ['set-constant', 'adConfig', 'false']]);
  });
});
