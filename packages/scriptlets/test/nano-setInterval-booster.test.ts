import { describe, expect, it } from 'vitest';
import def from '../src/nano-setInterval-booster';
import { inject, makeWindow, tick } from './_inject';

describe('nano-setInterval-booster', () => {
  it('shrinks the delay of matching timers', async () => {
    const win = makeWindow();
    inject(win, def, 'slowAd', '', '0.001');
    win.eval(`
      window.done = false;
      window.t = setInterval(function () { window.done = true; /* slowAd */ }, 10000);
    `);
    await tick(win, 30);
    win.eval('clearInterval(window.t)');
    expect(win.done).toBe(true);
  });

  it('leaves non-matching timers alone', async () => {
    const win = makeWindow();
    inject(win, def, 'slowAd', '', '0.001');
    win.eval(`
      window.done = false;
      window.t = setInterval(function () { window.done = true; }, 10000);
    `);
    await tick(win, 30);
    win.eval('clearInterval(window.t)');
    expect(win.done).toBe(false);
  });

  it('only boosts the requested delay', async () => {
    const win = makeWindow();
    inject(win, def, '', '10000', '0.0001');
    win.eval(`
      window.hits = [];
      window.t1 = setInterval(function () { window.hits.push('matched'); }, 10000);
      window.t2 = setInterval(function () { window.hits.push('other'); }, 9000);
    `);
    await tick(win, 30);
    win.eval('clearInterval(window.t1); clearInterval(window.t2);');
    expect(win.hits.includes('matched')).toBe(true);
    expect(win.hits.includes('other')).toBe(false);
  });
});
