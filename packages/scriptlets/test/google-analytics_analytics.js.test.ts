import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/google-analytics-analytics';
import { inject, makeWindow } from './_inject';

describe('google-analytics_analytics.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('google-analytics_analytics.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs ga() and calls hit callbacks', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.hit = false;
      ga('create', 'UA-1', 'auto');
      ga('send', 'pageview', { hitCallback: function () { window.hit = true; } });
      var ready = false;
      ga(function () { ready = true; });
      [window.hit, ready, ga.loaded, typeof ga.create().send, ga.getAll().length];
    `);
    expect(out).toEqual([true, true, true, 'function', 1]);
  });

  it('replays calls queued on the pre-existing stub', () => {
    const win = makeWindow();
    win.eval("window.ga = function () { window.ga.q.push(arguments); }; window.ga.q = []; ga('send', { hitCallback: function () { window.early = true; } });");
    inject(win, def);
    expect(win.early).toBe(true);
  });
});
