import { describe, expect, it } from 'vitest';
import def from '../src/remove-node-text';
import { inject, makeWindow, tick } from './_inject';

describe('remove-node-text', () => {
  it('empties matching nodes only', () => {
    const win = makeWindow(
      '<!doctype html><html><body><script id="s">adblockDetect()</script><script id="t">app()</script></body></html>',
    );
    inject(win, def, 'script', 'adblockDetect');
    expect(win.document.getElementById('s').textContent).toBe('');
    expect(win.document.getElementById('t').textContent).toBe('app()');
  });

  it('honours the excludes argument', () => {
    const win = makeWindow(
      '<!doctype html><html><body><div id="a">ads here</div><div id="b">ads but keep</div></body></html>',
    );
    inject(win, def, 'div', 'ads', 'keep');
    expect(win.document.getElementById('a').textContent).toBe('');
    expect(win.document.getElementById('b').textContent).toBe('ads but keep');
  });

  it('handles nodes added later', async () => {
    const win = makeWindow();
    inject(win, def, 'span', 'bad');
    win.document.body.insertAdjacentHTML('beforeend', '<span id="late">bad</span>');
    await tick(win, 20);
    expect(win.document.getElementById('late').textContent).toBe('');
  });
});
