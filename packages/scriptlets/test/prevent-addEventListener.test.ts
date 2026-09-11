import { describe, expect, it } from 'vitest';
import def from '../src/prevent-addEventListener';
import { inject, makeWindow } from './_inject';

describe('prevent-addEventListener', () => {
  it('drops listeners matching both type and handler source', () => {
    const win = makeWindow();
    inject(win, def, 'click', 'showAd');
    win.eval(`
      window.hits = [];
      document.addEventListener('click', function () { window.hits.push('showAd'); });
      document.addEventListener('click', function () { window.hits.push('content'); });
      document.dispatchEvent(new Event('click'));
    `);
    expect(win.hits).toEqual(['content']);
  });

  it('matches every type when the type argument is empty', () => {
    const win = makeWindow();
    inject(win, def, '', 'tracker');
    win.eval(`
      window.hits = [];
      window.addEventListener('load', function () { window.hits.push('tracker'); });
      window.addEventListener('load', function () { window.hits.push('other'); });
      window.dispatchEvent(new Event('load'));
    `);
    expect(win.hits).toEqual(['other']);
  });

  it('supports /regex/ arguments and `!` negation', () => {
    const win = makeWindow();
    inject(win, def, '/^(click|touchstart)$/', '!keep');
    win.eval(`
      window.hits = [];
      document.addEventListener('click', function () { window.hits.push('keep'); });
      document.addEventListener('click', function () { window.hits.push('drop'); });
      document.dispatchEvent(new Event('click'));
    `);
    expect(win.hits).toEqual(['keep']);
  });

  it('preserves addEventListener.toString()', () => {
    const win = makeWindow();
    const before = win.eval('EventTarget.prototype.addEventListener.toString()');
    inject(win, def, 'click', 'x');
    expect(win.eval('EventTarget.prototype.addEventListener.toString()')).toBe(before);
  });
});
