import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/nobab2';
import { inject, makeWindow, tick } from './_inject';

describe('nobab2.js', () => {
  it('defuses a BlockAdBlock timer callback', async () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.ran = false; setTimeout(function blockadblockCheck() { window.ran = true; }, 1);');
    await tick(win, 20);
    expect(win.ran).toBe(false);
  });

  it('leaves ordinary timers alone', async () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.ok = false; setTimeout(function () { window.ok = true; }, 1);');
    await tick(win, 20);
    expect(win.ok).toBe(true);
  });

  it('defuses a matching interval', async () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('setInterval(function detectAdBlock() {}, 1)')).toBe(0);
  });

  it('refuses matching eval payloads', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('window.eval("window.__x = 1; /* fuckadblock */")')).toBeUndefined();
  });
});
