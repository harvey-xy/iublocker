import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/fingerprint3';
import { inject, makeWindow } from './_inject';

describe('fingerprint3.js', () => {
  it('resolves load().get() with a fixed visitor id', async () => {
    const win = makeWindow();
    inject(win, def);
    const out = await win.eval('FingerprintJS.load().then(function (a) { return a.get(); })');
    expect(out.visitorId).toBe('00000000000000000000000000000000');
    expect(out.confidence.score).toBeGreaterThan(0);
  });

  it('answers hashComponents()', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('FingerprintJS.hashComponents({})')).toBe('00000000000000000000000000000000');
  });
});
