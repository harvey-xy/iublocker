import { describe, expect, it } from 'vitest';
import def from '../src/prevent-window-open';
import { inject, makeWindow } from './_inject';

describe('prevent-window-open', () => {
  it('returns a decoy instead of opening a matching URL', () => {
    const win = makeWindow();
    inject(win, def, 'popunder');
    const result = win.eval('window.open("https://ads.example/popunder?x=1")');
    expect(result).toBeTypeOf('object');
    expect(result.closed).toBe(false);
    expect(() => result.close()).not.toThrow();
    expect(result.document.write).toBeTypeOf('function');
    expect(result.self).toBe(result);
  });

  it('lets non-matching URLs through', () => {
    const win = makeWindow();
    win.eval('window.opened = []; window.open = function (u) { window.opened.push(u); return "real"; };');
    inject(win, def, 'popunder');
    expect(win.eval('window.open("https://example.com/good")')).toBe('real');
    expect(win.opened).toEqual(['https://example.com/good']);
  });

  it('supports `!` negation', () => {
    const win = makeWindow();
    win.eval('window.open = function () { return "real"; };');
    inject(win, def, '!example.com');
    expect(win.eval('window.open("https://example.com/good")')).toBe('real');
    expect(win.eval('window.open("https://ads.example/bad")')).toBeTypeOf('object');
  });

  it('blocks everything when no pattern is given', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('window.open("https://anything/")')).toBeTypeOf('object');
  });
});
