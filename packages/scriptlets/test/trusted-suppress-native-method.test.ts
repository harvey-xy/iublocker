import { describe, expect, it } from 'vitest';
import def from '../src/trusted-suppress-native-method';
import { inject, makeWindow } from './_inject';

describe('trusted-suppress-native-method', () => {
  it('prevents the call when the signature matches', () => {
    const win = makeWindow();
    win.eval('window.calls = []; window.target = { run: function (a) { window.calls.push(a); return a; } };');
    inject(win, def, 'target.run', '"script"', 'prevent');
    expect(win.eval('window.target.run("script")')).toBeUndefined();
    expect(win.eval('window.target.run("div")')).toBe('div');
    expect(win.calls).toEqual(['div']);
  });

  it('accepts a regex matcher', () => {
    const win = makeWindow();
    win.eval('window.target = { run: function (a) { return a; } };');
    inject(win, def, 'target.run', '"/^chp_?ad/"', 'prevent');
    expect(win.eval('window.target.run("chp_ad_x")')).toBeUndefined();
    expect(win.eval('window.target.run("safe")')).toBe('safe');
  });

  it('throws with `abort`', () => {
    const win = makeWindow();
    win.eval('window.target = { run: function (a) { return a; } };');
    inject(win, def, 'target.run', '"data-sdk"', 'abort');
    expect(() => win.eval('window.target.run("data-sdk")')).toThrow();
    expect(win.eval('window.target.run("other")')).toBe('other');
  });

  it('matches several arguments and lets `""` match anything', () => {
    const win = makeWindow();
    win.eval('window.target = { run: function (a, b) { return a + b; } };');
    inject(win, def, 'target.run', '"", "b"', 'prevent');
    expect(win.eval('window.target.run("x", "b")')).toBeUndefined();
    expect(win.eval('window.target.run("x", "c")')).toBe('xc');
  });

  it('does nothing without a signature', () => {
    const win = makeWindow();
    win.eval('window.target = { run: function (a) { return a; } };');
    inject(win, def, 'target.run', '');
    expect(win.eval('window.target.run("x")')).toBe('x');
  });
});
