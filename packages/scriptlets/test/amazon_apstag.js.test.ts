import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/amazon-apstag';
import { inject, makeWindow } from './_inject';

describe('amazon_apstag.js', () => {
  it('calls back with no bids', () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.bids = null; apstag.fetchBids({}, function (b) { window.bids = b; });');
    expect(win.bids).toEqual([]);
  });

  it('calls back from init', () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.inited = false; apstag.init({}, function () { window.inited = true; });');
    expect(win.inited).toBe(true);
  });

  it('exposes the remaining API as no-ops', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof apstag.setDisplayBids')).toBe('function');
    expect(win.eval('apstag.targetingKeys()')).toEqual([]);
  });
});
