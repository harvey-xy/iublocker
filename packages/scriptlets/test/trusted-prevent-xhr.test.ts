import { describe, expect, it } from 'vitest';
import def from '../src/trusted-prevent-xhr';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

const request = (win: any, url: string): void => {
  win.eval(`
    window.out = null;
    var x = new XMLHttpRequest();
    x.open('GET', ${JSON.stringify(url)});
    x.onload = function () { window.out = x.responseText; };
    x.send();
  `);
};

describe('trusted-prevent-xhr', () => {
  it('answers a matching request with an arbitrary body', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real');
    inject(win, def, 'googlesyndication', 'a.getAttribute("data-ad-client")||""');
    request(win, 'https://googlesyndication.com/x');
    await tick(win, 20);
    expect(win.out).toBe('a.getAttribute("data-ad-client")||""');
    expect(win.__xhrSent).toBe(0);
  });

  it('lets other requests through', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real');
    inject(win, def, 'googlesyndication', 'x');
    request(win, 'https://example.com/x');
    await tick(win, 20);
    expect(win.out).toBe('real');
  });

  it('supports the uBO directives', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real');
    inject(win, def, 'ads', 'emptyArr');
    request(win, 'https://ads.example/x');
    await tick(win, 20);
    expect(win.out).toBe('[]');
  });

  it('accepts and ignores a third argument', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real');
    inject(win, def, 'ads', 'body', 'text');
    request(win, 'https://ads.example/x');
    await tick(win, 20);
    expect(win.out).toBe('body');
  });

  it('is marked trusted', () => {
    expect(def.trusted).toBe(true);
  });
});
