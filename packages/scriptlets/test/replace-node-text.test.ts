import { describe, expect, it } from 'vitest';
import def from '../src/replace-node-text';
import { inject, makeWindow, tick } from './_inject';

describe('replace-node-text', () => {
  it('replaces matching text inside matching elements', () => {
    const win = makeWindow(
      '<!doctype html><html><body><script id="s">var showAds = true;</script><p id="p">showAds</p></body></html>',
    );
    inject(win, def, 'script', 'showAds = true', 'showAds = false');
    expect(win.document.getElementById('s').textContent).toBe('var showAds = false;');
    expect(win.document.getElementById('p').textContent).toBe('showAds');
  });

  it('supports /regex/ patterns and a condition', () => {
    const win = makeWindow(
      '<!doctype html><html><body><div id="a">value 123</div><div id="b">value 456</div></body></html>',
    );
    inject(win, def, 'div', '/\\d+/', 'N', '123');
    expect(win.document.getElementById('a').textContent).toBe('value N');
    expect(win.document.getElementById('b').textContent).toBe('value 456');
  });

  it('handles nodes added later', async () => {
    const win = makeWindow();
    inject(win, def, 'span', 'bad', 'good');
    win.document.body.insertAdjacentHTML('beforeend', '<span id="late">bad news</span>');
    await tick(win, 20);
    expect(win.document.getElementById('late').textContent).toBe('good news');
  });

  it('supports #text nodes', () => {
    const win = makeWindow('<!doctype html><html><body><div id="a">hello ads</div></body></html>');
    inject(win, def, '#text', 'ads', 'x');
    expect(win.document.getElementById('a').textContent).toBe('hello x');
  });
});
