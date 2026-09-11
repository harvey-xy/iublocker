import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/monkeybroker';
import { inject, makeWindow } from './_inject';

describe('monkeybroker.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('monkeybroker.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs the monkeybroker globals', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof mbr.init')).toBe('function');
    expect(win.eval('monkeyBroker()')).toBeUndefined();
  });
});
