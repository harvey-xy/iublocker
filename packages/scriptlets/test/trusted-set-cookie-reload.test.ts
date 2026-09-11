import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import def from '../src/trusted-set-cookie-reload';
import { inject, tick } from './_inject';

/**
 * `window.location` is unforgeable in jsdom, so the reload is observed as the
 * "navigation not implemented" jsdomError rather than by stubbing `location.reload`.
 */
function makeReloadWindow(): { win: any; reloads: () => number } {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (error: Error) => errors.push(String(error.message)));
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://example.com/page',
    runScripts: 'outside-only',
    virtualConsole,
  });
  return {
    win: dom.window as any,
    reloads: () => errors.filter((m) => m.includes('navigation')).length,
  };
}

describe('trusted-set-cookie-reload', () => {
  it('writes an arbitrary cookie value and reloads once', async () => {
    const { win, reloads } = makeReloadWindow();
    inject(win, def, 'godbayadblock', 'godbayadblock');
    await tick(win, 10);
    expect(win.document.cookie).toContain('godbayadblock=godbayadblock');
    expect(reloads()).toBe(1);
  });

  it('does not reload when the cookie is already present', async () => {
    const { win, reloads } = makeReloadWindow();
    win.document.cookie = 's=1; path=/';
    inject(win, def, 's', '180,,4,,a');
    await tick(win, 10);
    expect(win.document.cookie).toContain('s=180');
    expect(reloads()).toBe(0);
  });

  it('accepts a `domain` extra argument', async () => {
    const { win } = makeReloadWindow();
    inject(win, def, 'a', 'b', '', '', 'domain', 'example.com');
    await tick(win, 10);
    expect(win.document.cookie).toContain('a=b');
  });

  it('expires the cookie with $remove$', async () => {
    const { win } = makeReloadWindow();
    win.document.cookie = 'gone=1; path=/';
    inject(win, def, 'gone', '$remove$');
    await tick(win, 10);
    expect(win.document.cookie).not.toContain('gone=1');
  });

  it('ignores an empty name', async () => {
    const { win, reloads } = makeReloadWindow();
    inject(win, def, '', 'v');
    await tick(win, 10);
    expect(win.document.cookie).toBe('');
    expect(reloads()).toBe(0);
  });
});
