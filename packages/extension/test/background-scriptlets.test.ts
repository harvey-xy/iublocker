/**
 * ScriptletIndex — which calls are pre-registered and which the worker has to inject.
 * docs/SCRIPTLETS.md §3.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptletCall, ScriptletDB } from '@iublocker/shared';

/**
 * A miniature of the real compiler lookup: `byHost` keys ending in `.*` are entity keys
 * and only match through the label prefixes above the (single-label) public suffix.
 */
vi.mock('@iublocker/compiler', () => {
  const walk = (hostname: string): string[] => {
    const out: string[] = [];
    let h = hostname;
    for (;;) {
      out.push(h);
      const i = h.indexOf('.');
      if (i === -1) break;
      h = h.slice(i + 1);
    }
    return out;
  };
  const entityKeys = (hostname: string): string[] => {
    const parts = hostname.split('.');
    if (parts.length < 2) return [];
    const head = parts.slice(0, -1);
    return head.map((_, i) => `${head.slice(i).join('.')}.*`);
  };
  const detailed = (dbs: ScriptletDB[], hostname: string) => {
    const seen = new Set<string>();
    const pick = (keys: string[]): ScriptletCall[] => {
      const out: ScriptletCall[] = [];
      for (const db of dbs) {
        for (const key of keys) {
          for (const call of db.byHost[key] ?? []) {
            const id = `${call.name} ${call.args.join(' ')}`;
            if (seen.has(id)) continue;
            seen.add(id);
            out.push(call);
          }
        }
      }
      return out;
    };
    return { concrete: pick([...walk(hostname), '*']), entity: pick(entityKeys(hostname)) };
  };
  return {
    lookupCosmetic: () => ({
      selectors: [],
      styles: [],
      procedural: [],
      elemhide: false,
      generichide: false,
      specifichide: false,
      excluded: [],
    }),
    lookupScriptlets: (dbs: ScriptletDB[], hostname: string): ScriptletCall[] => {
      const { concrete, entity } = detailed(dbs, hostname);
      return [...concrete, ...entity];
    },
    lookupScriptletsDetailed: detailed,
    mergeCosmeticDB: (a: unknown) => a,
    mergeScriptletDB: (a: unknown) => a,
    compileUserFilters: () => ({ dnr: [], cosmetic: null, scriptlets: null, warnings: [] }),
  };
});

import * as scriptlets from '../src/background/scriptlets/index';
import * as store from '../src/background/storage/store';
import {
  makeListEntry,
  makeRulesetManifest,
  makeScriptletDB,
  resetBackground,
  stubFetch,
} from './background-utils';

const listDb = makeScriptletDB('easylist', {
  byHost: {
    'example.*': [{ name: 'entity-one', args: [] }],
    'example.com': [{ name: 'concrete-one', args: [] }],
  },
});

function setup(manifestPatch: Record<string, unknown> = {}) {
  resetBackground();
  stubFetch({
    'rulesets/manifest.json': makeRulesetManifest({
      lists: [makeListEntry('easylist')],
      scriptletGroups: [
        {
          name: 'concrete-one',
          hash: 'aaa',
          file: 'scriptlet-groups/concrete-one.js',
          libs: ['scriptlet-lib/concrete-one.js'],
          hosts: ['example.com'],
          listIds: ['easylist'],
        },
      ],
      ...manifestPatch,
    }),
    'rulesets/scriptlets/easylist.json': listDb,
  });
}

const names = (calls: ScriptletCall[]): string[] => calls.map((c) => c.name).sort();

describe('ScriptletIndex: entity keys go through the dynamic path', () => {
  beforeEach(() => setup());

  it('pre-registers only the concrete calls', async () => {
    expect(names(await scriptlets.lookupList('example.com'))).toEqual(['concrete-one']);
  });

  it('injects the entity-only calls dynamically', async () => {
    expect(names(await scriptlets.lookupDynamic('example.com'))).toEqual(['entity-one']);
  });

  it('injects everything on a suffix with no concrete key at all', async () => {
    expect(names(await scriptlets.lookupList('example.co'))).toEqual([]);
    expect(names(await scriptlets.lookupDynamic('example.co'))).toEqual(['entity-one']);
  });

  it('reports the union through lookupAll', async () => {
    expect(names(await scriptlets.lookupAll('example.com'))).toEqual(['concrete-one', 'entity-one']);
  });

  it('injects nothing for an unrelated hostname', async () => {
    expect(await scriptlets.lookupDynamic('unrelated.test')).toEqual([]);
  });
});

describe('ScriptletIndex: user and delta scriptlets still reach the dynamic path', () => {
  beforeEach(() => setup());

  it('adds user calls that no group covers', async () => {
    await store.set({
      userCompiled: {
        dnr: [],
        cosmetic: null,
        scriptlets: makeScriptletDB('user', { byHost: { 'example.com': [{ name: 'user-one', args: [] }] } }),
        warnings: [],
      } as never,
    });
    scriptlets.invalidate();
    expect(names(await scriptlets.lookupDynamic('example.com'))).toEqual(['entity-one', 'user-one']);
  });

  it('does not repeat a user call that a group already runs', async () => {
    await store.set({
      userCompiled: {
        dnr: [],
        cosmetic: null,
        scriptlets: makeScriptletDB('user', {
          byHost: { 'example.com': [{ name: 'concrete-one', args: [] }] },
        }),
        warnings: [],
      } as never,
    });
    scriptlets.invalidate();
    expect(names(await scriptlets.lookupDynamic('example.com'))).toEqual(['entity-one']);
  });
});
