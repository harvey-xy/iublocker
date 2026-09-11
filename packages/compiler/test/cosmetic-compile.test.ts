import { describe, expect, it } from 'vitest';
import type { CosmeticDB } from '@iublocker/shared';
import { emptyCosmeticDB } from '@iublocker/shared';
import type { RawLine } from '../src/types';
import type { CosmeticCompileOptions } from '../src/cosmetic/compile';
import {
  addCosmeticNetworkExceptions,
  compileCosmetic,
  MAX_GENERIC_COMPLEX,
  mergeCosmeticDB,
} from '../src/cosmetic/compile';

function lines(text: string): RawLine[] {
  return text
    .split('\n')
    .map((raw, i) => ({ line: i + 1, raw }))
    .filter((l) => l.raw.trim() !== '');
}

const OPTS: CosmeticCompileOptions = {
  listId: 'test',
  trusted: false,
};

function compile(text: string, opts: Partial<CosmeticCompileOptions> = {}) {
  return compileCosmetic(lines(text), { ...OPTS, ...opts });
}

describe('compileCosmetic — generic', () => {
  it('indexes simple selectors by id and class', () => {
    const { db } = compile(`
##.ad
##.ad-wrapper > .inner
###banner
##div.promo[data-x]
    `);
    expect(db.generic.byClass).toEqual({
      ad: ['.ad'],
      'ad-wrapper': ['.ad-wrapper > .inner'],
      promo: ['div.promo[data-x]'],
    });
    expect(db.generic.byId).toEqual({ banner: ['#banner'] });
    expect(db.generic.complex).toEqual([]);
  });

  it('puts everything else in complex', () => {
    const { db } = compile(`
##[data-ad]
##div
##.a + .b
##.a, .b
    `);
    expect(db.generic.complex).toEqual(['[data-ad]', 'div', '.a + .b', '.a, .b']);
  });

  it('dedupes identical generic selectors', () => {
    const { db } = compile('##.ad\n##.ad\n##[data-ad]\n##[data-ad]');
    expect(db.generic.byClass['ad']).toEqual(['.ad']);
    expect(db.generic.complex).toEqual(['[data-ad]']);
  });

  it('caps generic.complex with a warning', () => {
    const many = Array.from({ length: 12 }, (_, i) => `##[data-ad="${i}"]`).join('\n');
    const { db, warnings } = compile(many, { maxGenericComplex: 10 });
    expect(db.generic.complex).toHaveLength(10);
    expect(db.generic.complex[0]).toBe('[data-ad="0"]');
    expect(warnings.join(' ')).toContain('keeping the first 10');
  });

  it('uses 2000 as the default complex cap', () => {
    expect(MAX_GENERIC_COMPLEX).toBe(2000);
  });

  it('stores generic procedural and style filters under "*"', () => {
    const { db } = compile('#?#.a:has-text(Ad)\n##.b:style(color: red)');
    expect(db.procedural['*']).toEqual([
      {
        raw: '.a:has-text(Ad)',
        tasks: [
          ['css', '.a'],
          ['has-text', 'Ad'],
        ],
      },
    ]);
    expect(db.styles['*']).toEqual([['.b', 'color: red']]);
    expect(db.specific).toEqual({});
  });
});

describe('compileCosmetic — specific', () => {
  it('keys selectors by exact hostname', () => {
    const { db } = compile('example.com,test.org##.ad');
    expect(db.specific).toEqual({ 'example.com': ['.ad'], 'test.org': ['.ad'] });
    expect(db.generic.byClass).toEqual({});
  });

  it('records styles, procedural filters and :remove() separately', () => {
    const { db } = compile(`
example.com##.ad:style(opacity: 0.1)
example.com#?#.b:has-text(Ad)
example.com##.c:remove()
    `);
    expect(db.styles['example.com']).toEqual([['.ad', 'opacity: 0.1']]);
    expect(db.procedural['example.com']).toEqual([
      {
        raw: '.b:has-text(Ad)',
        tasks: [
          ['css', '.b'],
          ['has-text', 'Ad'],
        ],
      },
      { raw: '.c:remove()', tasks: [['css', '.c'], ['remove']] },
    ]);
    expect(db.specific['example.com']).toBeUndefined();
  });

  it('keys entities by the entity key instead of expanding them', () => {
    const { db } = compile('example.*##.ad');
    expect(db.specific).toEqual({ 'example.*': ['.ad'] });
  });

  it('keys entity :style() and procedural filters the same way', () => {
    const { db } = compile('example.*##.ad:style(opacity:0)\nexample.*#?#.x:has-text(Ad)');
    expect(db.styles['example.*']).toEqual([['.ad', 'opacity:0']]);
    expect(db.procedural['example.*']).toHaveLength(1);
  });

  it('keeps entity and concrete keys apart', () => {
    const { db } = compile('example.*##.a\nexample.com##.b');
    expect(Object.keys(db.specific).sort()).toEqual(['example.*', 'example.com']);
  });

  it('dedupes repeated specific selectors', () => {
    const { db } = compile('example.com##.ad\nexample.com##.ad');
    expect(db.specific['example.com']).toEqual(['.ad']);
  });
});

describe('compileCosmetic — negations and exceptions', () => {
  it('compiles negations into exceptions.selectors', () => {
    const { db } = compile('example.com,~sub.example.com##.ad');
    expect(db.specific).toEqual({ 'example.com': ['.ad'] });
    expect(db.exceptions.selectors).toEqual({ 'sub.example.com': ['.ad'] });
  });

  it('records negated entities under the entity key', () => {
    const { db } = compile('example.com,~other.*##.ad');
    expect(db.exceptions.selectors).toEqual({ 'other.*': ['.ad'] });
  });

  it('an entity exception cancels the entity filter', () => {
    const { db } = compile('example.*##.ad\nexample.*#@#.ad');
    expect(db.specific['example.*']).toBeUndefined();
    expect(db.exceptions.selectors['example.*']).toEqual(['.ad']);
  });

  it('a specific exception removes the specific selector', () => {
    const { db } = compile('example.com##.ad\nexample.com#@#.ad');
    expect(db.specific['example.com']).toBeUndefined();
    expect(db.exceptions.selectors['example.com']).toEqual(['.ad']);
  });

  it('applies exceptions regardless of line order', () => {
    const { db } = compile('example.com#@#.ad\nexample.com##.ad');
    expect(db.specific['example.com']).toBeUndefined();
  });

  it('a qualified exception does not touch other hostnames', () => {
    const { db } = compile('example.com##.ad\nother.com##.ad\nother.com#@#.ad');
    expect(db.specific).toEqual({ 'example.com': ['.ad'] });
    expect(db.exceptions.selectors).toEqual({ 'other.com': ['.ad'] });
  });

  it('an unqualified exception drops the generic selector globally', () => {
    const { db, warnings } = compile('##.ad\n##.keep\n#@#.ad');
    expect(db.generic.byClass).toEqual({ keep: ['.keep'] });
    expect(db.exceptions.selectors).toEqual({});
    expect(warnings.join(' ')).toContain('unqualified');
  });

  it('a qualified exception of a generic selector is a per-hostname exclusion', () => {
    const { db } = compile('##.ad\nexample.com#@#.ad');
    expect(db.generic.byClass).toEqual({ ad: ['.ad'] });
    expect(db.exceptions.selectors).toEqual({ 'example.com': ['.ad'] });
  });

  it('cancels styles and procedural filters on the same hostname', () => {
    const { db } = compile(`
example.com##.ad:style(color: red)
example.com#@#.ad
example.com#?#.b:has-text(x)
example.com#@?#.b:has-text(x)
    `);
    expect(db.styles['example.com']).toBeUndefined();
    expect(db.procedural['example.com']).toBeUndefined();
    expect(db.exceptions.selectors['example.com']).toEqual(['.ad', '.b:has-text(x)']);
  });

  it('normalises legacy spellings on both sides of an exception', () => {
    const { db } = compile('example.com##.a:if(.b)\nexample.com#@#.a:-abp-has(.b)');
    expect(db.specific['example.com']).toBeUndefined();
  });
});

describe('compileCosmetic — diagnostics', () => {
  it('reports dropped filters with line numbers and reasons', () => {
    const { db, dropped } = compile('example.com##.ad\nexample.com##.a:nope(1)\nbad host##.x');
    expect(db.specific['example.com']).toEqual(['.ad']);
    expect(dropped).toEqual([
      {
        listId: 'test',
        line: 2,
        raw: 'example.com##.a:nope(1)',
        reason: 'unknown pseudo-class ":nope"',
      },
      { listId: 'test', line: 3, raw: 'bad host##.x', reason: 'invalid hostname "bad host"' },
    ]);
  });

  it('skips scriptlet, comment and network lines', () => {
    const { db, dropped } = compile('! c\n||ads.example.com^\nexample.com##+js(aopr, x)');
    expect(dropped).toEqual([]);
    expect(db).toEqual(emptyCosmeticDB('test'));
  });

  it('produces a valid empty DB for an empty list', () => {
    expect(compile('').db).toEqual(emptyCosmeticDB('test'));
  });
});

describe('addCosmeticNetworkExceptions', () => {
  it('folds and lower-cases hostnames', () => {
    const db = emptyCosmeticDB('test');
    addCosmeticNetworkExceptions(db, {
      elemhide: ['Example.com'],
      generichide: ['a.com'],
      specifichide: ['b.com'],
    });
    addCosmeticNetworkExceptions(db, {
      elemhide: ['example.com', 'other.com'],
      generichide: [],
      specifichide: [],
    });
    expect(db.exceptions.elemhide).toEqual(['example.com', 'other.com']);
    expect(db.exceptions.generichide).toEqual(['a.com']);
    expect(db.exceptions.specifichide).toEqual(['b.com']);
  });
});

describe('mergeCosmeticDB', () => {
  const source = (): CosmeticDB =>
    compile(`
##.ad
###banner
##[data-ad]
example.com##.x
example.com##.y:style(color: red)
example.com#?#.z:has-text(q)
example.com,~sub.example.com##.neg
    `).db;

  it('is idempotent', () => {
    const a = source();
    const b = source();
    const merged = mergeCosmeticDB(a, b);
    expect(merged).toEqual(source());
  });

  it('is idempotent when merged repeatedly', () => {
    const a = source();
    mergeCosmeticDB(a, source());
    mergeCosmeticDB(a, source());
    expect(a).toEqual(source());
  });

  it('unions disjoint databases', () => {
    const a = compile('example.com##.a\n##.g1').db;
    const b = compile('other.com##.b\n##.g2\nother.com#?#.p:has-text(x)').db;
    const merged = mergeCosmeticDB(a, b);
    expect(merged.specific).toEqual({ 'example.com': ['.a'], 'other.com': ['.b'] });
    expect(merged.generic.byClass).toEqual({ g1: ['.g1'], g2: ['.g2'] });
    expect(merged.procedural['other.com']).toHaveLength(1);
  });

  it('keeps the target listId and merges network exceptions', () => {
    const a = emptyCosmeticDB('a');
    const b = emptyCosmeticDB('b');
    addCosmeticNetworkExceptions(b, { elemhide: ['x.com'], generichide: [], specifichide: [] });
    const merged = mergeCosmeticDB(a, b);
    expect(merged.listId).toBe('a');
    expect(merged.exceptions.elemhide).toEqual(['x.com']);
  });

  it('dedupes styles and procedural filters on a shared hostname', () => {
    const a = compile('example.com##.x:style(color: red)\nexample.com#?#.p:has-text(a)').db;
    const b = compile(
      'example.com##.x:style(color: red)\nexample.com##.y:style(color: blue)\nexample.com#?#.p:has-text(a)\nexample.com#?#.q:has-text(b)',
    ).db;
    mergeCosmeticDB(a, b);
    expect(a.styles['example.com']).toEqual([
      ['.x', 'color: red'],
      ['.y', 'color: blue'],
    ]);
    expect(a.procedural['example.com']?.map((f) => f.raw)).toEqual(['.p:has-text(a)', '.q:has-text(b)']);
  });

  it('does not alias arrays with the source', () => {
    const a = emptyCosmeticDB('a');
    const b = compile('example.com##.x\nexample.com##.y:style(color: red)\nexample.com#?#.z:remove()').db;
    mergeCosmeticDB(a, b);
    const aSpecific = a.specific['example.com'];
    const bSpecific = b.specific['example.com'];
    expect(aSpecific).not.toBe(bSpecific);
    expect(a.styles['example.com']).not.toBe(b.styles['example.com']);
    expect(a.procedural['example.com']).not.toBe(b.procedural['example.com']);
  });
});
