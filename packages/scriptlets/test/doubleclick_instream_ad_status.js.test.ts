import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/doubleclick-instream-ad-status';
import { inject, makeWindow } from './_inject';

describe('doubleclick_instream_ad_status.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('doubleclick_instream_ad_status.js');
    expect(def.trusted).toBe(false);
  });

  it('reports a successful ad status', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('google_ad_status')).toBe(1);
  });
});
