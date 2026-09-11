import { describe, expect, it } from 'vitest';
import def from '../src/trusted-set-local-storage-item';
import { inject, makeWindow } from './_inject';

describe('trusted-set-local-storage-item', () => {
  it('is marked as trusted', () => {
    expect(def.trusted).toBe(true);
  });

  it('writes arbitrary values', () => {
    const win = makeWindow();
    inject(win, def, 'cfg', '{"a":1}');
    expect(win.localStorage.getItem('cfg')).toBe('{"a":1}');
  });

  it('removes the key with $remove$', () => {
    const win = makeWindow();
    win.localStorage.setItem('gone', '1');
    inject(win, def, 'gone', '$remove$');
    expect(win.localStorage.getItem('gone')).toBeNull();
  });

  it('expands $currentDate$ and $now$', () => {
    const win = makeWindow();
    inject(win, def, 'd', '$currentDate$');
    inject(win, def, 'n', '$now$');
    expect(win.localStorage.getItem('d')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number(win.localStorage.getItem('n'))).toBeGreaterThan(0);
  });
});
