import { describe, it, expect, beforeEach } from 'vitest';
import {
  attributeSelector,
  buildLadder,
  broadenIndex,
  countMatches,
  defaultLadderIndex,
  elementVariants,
  filterFor,
  generateSelector,
  isGeneratedToken,
  isUsableId,
  narrowIndex,
  nthOfTypeIndex,
  pathSelector,
  stableClasses,
} from '../src/content/selector';

function html(markup: string): void {
  document.body.innerHTML = markup;
}

function pick(selector: string): Element {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`no element for ${selector}`);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('generated-token heuristics', () => {
  it.each([
    ['css-1x2y3z', true],
    ['sc-bdVaJa', true],
    ['jss42', true],
    ['a1b2c3d4e5', true],
    ['deadbeef', true],
    ['Button_a1b2c', true],
    ['0start', true],
    ['x'.repeat(25), true],
    ['ad-banner', false],
    ['promo', false],
    ['col-md-6', false],
    ['ad-slot-300x250', false],
    ['sidebar_right', false],
  ])('isGeneratedToken(%s) === %s', (token, expected) => {
    expect(isGeneratedToken(token)).toBe(expected);
  });

  it('rejects numeric-looking and generated ids', () => {
    expect(isUsableId('sponsored')).toBe(true);
    expect(isUsableId('post-1234')).toBe(false);
    expect(isUsableId('css-1x2y3z')).toBe(false);
    expect(isUsableId('')).toBe(false);
    expect(isUsableId(null)).toBe(false);
  });

  it('keeps only stable classes, capped at three', () => {
    html('<div class="ad-banner css-1x2y3z promo sc-bdVaJa top extra"></div>');
    expect(stableClasses(pick('div'))).toEqual(['ad-banner', 'promo', 'top']);
  });
});

describe('generateSelector', () => {
  it('prefers a unique, stable id', () => {
    html('<div id="sponsored" class="ad-banner"></div>');
    expect(generateSelector(pick('#sponsored'))).toBe('#sponsored');
  });

  it('ignores a duplicated id', () => {
    html('<div id="dup" class="ad-banner"></div><div id="dup"></div>');
    expect(generateSelector(pick('.ad-banner'))).toBe('div.ad-banner');
  });

  it('ignores a generated id and falls back to classes', () => {
    html('<div id="css-1x2y3z" class="ad-banner promo"></div>');
    expect(generateSelector(pick('div'))).toBe('div.ad-banner.promo');
  });

  it('drops generated classes', () => {
    html('<div class="ad-banner css-1x2y3z sc-bdVaJa"></div>');
    expect(generateSelector(pick('div'))).toBe('div.ad-banner');
  });

  it('uses an attribute when there is no usable class', () => {
    html('<div data-ad-slot="top"></div>');
    expect(attributeSelector(pick('div'))).toBe('div[data-ad-slot="top"]');
    expect(generateSelector(pick('div'))).toBe('div[data-ad-slot="top"]');
  });

  it('uses presence-only when the attribute value looks generated', () => {
    html('<div data-id="a1b2c3d4"></div>');
    expect(attributeSelector(pick('div'))).toBe('div[data-id]');
  });

  it('falls back to a positional path capped at depth 6', () => {
    html('<main><section><article><div><p>one</p><p>two</p></div></article></section></main>');
    const target = document.querySelectorAll('p')[1] as Element;
    const selector = generateSelector(target);
    expect(selector).toContain('p:nth-of-type(2)');
    expect(selector.split('>').length).toBeLessThanOrEqual(6);
    expect(countMatches(document, selector)).toBe(1);
    expect(target.matches(selector)).toBe(true);
  });

  it('anchors the path on an ancestor id when there is one', () => {
    html('<div id="main-content"><span></span><span></span></div>');
    const target = document.querySelectorAll('span')[1] as Element;
    expect(pathSelector(target)).toBe('#main-content > span:nth-of-type(2)');
  });

  it('omits :nth-of-type when the element is the only one of its type', () => {
    html('<div><p>only</p><span></span></div>');
    expect(nthOfTypeIndex(pick('p'))).toBe(0);
    expect(pathSelector(pick('p'))).toBe('body > div > p');
  });

  it('always produces a selector that matches the target', () => {
    html('<ul><li class="css-1x2y3z"></li><li class="css-1x2y3z"></li></ul>');
    const target = document.querySelectorAll('li')[1] as Element;
    const selector = generateSelector(target);
    expect(target.matches(selector)).toBe(true);
  });
});

describe('ladder (broaden / narrow)', () => {
  beforeEach(() => {
    html(`
      <section id="wrapper">
        <div class="card promo"><span class="label">Ad</span></div>
        <div class="card"><span class="label">Ad</span></div>
      </section>`);
  });

  it('lists variants of the target narrowest first, then its ancestors', () => {
    const target = pick('.label');
    const variants = elementVariants(target);
    expect(variants[0]).toContain('nth-of-type');
    expect(variants).toContain('span.label');
    expect(variants[variants.length - 1]).toBe('span');
    const ladder = buildLadder(target);
    expect(ladder[0]?.depth).toBe(0);
    expect(ladder.some((entry) => entry.depth === 1 && entry.selector.includes('card'))).toBe(true);
    expect(ladder.some((entry) => entry.selector === '#wrapper')).toBe(true);
  });

  it('starts on the generated selector and broadens monotonically', () => {
    const target = pick('.label');
    const ladder = buildLadder(target);
    const start = defaultLadderIndex(ladder, target);
    expect(ladder[start]?.selector).toBe(generateSelector(target));
    const broader = broadenIndex(start, ladder);
    expect(broader).toBe(start + 1);
    expect(narrowIndex(broader)).toBe(start);
  });

  it('clamps at both ends', () => {
    const ladder = buildLadder(pick('.label'));
    expect(narrowIndex(0)).toBe(0);
    expect(broadenIndex(ladder.length - 1, ladder)).toBe(ladder.length - 1);
  });

  it('broadening eventually matches more elements', () => {
    const target = pick('.label');
    const ladder = buildLadder(target);
    const narrow = countMatches(document, ladder[0]?.selector ?? '');
    const broadest = ladder[ladder.length - 1]?.selector ?? '';
    expect(narrow).toBe(1);
    expect(countMatches(document, broadest)).toBeGreaterThanOrEqual(1);
    const label = ladder.find((entry) => entry.selector === 'span.label');
    expect(label && countMatches(document, label.selector)).toBe(2);
  });

  it('formats the filter line', () => {
    expect(filterFor('example.com', '#ad')).toBe(`example.com##${'#ad'}`);
  });
});
