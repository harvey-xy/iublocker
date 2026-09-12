import { describe, expect, it } from 'vitest';
import { parseSelector } from '../src/cosmetic/procedural';

const cases = [
  '.sliderItem.active:has(span.news-item:has(img[alt="Anzeige"]))',
  '.elementor-hidden-desktop:has(> div.e-con-inner:only-child:not(:has(*)))',
  'div:has(> div:has(> .adsbygoogle))',
  'a:not(b:has(c:has(d)))',
  'a:not(:has(b))',
  'a:has(b:is(c:has(d)))',
  '.a:has(.b)',
  '.a:has(.b) .c:has(.d)',
];
describe('nested has', () => {
  it('parses', () => {
    for (const c of cases) console.log(c, '=>', JSON.stringify(parseSelector(c)));
  });
});
