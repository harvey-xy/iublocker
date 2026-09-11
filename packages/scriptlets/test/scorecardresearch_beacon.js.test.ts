import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/scorecardresearch-beacon';
import { inject, makeWindow } from './_inject';

describe('scorecardresearch_beacon.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('scorecardresearch_beacon.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs COMSCORE and the _comscore queue', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      _comscore.push({ c1: '2' });
      COMSCORE.beacon({ c1: '2' });
      COMSCORE.purge();
      [_comscore.length, typeof COMSCORE.beacon];
    `);
    expect(out).toEqual([0, 'function']);
  });
});
