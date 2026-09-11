import { describe, expect, it } from 'vitest';
import def from '../src/trusted-set-cookie';
import { inject, makeWindow } from './_inject';

describe('trusted-set-cookie', () => {
  it('is marked as trusted', () => {
    expect(def.trusted).toBe(true);
  });

  it('writes arbitrary values', () => {
    const win = makeWindow();
    inject(win, def, 'session', 'abc-123');
    expect(win.document.cookie).toContain('session=abc-123');
  });

  it('expands $now$', () => {
    const win = makeWindow();
    inject(win, def, 't', '$now$');
    expect(win.document.cookie).toMatch(/t=\d{10,}/);
  });

  it('accepts an expiry offset', () => {
    const win = makeWindow();
    inject(win, def, 'k', 'v', '1year');
    expect(win.document.cookie).toContain('k=v');
  });
});
