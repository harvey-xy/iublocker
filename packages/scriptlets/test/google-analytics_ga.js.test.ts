import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/google-analytics-ga';
import { inject, makeWindow } from './_inject';

describe('google-analytics_ga.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('google-analytics_ga.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs the classic _gaq / _gat API', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.ran = false;
      _gaq.push(['_setAccount', 'UA-1']);
      _gaq.push(function () { window.ran = true; });
      var tracker = _gat._getTracker('UA-1');
      tracker._trackPageview();
      [window.ran, typeof tracker._trackEvent, _gat._getTracker()._getVersion()];
    `);
    expect(out).toEqual([true, 'function', '5.7.0']);
  });

  it('drains a pre-existing _gaq array', () => {
    const win = makeWindow();
    win.eval('window._gaq = [function () { window.early = true; }];');
    inject(win, def);
    expect(win.early).toBe(true);
  });
});
