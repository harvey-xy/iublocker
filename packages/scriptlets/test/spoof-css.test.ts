import { describe, expect, it } from 'vitest';
import def from '../src/spoof-css';
import { inject, makeWindow } from './_inject';

const html =
  '<!doctype html><html><head><style>.ad{display:none}</style></head><body><div id="a" class="ad"></div><div id="b"></div></body></html>';

describe('spoof-css', () => {
  it('reports the spoofed value for matching elements', () => {
    const win = makeWindow(html);
    inject(win, def, '.ad', 'display', 'inline-flex');
    expect(
      win.eval('window.getComputedStyle(document.getElementById("a")).getPropertyValue("display")'),
    ).toBe('inline-flex');
  });

  it('leaves other elements alone', () => {
    const win = makeWindow(html);
    inject(win, def, '.ad', 'display', 'inline-flex');
    expect(
      win.eval('window.getComputedStyle(document.getElementById("b")).getPropertyValue("display")'),
    ).toBe('block');
  });

  it('supports the camelCase property form', () => {
    const win = makeWindow(html);
    inject(win, def, '.ad', 'visibility', 'visible');
    expect(win.eval('window.getComputedStyle(document.getElementById("a")).visibility')).toBe('visible');
  });

  it('spoofs several properties at once', () => {
    const win = makeWindow(html);
    inject(win, def, '.ad', 'visibility', 'visible', 'top', '0px');
    expect(win.eval('window.getComputedStyle(document.getElementById("a")).getPropertyValue("top")')).toBe(
      '0px',
    );
  });

  it('does nothing without a property/value pair', () => {
    const win = makeWindow(html);
    const before = win.getComputedStyle;
    inject(win, def, '.ad');
    expect(win.getComputedStyle).toBe(before);
  });
});
