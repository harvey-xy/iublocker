import { describe, expect, it } from 'vitest';
import def from '../src/trusted-json-edit-xhr-request';
import { inject, installXhrStub, makeWindow, tick } from './_inject';

describe('trusted-json-edit-xhr-request', () => {
  it('edits the outgoing JSON body', async () => {
    const win = makeWindow();
    installXhrStub(win);
    win.eval(
      'window.sentBody = null; XMLHttpRequest.prototype.send = function (b) { window.sentBody = b; };',
    );
    inject(win, def, '..client[?.clientName=="WEB"]+={"clientScreen":"CHANNEL"}', 'propsToMatch', '/player');
    win.eval(`
      var x = new XMLHttpRequest();
      x.open('POST', 'https://example.com/player?x=1');
      x.send(JSON.stringify({ context: { client: { clientName: 'WEB' } } }));
    `);
    await tick(win, 10);
    expect(JSON.parse(win.sentBody).context.client).toEqual({
      clientName: 'WEB',
      clientScreen: 'CHANNEL',
    });
  });

  it('leaves unmatched requests alone', async () => {
    const win = makeWindow();
    installXhrStub(win);
    win.eval(
      'window.sentBody = null; XMLHttpRequest.prototype.send = function (b) { window.sentBody = b; };',
    );
    inject(win, def, '.a=2', 'propsToMatch', '/never');
    win.eval(`
      var x = new XMLHttpRequest();
      x.open('POST', 'https://example.com/other');
      x.send('{"a":1}');
    `);
    await tick(win, 10);
    expect(win.sentBody).toBe('{"a":1}');
  });

  it('leaves a non-JSON body alone', async () => {
    const win = makeWindow();
    installXhrStub(win);
    win.eval(
      'window.sentBody = null; XMLHttpRequest.prototype.send = function (b) { window.sentBody = b; };',
    );
    inject(win, def, '.a=2');
    win.eval(`
      var x = new XMLHttpRequest();
      x.open('POST', 'https://example.com/x');
      x.send('plain');
    `);
    await tick(win, 10);
    expect(win.sentBody).toBe('plain');
  });
});
