import { describe, expect, it } from 'vitest';
import def from '../src/no-setInterval-if';
import { inject, makeWindow, tick } from './_inject';

describe('no-setInterval-if', () => {
  it('defuses matching callbacks but not others', async () => {
    const win = makeWindow();
    inject(win, def, 'pollAds');
    win.eval(`
      window.hits = [];
      window.a = setInterval(function () { window.hits.push('pollAds'); }, 2);
      window.b = setInterval(function () { window.hits.push('content'); }, 2);
    `);
    await tick(win, 25);
    win.eval('clearInterval(window.a); clearInterval(window.b);');
    expect(win.hits.includes('pollAds')).toBe(false);
    expect(win.hits.includes('content')).toBe(true);
  });

  it('supports `!` negation and a delay filter', async () => {
    const win = makeWindow();
    inject(win, def, '!keep', '2');
    win.eval(`
      window.hits = [];
      window.a = setInterval(function () { window.hits.push('keep'); }, 2);
      window.b = setInterval(function () { window.hits.push('drop'); }, 2);
    `);
    await tick(win, 25);
    win.eval('clearInterval(window.a); clearInterval(window.b);');
    expect(win.hits.includes('keep')).toBe(true);
    expect(win.hits.includes('drop')).toBe(false);
  });

  it('preserves setInterval.toString()', () => {
    const win = makeWindow();
    const before = win.eval('window.setInterval.toString()');
    inject(win, def, 'x');
    expect(win.eval('window.setInterval.toString()')).toBe(before);
  });
});
