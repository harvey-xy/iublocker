import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/ligatus-angular-tag';
import { inject, makeWindow } from './_inject';

describe('ligatus_angular-tag.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('ligatus_angular-tag.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs the ligatus globals', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof ligatus.init')).toBe('function');
    expect(win.eval('lgt()')).toBeUndefined();
  });
});
