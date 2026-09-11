import { describe, expect, it } from 'vitest';
import def from '../src/abort-current-script';
import { inject, makeWindow } from './_inject';

/** jsdom does not run page scripts here, so document.currentScript is faked. */
function withCurrentScript(win: any, script: any, body: () => void): void {
  Object.defineProperty(win.document, 'currentScript', { value: script, configurable: true });
  try {
    body();
  } finally {
    Object.defineProperty(win.document, 'currentScript', { value: null, configurable: true });
  }
}

describe('abort-current-script', () => {
  it('aborts when the running inline script matches the needle', () => {
    const win = makeWindow();
    inject(win, def, 'adConfig', 'showAds');
    const script = win.document.createElement('script');
    script.textContent = 'var x = showAds();';
    withCurrentScript(win, script, () => {
      expect(() => win.eval('adConfig')).toThrow(/iub/);
    });
  });

  it('leaves non-matching scripts alone', () => {
    const win = makeWindow();
    win.eval('window.adConfig = 7');
    inject(win, def, 'adConfig', 'showAds');
    const script = win.document.createElement('script');
    script.textContent = 'console.log(1)';
    withCurrentScript(win, script, () => {
      expect(win.eval('adConfig')).toBe(7);
    });
  });

  it('does nothing when no script is running', () => {
    const win = makeWindow();
    inject(win, def, 'adConfig', 'showAds');
    expect(() => win.eval('adConfig')).not.toThrow();
  });

  it('supports a /regex/ needle and a context filter', () => {
    const win = makeWindow();
    inject(win, def, 'v', '/sho.Ads/', '/example\\.com/');
    const script = win.document.createElement('script');
    script.textContent = 'showAds()';
    withCurrentScript(win, script, () => {
      expect(() => win.eval('v')).toThrow();
    });
  });
});
