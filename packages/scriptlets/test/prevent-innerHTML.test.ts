import { describe, expect, it } from 'vitest';
import def from '../src/prevent-innerHTML';
import { inject, makeWindow } from './_inject';

const html = '<!doctype html><html><body><script id="s"></script><div id="d"></div></body></html>';

describe('prevent-innerHTML', () => {
  it('blocks a matching assignment on a matching element', () => {
    const win = makeWindow(html);
    inject(win, def, 'script', '.cmd.unshift');
    win.eval('document.getElementById("s").innerHTML = "googletag.cmd.unshift(1)";');
    expect(win.document.getElementById('s').innerHTML).toBe('');
  });

  it('lets other content through', () => {
    const win = makeWindow(html);
    inject(win, def, 'script', '.cmd.unshift');
    win.eval('document.getElementById("s").innerHTML = "var a = 1;";');
    expect(win.document.getElementById('s').innerHTML).toBe('var a = 1;');
  });

  it('honours `!` negation', () => {
    const win = makeWindow(html);
    inject(win, def, 'script', '!/window/');
    win.eval('document.getElementById("s").innerHTML = "nope";');
    expect(win.document.getElementById('s').innerHTML).toBe('');
    win.eval('document.getElementById("s").innerHTML = "window.x";');
    expect(win.document.getElementById('s').innerHTML).toBe('window.x');
  });

  it('blocks every assignment on the selector when no pattern is given', () => {
    const win = makeWindow(html);
    inject(win, def, '#d');
    win.eval('document.getElementById("d").innerHTML = "<b>x</b>";');
    expect(win.document.getElementById('d').innerHTML).toBe('');
    win.eval('document.getElementById("s").innerHTML = "keep";');
    expect(win.document.getElementById('s').innerHTML).toBe('keep');
  });

  it('is idempotent', () => {
    const win = makeWindow(html);
    inject(win, def, 'script', 'a');
    const first = Object.getOwnPropertyDescriptor(win.Element.prototype, 'innerHTML');
    inject(win, def, 'script', 'a');
    expect(Object.getOwnPropertyDescriptor(win.Element.prototype, 'innerHTML')).toEqual(first);
  });
});
