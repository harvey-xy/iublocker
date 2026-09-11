import { describe, expect, it } from 'vitest';
import def from '../src/json-edit-xhr-response';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

const request = (win: any, url: string, into: string): void => {
  win.eval(`
    window.${into} = null;
    var x = new XMLHttpRequest();
    x.open('GET', ${JSON.stringify(url)});
    x.onload = function () { window.${into} = x.responseText; };
    x.send();
  `);
};

describe('json-edit-xhr-response', () => {
  it('removes matching entries before the page sees them', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"layers":[{"metadata":{"name":"POI_Ads"}},{"metadata":{"name":"Roads"}}]}');
    inject(win, def, '.layers.*[?.metadata.name=="POI_Ads"]');
    request(win, 'https://example.com/map.json', 'out');
    await tick(win, 20);
    expect(JSON.parse(win.out).layers.length).toBe(1);
  });

  it('honours propsToMatch', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"ads":1,"keep":2}');
    inject(win, def, '.ads', 'propsToMatch', '/feed');
    request(win, 'https://example.com/other', 'out');
    await tick(win, 20);
    expect(JSON.parse(win.out)).toEqual({ ads: 1, keep: 2 });
  });

  it('refuses to write values (untrusted)', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"ads":true}');
    const before = win.XMLHttpRequest.prototype.send;
    inject(win, def, '.ads=false');
    expect(win.XMLHttpRequest.prototype.send).toBe(before);
  });

  it('passes a non-JSON body through', async () => {
    const win = makeWindow();
    installXhrStub(win, 'not json');
    inject(win, def, '.ads');
    request(win, 'https://example.com/x', 'out');
    await tick(win, 20);
    expect(win.out).toBe('not json');
  });
});
