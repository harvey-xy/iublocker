import { describe, expect, it } from 'vitest';
import def from '../src/json-edit';
import { inject, makeWindow } from './_inject';

const parse = (win: any, text: string): any => win.eval(`JSON.parse(${JSON.stringify(text)})`);

describe('json-edit', () => {
  it('removes a key found by recursive descent', () => {
    const win = makeWindow();
    inject(win, def, '..admiralScriptCode');
    const out = parse(win, '{"a":{"b":{"admiralScriptCode":"x","keep":1}}}');
    expect(out.a.b.admiralScriptCode).toBeUndefined();
    expect(out.a.b.keep).toBe(1);
  });

  it('removes array entries matched by a filter', () => {
    const win = makeWindow();
    inject(win, def, '.items.*[?.isAd==true]');
    const out = parse(win, '{"items":[{"isAd":true},{"isAd":false},{"id":3}]}');
    expect(out.items.length).toBe(2);
    expect(out.items[0].isAd).toBe(false);
  });

  it('supports an existence filter', () => {
    const win = makeWindow();
    inject(win, def, '.*[?.adId]');
    const out = parse(win, '{"a":{"adId":1},"b":{"x":2}}');
    expect(out.a).toBeUndefined();
    expect(out.b.x).toBe(2);
  });

  it('supports the `^=` operator', () => {
    const win = makeWindow();
    inject(win, def, '.*[?.linkurl^="http"]');
    const out = parse(win, '{"a":{"linkurl":"http://x"},"b":{"linkurl":"/rel"}}');
    expect(out.a).toBeUndefined();
    expect(out.b).toBeTruthy();
  });

  it('refuses to write values (untrusted)', () => {
    const win = makeWindow();
    inject(win, def, '.showAds=false');
    const out = parse(win, '{"showAds":true}');
    expect(out.showAds).toBe(true);
  });

  it('leaves a malformed path alone', () => {
    const win = makeWindow();
    const before = win.JSON.parse;
    inject(win, def, 'not-a-path');
    expect(win.JSON.parse).toBe(before);
  });

  it('also prunes Response.prototype.json', async () => {
    const win = makeWindow();
    win.eval(
      'window.Response = function () {}; window.Response.prototype.json = function () { return Promise.resolve({ ads: 1, keep: 2 }); };',
    );
    inject(win, def, '.ads');
    const out = await win.eval('new window.Response().json()');
    expect(out.ads).toBeUndefined();
    expect(out.keep).toBe(2);
  });
});
