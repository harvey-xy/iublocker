import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/fuckadblock';
import { inject, makeWindow } from './_inject';

describe('fuckadblock.js-3.2.0', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('fuckadblock.js-3.2.0');
    expect(def.trusted).toBe(false);
  });

  it('reports that no ad blocker is present', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.detected = null;
      var fab = new FuckAdBlock();
      fab.onNotDetected(function () { window.detected = false; });
      fab.check();
      [window.detected, typeof fuckAdBlock.onNotDetected, typeof BlockAdBlock];
    `);
    expect(out).toEqual([false, 'function', 'function']);
  });

  it('supports the on(false, cb) form', () => {
    const win = makeWindow();
    inject(win, def);
    expect(
      win.eval(`
        window.ok = false;
        var fab = new FuckAdBlock();
        fab.on(false, function () { window.ok = true; }).check();
        window.ok;
      `),
    ).toBe(true);
  });
});
