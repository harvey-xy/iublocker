import { describe, expect, it } from 'vitest';
import def from '../src/trusted-click-element';
import { inject, makeWindow, tick } from './_inject';

const page = (body: string): string => `<!doctype html><html><body>${body}</body></html>`;

describe('trusted-click-element', () => {
  it('clicks the matching element', async () => {
    const win = makeWindow(page('<button id="b">ok</button>'));
    win.eval('window.hits = 0; document.getElementById("b").addEventListener("click", () => window.hits++);');
    inject(win, def, '#b');
    await tick(win, 30);
    expect(win.hits).toBe(1);
  });

  it('clicks a sequence of selectors in order', async () => {
    const win = makeWindow(page('<button id="a"></button><button id="b"></button>'));
    win.eval(
      'window.order = [];' +
        'document.getElementById("a").addEventListener("click", () => window.order.push("a"));' +
        'document.getElementById("b").addEventListener("click", () => window.order.push("b"));',
    );
    inject(win, def, '#a, #b');
    await tick(win, 40);
    expect(win.order).toEqual(['a', 'b']);
  });

  it('waits for an element that appears later', async () => {
    const win = makeWindow(page(''));
    win.eval('window.hits = 0;');
    inject(win, def, '#late');
    win.document.body.insertAdjacentHTML('beforeend', '<button id="late"></button>');
    win.eval('document.getElementById("late").addEventListener("click", () => window.hits++);');
    await tick(win, 250);
    expect(win.hits).toBe(1);
  });

  it('skips when a `cookie:` guard is absent', async () => {
    const win = makeWindow(page('<button id="b"></button>'));
    win.eval('window.hits = 0; document.getElementById("b").addEventListener("click", () => window.hits++);');
    inject(win, def, '#b', 'cookie:consent');
    await tick(win, 30);
    expect(win.hits).toBe(0);
  });

  it('runs when the `cookie:` guard is satisfied', async () => {
    const win = makeWindow(page('<button id="b"></button>'));
    win.document.cookie = 'consent=1; path=/';
    win.eval('window.hits = 0; document.getElementById("b").addEventListener("click", () => window.hits++);');
    inject(win, def, '#b', 'cookie:consent');
    await tick(win, 30);
    expect(win.hits).toBe(1);
  });

  it('does nothing without selectors', async () => {
    const win = makeWindow(page(''));
    expect(() => inject(win, def, '')).not.toThrow();
    await tick(win, 10);
  });
});
