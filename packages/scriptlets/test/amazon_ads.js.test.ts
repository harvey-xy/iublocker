import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/amazon-ads';
import { inject, makeWindow } from './_inject';

describe('amazon_ads.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('amazon_ads.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs amznads and apstag', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.bids = null;
      amznads.getAds('x');
      apstag.init({});
      apstag.fetchBids({}, function (b) { window.bids = b; });
      [window.bids, amznads.hasAds(), typeof amzn_ads, typeof aax_write, amznads.getKeys().length];
    `);
    expect(out).toEqual([[], false, 'function', 'function', 0]);
  });
});
