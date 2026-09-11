import { describe, expect, it } from 'vitest';
import def from '../src/trusted-json-edit-xhr-response';
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

describe('trusted-json-edit-xhr-response', () => {
  it('writes a value into a matching response', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"adshieldAdblockRecovery":true}');
    inject(win, def, '..adshieldAdblockRecovery=false', 'propsToMatch', '/bootstrap');
    request(win, 'https://example.com/bootstrap');
    await tick(win, 20);
    expect(JSON.parse(win.out)).toEqual({ adshieldAdblockRecovery: false });
  });

  it('accepts the positional url pattern form', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"mandatoryAdvertising":true}');
    inject(win, def, '.mandatoryAdvertising=false', '/player/configuration');
    request(win, 'https://example.com/player/configuration');
    await tick(win, 20);
    expect(JSON.parse(win.out)).toEqual({ mandatoryAdvertising: false });
  });

  it('leaves unmatched requests alone', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"a":1}');
    inject(win, def, '.a=2', 'propsToMatch', '/never');
    request(win, 'https://example.com/x');
    await tick(win, 20);
    expect(JSON.parse(win.out)).toEqual({ a: 1 });
  });

  it('reports the request URL and status', async () => {
    const win = makeWindow();
    installXhrStub(win, '{"a":1}');
    inject(win, def, '.a=2');
    win.eval(`
      window.info = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/y');
      x.onload = function () { window.info = [x.status, x.responseURL]; };
      x.send();
    `);
    await tick(win, 20);
    expect(win.info).toEqual([200, 'https://example.com/y']);
  });
});
