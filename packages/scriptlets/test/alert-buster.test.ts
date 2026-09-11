import { describe, expect, it } from 'vitest';
import def from '../src/alert-buster';
import { inject, makeWindow } from './_inject';

describe('alert-buster', () => {
  it('silences window.alert', () => {
    const win = makeWindow();
    let called = false;
    win.alert = () => {
      called = true;
    };
    inject(win, def);
    win.eval('window.alert("boo")');
    expect(called).toBe(false);
  });

  it('is idempotent', () => {
    const win = makeWindow();
    inject(win, def);
    const first = win.alert;
    inject(win, def);
    expect(win.alert).toBe(first);
  });
});
