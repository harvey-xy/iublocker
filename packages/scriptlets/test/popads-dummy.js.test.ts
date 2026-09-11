import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/popads-dummy';
import { inject, makeWindow } from './_inject';

describe('popads-dummy.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('popads-dummy.js');
    expect(def.trusted).toBe(false);
  });

  it('defines empty PopAds globals', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('JSON.stringify(PopAds)')).toBe('{}');
    expect(win.eval('JSON.stringify(popns)')).toBe('{}');
  });
});
