import { describe, expect, it } from 'vitest';
import def from '../src/json-prune-fetch-response';
import { inject, installFetchStub, makeWindow } from './_inject';

describe('json-prune-fetch-response', () => {
  it('prunes the JSON body of a matching response', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":[1,2],"items":[{"id":1}]}');
    inject(win, def, 'ads');
    const out = await win.eval('fetch("https://example.com/feed").then(function (r) { return r.json(); })');
    expect(out).toEqual({ items: [{ id: 1 }] });
  });

  it('only touches requests matching propsToMatch', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":1,"keep":2}');
    inject(win, def, 'ads', '', 'url:/feed');
    const pruned = await win.eval(
      'fetch("https://example.com/feed").then(function (r) { return r.json(); })',
    );
    const intact = await win.eval(
      'fetch("https://example.com/other").then(function (r) { return r.json(); })',
    );
    expect(pruned).toEqual({ keep: 2 });
    expect(intact).toEqual({ ads: 1, keep: 2 });
  });

  it('honours requiredProps', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":1}');
    inject(win, def, 'ads', 'marker');
    const out = await win.eval('fetch("https://example.com/feed").then(function (r) { return r.json(); })');
    expect(out).toEqual({ ads: 1 });
  });

  it('passes non-JSON bodies through untouched', async () => {
    const win = makeWindow();
    installFetchStub(win, 'not json at all');
    inject(win, def, 'ads');
    const text = await win.eval('fetch("https://example.com/feed").then(function (r) { return r.text(); })');
    expect(text).toBe('not json at all');
  });

  it('keeps the response status and url', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"ads":1,"keep":2}');
    inject(win, def, 'ads');
    const status = await win.eval(
      'fetch("https://example.com/feed").then(function (r) { return r.status; })',
    );
    const url = await win.eval('fetch("https://example.com/feed").then(function (r) { return r.url; })');
    expect(status).toBe(200);
    expect(url).toBe('https://example.com/feed');
  });
});
