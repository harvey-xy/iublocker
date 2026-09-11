import { describe, expect, it } from 'vitest';
import def from '../src/trusted-replace-fetch-response';
import { inject, installFetchStub, makeWindow } from './_inject';

describe('trusted-replace-fetch-response', () => {
  it('is marked as trusted', () => {
    expect(def.trusted).toBe(true);
  });

  it('replaces the whole body when the pattern is *', async () => {
    const win = makeWindow();
    installFetchStub(win, 'original');
    inject(win, def, '*', 'replaced');
    const text = await win.eval('fetch("https://example.com/x").then(function (r) { return r.text(); })');
    expect(text).toBe('replaced');
  });

  it('replaces every occurrence of a literal', async () => {
    const win = makeWindow();
    installFetchStub(win, 'ad ad content');
    inject(win, def, 'ad', 'xx');
    const text = await win.eval('fetch("https://example.com/x").then(function (r) { return r.text(); })');
    expect(text).toBe('xx xx content');
  });

  it('supports /regex/ patterns with capture groups', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"showAds":true}');
    inject(win, def, '/"showAds":(true)/', '"showAds":false');
    const text = await win.eval('fetch("https://example.com/x").then(function (r) { return r.text(); })');
    expect(text).toBe('{"showAds":false}');
  });

  it('only touches matching requests', async () => {
    const win = makeWindow();
    installFetchStub(win, 'original');
    inject(win, def, '*', 'replaced', 'url:/ads/');
    const changed = await win.eval(
      'fetch("https://example.com/ads/x").then(function (r) { return r.text(); })',
    );
    const intact = await win.eval(
      'fetch("https://example.com/news").then(function (r) { return r.text(); })',
    );
    expect(changed).toBe('replaced');
    expect(intact).toBe('original');
  });
});
