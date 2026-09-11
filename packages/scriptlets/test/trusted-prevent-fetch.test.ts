import { describe, expect, it } from 'vitest';
import def from '../src/trusted-prevent-fetch';
import { inject, installFetchStub, makeWindow } from './_inject';

describe('trusted-prevent-fetch', () => {
  it('answers a matching request with an arbitrary body', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real');
    inject(win, def, 'googlesyndication', 'function');
    const text = await win.eval(
      'fetch("https://googlesyndication.com/x").then(function (r) { return r.text(); })',
    );
    expect(text).toBe('function');
    expect(win.__fetchCalls.length).toBe(0);
  });

  it('lets other requests through', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real');
    inject(win, def, 'googlesyndication', 'function');
    const text = await win.eval('fetch("https://example.com/x").then(function (r) { return r.text(); })');
    expect(text).toBe('real');
  });

  it('applies the responseProps object', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real');
    inject(win, def, 'ads', 'x', '{"type": "cors"}');
    const type = await win.eval('fetch("https://ads.example/x").then(function (r) { return r.type; })');
    expect(type).toBe('cors');
  });

  it('supports the uBO body keywords', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real');
    inject(win, def, 'ads', 'emptyObj');
    const out = await win.eval('fetch("https://ads.example/x").then(function (r) { return r.json(); })');
    expect(out).toEqual({});
  });

  it('is marked trusted', () => {
    expect(def.trusted).toBe(true);
  });
});
