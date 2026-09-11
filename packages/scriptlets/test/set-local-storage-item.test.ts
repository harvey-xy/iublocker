import { describe, expect, it } from 'vitest';
import def from '../src/set-local-storage-item';
import { inject, makeWindow } from './_inject';

describe('set-local-storage-item', () => {
  it('writes an approved keyword', () => {
    const win = makeWindow();
    inject(win, def, 'consent', 'true');
    expect(win.localStorage.getItem('consent')).toBe('true');
  });

  it('maps emptyObj / emptyArr / emptyStr', () => {
    const win = makeWindow();
    inject(win, def, 'a', 'emptyObj');
    inject(win, def, 'b', 'emptyArr');
    inject(win, def, 'c', 'emptyStr');
    expect(win.localStorage.getItem('a')).toBe('{}');
    expect(win.localStorage.getItem('b')).toBe('[]');
    expect(win.localStorage.getItem('c')).toBe('');
  });

  it('accepts small numbers but rejects large ones', () => {
    const win = makeWindow();
    inject(win, def, 'n', '42');
    inject(win, def, 'big', '999999');
    expect(win.localStorage.getItem('n')).toBe('42');
    expect(win.localStorage.getItem('big')).toBeNull();
  });

  it('rejects arbitrary values', () => {
    const win = makeWindow();
    inject(win, def, 'x', 'whatever');
    expect(win.localStorage.getItem('x')).toBeNull();
  });

  it('removes the key with $remove$', () => {
    const win = makeWindow();
    win.localStorage.setItem('gone', '1');
    inject(win, def, 'gone', '$remove$');
    expect(win.localStorage.getItem('gone')).toBeNull();
  });

  it('leaves sessionStorage alone', () => {
    const win = makeWindow();
    inject(win, def, 'k', 'yes');
    expect(win.sessionStorage.getItem('k')).toBeNull();
  });
});
