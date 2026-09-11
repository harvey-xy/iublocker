import { describe, expect, it } from 'vitest';
import def from '../src/prevent-refresh';
import { inject, makeWindow, tick } from './_inject';

const withMeta = (content: string): string =>
  `<!doctype html><html><head><meta http-equiv="refresh" content="${content}"></head><body></body></html>`;

describe('prevent-refresh', () => {
  it('defuses a meta refresh', () => {
    const win = makeWindow(withMeta('5;url=https://example.org/'));
    inject(win, def);
    const meta = win.document.querySelector('meta');
    expect(meta.hasAttribute('http-equiv')).toBe(false);
  });

  it('rewrites the delay when one is given', () => {
    const win = makeWindow(withMeta('5;url=https://example.org/'));
    inject(win, def, '60');
    const meta = win.document.querySelector('meta');
    expect(meta.getAttribute('content')).toBe('60;url=https://example.org/');
    expect(meta.getAttribute('http-equiv')).toBe('refresh');
  });

  it('ignores other http-equiv metas', () => {
    const win = makeWindow(
      '<!doctype html><html><head><meta http-equiv="content-type" content="text/html"></head><body></body></html>',
    );
    inject(win, def);
    expect(win.document.querySelector('meta').getAttribute('http-equiv')).toBe('content-type');
  });

  it('defuses metas added later', async () => {
    const win = makeWindow();
    inject(win, def);
    win.document.head.insertAdjacentHTML('beforeend', '<meta http-equiv="refresh" content="3">');
    await tick(win, 20);
    expect(win.document.querySelector('meta').hasAttribute('http-equiv')).toBe(false);
  });
});
