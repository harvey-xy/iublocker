import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/popads';
import { inject, makeWindow } from './_inject';

describe('popads.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('popads.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs the PopAds globals', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof PopAds')).toBe('object');
    expect(win.eval('popns.adblock')).toBe(false);
    expect(win.eval('popns.pop()')).toBeUndefined();
    expect(win.eval('typeof popMagic.init')).toBe('function');
  });
});
