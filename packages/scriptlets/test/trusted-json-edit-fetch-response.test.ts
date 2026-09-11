import { describe, expect, it } from 'vitest';
import def from '../src/trusted-json-edit-fetch-response';
import { inject, installFetchStub, makeWindow } from './_inject';

const get = (win: any, url: string): Promise<any> =>
  win.eval(`fetch(${JSON.stringify(url)}).then(function (r) { return r.json(); })`);

describe('trusted-json-edit-fetch-response', () => {
  it('writes a value into a matching response', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"mandatoryAdvertising":true}');
    inject(win, def, '.mandatoryAdvertising=false', 'propsToMatch', '/config');
    expect(await get(win, 'https://example.com/config')).toEqual({ mandatoryAdvertising: false });
  });

  it('empties an array with `=[]`', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"streams":[{"adUnits":[1,2]}]}');
    inject(win, def, '.streams.*.adUnits=[]');
    expect(await get(win, 'https://example.com/manifest')).toEqual({ streams: [{ adUnits: [] }] });
  });

  it('leaves unmatched requests alone', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"a":1}');
    inject(win, def, '.a=2', 'propsToMatch', '/never');
    expect(await get(win, 'https://example.com/x')).toEqual({ a: 1 });
  });

  it('keeps the response status and url', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"a":1}');
    inject(win, def, '.a=2');
    const status = await win.eval('fetch("https://example.com/x").then(function (r) { return r.status; })');
    expect(status).toBe(200);
  });

  it('ignores a malformed path', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"a":1}');
    const before = win.fetch;
    inject(win, def, 'nonsense');
    expect(win.fetch).toBe(before);
  });
});
