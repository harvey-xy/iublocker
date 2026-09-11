import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/fingerprint2';
import { inject, makeWindow } from './_inject';

describe('fingerprint2.js', () => {
  it('answers get() with a fixed component list', () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.out = null; Fingerprint2.get(function (c) { window.out = c; });');
    expect(Array.isArray(win.out)).toBe(true);
    expect(win.out.length).toBeGreaterThan(0);
  });

  it('answers getPromise()', async () => {
    const win = makeWindow();
    inject(win, def);
    await expect(win.eval('Fingerprint2.getPromise()')).resolves.toBeInstanceOf(Array);
  });

  it('answers getV18() with a fixed hash', () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.hash = null; Fingerprint2.getV18(function (h) { window.hash = h; });');
    expect(win.hash).toBe('00000000000000000000000000000000');
  });

  it('is also reachable through the constructor form', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof new Fingerprint2().getPromise')).toBe('function');
  });
});
