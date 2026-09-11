import { describe, expect, it } from 'vitest';
import def from '../src/no-fetch-if';
import { inject, installFetchStub, makeWindow } from './_inject';

describe('no-fetch-if', () => {
  it('answers matching requests with an empty response', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real body');
    inject(win, def, '/ads/');
    const text = await win.eval('fetch("https://example.com/ads/banner").then(function (r) { return r.text(); })');
    expect(text).toBe('');
    expect(win.__fetchCalls.length).toBe(0);
  });

  it('lets other requests through', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real body');
    inject(win, def, '/ads/');
    const text = await win.eval('fetch("https://example.com/api/news").then(function (r) { return r.text(); })');
    expect(text).toBe('real body');
    expect(win.__fetchCalls.length).toBe(1);
  });

  it('matches on other request properties', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real body');
    inject(win, def, 'method:POST');
    const blocked = await win.eval(
      'fetch("https://example.com/x", { method: "POST" }).then(function (r) { return r.text(); })',
    );
    const allowed = await win.eval('fetch("https://example.com/x").then(function (r) { return r.text(); })');
    expect(blocked).toBe('');
    expect(allowed).toBe('real body');
  });

  it('supports the emptyObj / emptyArr response bodies', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real');
    inject(win, def, '*', 'emptyObj');
    const body = await win.eval('fetch("https://example.com/x").then(function (r) { return r.text(); })');
    expect(body).toBe('{}');
  });

  it('keeps a full URL token as a URL pattern', async () => {
    const win = makeWindow();
    installFetchStub(win, 'real');
    inject(win, def, 'https://ads.example/track');
    const blocked = await win.eval('fetch("https://ads.example/track?a=1").then(function (r) { return r.text(); })');
    const allowed = await win.eval('fetch("https://example.com/ok").then(function (r) { return r.text(); })');
    expect(blocked).toBe('');
    expect(allowed).toBe('real');
  });

  it('preserves fetch.toString()', () => {
    const win = makeWindow();
    installFetchStub(win);
    const before = win.eval('window.fetch.toString()');
    inject(win, def, '/ads/');
    expect(win.eval('window.fetch.toString()')).toBe(before);
  });
});
