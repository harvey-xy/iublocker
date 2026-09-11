import { describe, expect, it } from 'vitest';
import def from '../src/trusted-override-element-method';
import { inject, makeWindow } from './_inject';

const html =
  '<!doctype html><html><body><a id="ad" target="_blank" rel="sponsored" href="#"></a><a id="ok" href="#"></a></body></html>';

describe('trusted-override-element-method', () => {
  it('neutralises the method on matching elements only', () => {
    const win = makeWindow(html);
    win.eval(
      'window.clicks = [];' +
        'document.getElementById("ad").addEventListener("click", () => window.clicks.push("ad"));' +
        'document.getElementById("ok").addEventListener("click", () => window.clicks.push("ok"));',
    );
    inject(win, def, 'HTMLAnchorElement.prototype.click', 'a[target="_blank"][rel*="sponsored"]');
    win.eval('document.getElementById("ad").click(); document.getElementById("ok").click();');
    expect(win.clicks).toEqual(['ok']);
  });

  it('neutralises everything when no selector is given', () => {
    const win = makeWindow(html);
    win.eval('window.clicks = 0; document.getElementById("ok").addEventListener("click", () => window.clicks++);');
    inject(win, def, 'HTMLAnchorElement.prototype.click');
    win.eval('document.getElementById("ok").click();');
    expect(win.clicks).toBe(0);
  });

  it('throws with the `throw` disposition', () => {
    const win = makeWindow(html);
    inject(win, def, 'HTMLAnchorElement.prototype.click', 'a', 'throw');
    expect(() => win.eval('document.getElementById("ok").click()')).toThrow();
  });

  it('does nothing for an unknown chain', () => {
    const win = makeWindow(html);
    expect(() => inject(win, def, 'No.Such.method', 'a')).not.toThrow();
  });

  it('is idempotent', () => {
    const win = makeWindow(html);
    inject(win, def, 'HTMLAnchorElement.prototype.click', 'a');
    const first = win.HTMLAnchorElement.prototype.click;
    inject(win, def, 'HTMLAnchorElement.prototype.click', 'a');
    expect(win.HTMLAnchorElement.prototype.click).toBe(first);
  });
});
