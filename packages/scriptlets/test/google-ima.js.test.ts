import { describe, expect, it } from 'vitest';
import def from '../src/surrogates/google-ima';
import { inject, makeWindow, tick } from './_inject';

describe('google-ima.js', () => {
  it('defines the google.ima namespace', () => {
    const win = makeWindow();
    inject(win, def);
    expect(typeof win.google.ima.AdDisplayContainer).toBe('function');
    expect(typeof win.google.ima.AdsLoader).toBe('function');
    expect(typeof win.google.ima.AdsRequest).toBe('function');
    expect(typeof win.google.ima.AdsRenderingSettings).toBe('function');
    expect(win.google.ima.ViewMode.NORMAL).toBe('normal');
    expect(win.google.ima.UiElements.COUNTDOWN).toBe('countdown');
    expect(typeof win.google.ima.settings.setPlayerType).toBe('function');
  });

  it('hands the player an AdsManager and reports the ads complete', async () => {
    const win = makeWindow();
    inject(win, def);
    win.eval(`
      window.events = [];
      var ima = window.google.ima;
      var loader = new ima.AdsLoader(new ima.AdDisplayContainer(document.body));
      loader.addEventListener(ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, function (e) {
        var manager = e.getAdsManager();
        window.remaining = manager.getRemainingTime();
        manager.init(640, 360, ima.ViewMode.NORMAL);
        manager.addEventListener(ima.AdEvent.Type.ALL_ADS_COMPLETED, function () { window.events.push('all'); });
        manager.addEventListener(ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, function () { window.events.push('resume'); });
        manager.start();
        manager.destroy();
      });
      loader.requestAds(new ima.AdsRequest());
    `);
    await tick(win, 30);
    expect(win.remaining).toBe(0);
    expect(win.events).toContain('resume');
    expect(win.events).toContain('all');
  });

  it('exposes the error types', () => {
    const win = makeWindow();
    inject(win, def);
    const err = new win.google.ima.AdError('adPlayError', 900, 303, 'empty');
    expect(err.getErrorCode()).toBe(900);
    expect(win.google.ima.AdErrorEvent.Type.AD_ERROR).toBe('adError');
  });

  it('does not overwrite a real SDK', () => {
    const win = makeWindow();
    win.eval('window.google = { ima: { real: true } };');
    inject(win, def);
    expect(win.google.ima.real).toBe(true);
  });
});
