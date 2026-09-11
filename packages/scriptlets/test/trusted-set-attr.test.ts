import { describe, expect, it } from 'vitest';
import def from '../src/trusted-set-attr';
import { inject, makeWindow, tick } from './_inject';

const html = '<!doctype html><html><body><ins class="adsbygoogle"></ins></body></html>';

describe('trusted-set-attr', () => {
  it('sets an arbitrary attribute value', () => {
    const win = makeWindow(html);
    inject(win, def, 'ins.adsbygoogle', 'data-ad-status', 'unfill-optimize');
    expect(win.document.querySelector('ins').getAttribute('data-ad-status')).toBe('unfill-optimize');
  });

  it('keeps setting it on new elements', async () => {
    const win = makeWindow(html);
    inject(win, def, 'ins.adsbygoogle', 'data-ad-status', 'done');
    win.document.body.insertAdjacentHTML('beforeend', '<ins class="adsbygoogle" id="late"></ins>');
    await tick(win, 20);
    expect(win.document.getElementById('late').getAttribute('data-ad-status')).toBe('done');
  });

  it('writes an empty value when none is given', () => {
    const win = makeWindow(html);
    inject(win, def, 'ins', 'data-x');
    expect(win.document.querySelector('ins').getAttribute('data-x')).toBe('');
  });

  it('does nothing without a selector', () => {
    const win = makeWindow(html);
    inject(win, def, '', 'data-x', '1');
    expect(win.document.querySelector('ins').hasAttribute('data-x')).toBe(false);
  });
});
