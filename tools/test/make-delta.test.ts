import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeCosmeticDelta,
  computeDelta,
  computeDnrDelta,
  computeScriptletDelta,
  loadBundle,
  mergeCosmeticDBs,
  mergeScriptletDBs,
  ruleKey,
  type RulesetBundle,
} from '../make-delta';
import { BUILD_BUDGET, ID_RANGE } from '../../packages/shared/src/dnr';
import { emptyCosmeticDB } from '../../packages/shared/src/cosmetic';
import { emptyScriptletDB } from '../../packages/shared/src/scriptlets';
import type { DNRRule } from '../../packages/shared/src/dnr';
import type { CosmeticDB } from '../../packages/shared/src/cosmetic';
import type { ScriptletDB } from '../../packages/shared/src/scriptlets';

function block(id: number, urlFilter: string, extra: Partial<DNRRule> = {}): DNRRule {
  return { id, priority: 1, action: { type: 'block' }, condition: { urlFilter }, ...extra };
}

function bundle(partial: Partial<RulesetBundle> & { dnr: Record<string, DNRRule[]> }): RulesetBundle {
  const listIds = partial.listIds ?? Object.keys(partial.dnr);
  const cosmetic: Record<string, CosmeticDB> = partial.cosmetic ?? {};
  const scriptlets: Record<string, ScriptletDB> = partial.scriptlets ?? {};
  for (const id of listIds) {
    cosmetic[id] ??= emptyCosmeticDB(id);
    scriptlets[id] ??= emptyScriptletDB(id);
  }
  return { version: partial.version ?? '2026.01.01.1', listIds, dnr: partial.dnr, cosmetic, scriptlets };
}

describe('ruleKey', () => {
  it('ignores the id', () => {
    expect(ruleKey(block(1, '||a.com^'))).toBe(ruleKey(block(9999, '||a.com^')));
  });

  it('treats a missing priority as 1', () => {
    const withPriority = block(1, '||a.com^');
    const without: DNRRule = { id: 2, action: { type: 'block' }, condition: { urlFilter: '||a.com^' } };
    expect(ruleKey(withPriority)).toBe(ruleKey(without));
  });

  it('ignores the order of domain and resource-type lists', () => {
    const a = block(1, '||a.com^', {
      condition: {
        urlFilter: '||a.com^',
        initiatorDomains: ['b.com', 'a.com'],
        resourceTypes: ['script', 'image'],
      },
    });
    const b = block(2, '||a.com^', {
      condition: {
        urlFilter: '||a.com^',
        initiatorDomains: ['a.com', 'b.com'],
        resourceTypes: ['image', 'script'],
      },
    });
    expect(ruleKey(a)).toBe(ruleKey(b));
  });

  it('ignores object key order but not values', () => {
    const a: DNRRule = {
      id: 1,
      action: { type: 'block' },
      condition: { urlFilter: '||a.com^', domainType: 'thirdParty' },
    };
    const b: DNRRule = {
      id: 1,
      condition: { domainType: 'thirdParty', urlFilter: '||a.com^' },
      action: { type: 'block' },
    };
    expect(ruleKey(a)).toBe(ruleKey(b));
    expect(ruleKey(a)).not.toBe(ruleKey(block(1, '||b.com^')));
  });
});

describe('computeDnrDelta', () => {
  it('adds only rules missing from the old build and numbers them in the delta range', () => {
    const oldB = bundle({ dnr: { easylist: [block(1, '||a.com^')] } });
    const newB = bundle({
      dnr: { easylist: [block(7, '||a.com^'), block(8, '||b.com^'), block(9, '||c.com^')] },
    });
    const { add, stats } = computeDnrDelta(oldB, newB, ['easylist']);
    expect(add.map((r) => r.condition.urlFilter)).toEqual(['||b.com^', '||c.com^']);
    expect(add.map((r) => r.id)).toEqual([ID_RANGE.DELTA.start, ID_RANGE.DELTA.start + 1]);
    expect(stats.added).toBe(2);
    expect(stats.droppedOverBudget).toBe(0);
  });

  it('deduplicates identical rules coming from several lists', () => {
    const oldB = bundle({ dnr: { easylist: [], easyprivacy: [] } });
    const newB = bundle({
      dnr: { easylist: [block(1, '||dup.com^')], easyprivacy: [block(2, '||dup.com^')] },
    });
    const { add } = computeDnrDelta(oldB, newB, ['easylist', 'easyprivacy']);
    expect(add).toHaveLength(1);
  });

  it('ranks allow and priority>=3 rules first, then by list order, then by rule order', () => {
    const oldB = bundle({ dnr: { easylist: [], 'ubo-filters': [] } });
    const newB = bundle({
      listIds: ['ubo-filters', 'easylist'],
      dnr: {
        'ubo-filters': [block(1, '||u1.com^'), block(2, '||u2.com^')],
        easylist: [
          block(3, '||e1.com^'),
          block(4, '||important.com^', { priority: 3 }),
          { id: 5, priority: 2, action: { type: 'allow' }, condition: { urlFilter: '||allow.com^' } },
        ],
      },
    });
    const { add } = computeDnrDelta(oldB, newB, ['easylist', 'ubo-filters']);
    expect(add.map((r) => r.condition.urlFilter)).toEqual([
      '||important.com^',
      '||allow.com^',
      '||e1.com^',
      '||u1.com^',
      '||u2.com^',
    ]);
  });

  it('caps additions at the delta dynamic-rule budget', () => {
    const many = Array.from({ length: BUILD_BUDGET.DELTA_DYNAMIC_RULES + 5 }, (_, i) =>
      block(i + 1, `||x${i}.com^`),
    );
    const oldB = bundle({ dnr: { easylist: [] } });
    const newB = bundle({ dnr: { easylist: many } });
    const { add, stats } = computeDnrDelta(oldB, newB, ['easylist']);
    expect(add).toHaveLength(BUILD_BUDGET.DELTA_DYNAMIC_RULES);
    expect(stats.droppedOverBudget).toBe(5);
    expect(add.at(-1)?.id).toBe(ID_RANGE.DELTA.start + BUILD_BUDGET.DELTA_DYNAMIC_RULES - 1);
    expect(add.at(-1)?.id).toBeLessThanOrEqual(ID_RANGE.DELTA.end);
  });

  it('disables old rule ids that disappeared, capped per ruleset, using the old ids', () => {
    const oldRules = Array.from({ length: 5_050 }, (_, i) => block(i + 1, `||gone${i}.com^`));
    const oldB = bundle({ dnr: { easylist: [...oldRules, block(90_000, '||kept.com^')] } });
    const newB = bundle({ dnr: { easylist: [block(1, '||kept.com^')] } });
    const { disable, stats } = computeDnrDelta(oldB, newB, ['easylist']);
    expect(disable.easylist).toHaveLength(5_000);
    expect(disable.easylist?.[0]).toBe(1);
    expect(disable.easylist).not.toContain(90_000);
    expect(stats.disabled).toBe(5_000);
    expect(stats.disabledRulesets).toBe(1);
  });

  it('reports, but does not try to disable, rulesets that vanished from the new build', () => {
    const oldB = bundle({ dnr: { easylist: [block(1, '||a.com^')], retired: [block(2, '||b.com^')] } });
    const newB = bundle({ dnr: { easylist: [block(1, '||a.com^')] } });
    const { disable, stats } = computeDnrDelta(oldB, newB, ['easylist']);
    expect(disable).toEqual({});
    expect(stats.missingInNew).toEqual(['retired']);
  });
});

describe('cosmetic delta', () => {
  const withSpecific = (
    listId: string,
    specific: Record<string, string[]>,
    extra: Partial<CosmeticDB> = {},
  ): CosmeticDB => ({
    ...emptyCosmeticDB(listId),
    specific,
    ...extra,
  });

  it('merges every list into one DB, deduplicating', () => {
    const merged = mergeCosmeticDBs([
      withSpecific('a', { 'example.com': ['.ad', '.banner'] }),
      withSpecific('b', { 'example.com': ['.ad', '.promo'], 'other.com': ['#x'] }),
    ]);
    expect(merged.listId).toBe('delta');
    expect(merged.specific['example.com']).toEqual(['.ad', '.banner', '.promo']);
    expect(merged.specific['other.com']).toEqual(['#x']);
  });

  it('computes per-hostname add and removeSpecific sets', () => {
    const oldDb = withSpecific('old', { 'example.com': ['.ad', '.old'], 'gone.com': ['.x'] });
    const newDb = withSpecific('new', { 'example.com': ['.ad', '.new'], 'fresh.com': ['.y'] });
    const { add, removeSpecific, stats } = computeCosmeticDelta(oldDb, newDb);
    expect(add.specific).toEqual({ 'example.com': ['.new'], 'fresh.com': ['.y'] });
    expect(removeSpecific).toEqual({ 'example.com': ['.old'], 'gone.com': ['.x'] });
    expect(stats.addedSelectors).toBe(2);
    expect(stats.removedSelectors).toBe(2);
  });

  it('diffs generic tables, styles, procedural filters and exceptions', () => {
    const oldDb: CosmeticDB = {
      ...emptyCosmeticDB('old'),
      generic: { byId: { ad: ['#ad'] }, byClass: {}, complex: ['[data-ad]'] },
      styles: { 'example.com': [['.a', 'opacity:0']] },
      procedural: {
        'example.com': [
          {
            raw: '.card:has-text(A)',
            tasks: [
              ['css', '.card'],
              ['has-text', 'A'],
            ],
          },
        ],
      },
      exceptions: {
        selectors: { 'ex.com': ['.keep'] },
        elemhide: ['e.com'],
        generichide: [],
        specifichide: [],
      },
    };
    const newDb: CosmeticDB = {
      ...emptyCosmeticDB('new'),
      generic: {
        byId: { ad: ['#ad', '#ad2'] },
        byClass: { promo: ['.promo'] },
        complex: ['[data-ad]', '[data-promo]'],
      },
      styles: {
        'example.com': [
          ['.a', 'opacity:0'],
          ['.b', 'display:none'],
        ],
      },
      procedural: {
        'example.com': [
          {
            raw: '.card:has-text(A)',
            tasks: [
              ['css', '.card'],
              ['has-text', 'A'],
            ],
          },
          {
            raw: '.card:has-text(B)',
            tasks: [
              ['css', '.card'],
              ['has-text', 'B'],
            ],
          },
        ],
      },
      exceptions: {
        selectors: { 'ex.com': ['.keep', '.new'] },
        elemhide: ['e.com', 'f.com'],
        generichide: [],
        specifichide: [],
      },
    };
    const { add, stats } = computeCosmeticDelta(oldDb, newDb);
    expect(add.generic.byId).toEqual({ ad: ['#ad2'] });
    expect(add.generic.byClass).toEqual({ promo: ['.promo'] });
    expect(add.generic.complex).toEqual(['[data-promo]']);
    expect(add.styles['example.com']).toEqual([['.b', 'display:none']]);
    expect(add.procedural['example.com']?.map((f) => f.raw)).toEqual(['.card:has-text(B)']);
    expect(add.exceptions.selectors).toEqual({ 'ex.com': ['.new'] });
    expect(add.exceptions.elemhide).toEqual(['f.com']);
    expect(stats.addedProcedural).toBe(1);
  });
});

describe('scriptlet delta', () => {
  const db = (listId: string, byHost: Record<string, { name: string; args: string[] }[]>): ScriptletDB => ({
    ...emptyScriptletDB(listId),
    byHost,
  });

  it('merges lists and diffs calls by name + args', () => {
    const oldDb = mergeScriptletDBs([
      db('a', { 'example.com': [{ name: 'set-constant', args: ['adConfig', 'false'] }] }),
    ]);
    const newDb = mergeScriptletDBs([
      db('a', {
        'example.com': [
          { name: 'set-constant', args: ['adConfig', 'false'] },
          { name: 'abort-on-property-read', args: ['ads'] },
        ],
      }),
      db('b', { 'other.com': [{ name: 'nowebrtc', args: [] }] }),
    ]);
    const { add, remove, stats } = computeScriptletDelta(oldDb, newDb);
    expect(add.byHost['example.com']).toEqual([{ name: 'abort-on-property-read', args: ['ads'] }]);
    expect(add.byHost['other.com']).toEqual([{ name: 'nowebrtc', args: [] }]);
    expect(remove).toEqual({});
    expect(stats.added).toBe(2);

    const back = computeScriptletDelta(newDb, oldDb);
    expect(back.remove['example.com']).toEqual([{ name: 'abort-on-property-read', args: ['ads'] }]);
    expect(back.remove['other.com']).toEqual([{ name: 'nowebrtc', args: [] }]);
    expect(back.stats.removed).toBe(2);
  });
});

describe('computeDelta', () => {
  it('produces a DeltaFile with base/version from the two manifests', () => {
    const oldB = bundle({ version: '2026.01.01.1', dnr: { easylist: [block(1, '||a.com^')] } });
    const newB = bundle({
      version: '2026.02.02.3',
      dnr: { easylist: [block(1, '||a.com^'), block(2, '||b.com^')] },
    });
    const { delta, summary } = computeDelta(oldB, newB, {
      builtAt: '2026-02-02T00:00:00.000Z',
      extensionVersion: '1.2.3',
    });
    expect(delta.base).toBe('2026.01.01.1');
    expect(delta.version).toBe('2026.02.02.3');
    expect(delta.builtAt).toBe('2026-02-02T00:00:00.000Z');
    expect(delta.dnr.add).toHaveLength(1);
    expect(delta.cosmetic.add.listId).toBe('delta');
    expect(delta.scriptlets.add.listId).toBe('delta');
    expect(summary.extensionVersion).toBe('1.2.3');
    // Serialisable as-is.
    expect(() => JSON.parse(JSON.stringify(delta))).not.toThrow();
  });
});

describe('loadBundle', () => {
  it('reads manifest.json and the per-list files, tolerating missing DBs', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iub-delta-'));
    await mkdir(path.join(dir, 'dnr'), { recursive: true });
    await mkdir(path.join(dir, 'cosmetic'), { recursive: true });
    await writeFile(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        version: '2026.03.03.1',
        builtAt: '2026-03-03T00:00:00.000Z',
        lists: [
          {
            id: 'easylist',
            title: 'EasyList',
            group: 'ads',
            defaultEnabled: true,
            trusted: false,
            sources: [],
            counts: {
              dnr: 1,
              regex: 0,
              cosmeticGeneric: 0,
              cosmeticSpecific: 1,
              procedural: 0,
              scriptlets: 0,
              dropped: 0,
            },
            files: {
              dnr: 'dnr/easylist.json',
              cosmetic: 'cosmetic/easylist.json',
              scriptlets: 'scriptlets/easylist.json',
            },
          },
        ],
        budget: { staticRulesTotal: 1, staticRulesDefaultEnabled: 1, regexTotal: 0 },
        scriptletGroups: [],
      }),
    );
    await writeFile(path.join(dir, 'dnr', 'easylist.json'), JSON.stringify([block(1, '||a.com^')]));
    await writeFile(
      path.join(dir, 'cosmetic', 'easylist.json'),
      JSON.stringify({ ...emptyCosmeticDB('easylist'), specific: { 'example.com': ['.ad'] } }),
    );

    const loaded = await loadBundle(dir);
    expect(loaded.version).toBe('2026.03.03.1');
    expect(loaded.listIds).toEqual(['easylist']);
    expect(loaded.dnr.easylist).toHaveLength(1);
    expect(loaded.cosmetic.easylist?.specific).toEqual({ 'example.com': ['.ad'] });
    // scriptlets/easylist.json does not exist → empty DB, not a crash.
    expect(loaded.scriptlets.easylist?.byHost).toEqual({});
  });

  it('throws a clear error when the directory has no manifest', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'iub-delta-empty-'));
    await expect(loadBundle(dir)).rejects.toThrow(/manifest\.json/);
  });
});

describe('hostname keys that collide with Object.prototype', () => {
  /** `Object.fromEntries`-style own property, the way the compiler emits these DBs. */
  function withHost<T>(host: string, value: T): Record<string, T> {
    const out: Record<string, T> = {};
    Object.defineProperty(out, host, { value, writable: true, enumerable: true, configurable: true });
    return out;
  }

  it('diffs a "__proto__" hostname instead of pushing onto Object.prototype', () => {
    const oldDb = emptyCosmeticDB('old');
    const newDb = emptyCosmeticDB('new');
    newDb.specific = withHost('__proto__', ['.a']);
    newDb.procedural = withHost('constructor', [{ raw: '.b:has-text(x)', tasks: [['css', '.b']] }]);
    const delta = computeCosmeticDelta(oldDb, newDb);
    expect(delta.add.specific['__proto__']).toEqual(['.a']);
    expect(Object.keys(delta.add.procedural)).toEqual(['constructor']);
    expect(delta.stats.addedSelectors).toBe(1);
  });

  it('merges such keys across lists', () => {
    const a = emptyScriptletDB('a');
    a.byHost = withHost('__proto__', [{ name: 'set-constant', args: ['x', '1'] }]);
    const b = emptyScriptletDB('b');
    b.byHost = withHost('__proto__', [{ name: 'set-constant', args: ['y', '2'] }]);
    const merged = mergeScriptletDBs([a, b]);
    expect(merged.byHost['__proto__']).toHaveLength(2);
    expect(Object.keys(merged.byHost)).toEqual(['__proto__']);
  });

  it('removes them too', () => {
    const oldDb = emptyScriptletDB('old');
    oldDb.byHost = withHost('__proto__', [{ name: 'set-constant', args: ['x', '1'] }]);
    const delta = computeScriptletDelta(oldDb, emptyScriptletDB('new'));
    expect(delta.remove['__proto__']).toHaveLength(1);
    expect(delta.stats.removed).toBe(1);
  });
});
