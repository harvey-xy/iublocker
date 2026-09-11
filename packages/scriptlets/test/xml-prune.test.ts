import { describe, expect, it } from 'vitest';
import def from '../src/xml-prune';
import { inject, installFetchStub, installXhrStub, makeWindow, tick } from './_inject';

// jsdom's XPath engine handles neither `name()` nor camelCase attribute names, so the
// fixture uses the plain spellings it does support; Chrome evaluates the uBO forms fine.
const MPD =
  '<?xml version="1.0"?><MPD duration="PT10S">' +
  '<Period id="1-ad-roll"><BaseURL>ads</BaseURL></Period>' +
  '<Period id="2-main"><BaseURL>content</BaseURL></Period></MPD>';

const text = (win: any, url: string): Promise<string> =>
  win.eval(`fetch(${JSON.stringify(url)}).then(function (r) { return r.text(); })`);

describe('xml-prune', () => {
  it('removes nodes matched by a CSS selector', async () => {
    const win = makeWindow();
    installFetchStub(win, MPD);
    inject(win, def, 'Period[id*="-ad-"]', '', '.mpd');
    const out = await text(win, 'https://example.com/v.mpd');
    expect(out).not.toContain('1-ad-roll');
    expect(out).toContain('2-main');
  });

  it('removes an attribute selected by xpath', async () => {
    const win = makeWindow();
    installFetchStub(win, MPD);
    inject(win, def, 'xpath(//MPD/@duration)', '', '.mpd');
    const out = await text(win, 'https://example.com/v.mpd');
    expect(out).not.toContain('duration=');
  });

  it('removes elements selected by xpath', async () => {
    const win = makeWindow();
    installFetchStub(win, MPD);
    inject(win, def, "xpath(//Period[contains(@id,'-ad-')])", '', '.mpd');
    const out = await text(win, 'https://example.com/v.mpd');
    expect(out).not.toContain('1-ad-roll');
    expect(out).toContain('2-main');
  });

  it('only touches URLs matching the pattern', async () => {
    const win = makeWindow();
    installFetchStub(win, MPD);
    inject(win, def, 'Period[id*="-ad-"]', '', '.mpd');
    const out = await text(win, 'https://example.com/other.xml');
    expect(out).toContain('1-ad-roll');
  });

  it('honours the second selector as a precondition', async () => {
    const win = makeWindow();
    installFetchStub(win, MPD);
    inject(win, def, 'Period[id*="-ad-"]', 'Missing', '.mpd');
    const out = await text(win, 'https://example.com/v.mpd');
    expect(out).toContain('1-ad-roll');
  });

  it('passes non-XML bodies through untouched', async () => {
    const win = makeWindow();
    installFetchStub(win, 'not xml');
    inject(win, def, 'Period', '', '.mpd');
    expect(await text(win, 'https://example.com/v.mpd')).toBe('not xml');
  });

  it('prunes an XHR response too', async () => {
    const win = makeWindow();
    installXhrStub(win, MPD);
    inject(win, def, 'Period[id*="-ad-"]', '', '.mpd');
    win.eval(`
      window.out = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/v.mpd');
      x.onload = function () { window.out = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(String(win.out)).not.toContain('1-ad-roll');
  });
});
