import { describe, expect, it } from 'vitest';
import def from '../src/prevent-requestAnimationFrame';
import { inject, makeWindow, tick } from './_inject';

describe('prevent-requestAnimationFrame', () => {
  it('defuses matching callbacks but keeps the others', async () => {
    const win = makeWindow();
    inject(win, def, 'checkAdblock');
    win.eval(`
      window.hits = [];
      requestAnimationFrame(function () { window.hits.push('checkAdblock'); });
      requestAnimationFrame(function () { window.hits.push('paint'); });
    `);
    await tick(win, 60);
    expect(win.hits).toEqual(['paint']);
  });

  it('supports `!` negation', async () => {
    const win = makeWindow();
    inject(win, def, '!keep');
    win.eval(`
      window.hits = [];
      requestAnimationFrame(function () { window.hits.push('keep'); });
      requestAnimationFrame(function () { window.hits.push('drop'); });
    `);
    await tick(win, 60);
    expect(win.hits).toEqual(['keep']);
  });

  it('preserves requestAnimationFrame.toString()', () => {
    const win = makeWindow();
    const before = win.eval('window.requestAnimationFrame.toString()');
    inject(win, def, 'x');
    expect(win.eval('window.requestAnimationFrame.toString()')).toBe(before);
  });
});
