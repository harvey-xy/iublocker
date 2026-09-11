import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/outbrain-widget';
import { inject, makeWindow } from './_inject';

describe('outbrain-widget.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('outbrain-widget.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs OBR.extern', () => {
    const win = makeWindow();
    inject(win, def);
    const out = win.eval(`
      window.ready = false;
      OBR.extern.callWhenServerLoaded(function () { window.ready = true; });
      OBR.extern.researchWidget();
      [window.ready, typeof OBR.extern.callClick, typeof outbrain.reloadWidget];
    `);
    expect(out).toEqual([true, 'function', 'function']);
  });
});
