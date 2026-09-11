import { describe, expect, it } from 'vitest';
import def from '../src/window-close-if';
import { inject, makeWindow } from './_inject';

describe('window-close-if', () => {
  const spy = (win: any): (() => number) => {
    let n = 0;
    win.close = () => {
      n += 1;
    };
    return () => n;
  };

  it('closes when the URL contains the literal', () => {
    const win = makeWindow(undefined, 'https://example.com/protect?x=1');
    const count = spy(win);
    inject(win, def, '/protect?');
    expect(count()).toBe(1);
  });

  it('leaves other URLs alone', () => {
    const win = makeWindow(undefined, 'https://example.com/other');
    const count = spy(win);
    inject(win, def, '/protect?');
    expect(count()).toBe(0);
  });

  it('supports a regex and `!` negation', () => {
    const win = makeWindow(undefined, 'https://example.com/a');
    const count = spy(win);
    inject(win, def, '!/\\/b$/');
    expect(count()).toBe(1);
  });

  it('closes unconditionally without a pattern', () => {
    const win = makeWindow();
    const count = spy(win);
    inject(win, def);
    expect(count()).toBe(1);
  });
});
