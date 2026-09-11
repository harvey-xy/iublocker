import { describe, expect, it } from 'vitest';
import def from '../src/abort-on-stack-trace';
import { inject, makeWindow } from './_inject';

describe('abort-on-stack-trace', () => {
  it('aborts when the reading stack matches', () => {
    const win = makeWindow();
    inject(win, def, 'probe', 'adsLoader');
    win.eval('window.adsLoader = function adsLoader() { return probe; }');
    expect(() => win.eval('adsLoader()')).toThrow(/iub/);
  });

  it('leaves other call sites alone', () => {
    const win = makeWindow();
    inject(win, def, 'probe', 'adsLoader');
    win.eval('window.contentLoader = function contentLoader() { return probe; }');
    expect(() => win.eval('contentLoader()')).not.toThrow();
  });

  it('supports `!` negation', () => {
    const win = makeWindow();
    inject(win, def, 'probe', '!allowedLoader');
    win.eval('window.allowedLoader = function allowedLoader() { return probe; }');
    win.eval('window.otherLoader = function otherLoader() { return probe; }');
    expect(() => win.eval('allowedLoader()')).not.toThrow();
    expect(() => win.eval('otherLoader()')).toThrow();
  });
});
