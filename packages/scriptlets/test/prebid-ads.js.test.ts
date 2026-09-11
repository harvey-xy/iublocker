import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/prebid-ads';
import { inject, makeWindow } from './_inject';

describe('prebid-ads.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('prebid-ads.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs pbjs and answers bid requests immediately', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.back = false;
      pbjs.que.push(function () { window.queued = true; });
      pbjs.requestBids({ bidsBackHandler: function () { window.back = true; } });
      pbjs.setConfig({});
      [window.queued, window.back, pbjs.libLoaded, pbjs.getAllWinningBids().length];
    `);
    expect(out).toEqual([true, true, true, 0]);
  });

  it('drains a queue created before the surrogate ran', () => {
    const win = makeWindow();
    win.eval('window.pbjs = { que: [function () { window.early = true; }] };');
    inject(win, def);
    expect(win.early).toBe(true);
  });
});
