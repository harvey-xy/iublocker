import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/chartbeat';
import { inject, makeWindow } from './_inject';

describe('chartbeat.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('chartbeat.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs pSUPERFLY', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof pSUPERFLY.virtualPage')).toBe('function');
    expect(win.eval('pSUPERFLY.activity()')).toBeUndefined();
    expect(win.eval('typeof _sf_async_config')).toBe('object');
  });
});
