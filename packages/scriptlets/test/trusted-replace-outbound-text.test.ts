import { describe, expect, it } from 'vitest';
import def from '../src/trusted-replace-outbound-text';
import { inject, makeWindow } from './_inject';

describe('trusted-replace-outbound-text', () => {
  it('rewrites the return value', () => {
    const win = makeWindow();
    win.eval('window.target = { call: function () { return "skmedix.com/x"; } };');
    inject(win, def, 'target.call', 'skmedix.com', 'skmedix.pl');
    expect(win.eval('window.target.call()')).toBe('skmedix.pl/x');
  });

  it('honours a `condition`', () => {
    const win = makeWindow();
    win.eval('window.target = { call: function (v) { return v; } };');
    inject(win, def, 'target.call', '/.+/', '', 'condition', 'cloudfront');
    expect(win.eval('window.target.call("https://cloudfront.net/a.js")')).toBe('');
    expect(win.eval('window.target.call("https://other.net/a.js")')).toBe('https://other.net/a.js');
  });

  it('leaves non-string return values alone', () => {
    const win = makeWindow();
    win.eval('window.target = { call: function () { return 42; } };');
    inject(win, def, 'target.call', '/4/', 'x');
    expect(win.eval('window.target.call()')).toBe(42);
  });

  it('rewrites a resolved promise', async () => {
    const win = makeWindow();
    win.eval('window.target = { call: function () { return Promise.resolve("ad-here"); } };');
    inject(win, def, 'target.call', 'ad', 'no');
    await expect(win.eval('window.target.call()')).resolves.toBe('no-here');
  });

  it('does nothing for an unknown chain', () => {
    const win = makeWindow();
    expect(() => inject(win, def, 'no.such.fn', '/a/', 'b')).not.toThrow();
  });
});
