import { describe, expect, it } from 'vitest';
import def from '../src/json-edit-fetch-request';
import { inject, installFetchStub, makeWindow } from './_inject';

describe('json-edit-fetch-request', () => {
  it('edits the outgoing JSON body', async () => {
    const win = makeWindow();
    installFetchStub(win);
    inject(win, def, '.*[?.operationName=="TrackEvent"]', 'propsToMatch', '/v1/api');
    await win.eval(
      'fetch("https://example.com/v1/api", { method: "POST", body: JSON.stringify({ a: { operationName: "TrackEvent" }, b: { operationName: "Keep" } }) })',
    );
    const init = win.__fetchCalls[0][1];
    expect(JSON.parse(init.body)).toEqual({ b: { operationName: 'Keep' } });
  });

  it('leaves unmatched requests alone', async () => {
    const win = makeWindow();
    installFetchStub(win);
    inject(win, def, '.a', 'propsToMatch', '/never');
    await win.eval('fetch("https://example.com/x", { method: "POST", body: "{\\"a\\":1}" })');
    expect(win.__fetchCalls[0][1].body).toBe('{"a":1}');
  });

  it('leaves a non-JSON body alone', async () => {
    const win = makeWindow();
    installFetchStub(win);
    inject(win, def, '.a');
    await win.eval('fetch("https://example.com/x", { method: "POST", body: "plain" })');
    expect(win.__fetchCalls[0][1].body).toBe('plain');
  });

  it('refuses to write values (untrusted)', () => {
    const win = makeWindow();
    installFetchStub(win);
    const before = win.fetch;
    inject(win, def, '.a=1');
    expect(win.fetch).toBe(before);
  });
});
