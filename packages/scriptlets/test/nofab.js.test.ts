import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/nofab';
import { inject, makeWindow } from './_inject';

describe('nofab.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('nofab.js');
    expect(def.trusted).toBe(false);
  });

  it('reports that no ad blocker is present', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.detected = null;
      var fab = new FuckAdBlock();
      fab.onNotDetected(function () { window.detected = false; });
      [window.detected, typeof fuckAdBlock, typeof blockAdBlock];
    `);
    expect(out).toEqual([false, 'object', 'object']);
  });
});
