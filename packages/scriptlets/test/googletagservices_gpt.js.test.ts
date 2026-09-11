import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/googletagservices-gpt';
import { inject, makeWindow } from './_inject';

describe('googletagservices_gpt.js', () => {
  it('registers itself as a redirect resource', () => {
    expect(def.redirectResource).toBe('googletagservices_gpt.js');
    expect(def.trusted).toBe(false);
  });

  it('stubs googletag with a working cmd queue', () => {
    const win = makeWindow();
    inject(win, def);
    const ran = win.eval(`
      window.out = [];
      googletag.cmd.push(function () { window.out.push('queued'); });
      var slot = googletag.defineSlot('/1234/banner', [[300, 250]], 'ad-div');
      slot.addService(googletag.pubads()).setTargeting('k', 'v');
      googletag.pubads().enableSingleRequest();
      googletag.pubads().refresh();
      googletag.enableServices();
      googletag.display('ad-div');
      [window.out.length, googletag.apiReady, slot.getAdUnitPath(), slot.getSlotElementId(),
       typeof googletag.pubads().addEventListener, googletag.sizeMapping().addSize([0, 0], [1, 1]).build().length];
    `);
    expect(ran).toEqual([1, true, '/1234/banner', 'ad-div', 'function', 0]);
  });

  it('drains a queue the page created before the surrogate ran', () => {
    const win = makeWindow();
    win.eval('window.googletag = { cmd: [] }; googletag.cmd.push(function () { window.early = true; });');
    inject(win, def);
    expect(win.early).toBe(true);
  });
});
