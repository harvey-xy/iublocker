import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/ati-smarttag';
import { inject, makeWindow } from './_inject';

describe('ati-smarttag.js', () => {
  it('exposes the ATInternet namespace', () => {
    const win = makeWindow();
    inject(win, def);
    expect(typeof win.ATInternet.Tracker.Tag).toBe('function');
    expect(typeof win.ATInternet.Utils.getCookie).toBe('function');
  });

  it('builds an inert tag', () => {
    const win = makeWindow();
    inject(win, def);
    win.eval('window.t = new ATInternet.Tracker.Tag(); window.t.page.set({}); window.t.dispatch();');
    expect(typeof win.t.click.send).toBe('function');
  });

  it('provides a default `tag` global', () => {
    const win = makeWindow();
    inject(win, def);
    expect(typeof win.tag.page.send).toBe('function');
  });
});
