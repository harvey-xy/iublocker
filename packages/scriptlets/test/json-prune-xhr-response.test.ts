import { describe, expect, it } from 'vitest';
import def from '../src/json-prune-xhr-response';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

describe('json-prune-xhr-response', () => {
  it('prunes the JSON body before the page sees it', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"ads":[1,2],"items":[{"id":1}]}');
    inject(win, def, 'ads');
    win.eval(`
      window.result = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/feed');
      x.onload = function () { window.result = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(JSON.parse(win.result)).toEqual({ items: [{ id: 1 }] });
    expect(win.__xhrSent).toBe(1);
  });

  it('honours propsToMatch', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"ads":1,"keep":2}');
    inject(win, def, 'ads', '', 'url:/feed');
    win.eval(`
      window.a = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/other');
      x.onload = function () { window.a = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(JSON.parse(win.a)).toEqual({ ads: 1, keep: 2 });
  });

  it('sets responseType-aware properties', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"ads":1,"keep":2}');
    inject(win, def, 'ads');
    win.eval(`
      window.result = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/feed');
      x.responseType = 'json';
      x.onload = function () { window.result = x.response; };
      x.send();
    `);
    await tick(win, 20);
    expect(win.result).toEqual({ keep: 2 });
  });

  it('leaves non-JSON bodies alone', async () => {
    const win = makeWindow();
    installXhrStub(win, 'plain text');
    inject(win, def, 'ads');
    win.eval(`
      window.result = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/feed');
      x.onload = function () { window.result = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(win.result).toBe('plain text');
  });
});
