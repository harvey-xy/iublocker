import { JSDOM, VirtualConsole } from 'jsdom';
import { describe, expect, it } from 'vitest';
import def from '../src/set-cookie-reload';
import { inject, tick } from './_inject';

/**
 * `window.location` and every one of its members are unforgeable in jsdom, so a reload
 * cannot be stubbed. Instead the navigation attempt is observed on the virtual console.
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

describe('set-cookie-reload', () => {
  it('sets the cookie and reloads once', async () => {
    const { win, reloads } = makeReloadWindow();
    inject(win, def, 'consent', 'true');
    await tick(win, 10);
    expect(win.document.cookie).toContain('consent=true');
    expect(reloads()).toBe(1);
  });

  it('does not reload when the cookie already has that value', async () => {
    const { win, reloads } = makeReloadWindow();
    win.document.cookie = 'consent=true; path=/';
    inject(win, def, 'consent', 'true');
    await tick(win, 10);
    expect(reloads()).toBe(0);
  });

  it('reloads at most once per document', async () => {
    const { win, reloads } = makeReloadWindow();
    inject(win, def, 'a', 'true');
    inject(win, def, 'b', 'false');
    await tick(win, 10);
    expect(win.document.cookie).toContain('a=true');
    expect(win.document.cookie).toContain('b=false');
    expect(reloads()).toBe(1);
  });

  it('rejects arbitrary values', async () => {
    const { win, reloads } = makeReloadWindow();
    inject(win, def, 'x', 'nonsense');
    await tick(win, 10);
    expect(win.document.cookie).toBe('');
    expect(reloads()).toBe(0);
  });
});
