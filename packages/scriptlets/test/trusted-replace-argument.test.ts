import { describe, expect, it } from 'vitest';
import def from '../src/trusted-replace-argument';
import { inject, makeWindow } from './_inject';

describe('trusted-replace-argument', () => {
  it('replaces the argument at the given index', () => {
    const win = makeWindow();
    win.eval('window.seen = []; window.target = { call: function (a, b) { window.seen.push([a, b]); } };');
    inject(win, def, 'target.call', '1', 'json:"replaced"');
    win.eval('window.target.call("x", "original")');
    expect(win.seen[0]).toEqual(['x', 'replaced']);
  });

  it('only replaces when the condition matches', () => {
    const win = makeWindow();
    win.eval('window.seen = []; window.target = { call: function (a) { window.seen.push(a); } };');
    inject(win, def, 'target.call', '0', 'json:"gecmisi"', 'condition', 'googleads');
    win.eval('window.target.call("googleads.js"); window.target.call("other.js")');
    expect(win.seen).toEqual(['gecmisi', 'other.js']);
  });

  it('supports the `repl:/from/to/` form', () => {
    const win = makeWindow();
    win.eval('window.seen = []; window.target = { call: function (a) { window.seen.push(a); } };');
    inject(win, def, 'target.call', '0', 'repl:/true/false/', 'condition', 'adBlockWall');
    win.eval('window.target.call(\'{"adBlockWallEnabled":true}\')');
    expect(win.seen[0]).toBe('{"adBlockWallEnabled":false}');
  });

  it('replaces `this` when argpos is `this`', () => {
    const win = makeWindow();
    win.eval('window.seen = []; window.target = { call: function () { window.seen.push(String(this)); } };');
    inject(win, def, 'target.call', 'this', 'json:"subscribed"', 'condition', '/^anon$/');
    win.eval('window.target.call.call("anon")');
    expect(win.seen[0]).toBe('subscribed');
  });

  it('replaces with undefined', () => {
    const win = makeWindow();
    win.eval('window.seen = []; window.target = { call: function (a) { window.seen.push(a); } };');
    inject(win, def, 'target.call', '0', 'undefined');
    win.eval('window.target.call("x")');
    expect(win.seen[0]).toBeUndefined();
  });

  it('does nothing for an unknown chain', () => {
    const win = makeWindow();
    expect(() => inject(win, def, 'no.such.thing', '0', 'json:1')).not.toThrow();
  });

  it('is idempotent', () => {
    const win = makeWindow();
    win.eval('window.target = { call: function () {} };');
    inject(win, def, 'target.call', '0', 'json:1');
    const first = win.target.call;
    inject(win, def, 'target.call', '0', 'json:1');
    expect(win.target.call).toBe(first);
  });
});
