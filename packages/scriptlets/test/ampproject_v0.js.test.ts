import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/ampproject-v0';
import { inject, makeWindow } from './_inject';

describe('ampproject_v0.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('ampproject_v0.js');
    expect(def.trusted).toBe(false);
  });

  it('reveals a page hidden by the AMP boilerplate', () => {
    const win = makeWindow(
      '<!doctype html><html amp-boilerplate><head><style amp-boilerplate>body{visibility:hidden}</style></head><body></body></html>',
    );
    inject(win, def);
    expect(win.document.documentElement.hasAttribute('amp-boilerplate')).toBe(false);
    expect(win.document.querySelector('style[amp-boilerplate]')).toBeNull();
    expect(win.document.documentElement.style.visibility).toBe('visible');
  });

  it('runs AMP.push callbacks', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('window.ok = false; AMP.push(function () { window.ok = true; }); window.ok;')).toBe(true);
  });
});
