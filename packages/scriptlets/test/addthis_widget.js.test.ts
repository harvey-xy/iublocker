import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/addthis-widget';
import { inject, makeWindow } from './_inject';

describe('addthis_widget.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('addthis_widget.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs the addthis API', () => {
    const win = makeWindow();
    inject(win, def);
    expect(win.eval('typeof addthis.init')).toBe('function');
    expect(win.eval('addthis.toolbox()')).toBeUndefined();
    expect(win.eval('typeof addthis.layers.refresh')).toBe('function');
  });
});
