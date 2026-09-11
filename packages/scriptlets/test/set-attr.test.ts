import { describe, expect, it } from 'vitest';
import def from '../src/set-attr';
import { inject, makeWindow, tick } from './_inject';

const html = '<!doctype html><html><body><div id="a"></div><div class="p"></div></body></html>';

describe('set-attr', () => {
  it('sets the attribute on matching elements', () => {
    const win = makeWindow(html);
    inject(win, def, '#a', 'data-state', 'ready');
    expect(win.document.getElementById('a').getAttribute('data-state')).toBe('ready');
  });

  it('defaults to the empty string', () => {
    const win = makeWindow(html);
    inject(win, def, '.p', 'hidden');
    expect(win.document.querySelector('.p').getAttribute('hidden')).toBe('');
  });

  it('expands $currentURL$', () => {
    const win = makeWindow(html);
    inject(win, def, '#a', 'data-url', '$currentURL$');
    expect(win.document.getElementById('a').getAttribute('data-url')).toBe('https://example.com/page');
  });

  it('reapplies to elements added later', async () => {
    const win = makeWindow(html);
    inject(win, def, '.late', 'data-x', '1');
    win.document.body.insertAdjacentHTML('beforeend', '<i class="late"></i>');
    await tick(win, 20);
    expect(win.document.querySelector('.late').getAttribute('data-x')).toBe('1');
  });
});
