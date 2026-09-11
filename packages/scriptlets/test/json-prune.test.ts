import { describe, expect, it } from 'vitest';
import def from '../src/json-prune';
import { inject, installFetchStub, makeWindow } from './_inject';

describe('json-prune', () => {
  it('removes a dotted path from JSON.parse output', () => {
    const win = makeWindow();
    inject(win, def, 'ads.items');
    const out = win.eval('JSON.parse(\'{"ads":{"items":[1,2],"id":3},"keep":1}\')');
    expect(out).toEqual({ ads: { id: 3 }, keep: 1 });
  });

  it('supports several paths at once', () => {
    const win = makeWindow();
    inject(win, def, 'a b.c');
    expect(win.eval('JSON.parse(\'{"a":1,"b":{"c":2,"d":3}}\')')).toEqual({ b: { d: 3 } });
  });

  it('supports [] and * wildcards', () => {
    const win = makeWindow();
    inject(win, def, 'items.[].ad');
    expect(win.eval('JSON.parse(\'{"items":[{"ad":1,"t":"a"},{"ad":2,"t":"b"}]}\')')).toEqual({
      items: [{ t: 'a' }, { t: 'b' }],
    });

    const win2 = makeWindow();
    inject(win2, def, 'data.*.tracking');
    expect(win2.eval('JSON.parse(\'{"data":{"x":{"tracking":1,"k":2},"y":{"tracking":3}}}\')')).toEqual({
      data: { x: { k: 2 }, y: {} },
    });
  });

  it('honours requiredProps', () => {
    const win = makeWindow();
    inject(win, def, 'ads', 'marker');
    expect(win.eval('JSON.parse(\'{"ads":1,"marker":2}\')')).toEqual({ marker: 2 });
    expect(win.eval('JSON.parse(\'{"ads":1}\')')).toEqual({ ads: 1 });
  });

  it('honours negated requiredProps', () => {
    const win = makeWindow();
    inject(win, def, 'ads', '!skip');
    expect(win.eval('JSON.parse(\'{"ads":1}\')')).toEqual({});
    expect(win.eval('JSON.parse(\'{"ads":1,"skip":1}\')')).toEqual({ ads: 1, skip: 1 });
  });

  it('leaves non-objects and unrelated payloads alone', () => {
    const win = makeWindow();
    inject(win, def, 'ads');
    expect(win.eval('JSON.parse("5")')).toBe(5);
    expect(win.eval('JSON.parse(\'{"other":1}\')')).toEqual({ other: 1 });
  });

  it('prunes Response.prototype.json too', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":1,"keep":2}');
    inject(win, def, 'ads');
    const out = await win.eval('fetch("/x").then(function (r) { return r.json(); })');
    expect(out).toEqual({ keep: 2 });
  });

  it('preserves JSON.parse.toString()', () => {
    const win = makeWindow();
    const before = win.eval('JSON.parse.toString()');
    inject(win, def, 'ads');
    expect(win.eval('JSON.parse.toString()')).toBe(before);
    expect(win.eval('JSON.parse.toString()')).toContain('native code');
  });

  it('does nothing without propsToRemove', () => {
    const win = makeWindow();
    inject(win, def, '');
    expect(win.eval('JSON.parse(\'{"ads":1}\')')).toEqual({ ads: 1 });
  });
});
