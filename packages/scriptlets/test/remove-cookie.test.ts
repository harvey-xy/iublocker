import { describe, expect, it } from 'vitest';
import def from '../src/remove-cookie';
import { inject, makeWindow } from './_inject';

describe('remove-cookie', () => {
  it('removes cookies matching a literal name', () => {
    const win = makeWindow();
    win.document.cookie = 'tracker=1; path=/';
    win.document.cookie = 'keep=2; path=/';
    inject(win, def, 'tracker');
    expect(win.document.cookie).not.toContain('tracker=');
    expect(win.document.cookie).toContain('keep=2');
  });

  it('supports /regex/ names', () => {
    const win = makeWindow();
    win.document.cookie = 'ab_test=1; path=/';
    win.document.cookie = 'other=2; path=/';
    inject(win, def, '/^ab_/');
    expect(win.document.cookie).not.toContain('ab_test');
    expect(win.document.cookie).toContain('other=2');
  });

  it('does nothing without a name', () => {
    const win = makeWindow();
    win.document.cookie = 'keep=1; path=/';
    inject(win, def, '');
    expect(win.document.cookie).toContain('keep=1');
  });

  it('sweeps again on beforeunload', () => {
    const win = makeWindow();
    inject(win, def, 'late');
    win.document.cookie = 'late=1; path=/';
    win.dispatchEvent(new win.Event('beforeunload'));
    expect(win.document.cookie).not.toContain('late=');
  });
});
