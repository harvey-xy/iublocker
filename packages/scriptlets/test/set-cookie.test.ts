import { describe, expect, it } from 'vitest';
import def from '../src/set-cookie';
import { inject, makeWindow } from './_inject';

describe('set-cookie', () => {
  it('writes an approved value', () => {
    const win = makeWindow();
    inject(win, def, 'consent', 'true');
    expect(win.document.cookie).toContain('consent=true');
  });

  it('accepts numbers', () => {
    const win = makeWindow();
    inject(win, def, 'n', '1');
    expect(win.document.cookie).toContain('n=1');
  });

  it('rejects arbitrary values', () => {
    const win = makeWindow();
    inject(win, def, 'x', 'some-arbitrary-value');
    expect(win.document.cookie).toBe('');
  });

  it('encodes the name and value', () => {
    const win = makeWindow();
    inject(win, def, 'a b', 'yes');
    expect(win.document.cookie).toContain('a%20b=yes');
  });
});
