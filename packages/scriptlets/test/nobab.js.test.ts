import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/nobab';
import { inject, makeWindow } from './_inject';

describe('nobab.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('nobab.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs BlockAdBlock and removes its bait elements', () => {
    const win = makeWindow('<!doctype html><html><body><div id="babasbmsgs1"></div><div class="babasbm-x"></div></body></html>');
    inject(win, def);
    expect(win.document.getElementById('babasbmsgs1')).toBeNull();
    expect(win.document.querySelector('.babasbm-x')).toBeNull();
    expect(
      win.eval('window.ok = false; blockAdBlock.onNotDetected(function () { window.ok = true; }); window.ok;'),
    ).toBe(true);
  });
});
