import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/nobab2';
import { inject, makeWindow, tick } from './_inject';

/**
 * The surrogate also guards `eval`, so the test harness must never pass a BlockAdBlock
 * signature through `win.eval` itself: the payloads below are built before injection.
 */
describe('nobab2.js', () => {
  it('defuses a BlockAdBlock timer callback', async () => {
    const win = makeWindow();
    win.eval('window.ran = false; window.bab = function blockadblockCheck() { window.ran = true; };');
    inject(win, def);
    win.eval('window.tid = window.setTimeout(window.bab, 1);');
    await tick(win, 20);
    expect(win.ran).toBe(false);
    expect(win.tid).toBe(0);
  });

  it('leaves ordinary timers alone', async () => {
    const win = makeWindow();
    win.eval('window.ok = false; window.plain = function () { window.ok = true; };');
    inject(win, def);
    win.eval('window.setTimeout(window.plain, 1);');
    await tick(win, 20);
    expect(win.ok).toBe(true);
  });

  it('defuses a matching interval', () => {
    const win = makeWindow();
    win.eval('window.bab = function detectAdBlock() {};');
    inject(win, def);
    expect(win.eval('window.setInterval(window.bab, 1)')).toBe(0);
  });

  it('refuses matching eval payloads', () => {
    const win = makeWindow();
    win.eval('window.payload = "window.__x = 1; /* fuck" + "adblock */";');
    inject(win, def);
    win.eval('window.out = window.eval(window.payload);');
    expect(win.out).toBeUndefined();
    expect(win.__x).toBeUndefined();
  });

  it('lets ordinary eval through', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('window.eval("1 + 1")')).toBe(2);
  });
});
