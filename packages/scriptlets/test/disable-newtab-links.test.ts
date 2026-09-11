import { describe, expect, it } from 'vitest';
import def from '../src/disable-newtab-links';
import { inject, makeWindow } from './_inject';

describe('disable-newtab-links', () => {
  it('cancels clicks on links that open a new tab', () => {
    const win = makeWindow(
      '<!doctype html><html><body><a id="blank" href="https://ads.example/" target="_blank"><span id="inner">x</span></a><a id="plain" href="https://example.com/">y</a></body></html>',
    );
    inject(win, def);
    const blank = win.eval(`
      var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.getElementById('inner').dispatchEvent(ev);
      ev.defaultPrevented;
    `);
    const plain = win.eval(`
      var ev2 = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.getElementById('plain').dispatchEvent(ev2);
      ev2.defaultPrevented;
    `);
    expect(blank).toBe(true);
    expect(plain).toBe(false);
  });

  it('is idempotent', () => {
    const win = makeWindow('<!doctype html><html><body><a id="a" href="#" target="_blank">x</a></body></html>');
    inject(win, def);
    inject(win, def);
    expect(
      win.eval(`
        var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
        document.getElementById('a').dispatchEvent(ev);
        ev.defaultPrevented;
      `),
    ).toBe(true);
  });
});
