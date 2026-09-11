import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/googletagmanager-gtm';
import { inject, makeWindow } from './_inject';

describe('googletagmanager_gtm.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('googletagmanager_gtm.js');
    expect(def.trusted).toBe(false);
  });

  it('keeps dataLayer working and runs event callbacks', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.called = false;
      dataLayer.push({ event: 'x', eventCallback: function () { window.called = true; } });
      [window.called, dataLayer.length, typeof google_tag_manager, typeof gtag];
    `);
    expect(out).toEqual([true, 1, 'object', 'function']);
  });

  it('unhides a page hidden by the GTM anti-flicker snippet', () => {
    const win = makeWindow(
      '<!doctype html><html class="async-hide"><head><style id="gtm-hide">body{opacity:0}</style></head><body></body></html>',
    );
    inject(win, def);
    expect(win.document.documentElement.classList.contains('async-hide')).toBe(false);
    expect(win.document.getElementById('gtm-hide')).toBeNull();
  });
});
