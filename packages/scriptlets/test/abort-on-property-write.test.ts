import { describe, expect, it } from 'vitest';
import def from '../src/abort-on-property-write';
import { inject, makeWindow } from './_inject';

describe('abort-on-property-write', () => {
  it('throws when the property is written', () => {
    const win = makeWindow();
    inject(win, def, 'adblock');
    expect(() => win.eval('window.adblock = true')).toThrow(/iub/);
  });

  it('leaves reads alone', () => {
    const win = makeWindow();
    win.eval('window.thing = 42');
    inject(win, def, 'thing');
    expect(win.eval('thing')).toBe(42);
  });

  it('handles chained properties created later', () => {
    const win = makeWindow();
    inject(win, def, 'a.b');
    win.eval('window.a = {}');
    expect(() => win.eval('a.b = 1')).toThrow();
  });

  it('swallows its own exception through window.onerror', () => {
    const win = makeWindow();
    inject(win, def, 'y');
    let message = '';
    try {
      win.eval('window.y = 1');
    } catch (ex) {
      message = String((ex as Error).message);
    }
    expect(win.onerror(message)).toBe(true);
  });
});
