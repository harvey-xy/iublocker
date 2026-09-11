import { describe, expect, it } from 'vitest';
import def from '../src/remove-class';
import { inject, makeWindow, tick } from './_inject';

const html =
  '<!doctype html><html><body><div id="a" class="adblock box"></div><span id="b" class="adblock"></span></body></html>';

describe('remove-class', () => {
  it('removes the class from every element', () => {
    const win = makeWindow(html);
    inject(win, def, 'adblock');
    expect(win.document.getElementById('a').className).toBe('box');
    expect(win.document.getElementById('b').className).toBe('');
  });

  it('honours a selector', () => {
    const win = makeWindow(html);
    inject(win, def, 'adblock', 'span');
    expect(win.document.getElementById('a').className).toBe('adblock box');
    expect(win.document.getElementById('b').className).toBe('');
  });

  it('keeps removing with `stay`', async () => {
    const win = makeWindow(html);
    inject(win, def, 'adblock', '', 'stay');
    win.document.getElementById('a').className = 'adblock again';
    await tick(win, 20);
    expect(win.document.getElementById('a').className).toBe('again');
  });
});
