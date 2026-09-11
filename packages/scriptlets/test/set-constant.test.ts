import { describe, expect, it } from 'vitest';
import def from '../src/set-constant';
import { inject, makeWindow } from './_inject';

describe('set-constant', () => {
  it('defines a boolean constant', () => {
    const win = makeWindow();
    inject(win, def, 'adsEnabled', 'false');
    expect(win.eval('adsEnabled')).toBe(false);
  });

  it('defines a.b even when `a` is created later', () => {
    const win = makeWindow();
    inject(win, def, 'a.b', 'false');
    expect(win.a).toBeUndefined();
    win.eval('window.a = {}');
    expect(win.eval('a.b')).toBe(false);
  });

  it('keeps answering the constant after the page assigns to it', () => {
    const win = makeWindow();
    inject(win, def, 'flag', 'true');
    win.eval('window.flag = false');
    expect(win.eval('flag')).toBe(true);
  });

  it('supports the uBO value keywords', () => {
    const cases: [string, (v: any) => void][] = [
      ['undefined', (v) => expect(v).toBeUndefined()],
      ['null', (v) => expect(v).toBeNull()],
      ['true', (v) => expect(v).toBe(true)],
      ['emptyObj', (v) => expect(v).toEqual({})],
      ['emptyArr', (v) => expect(v).toEqual([])],
      ["''", (v) => expect(v).toBe('')],
      ['yes', (v) => expect(v).toBe('yes')],
      ['no', (v) => expect(v).toBe('no')],
      ['-1', (v) => expect(v).toBe(-1)],
      ['42', (v) => expect(v).toBe(42)],
      ['noopFunc', (v) => expect(v()).toBeUndefined()],
      ['trueFunc', (v) => expect(v()).toBe(true)],
      ['falseFunc', (v) => expect(v()).toBe(false)],
      ['throwFunc', (v) => expect(() => v()).toThrow()],
    ];
    for (const [keyword, check] of cases) {
      const win = makeWindow();
      inject(win, def, 'k', keyword);
      check(win.eval('k'));
    }
  });

  it('rejects out-of-range numbers and unknown keywords', () => {
    const win = makeWindow();
    inject(win, def, 'big', '99999');
    inject(win, def, 'weird', 'somethingElse');
    expect(win.eval('typeof big')).toBe('undefined');
    expect(win.eval('typeof weird')).toBe('undefined');
    expect(Object.getOwnPropertyDescriptor(win, 'big')).toBeUndefined();
  });

  it('applies only on a matching stack when the third argument is given', () => {
    const win = makeWindow();
    inject(win, def, 'gate', 'true', 'adsLoader');
    win.eval('window.adsLoader = function adsLoader() { return gate; }');
    win.eval('window.other = function other() { return gate; }');
    expect(win.eval('adsLoader()')).toBe(true);
    expect(win.eval('other()')).toBeUndefined();
  });

  it('returns promise-shaped values for the promise keywords', async () => {
    const win = makeWindow();
    inject(win, def, 'ok', 'noopPromiseResolve');
    inject(win, def, 'bad', 'noopPromiseReject');
    expect(win.eval('typeof ok().then')).toBe('function');
    await expect(Promise.resolve(win.eval('ok()'))).resolves.not.toThrow();
    await expect(Promise.resolve(win.eval('bad()'))).rejects.toBeInstanceOf(win.Error);
  });
});
