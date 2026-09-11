import { describe, expect, it } from 'vitest';
import def from '../src/json-edit-fetch-response';
import { inject, installFetchStub, makeWindow } from './_inject';

const get = (win: any, url: string): Promise<any> =>
  win.eval(`fetch(${JSON.stringify(url)}).then(function (r) { return r.json(); })`);

describe('json-edit-fetch-response', () => {
  it('removes matching entries from the JSON body', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"items":[{"isAd":true},{"id":2}]}');
    inject(win, def, '.items.*[?.isAd==true]');
    const out = await get(win, 'https://example.com/feed');
    expect(out).toEqual({ items: [{ id: 2 }] });
  });

  it('honours a named `propsToMatch` extra argument', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":1,"keep":2}');
    inject(win, def, '.ads', 'propsToMatch', '/feed');
    expect(await get(win, 'https://example.com/feed')).toEqual({ keep: 2 });
    expect(await get(win, 'https://example.com/other')).toEqual({ ads: 1, keep: 2 });
  });

  it('honours the legacy positional propsToMatch', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":1,"keep":2}');
    inject(win, def, '.ads', 'url:/feed');
    expect(await get(win, 'https://example.com/other')).toEqual({ ads: 1, keep: 2 });
  });

  it('refuses to write values (untrusted)', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":true}');
    inject(win, def, '.ads=false');
    expect(await get(win, 'https://example.com/feed')).toEqual({ ads: true });
  });

  it('passes non-JSON bodies through untouched', async () => {
    const win = makeWindow();
    installFetchStub(win, 'plain text');
    inject(win, def, '.ads');
    const text = await win.eval('fetch("https://example.com/f").then(function (r) { return r.text(); })');
    expect(text).toBe('plain text');
  });
});
