import { describe, expect, it } from 'vitest';
import def from '../src/no-xhr-if';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

describe('no-xhr-if', () => {
  it('answers matching requests without touching the network', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real body');
    inject(win, def, '/ads/');
    win.eval(`
      window.result = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/ads/banner');
      x.onload = function () { window.result = { text: x.responseText, status: x.status, ready: x.readyState }; };
      x.send();
    `);
    await tick(win, 20);
    expect(win.result).toEqual({ text: '', status: 200, ready: 4 });
    expect(win.__xhrSent).toBe(0);
  });

  it('lets other requests through', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real body');
    inject(win, def, '/ads/');
    win.eval(`
      window.result = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/news');
      x.onload = function () { window.result = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(win.result).toBe('real body');
    expect(win.__xhrSent).toBe(1);
  });

  it('supports method matching and directive bodies', async () => {
    const win = makeWindow();
    installXhrStub(win, 'real body');
    inject(win, def, 'method:POST', 'emptyArr');
    win.eval(`
      window.result = null;
      var x = new XMLHttpRequest();
      x.open('POST', 'https://example.com/track');
      x.onload = function () { window.result = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(win.result).toBe('[]');
  });

  it('preserves XMLHttpRequest.prototype.open.toString()', () => {
    const win = makeWindow();
    const before = win.eval('XMLHttpRequest.prototype.open.toString()');
    inject(win, def, '/ads/');
    expect(win.eval('XMLHttpRequest.prototype.open.toString()')).toBe(before);
  });
});
