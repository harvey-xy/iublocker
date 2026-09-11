import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CosmeticDB, CosmeticLookup } from '@iublocker/shared';

/** Minimal stand-in for the compiler's hostname walk + union semantics. */
const lookupCosmetic = vi.fn((dbs: CosmeticDB[], hostname: string): CosmeticLookup => {
  const walk: string[] = [];
  let host = hostname;
  for (;;) {
    walk.push(host);
    const i = host.indexOf('.');
    if (i === -1) break;
    host = host.slice(i + 1);
  }
  const selectors = new Set<string>();
  const excluded = new Set<string>();
  const styles: [string, string][] = [];
  for (const db of dbs) {
    for (const key of walk) {
      for (const selector of db.specific[key] ?? []) selectors.add(selector);
      for (const selector of db.exceptions.selectors[key] ?? []) excluded.add(selector);
      for (const style of db.styles[key] ?? []) styles.push(style);
    }
  }
  for (const selector of excluded) selectors.delete(selector);
  return {
    selectors: [...selectors],
    styles,
    procedural: [],
    elemhide: dbs.some((db) => db.exceptions.elemhide.includes(hostname)),
    generichide: false,
    specifichide: false,
    excluded: [...excluded],
  };
});

vi.mock('@iublocker/compiler', () => ({
  lookupCosmetic: (dbs: CosmeticDB[], hostname: string) => lookupCosmetic(dbs, hostname),
  lookupScriptlets: () => [],
  mergeCosmeticDB: (a: CosmeticDB) => a,
  mergeScriptletDB: (a: unknown) => a,
  compileUserFilters: () => ({ dnr: [], cosmetic: null, scriptlets: null, warnings: [] }),
}));

import * as cosmeticIndex from '../src/background/cosmetic/index';
import * as store from '../src/background/storage/store';
import { makeCosmeticDB, makeListEntry, makeRulesetManifest, resetBackground, stubFetch } from './background-utils';

const manifest = makeRulesetManifest({
  lists: [
    makeListEntry('easylist', { defaultEnabled: true }),
    makeListEntry('annoy', { defaultEnabled: false, group: 'annoyances' }),
  ],
});

function routes() {
  return {
    'rulesets/manifest.json': manifest,
    'rulesets/cosmetic/easylist.json': makeCosmeticDB('easylist', {
      specific: { 'example.com': ['.ad', '.banner'], 'other.com': ['.x'] },
      styles: { 'example.com': [['.promo', 'opacity:0.1!important']] },
      generic: { byId: { ad: ['#ad'] }, byClass: { banner: ['.banner'] }, complex: ['[data-ad]'] },
      exceptions: { selectors: { 'shop.example.com': ['.banner'] }, elemhide: ['noads.com'], generichide: [], specifichide: [] },
    }),
    'rulesets/cosmetic/annoy.json': makeCosmeticDB('annoy', {
      specific: { 'example.com': ['.cookie-wall'] },
      generic: { byId: {}, byClass: { nag: ['.nag'] }, complex: ['[data-nag]'] },
    }),
  };
}

describe('CosmeticIndex', () => {
  beforeEach(() => {
    resetBackground();
    lookupCosmetic.mockClear();
    stubFetch(routes());
  });

  it('loads only the enabled lists and answers a lookup', async () => {
    const result = await cosmeticIndex.lookup('www.example.com');
    expect(result.selectors.sort()).toEqual(['.ad', '.banner']);
    expect(result.styles).toEqual([['.promo', 'opacity:0.1!important']]);
    const dbs = await cosmeticIndex.getDbs();
    expect(dbs.map((db) => db.listId)).toEqual(['easylist']);
  });

  it('applies per-hostname exceptions', async () => {
    const result = await cosmeticIndex.lookup('shop.example.com');
    expect(result.selectors).toEqual(['.ad']);
    expect(result.excluded).toEqual(['.banner']);
  });

  it('reports elemhide', async () => {
    expect((await cosmeticIndex.lookup('noads.com')).elemhide).toBe(true);
  });

  it('caches lookups per hostname until invalidated', async () => {
    await cosmeticIndex.lookup('example.com');
    await cosmeticIndex.lookup('example.com');
    expect(lookupCosmetic).toHaveBeenCalledTimes(1);
    cosmeticIndex.invalidate();
    await cosmeticIndex.lookup('example.com');
    expect(lookupCosmetic).toHaveBeenCalledTimes(2);
  });

  it('picks up a list toggle after invalidation', async () => {
    expect((await cosmeticIndex.lookup('example.com')).selectors).not.toContain('.cookie-wall');
    await store.set({ lists: { easylist: { enabled: true }, annoy: { enabled: true } } });
    cosmeticIndex.invalidate();
    expect((await cosmeticIndex.lookup('example.com')).selectors).toContain('.cookie-wall');
  });

  it('includes user and delta DBs', async () => {
    await store.set({
      userCompiled: {
        dnr: [],
        cosmetic: makeCosmeticDB('user', { specific: { 'example.com': ['.mine'] } }),
        scriptlets: { version: 1, listId: 'user', byHost: {}, exceptions: {} },
        warnings: [],
      },
      delta: {
        base: manifest.version,
        version: '2026.09.12.1',
        appliedAt: 1,
        cosmetic: makeCosmeticDB('delta', { specific: { 'example.com': ['.fresh'] } }),
        scriptlets: { version: 1, listId: 'delta', byHost: {}, exceptions: {} },
        disabled: {},
      },
    });
    cosmeticIndex.invalidate();
    const result = await cosmeticIndex.lookup('example.com');
    expect(result.selectors).toEqual(expect.arrayContaining(['.ad', '.fresh', '.mine']));
  });

  it('merges generic tables across DBs', async () => {
    await store.set({ lists: { easylist: { enabled: true }, annoy: { enabled: true } } });
    cosmeticIndex.invalidate();
    const generic = await cosmeticIndex.genericTables();
    expect(generic.byId).toEqual({ ad: ['#ad'] });
    expect(generic.byClass).toEqual({ banner: ['.banner'], nag: ['.nag'] });
    expect(generic.complex.sort()).toEqual(['[data-ad]', '[data-nag]']);
  });

  it('survives a missing cosmetic file', async () => {
    resetBackground();
    stubFetch({ 'rulesets/manifest.json': manifest });
    const result = await cosmeticIndex.lookup('example.com');
    expect(result.selectors).toEqual([]);
    expect(await cosmeticIndex.hasAnyFor('example.com')).toBe(false);
  });
});
