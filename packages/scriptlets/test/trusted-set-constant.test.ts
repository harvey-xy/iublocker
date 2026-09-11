import { describe, expect, it } from 'vitest';
import def from '../src/trusted-set-constant';
import { inject, makeWindow } from './_inject';

describe('trusted-set-constant', () => {
  it('is marked as trusted', () => {
    expect(def.trusted).toBe(true);
  });

  it('accepts arbitrary strings, numbers and JSON', () => {
    const win = makeWindow();
    inject(win, def, 'a', 'hello world');
    inject(win, def, 'b', '123456789');
    inject(win, def, 'c', '{"x":[1,2]}');
    expect(win.eval('a')).toBe('hello world');
    expect(win.eval('b')).toBe(123456789);
    expect(win.eval('c')).toEqual({ x: [1, 2] });
  });

  it('still understands the keywords', () => {
    const win = makeWindow();
    inject(win, def, 'k', 'noopFunc');
    expect(win.eval('typeof k')).toBe('function');
  });

  it('defines chained paths lazily', () => {
    const win = makeWindow();
    inject(win, def, 'x.y.z', 'ok');
    win.eval('window.x = { y: {} }');
    expect(win.eval('x.y.z')).toBe('ok');
  });
});
