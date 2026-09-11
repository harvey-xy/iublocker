import { describe, expect, it } from 'vitest';
import def from '../src/abort-on-property-read';
import { inject, makeWindow } from './_inject';

describe('abort-on-property-read', () => {
  it('throws a ReferenceError when the property is read', () => {
    const win = makeWindow();
    inject(win, def, 'adblockDetector');
    expect(() => win.eval('adblockDetector')).toThrow(/iub/);
  });

  it('swallows its own exception through window.onerror, but nothing else', () => {
    const win = makeWindow();
    inject(win, def, 'foo');
    let message = '';
    try {
      win.eval('foo');
    } catch (ex) {
      message = String((ex as Error).message);
    }
    expect(message).not.toBe('');
    expect(win.onerror(`Uncaught ReferenceError: ${message}`)).toBe(true);
    expect(win.onerror('Uncaught TypeError: something else')).not.toBe(true);
  });

  it('waits for intermediate objects that do not exist yet', () => {
    const win = makeWindow();
    inject(win, def, 'a.b.c');
    win.eval('window.a = { b: {} }');
    expect(() => win.eval('a.b.c')).toThrow();
    expect(win.a.b).toBeTypeOf('object');
  });

  it('leaves writes alone and is idempotent', () => {
    const win = makeWindow();
    inject(win, def, 'x');
    inject(win, def, 'x');
    expect(() => win.eval('window.x = 1')).not.toThrow();
    expect(() => win.eval('x')).toThrow();
  });
});
