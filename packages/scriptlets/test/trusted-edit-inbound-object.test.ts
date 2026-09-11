import { describe, expect, it } from 'vitest';
import def from '../src/trusted-edit-inbound-object';
import { inject, makeWindow } from './_inject';

describe('trusted-edit-inbound-object', () => {
  it('edits the argument before the function sees it', () => {
    const win = makeWindow();
    win.eval('window.seen = null; window.target = { run: function (o) { window.seen = o; } };');
    inject(win, def, 'target.run', '0', '.*[?.context.bidRequestId]');
    win.eval('window.target.run({ a: { context: { bidRequestId: 1 } }, b: { x: 2 } })');
    expect(win.seen).toEqual({ b: { x: 2 } });
  });

  it('writes values too (trusted)', () => {
    const win = makeWindow();
    win.eval('window.seen = null; window.target = { run: function (o) { window.seen = o; } };');
    inject(win, def, 'target.run', '0', '.enabled=false');
    win.eval('window.target.run({ enabled: true })');
    expect(win.seen).toEqual({ enabled: false });
  });

  it('leaves non-object arguments alone', () => {
    const win = makeWindow();
    win.eval('window.seen = null; window.target = { run: function (o) { window.seen = o; } };');
    inject(win, def, 'target.run', '0', '.a');
    win.eval('window.target.run("text")');
    expect(win.seen).toBe('text');
  });

  it('does nothing for an unknown chain', () => {
    const win = makeWindow();
    expect(() => inject(win, def, 'no.such.fn', '0', '.a')).not.toThrow();
  });
});
