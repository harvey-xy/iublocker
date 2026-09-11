import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/google-analytics-cx-api';
import { inject, makeWindow } from './_inject';

describe('google-analytics_cx_api.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('google-analytics_cx_api.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs cxApi', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('cxApi.getChosenVariation()')).toBe(0);
    expect(win.eval('cxApi.chooseVariation()')).toBe(0);
    expect(win.eval('typeof cxApi.setChosenVariation')).toBe('function');
  });
});
