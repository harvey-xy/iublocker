import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/googlesyndication-adsbygoogle';
import { inject, makeWindow } from './_inject';

describe('googlesyndication_adsbygoogle.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('googlesyndication_adsbygoogle.js');
    expect(def.trusted).toBe(false);
  });

  it('marks ad slots as unfilled and accepts pushes', () => {
    const win = makeWindow('<!doctype html><html><body><ins class="adsbygoogle"></ins></body></html>');
    inject(win, def);
    win.eval('adsbygoogle.push({});');
    const ins = win.document.querySelector('ins');
    expect(ins.getAttribute('data-adsbygoogle-status')).toBe('done');
    expect(ins.getAttribute('data-ad-status')).toBe('unfilled');
    expect(win.eval('adsbygoogle.loaded')).toBe(true);
  });

  it('drains a pre-existing array', () => {
    const win = makeWindow('<!doctype html><html><body><ins class="adsbygoogle"></ins></body></html>');
    win.eval('window.adsbygoogle = [{ onload: function () { window.early = true; } }];');
    inject(win, def);
    expect(win.early).toBe(true);
  });
});
