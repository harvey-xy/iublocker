import { describe, expect, it } from 'vitest';
import def from '../src/no-setTimeout-if';
import { inject, makeWindow, tick } from './_inject';

describe('no-setTimeout-if', () => {
  it('defuses matching callbacks but not others', async () => {
    const win = makeWindow();
    inject(win, def, 'showAd');
    win.eval(`
      window.hits = [];
      setTimeout(function () { window.hits.push('showAd'); }, 1);
      setTimeout(function () { window.hits.push('content'); }, 1);
    `);
    await tick(win, 20);
    expect(win.hits).toEqual(['content']);
  });

  it('supports /regex/ needles', async () => {
    const win = makeWindow();
    inject(win, def, '/ad[A-Z]/');
    win.eval(`
      window.hits = [];
      setTimeout(function () { window.hits.push('a'); adSlot(); }, 1);
      setTimeout(function () { window.hits.push('b'); }, 1);
    `);
    await tick(win, 20);
    expect(win.hits).toEqual(['b']);
  });

  it('supports `!` negation', async () => {
    const win = makeWindow();
    inject(win, def, '!keepMe');
    win.eval(`
      window.hits = [];
      setTimeout(function () { window.hits.push('keepMe'); }, 1);
      setTimeout(function () { window.hits.push('other'); }, 1);
    `);
    await tick(win, 20);
    expect(win.hits).toEqual(['keepMe']);
  });

  it('matches on the delay when given', async () => {
    const win = makeWindow();
    inject(win, def, 'tick', '50');
    win.eval(`
      window.hits = [];
      setTimeout(function () { window.hits.push('at50'); /* tick */ }, 50);
      setTimeout(function () { window.hits.push('at1'); /* tick */ }, 1);
    `);
    await tick(win, 80);
    expect(win.hits).toEqual(['at1']);
  });

  it('preserves setTimeout.toString()', () => {
    const win = makeWindow();
    const before = win.eval('window.setTimeout.toString()');
    inject(win, def, 'showAd');
    expect(win.eval('window.setTimeout.toString()')).toBe(before);
    expect(win.eval('window.setTimeout.toString()')).not.toContain('defused');
  });
});
