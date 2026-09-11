import { describe, expect, it } from 'vitest';
import def from '../src/trusted-replace-xhr-response';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

function request(win: any, url = 'https://example.com/feed'): void {
  win.eval(`
    window.result = null;
    var x = new XMLHttpRequest();
    x.open('GET', ${JSON.stringify(url)});
    x.onload = function () { window.result = x.responseText; };
    x.send();
  `);
}

describe('trusted-replace-xhr-response', () => {
  it('is marked as trusted', () => {
    expect(def.trusted).toBe(true);
  });

  it('replaces the whole body when the pattern is *', async () => {
    const win = makeWindow();
    installXhrStub(win, 'original');
    inject(win, def, '*', 'replaced');
    request(win);
    await tick(win, 20);
    expect(win.result).toBe('replaced');
  });

  it('replaces a /regex/ match', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"showAds":true,"showAds2":true}');
    inject(win, def, '/true/', 'false');
    request(win);
    await tick(win, 20);
    expect(win.result).toBe('{"showAds":false,"showAds2":false}');
  });

  it('only touches matching requests', async () => {
    const win = makeWindow();
    installXhrStub(win, 'original');
    inject(win, def, '*', 'replaced', 'url:/ads/');
    request(win, 'https://example.com/news');
    await tick(win, 20);
    expect(win.result).toBe('original');
  });
});
