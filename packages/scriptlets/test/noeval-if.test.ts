import { describe, expect, it } from 'vitest';
import def from '../src/noeval-if';
import { inject, makeWindow } from './_inject';

/** The scriptlet replaces window.eval, so keep a reference to the real one for driving the test. */
function pageRunner(win: any): (source: string) => any {
  const original = win.eval;
  return (source: string) => original.call(win, source);
}

describe('noeval-if', () => {
  it('blocks matching eval calls and passes the rest through', () => {
    const win = makeWindow();
    const run = pageRunner(win);
    inject(win, def, 'adblock');
    expect(run('window.eval("1 + 1")')).toBe(2);
    expect(run('window.eval("var adblock = 3; 5")')).toBeUndefined();
  });

  it('blocks every eval when no needle is given', () => {
    const win = makeWindow();
    const run = pageRunner(win);
    inject(win, def);
    expect(run('window.eval("1 + 1")')).toBeUndefined();
  });

  it('supports `!` negation', () => {
    const win = makeWindow();
    const run = pageRunner(win);
    inject(win, def, '!keepThis');
    expect(run('window.eval("/* keepThis */ 7")')).toBe(7);
    expect(run('window.eval("8")')).toBeUndefined();
  });

  it('preserves eval.toString()', () => {
    const win = makeWindow();
    const before = String(win.eval);
    inject(win, def, 'x');
    expect(String(win.eval)).toBe(before);
    expect(String(win.eval)).toContain('native code');
  });
});
