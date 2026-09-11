import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/hd-main';
import { inject, makeWindow } from './_inject';

describe('hd-main.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('hd-main.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs the loader and refuses blank popups', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof hd_main')).toBe('function');
    expect(win.eval('window.open("about:blank")')).toBeNull();
    expect(win.eval('__hdMainLoaded')).toBe(true);
  });
});
