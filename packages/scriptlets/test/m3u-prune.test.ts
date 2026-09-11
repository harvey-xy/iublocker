import { describe, expect, it } from 'vitest';
import def from '../src/m3u-prune';
import { inject, installFetchStub, installXhrStub, makeWindow, tick } from './_inject';

const PLAYLIST =
  '#EXTM3U\n' +
  '#EXTINF:4.0,\n' +
  'https://redirector.googlevideo.com/dclk_video_ads/seg1.ts\n' +
  '#EXTINF:4.0,\n' +
  'https://cdn.example.com/content1.ts\n';

const text = (win: any, url: string): Promise<string> =>
  win.eval(`fetch(${JSON.stringify(url)}).then(function (r) { return r.text(); })`);

describe('m3u-prune', () => {
  it('removes the lines matching a literal, with their EXTINF header', async () => {
    const win = makeWindow();
    installFetchStub(win, PLAYLIST);
    inject(win, def, 'dclk_video_ads', '.m3u8');
    const out = await text(win, 'https://example.com/v.m3u8');
    expect(out).not.toContain('dclk_video_ads');
    expect(out).toContain('content1.ts');
    expect(out.split('\n').filter((l) => l.startsWith('#EXTINF')).length).toBe(1);
  });

  it('applies a regex with the g flag to the whole playlist', async () => {
    const win = makeWindow();
    installFetchStub(win, PLAYLIST);
    inject(win, def, '/^https?:\\/\\/redirector\\.googlevideo\\.com.*$/gm', '.m3u8');
    const out = await text(win, 'https://example.com/v.m3u8');
    expect(out).not.toContain('redirector.googlevideo.com');
  });

  it('only touches URLs matching the pattern', async () => {
    const win = makeWindow();
    installFetchStub(win, PLAYLIST);
    inject(win, def, 'dclk_video_ads', '/prog.m3u8');
    expect(await text(win, 'https://example.com/other.m3u8')).toContain('dclk_video_ads');
  });

  it('passes non-playlist bodies through untouched', async () => {
    const win = makeWindow();
    installFetchStub(win, '{"a":1}');
    inject(win, def, 'ads', '.m3u8');
    expect(await text(win, 'https://example.com/v.m3u8')).toBe('{"a":1}');
  });

  it('prunes an XHR response too', async () => {
    const win = makeWindow();
    installXhrStub(win, PLAYLIST);
    inject(win, def, 'dclk_video_ads', '.m3u8');
    win.eval(`
      window.out = null;
      var x = new XMLHttpRequest();
      x.open('GET', 'https://example.com/v.m3u8');
      x.onload = function () { window.out = x.responseText; };
      x.send();
    `);
    await tick(win, 20);
    expect(String(win.out)).not.toContain('dclk_video_ads');
  });
});
