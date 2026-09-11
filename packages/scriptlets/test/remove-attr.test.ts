import { describe, expect, it } from 'vitest';
import def from '../src/remove-attr';
import { inject, makeWindow, tick } from './_inject';

const html =
  '<!doctype html><html><body><div id="a" data-ad="1" data-track="2"></div><span data-ad="3"></span></body></html>';

describe('remove-attr', () => {
  it('removes the attribute everywhere it appears', () => {
    const win = makeWindow(html);
    inject(win, def, 'data-ad');
    expect(win.document.getElementById('a').hasAttribute('data-ad')).toBe(false);
    expect(win.document.querySelector('span').hasAttribute('data-ad')).toBe(false);
    expect(win.document.getElementById('a').getAttribute('data-track')).toBe('2');
  });

  it('honours a selector', () => {
    const win = makeWindow(html);
    inject(win, def, 'data-ad', 'span');
    expect(win.document.getElementById('a').getAttribute('data-ad')).toBe('1');
    expect(win.document.querySelector('span').hasAttribute('data-ad')).toBe(false);
  });

  it('accepts several `|`-separated attributes', () => {
    const win = makeWindow(html);
    inject(win, def, 'data-ad|data-track');
    expect(win.document.getElementById('a').hasAttribute('data-track')).toBe(false);
  });

  it('keeps removing with `stay`', async () => {
    const win = makeWindow(html);
    inject(win, def, 'data-ad', '', 'stay');
    win.document.body.insertAdjacentHTML('beforeend', '<p id="late" data-ad="9"></p>');
    await tick(win, 20);
    expect(win.document.getElementById('late').hasAttribute('data-ad')).toBe(false);
  });

  it('does nothing without attributes', () => {
    const win = makeWindow(html);
    inject(win, def, '');
    expect(win.document.getElementById('a').getAttribute('data-ad')).toBe('1');
  });
});
