import { describe, expect, it } from 'vitest';
import def from '../src/trusted-set-session-storage-item';
import { inject, makeWindow } from './_inject';

describe('trusted-set-session-storage-item', () => {
  it('writes an arbitrary value', () => {
    const win = makeWindow();
    inject(win, def, 'k', '{"displayed":true}');
    expect(win.sessionStorage.getItem('k')).toBe('{"displayed":true}');
  });

  it('expands $now$', () => {
    const win = makeWindow();
    inject(win, def, 'lastAd', '$now$');
    expect(Number(win.sessionStorage.getItem('lastAd'))).toBeGreaterThan(0);
  });

  it('removes the key with $remove$', () => {
    const win = makeWindow();
    win.sessionStorage.setItem('k', 'v');
    inject(win, def, 'k', '$remove$');
    expect(win.sessionStorage.getItem('k')).toBeNull();
  });

  it('ignores an empty key', () => {
    const win = makeWindow();
    inject(win, def, '', 'v');
    expect(win.sessionStorage.length).toBe(0);
  });
});
