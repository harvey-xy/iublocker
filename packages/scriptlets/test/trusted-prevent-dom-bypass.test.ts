import { describe, expect, it } from 'vitest';
import def from '../src/trusted-prevent-dom-bypass';
import { inject, makeWindow } from './_inject';

describe('trusted-prevent-dom-bypass', () => {
  it('copies the patched function into an inserted frame', () => {
    const win = makeWindow();
    win.eval('window.JSON.parse = function patched() { return "patched"; };');
    inject(win, def, 'Node.prototype.appendChild', 'JSON.parse');
    win.eval('window.frame = document.createElement("iframe"); document.body.appendChild(window.frame);');
    const inner = win.frame.contentWindow;
    expect(inner.JSON.parse('{}')).toBe('patched');
  });

  it('copies a whole prototype object', () => {
    const win = makeWindow();
    win.eval('window.XMLHttpRequest.prototype.marker = 42;');
    inject(win, def, 'Node.prototype.appendChild', 'XMLHttpRequest.prototype');
    win.eval('window.frame = document.createElement("iframe"); document.body.appendChild(window.frame);');
    expect(win.frame.contentWindow.XMLHttpRequest.prototype.marker).toBe(42);
  });

  it('leaves non-frame insertions alone', () => {
    const win = makeWindow();
    inject(win, def, 'Node.prototype.appendChild', 'JSON.parse');
    win.eval('document.body.appendChild(document.createElement("div"));');
    expect(win.document.body.children.length).toBe(1);
  });

  it('does nothing for an unknown method chain', () => {
    const win = makeWindow();
    expect(() => inject(win, def, 'No.Such.method', 'fetch')).not.toThrow();
  });

  it('hooks the method only once', () => {
    const win = makeWindow();
    inject(win, def, 'Node.prototype.appendChild', 'JSON.parse');
    const first = win.Node.prototype.appendChild;
    inject(win, def, 'Node.prototype.appendChild', 'fetch');
    expect(win.Node.prototype.appendChild).toBe(first);
  });
});
